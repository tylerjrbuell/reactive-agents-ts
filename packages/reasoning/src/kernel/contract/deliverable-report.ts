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
import { describeUnmet } from "../capabilities/verify/post-conditions.js";
import { verifyDelivery } from "../capabilities/verify/delivery-authority.js";
import type { RunLedger } from "../ledger/run-ledger.js";
import type { RunContract } from "./run-contract.js";

/**
 * Optional run-scoped RunLedger evidence.
 *
 * Originally (Wave C1 task 6) this was `artifactPaths: readonly string[]` — a
 * flattened list of `artifact` entry paths, matched here by a second copy of the
 * path logic. That flatten was lossy in a way that mattered: it dropped `op`, so
 * an `op: "delete"` entry's path read as PRODUCED. False-met is the one
 * direction a success authority must never fail in.
 *
 * The ledger is now passed WHOLE and handed to the same `verify()` gate the
 * terminal post-condition gate uses, so "was this artifact produced?" is decided
 * in exactly one place (`isArtifactProduced`) for the receipt, the arbitrator,
 * and terminate. Absent on callers with no ledger, which fall through to the
 * step scan inside `verify` exactly as before.
 */
export interface DeliverableReportOptions {
  readonly ledger?: RunLedger;
}

/**
 * Compute the per-deliverable produced|missing report for a run.
 *
 * Each contract deliverable is verified with the pure `verify()` gate — the
 * SAME authority the terminal gate uses (artifact-produced → `isArtifactProduced`,
 * which reads the run-scoped ledger's `artifact` entries and falls back to the
 * step scan; answer-section → OutputContains against `output`). The
 * human-readable `spec` is the owning requirement's description (deliverables
 * share their requirement's id), falling back to a description of the matcher.
 *
 * Returns `[]` when the contract declares no deliverables — the caller then
 * leaves `receipt.deliverables` absent, keeping pure-Q&A receipts byte-identical.
 */
export function computeDeliverableReport(
  contract: RunContract,
  steps: readonly ReasoningStep[],
  output = "",
  opts?: DeliverableReportOptions,
): readonly DeliverableReceipt[] {
  return contract.deliverables.map((d) => {
    const { met } = verifyDelivery([d.matcher], { steps, output, ledger: opts?.ledger });
    const req = contract.requirements.find((r) => r.id === d.id);
    const spec = req?.spec.description ?? describeUnmet([d.matcher]);
    return { spec, produced: met.length === 1 };
  });
}
