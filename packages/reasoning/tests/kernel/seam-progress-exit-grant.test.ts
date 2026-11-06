// Run: bun test packages/reasoning/tests/kernel/seam-progress-exit-grant.test.ts --timeout 20000
//
// Progress-aware exit gate (opt-in `.withHarness({ progressAwareExit: true })`,
// kernel/loop/progress-exit-grant.ts). Live shape (2f rerun, wiki/Research/
// Ablations/2026-11-06-loop-progress-aware-rerun): the first soft exit spends
// the gate's one deny-once nudge, a write lands, then dispatcher_early_stop /
// stall proposes again and the run ends with output files missing. With the
// switch ON, that second soft exit is denied again (a progress grant) because
// the ledger recorded progress since the previous denial.
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../src/kernel/utils/observation-helpers.js";
import { artifactProduced } from "../../src/kernel/capabilities/verify/post-conditions.js";
import { initialKernelState, transitionState, type KernelState } from "../../src/kernel/state/kernel-state.js";
import { appendEntry } from "../../src/kernel/ledger/run-ledger.js";
import { resolveHarnessConfig } from "../../src/harness-config.js";
import { makeKernelInput, makeKernelRunOptions } from "../../src/testing/kernel-fixtures.js";
import type { ReasoningStep } from "../../src/types/index.js";
import { DISPATCHER_EARLY_STOP, disposeExit, isExitDenial, proposeExit } from "../../src/kernel/loop/exit-gate.js";
import { assembleDeliverable } from "../../src/kernel/loop/runner-helpers/deliverable.js";
import {
  PROGRESS_EXIT_GRANT_LIMIT,
  PROGRESS_EXIT_GRANT_REASON,
  PROGRESS_EXIT_GUARD,
  progressAwareExitEnabled,
} from "../../src/kernel/loop/progress-exit-grant.js";

type Guard = Extract<AgentEvent, { _tag: "GuardFiredEmitted" }>;

let n = 0;
const call = (name: string, args: Record<string, unknown>, out: string): ReasoningStep[] => {
  const id = `g${++n}`;
  return [
    makeStep("action", `${name}(${JSON.stringify(args)})`, { toolCall: { id, name, arguments: args } }),
    makeStep("observation", out, { toolCallId: id, observationResult: makeObservationResult(name, true, out) }),
  ];
};
const write = (p: string) => call("file-write", { path: p, content: "x" }, `✓ Written to ${p}`);

const MAX = 14;
const options = makeKernelRunOptions({ strategy: "reactive", maxIterations: MAX });
const OUTPUTS = ["./out-1.txt", "./out-2.txt", "./out-3.txt", "./out-4.txt", "./out-5.txt", "./out-6.txt"];
const TASK = "Write out-1..6.";
const inputOn = makeKernelInput({ task: TASK, harness: { ...resolveHarnessConfig(), progressAwareExit: true } });
const inputOff = makeKernelInput({ task: TASK, harness: resolveHarnessConfig() });

/** Append a write and its ledger artifact at `iteration`. */
const landWrite = (state: KernelState, path: string, iteration: number): KernelState =>
  transitionState(state, {
    iteration,
    steps: [...state.steps, ...write(path)],
    ledger: appendEntry(state.ledger, { kind: "artifact", iteration, path, op: "write" }),
  });

const fresh = (): KernelState => {
  const base = initialKernelState(options);
  return transitionState(base, { meta: { ...base.meta, postConditions: OUTPUTS.map(artifactProduced) } });
};

/** A soft dispatcher early-stop proposal, with every guard-fired event captured. */
const earlyStop = (state: KernelState, input = inputOn) => {
  const guards: Guard[] = [];
  return Effect.runPromise(
    Effect.gen(function* () {
      const bus = yield* EventBus;
      yield* bus.on("GuardFiredEmitted", (e) => Effect.sync(() => { guards.push(e); }));
      return yield* proposeExit({
        state,
        proposal: { ...DISPATCHER_EARLY_STOP, deliverable: assembleDeliverable(state) },
        input,
        maxIterations: MAX,
        taskId: "progress-grant",
      });
    }).pipe(Effect.provide(EventBusLive)),
  ).then((disposition) => ({ ...disposition, guards }));
};

/** out-1 lands, then the first soft exit spends the nudge (deny-once). */
async function afterNudge(input = inputOn): Promise<KernelState> {
  const s = landWrite(fresh(), "out-1.txt", 1);
  const first = await earlyStop(s, input);
  expect(first.decision).toBe("deny-once");
  expect(first.state.steps.at(-1)!.metadata?.exitGate?.grant).toBeUndefined();
  return first.state;
}

describe("progress-aware exit gate (switch ON)", () => {
  it("deny-once, then progress, then a second soft exit is denied again as a progress grant", async () => {
    const s = landWrite(await afterNudge(), "out-2.txt", 3);
    const second = await earlyStop(s);
    expect(second.decision).toBe("deny-once");
    expect(second.state.status).toBe("thinking");
    const record = second.state.steps.at(-1)!.metadata?.exitGate;
    expect(record?.grant).toBe(PROGRESS_EXIT_GRANT_REASON);
    expect(record?.outstanding.join(" ")).toContain("out-3.txt");
    const activation = second.guards.filter((g) => g.guard === PROGRESS_EXIT_GUARD);
    expect(activation).toHaveLength(1);
    expect(activation[0]!.reason).toBe("progress_since_last_exit");
    expect(activation[0]!.outcome).toBe("block");
    const gate = second.guards.find((g) => g.guard === "exit_gate");
    expect(gate?.metadata?.grant).toBe(PROGRESS_EXIT_GRANT_REASON);
  });

  it("no progress since the last denial: the second soft exit ends the run", async () => {
    const s = transitionState(await afterNudge(), { iteration: 3 });
    const second = await earlyStop(s);
    expect(isExitDenial(second.decision)).toBe(false);
    expect(["done", "failed"]).toContain(second.state.status);
    expect(second.guards.some((g) => g.guard === PROGRESS_EXIT_GUARD)).toBe(false);
  });

  it("measures from the LAST denial: progress before a grant does not carry over", async () => {
    const granted = await earlyStop(landWrite(await afterNudge(), "out-2.txt", 3));
    expect(granted.decision).toBe("deny-once");
    const third = await earlyStop(transitionState(granted.state, { iteration: 4 }));
    expect(isExitDenial(third.decision)).toBe(false);
  });

  it(`bounded: at most ${PROGRESS_EXIT_GRANT_LIMIT} grants per run, even with progress each time`, async () => {
    let s = await afterNudge();
    for (let k = 0; k < PROGRESS_EXIT_GRANT_LIMIT; k++) {
      const next = await earlyStop(landWrite(s, `out-${k + 2}.txt`, 3 + k));
      expect(next.decision).toBe("deny-once");
      s = next.state;
    }
    const over = await earlyStop(landWrite(s, "out-6.txt", 3 + PROGRESS_EXIT_GRANT_LIMIT));
    expect(isExitDenial(over.decision)).toBe(false);
  });

  it("bounded: no grant without room for one more iteration under the cap", async () => {
    const s = landWrite(await afterNudge(), "out-2.txt", MAX - 1);
    expect(isExitDenial((await earlyStop(s)).decision)).toBe(false);
  });

  it("pure rule: a grant only lifts the spent nudge for a soft proposal; cap and model are unchanged", () => {
    const row = {
      kind: "soft" as const, outstanding: ["write out-3.txt"], hasMaterial: true,
      deniedBefore: true, iteration: 3, llmCalls: 3, maxIterations: MAX,
    };
    expect(disposeExit(row)).toBe("handoff");
    expect(disposeExit({ ...row, progressGrant: true })).toBe("deny-once");
    expect(disposeExit({ ...row, kind: "cap", progressGrant: true })).toBe("handoff");
    expect(disposeExit({ ...row, proposedBy: "model", progressGrant: true })).toBe("deny");
    expect(disposeExit({ ...row, outstanding: [], progressGrant: true })).toBe("accept");
  });
});

describe("progress-aware exit gate (switch OFF = current behavior)", () => {
  it("is off by default and when the field is absent", () => {
    expect(resolveHarnessConfig().progressAwareExit).toBe(false);
    expect(progressAwareExitEnabled(undefined)).toBe(false);
    expect(progressAwareExitEnabled(resolveHarnessConfig())).toBe(false);
    expect(progressAwareExitEnabled(resolveHarnessConfig({ progressAwareExit: true }))).toBe(true);
  });

  it("the same deny-once, progress, second soft exit sequence ends the run", async () => {
    const s = landWrite(await afterNudge(inputOff), "out-2.txt", 3);
    const second = await earlyStop(s, inputOff);
    expect(isExitDenial(second.decision)).toBe(false);
    expect(["done", "failed"]).toContain(second.state.status);
    expect(second.guards.some((g) => g.guard === PROGRESS_EXIT_GUARD)).toBe(false);
    expect(second.guards.find((g) => g.guard === "exit_gate")?.metadata?.grant).toBeUndefined();
  });
});
