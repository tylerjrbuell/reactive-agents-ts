// Run: bun test packages/reasoning/src/kernel/state/terminal-outcome.test.ts --timeout 15000
//
// Plan 8 K1 — the corpus invariant, pinned on the pure derivation:
//   success  =>  no blocked deliverable decision  AND  `answer` not left unmet.
// Enumerates status x decision x ledger so no combination can claim success
// beside a "block" verdict.

import { describe, expect, it } from "bun:test";
import {
  answerSatisfiedIn,
  deliverableDecisionEnvelope,
  deriveTerminalOutcome,
  type TerminalOutcome,
} from "./terminal-outcome.js";
import { resolveCompletionStatus } from "./completion-status.js";
import { recordRequirementsDeclared, recordTerminalVerdict } from "../ledger/emit.js";
import type { DeliverableDecision } from "../loop/runner-helpers/deliverable-decision.js";

const declared = recordRequirementsDeclared(undefined, [{ id: "answer", description: "answer", kind: "question-answered" }], 0);
const satisfied = recordTerminalVerdict(declared, { verified: true, iteration: 1 });

const decision = (accepted: boolean): DeliverableDecision => ({
  chosen: "tool-artifact",
  accepted,
  why: accepted ? "verified" : "output-is-model-authored: harness fallback",
  verdictSummary: accepted ? "all checks passed" : "failed at output-is-model-authored",
  rejected: [],
});

describe("K1 corpus invariant: success => no block verdict && answer satisfied", () => {
  const statuses: TerminalOutcome["status"][] = ["completed", "partial", "abstained", "failed"];
  const decisions = [undefined, decision(true), decision(false)] as const;
  const ledgers = [undefined, declared, satisfied] as const;

  for (const status of statuses) {
    for (const d of decisions) {
      for (const ledger of ledgers) {
        const label = `${status} / decision=${d === undefined ? "none" : d.accepted ? "accept" : "block"} / answer=${answerSatisfiedIn(ledger)}`;
        it(label, () => {
          const o = deriveTerminalOutcome({
            status,
            meta: { terminatedBy: "harness_deliverable", ...(d ? { deliverableDecision: d } : {}) },
            ledger,
          });
          if (o.success) {
            expect(o.verdict?.accepted).not.toBe(false);
            expect(o.answerSatisfied).not.toBe(false);
            expect(o.status).toBe("completed");
          }
          // And the converse for the shape this plan fixes: a block never claims success.
          if (d && !d.accepted) expect(o.success).toBe(false);
        });
      }
    }
  }

  it("a clean accepted completed run claims success and names its provenance", () => {
    const o = deriveTerminalOutcome({ status: "completed", meta: { terminatedBy: "final_answer", deliverableDecision: decision(true) }, ledger: satisfied });
    expect(o).toMatchObject({ success: true, provenance: "tool-artifact", answerSatisfied: true, terminatedBy: "final_answer" });
  });
});

describe("K1 status/verdict agree by construction", () => {
  it("resolveCompletionStatus: a refused deliverable on a `done` state is partial, whatever else is set", () => {
    expect(resolveCompletionStatus({ status: "done", meta: { deliverableDecision: { accepted: false } } })).toBe("partial");
    expect(resolveCompletionStatus({ status: "done", meta: { deliverableDecision: { accepted: true } } })).toBe("completed");
    expect(resolveCompletionStatus({ status: "failed", meta: { deliverableDecision: { accepted: false } } })).toBe("failed");
  });

  it("deliverableDecisionEnvelope: refusal => partial + answer outstanding; accept/none => clean", () => {
    const refused = deliverableDecisionEnvelope({ deliverableDecision: decision(false) });
    expect(refused.completionStatus).toBe("partial");
    expect(refused.outstandingCriteria).toEqual(["answer"]);
    expect(refused.verificationWarning).toContain("output-is-model-authored");
    expect(deliverableDecisionEnvelope({ deliverableDecision: decision(true) })).toEqual({ completionStatus: "completed" });
    expect(deliverableDecisionEnvelope(undefined)).toEqual({ completionStatus: "completed" });
  });
});
