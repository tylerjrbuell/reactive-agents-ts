// File: src/kernel/contract/deliverable-report.ts
//
// computeDeliverableReport — the RunContract's deliverable specs × the run's
// step-based artifact scan, producing the {spec, produced} rows the TrustReceipt
// names (meta-loop 4a, B2). This is the receipt-facing consumer of the contract:
// it answers "which declared deliverables actually landed?" using the SAME pure
// verify() gate the terminal gate uses, so a partial multi-file run (rw-8: 1 of
// 3 files) names the two missing outputs on the receipt instead of silently
// reporting success.
//
// DAG law: pure. Reads the (frozen) contract + the ledger (steps[]) + the
// assembled output. No loop state, no fs, no LLM.

import type { DeliverableReceipt } from "@reactive-agents/core";
import type { ReasoningStep } from "../../types/index.js";
import { describeUnmet, verify } from "../capabilities/verify/post-conditions.js";
import type { RunContract } from "./run-contract.js";

/**
 * Compute the per-deliverable produced|missing report for a run.
 *
 * Each contract deliverable is verified against the step ledger with the pure
 * `verify()` gate (artifact-produced → `isArtifactProduced` scan, answer-section
 * → OutputContains against `output`). The human-readable `spec` is the owning
 * requirement's description (deliverables share their requirement's id), falling
 * back to a description of the matcher.
 *
 * Returns `[]` when the contract declares no deliverables — the caller then
 * leaves `receipt.deliverables` absent, keeping pure-Q&A receipts byte-identical.
 */
export function computeDeliverableReport(
  contract: RunContract,
  steps: readonly ReasoningStep[],
  output = "",
): readonly DeliverableReceipt[] {
  return contract.deliverables.map((d) => {
    const { met } = verify([d.matcher], steps, { output });
    const req = contract.requirements.find((r) => r.id === d.id);
    const spec = req?.spec.description ?? describeUnmet([d.matcher]);
    return { spec, produced: met.length === 1 };
  });
}
