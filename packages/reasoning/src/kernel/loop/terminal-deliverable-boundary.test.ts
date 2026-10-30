// Run: bun test packages/reasoning/src/kernel/loop/terminal-deliverable-boundary.test.ts --timeout 15000
//
// H3 pin — ONE terminal/deliverable boundary. Every terminate()-carried
// deliverable (stall_deliverable, loop_graceful, oracle_forced, harness_*)
// reaches the terminal verify gate, which CONSUMES the verdict: `answer` is
// satisfied only on an accepted deliverable (R14), a rejected one is never
// success, and provenance + rejected candidates ride meta + terminal_decision.
// CUT: removing finalizeDeliverableDecision in runner-terminal-verify-gate.ts
// (or the commitDeliverable provenance stamp) turns these red.

import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { modelSynthesisDeliverable, sentinelDeliverable } from "@reactive-agents/core";
import { initialKernelState, type KernelState } from "../state/kernel-state.js";
import { terminate } from "./terminate.js";
import type { TerminateReason } from "./terminate-reason.js";
import { runTerminalVerifierGate } from "./runner-terminal-verify-gate.js";
import { terminalDecisionMetadata } from "./runner-helpers/deliverable.js";
import { recordRequirementsDeclared } from "../ledger/emit.js";
import { entriesOfKind } from "../ledger/run-ledger.js";
import type { Verifier, VerificationResult } from "../capabilities/verify/verifier.js";

const ok: Verifier = {
  verify: (c) => ({ verified: true, checks: [], summary: `${c.action}: all checks passed`, action: c.action, softFail: false }),
};
const reject: Verifier = {
  verify: (c): VerificationResult => ({
    verified: false,
    checks: [{ name: "required-tools-satisfied", passed: false, reason: "tool never called", severity: "reject" }],
    summary: "final-answer: failed at required-tools-satisfied",
    action: c.action,
    softFail: false,
    severity: "reject",
  }),
};

const declaredState = (): KernelState => {
  const base = initialKernelState({ strategy: "reactive", kernelType: "reactive", maxIterations: 10 });
  return {
    ...base,
    ledger: recordRequirementsDeclared(undefined, [{ id: "answer", description: "answer", kind: "question-answered" }], 0),
  };
};

const answerStatuses = (s: KernelState) =>
  entriesOfKind(s.ledger, "requirement").filter((e) => e.requirementId === "answer").map((e) => e.status);

const gate = (state: KernelState, verifier: Verifier) =>
  Effect.runPromise(
    runTerminalVerifierGate({
      state,
      verifier,
      effectiveInput: { task: "t" },
      taskIntent: { format: undefined } as never,
      currentOptions: { taskId: "tdb" } as never,
      emitLog: () => Effect.void,
      isAwaitingApproval: false,
      isAwaitingInteraction: false,
      isAbstained: false,
      isBudgetTerminal: false,
    }),
  );

const SITES: TerminateReason[] = ["harness_synthesis", "harness_deliverable", "loop_graceful", "oracle_forced"];

describe("terminal boundary — verdict consumed, answer written (every terminate() site class)", () => {
  for (const reason of SITES) {
    it(`${reason}: accepted verdict satisfies answer + stamps provenance`, async () => {
      const done = terminate(declaredState(), {
        reason,
        deliverable: modelSynthesisDeliverable({ type: "thought", content: "The answer is 42.", iteration: 1 }),
      });
      expect(answerStatuses(done)).toEqual(["declared"]); // terminate() alone leaves it outstanding
      const out = await gate(done, ok);
      expect(out.status).toBe("done");
      expect(answerStatuses(out)).toEqual(["declared", "satisfied"]);
      expect(out.meta.deliverableProvenance).toBe("model-final");
      expect(out.meta.deliverableDecision).toMatchObject({ accepted: true, chosen: "model-final", rejected: [] });
      expect(terminalDecisionMetadata(out)).toMatchObject({ intent: "deliver", chosen: "model-final", alternatives: [] });
    });

    it(`${reason}: rejected verdict is never success; answer stays outstanding; candidate recorded`, async () => {
      const done = terminate(declaredState(), {
        reason,
        deliverable: modelSynthesisDeliverable({ type: "thought", content: "Next I will fetch the data.", iteration: 1 }),
      });
      const out = await gate(done, reject);
      expect(out.status).toBe("failed");
      expect(answerStatuses(out)).toEqual(["declared"]);
      const d = out.meta.deliverableDecision!;
      expect(d.accepted).toBe(false);
      expect(d.chosen).toBe("none");
      expect(d.rejected[0]).toMatchObject({ provenance: "model-final", excerpt: "Next I will fetch the data." });
      expect(d.rejected[0]!.reason).toContain("required-tools-satisfied");
      const md = terminalDecisionMetadata(out);
      expect(md.intent).toBe("fail");
      expect((md.alternatives as unknown[]).length).toBe(1);
      expect(md.verdictSummary).toContain("required-tools-satisfied");
    });
  }

  it("harness-authored-only failure ships as labeled partial, answer stays outstanding", async () => {
    const authorship: Verifier = {
      verify: (c) => ({
        verified: false,
        checks: [{ name: "output-is-model-authored", passed: false, reason: "harness", severity: "reject" }],
        summary: "x",
        action: c.action,
        softFail: false,
        severity: "reject",
      }),
    };
    const done = terminate(declaredState(), {
      reason: "harness_deliverable",
      deliverable: modelSynthesisDeliverable({ type: "thought", content: "artifact body", iteration: 1 }),
    });
    const out = await gate(done, authorship);
    expect(out.status).toBe("done");
    expect(out.meta.harnessAuthoredOutput).toBe(true);
    expect(answerStatuses(out)).toEqual(["declared"]);
    expect(terminalDecisionMetadata(out).intent).toBe("deliver-partial");
  });

  it("provenance vocabulary: sentinel deliverable stamps `sentinel`", () => {
    const s = terminate(declaredState(), { reason: "harness_deliverable", deliverable: sentinelDeliverable("no_substantive_output") });
    expect(s.meta.deliverableProvenance).toBe("sentinel");
  });
});
