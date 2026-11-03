// File: src/kernel/state/terminal-outcome.ts
//
// The ONE reconciled terminal outcome (Plan 8 K1, audit P12 / R1).
//
// THE DEFECT. `status`, `terminatedBy`, the terminal verify-gate verdict and the
// ledger `answer` requirement were written by different sites and nothing
// reconciled them: a harness-assembled deliverable the gate refused to bless
// (`deliverable_decision=block`) still ended `success` because the downstream
// "partial + substantive output => success" tolerance lane keys on the coarse
// status bit alone (5 of 9 blocked-deliverable traces, 2026-11-02 diagnosis).
//
// THE RULE. A terminal whose own gate said "block" cannot be reported as a
// success. This module is the single derivation of that fact:
//   - `deliverableDecisionEnvelope` turns a refused deliverable into a
//     CompletionEnvelope (partial + the unmet `answer` requirement), joined into
//     the contract-coverage arm at the strategy mint — so the existing
//     `outstandingCriteria` veto (the engine's success lane) flips the bit.
//   - `deriveTerminalOutcome` is the single outcome object (status,
//     terminatedBy, provenance, verdict, answer-satisfied, success claim) that
//     rides the strategy result as `metadata.terminalOutcome`.
//
// Leaf module: depends only on ledger + envelope types. No new scorer.

import type { CompletionEnvelope } from "./completion-envelope.js";
import type { DeliverableDecision, DeliverableProvenance } from "../loop/runner-helpers/deliverable-decision.js";
import { entriesOfKind, type RunLedger } from "../ledger/run-ledger.js";

/** Id of the always-present question-answered floor requirement. */
const ANSWER_REQUIREMENT_ID = "answer";

/** The narrow meta slice the outcome derivation reads. */
export interface TerminalOutcomeMeta {
  readonly terminatedBy?: string;
  readonly deliverableDecision?: DeliverableDecision;
  readonly deliverableProvenance?: DeliverableProvenance;
}

/**
 * What the run's terminal evidence supports claiming — one object, so the
 * labels cannot disagree. `success` is the KERNEL-SUPPORTED claim: completed,
 * the gate did not refuse the deliverable, and the `answer` requirement is not
 * left unsatisfied.
 */
export interface TerminalOutcome {
  readonly status: "completed" | "partial" | "abstained" | "failed";
  /** Raw kernel termination reason (`state.meta.terminatedBy`), or null. */
  readonly terminatedBy: string | null;
  /** Provenance of the delivered answer; "none" when nothing was delivered. */
  readonly provenance: DeliverableProvenance | "none";
  /** The terminal gate's verdict on the deliverable; null when the gate did not decide. */
  readonly verdict: { readonly accepted: boolean; readonly summary: string } | null;
  /** Ledger `answer` requirement: true satisfied, false declared-but-unmet, null not declared. */
  readonly answerSatisfied: boolean | null;
  /** Kernel-supported success claim (see type docs). */
  readonly success: boolean;
}

/** Latest status of the `answer` requirement in the ledger (null if never declared). */
export function answerSatisfiedIn(ledger: RunLedger | undefined): boolean | null {
  const entries = entriesOfKind(ledger, "requirement").filter(
    (e) => e.requirementId === ANSWER_REQUIREMENT_ID,
  );
  const last = entries[entries.length - 1];
  return last === undefined ? null : last.status === "satisfied";
}

/**
 * Derive the single terminal outcome. Pure. `status` is the already-resolved
 * completion status (the caller's authority); this adds the verdict and answer
 * facts and computes the success claim as their conjunction.
 */
export function deriveTerminalOutcome(args: {
  readonly status: TerminalOutcome["status"];
  readonly meta: TerminalOutcomeMeta;
  readonly ledger: RunLedger | undefined;
}): TerminalOutcome {
  const { status, meta, ledger } = args;
  const decision = meta.deliverableDecision;
  const verdict = decision ? { accepted: decision.accepted, summary: decision.verdictSummary } : null;
  const answerSatisfied = answerSatisfiedIn(ledger);
  return {
    status,
    terminatedBy: meta.terminatedBy ?? null,
    provenance: decision?.chosen ?? meta.deliverableProvenance ?? "none",
    verdict,
    answerSatisfied,
    success: status === "completed" && verdict?.accepted !== false && answerSatisfied !== false,
  };
}

/**
 * The envelope a REFUSED deliverable contributes: a terminal whose own verify
 * gate blocked the deliverable (`deliverableDecision.accepted === false`) but
 * which still shipped output (a labeled honest partial) leaves the `answer`
 * requirement outstanding. Clean `completed` envelope when there is no refusal.
 */
export function deliverableDecisionEnvelope(
  meta: TerminalOutcomeMeta | undefined,
): CompletionEnvelope {
  const decision = meta?.deliverableDecision;
  if (decision === undefined || decision.accepted) return { completionStatus: "completed" };
  return {
    completionStatus: "partial",
    outstandingCriteria: [ANSWER_REQUIREMENT_ID],
    verificationWarning: `deliverable not accepted by the terminal gate: ${decision.why}`,
  };
}
