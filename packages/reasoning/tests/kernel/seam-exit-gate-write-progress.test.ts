// Run: bun test packages/reasoning/tests/kernel/seam-exit-gate-write-progress.test.ts --timeout 20000
//
// Write-coverage progress-aware exit (flag `writeCoverage`). A SOFT exit with
// unwritten write targets is re-denied while a target was written since the
// previous denial, bounded by targets + 1 denials and the iteration cap. No new
// write since the last denial hands off as before; flag off = deny-once-then-handoff.
// Measured 2026-11-09: cogito:8b wrote 2-3 of 6 targets then ended at iteration
// 7-10 of 24 (disposeExit gave deny-once then handoff).
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { EventBusLive, modelSynthesisDeliverable } from "@reactive-agents/core";
import { compileRunContract } from "../../src/kernel/contract/run-contract.js";
import { disposeExit, PROGRESS_DENIAL_REASON, proposeExit } from "../../src/kernel/loop/exit-gate.js";
import { toolCalled } from "../../src/kernel/capabilities/verify/post-conditions.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../src/kernel/utils/observation-helpers.js";
import { makeKernelInput, makeKernelState } from "../../src/testing/kernel-fixtures.js";
import { transitionState, type KernelState } from "../../src/kernel/state/kernel-state.js";
import type { ReasoningStep } from "../../src/types/index.js";

const MODULES = ["clamp", "slugify", "chunk", "median", "duration", "dedupe"] as const;
const TASK = `Fix the bug in each module in place:\n${MODULES.map((m) => `- src/${m}.ts (tested by tests/${m}.test.ts)`).join("\n")}\nDo not edit the tests.`;

let seq = 0;
function write(path: string): ReasoningStep[] {
  const id = `p${++seq}`;
  return [
    makeStep("action", `file-write(${path})`, { toolCall: { id, name: "file-write", arguments: { path, content: "x" } } }),
    makeStep("observation", "ok", { toolCallId: id, observationResult: makeObservationResult("file-write", true, "ok") }),
  ];
}

const contract = compileRunContract(TASK, { writeCoverage: true });
const input = makeKernelInput({ task: TASK });
const draft = modelSynthesisDeliverable({ type: "thought", content: "I fixed the modules.", iteration: 2 });

/** A substantial model draft: handoff material (so a second soft exit hands off instead of accepting). */
const MATERIAL =
  "Here is what I found in the modules so far: the clamp bound check was inverted and the slugify regex dropped digits, both are understood.";

const initial =(meta: Record<string, unknown> = { runContract: contract }): KernelState =>
  makeKernelState({ iteration: 3, llmCalls: 3, steps: [makeStep("thought", MATERIAL)], meta } as never);

const withWrites = (s: KernelState, ...paths: string[]): KernelState =>
  transitionState(s, { status: "thinking", steps: [...s.steps, ...paths.flatMap(write)] });

/** One soft `loop_resolution` proposal; returns the decision and the next state. */
async function propose(s: KernelState, maxIterations = 24) {
  const d = await Effect.runPromise(
    proposeExit({
      state: s,
      proposal: { proposedBy: "loop_resolution", kind: "soft", reason: "loop_graceful", deliverable: draft },
      input,
      maxIterations,
      taskId: "t",
    }).pipe(Effect.provide(EventBusLive)),
  );
  return { decision: d.decision, state: d.state };
}

const records = (s: KernelState) => s.steps.flatMap((st) => (st.metadata?.exitGate ? [st.metadata.exitGate] : []));

describe("write-coverage progress-aware exit", () => {
  it("(a) soft exit after each of 3 writes is re-denied; reason names the progress rule", async () => {
    let s = initial();
    const first = await propose(s);
    expect(first.decision).toBe("deny-once");
    s = first.state;
    for (const m of MODULES.slice(0, 3)) {
      s = withWrites(s, `src/${m}.ts`);
      const r = await propose(s);
      expect(r.decision).toBe("deny-once");
      s = r.state;
      expect(records(s).at(-1)!.reason.startsWith(PROGRESS_DENIAL_REASON)).toBe(true);
    }
    expect(records(s).map((r) => r.writesSatisfied)).toEqual([0, 1, 2, 3]);
  });

  it("(b) soft exit with no write since the last denial hands off", async () => {
    let s = initial();
    s = (await propose(s)).state;
    s = withWrites(s, "src/clamp.ts");
    s = (await propose(s)).state; // progress -> re-denied
    const stuck = await propose(s); // nothing new written
    expect(stuck.decision).toBe("handoff");
  });

  it("(c) denial cap reached -> handoff even with progress (pure)", () => {
    const base = {
      kind: "soft", outstanding: ["x"], hasMaterial: true, deniedBefore: true,
      iteration: 3, llmCalls: 3, maxIterations: 24, writeProgress: true, maxDenials: 7,
    } as const;
    expect(disposeExit({ ...base, denialsSoFar: 6 })).toBe("deny-once");
    expect(disposeExit({ ...base, denialsSoFar: 7 })).toBe("handoff");
    // the iteration cap still bounds it
    expect(disposeExit({ ...base, denialsSoFar: 1, iteration: 23 })).toBe("handoff");
  });

  it("(d) flag off: deny-once then handoff exactly as before", async () => {
    const base = { kind: "soft", outstanding: ["x"], hasMaterial: true, iteration: 3, llmCalls: 3, maxIterations: 24 } as const;
    expect(disposeExit({ ...base, deniedBefore: false })).toBe("deny-once");
    expect(disposeExit({ ...base, deniedBefore: true })).toBe("handoff");
    // no write-coverage requirement in the contract -> no progress metadata, no re-denial
    // an unrelated outstanding item (required tool never called), no write contract
    let s = initial({ runContract: compileRunContract(TASK), postConditions: [toolCalled("never-called")] });
    s = transitionState(s, { steps: [...s.steps, ...write("src/clamp.ts")] });
    const one = await propose(s);
    expect(one.decision).toBe("deny-once");
    expect(records(one.state)[0]!.writesSatisfied).toBeUndefined();
    const two = await propose(withWrites(one.state, "src/slugify.ts"));
    expect(two.decision).toBe("handoff");
  });

  it("(e) denials never exceed targets + 1, even with progress on every proposal", () => {
    const targets = 6;
    let denials = 0;
    for (let i = 0; i < 100; i++) {
      const d = disposeExit({
        kind: "soft", outstanding: ["x"], hasMaterial: true, deniedBefore: denials > 0,
        iteration: 3, llmCalls: 3, maxIterations: 1000,
        writeProgress: true, denialsSoFar: denials, maxDenials: targets + 1,
      });
      if (d !== "deny-once") break;
      denials++;
    }
    expect(denials).toBe(targets + 1);
  });
});
