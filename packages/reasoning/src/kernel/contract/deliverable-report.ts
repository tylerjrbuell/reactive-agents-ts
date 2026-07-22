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
import { describeUnmet, verify, writtenPathSatisfies } from "../capabilities/verify/post-conditions.js";
import type { RunContract } from "./run-contract.js";

/**
 * Optional ledger-artifact evidence (Wave C1 task 6). When the run's RunLedger
 * carries `kind: "artifact"` entries (minted at the kernel's act.ts C2 seam),
 * `artifactPaths` names their `path`s — a declared deliverable whose path
 * matches one of these is `produced: true` WITHOUT re-scanning `steps`. Absent
 * (or empty) on strategies that project no artifact entries onto their ledger
 * today (code-action, reflexion), which correctly fall through to the
 * existing step-scan below.
 */
export interface DeliverableReportOptions {
  readonly artifactPaths?: readonly string[];
}

/**
 * Compute the per-deliverable produced|missing report for a run.
 *
 * Each contract deliverable is FIRST checked against `opts.artifactPaths`
 * (Wave C1 task 6: the ledger already recorded the artifact fact, so no
 * step re-scan is needed) and, failing that, verified against the step ledger
 * with the pure `verify()` gate (artifact-produced → `isArtifactProduced`
 * scan, answer-section → OutputContains against `output`). The human-readable
 * `spec` is the owning requirement's description (deliverables share their
 * requirement's id), falling back to a description of the matcher.
 *
 * Returns `[]` when the contract declares no deliverables — the caller then
 * leaves `receipt.deliverables` absent, keeping pure-Q&A receipts byte-identical.
 *
 * `opts` absent (or `artifactPaths` empty) keeps every existing path
 * byte-identical to pre-task-6 behavior.
 */
export function computeDeliverableReport(
  contract: RunContract,
  steps: readonly ReasoningStep[],
  output = "",
  opts?: DeliverableReportOptions,
): readonly DeliverableReceipt[] {
  const artifactPaths = opts?.artifactPaths ?? [];
  return contract.deliverables.map((d) => {
    // Bound to a local so the "ArtifactProduced" narrowing survives into the
    // nested `.some()` closure below (narrowing a dotted `d.matcher.kind`
    // expression does not persist across a function boundary; a `const`
    // identifier's does).
    const matcher = d.matcher;
    const ledgerProduced =
      matcher.kind === "ArtifactProduced" &&
      artifactPaths.some((p) => writtenPathSatisfies(p, matcher.path));
    const { met } = verify([d.matcher], steps, { output });
    const req = contract.requirements.find((r) => r.id === d.id);
    const spec = req?.spec.description ?? describeUnmet([d.matcher]);
    return { spec, produced: ledgerProduced || met.length === 1 };
  });
}
