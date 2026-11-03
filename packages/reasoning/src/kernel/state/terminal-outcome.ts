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
import type { CompletionAuthorityState } from "./completion-authority-state.js";
import { resolveCompletionStatus } from "./completion-status.js";
import { deriveTerminalAuthority, type TerminalAuthority } from "./terminal-authority.js";
import type { DeliverableDecision, DeliverableProvenance } from "../loop/runner-helpers/deliverable-decision.js";
import { entriesOfKind, type RunLedger } from "../ledger/run-ledger.js";

/** Id of the always-present question-answered floor requirement. */
const ANSWER_REQUIREMENT_ID = "answer";

/** The narrow meta slice the outcome derivation reads. */
export interface TerminalOutcomeMeta {
  readonly terminatedBy?: string;
  readonly deliverableDecision?: DeliverableDecision;
  readonly deliverableProvenance?: DeliverableProvenance;
  /** Site that wrote a harness deliverable terminal (see `terminal-authority.ts`). */
  readonly terminalSite?: string;
  /** Class of the provider/stream error that ended the run (`llm_error`), when known. */
  readonly errorClass?: string;
}

/**
 * Reconciled status the KERNEL supports at `terminal_decision` time (before the
 * strategy mint applies the contract/delegation caps): `failed` / `abstained` /
 * `partial` (shipped unverified or the gate refused the deliverable) / `completed`.
 * The vocabulary `terminal_decision.status` (`done|failed`) cannot express.
 */
export function kernelReconciledStatus(
  state: CompletionAuthorityState & { readonly meta: { readonly terminatedBy?: string } },
): TerminalOutcome["status"] {
  if (state.status !== "failed" && state.meta.terminatedBy === "abstained") return "abstained";
  return resolveCompletionStatus(state);
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
  /**
   * Which site/mechanism set the final status (`model-final`, `gate-verdict`,
   * `guard:<name>`, `budget`, `strategy-exhausted`, ...). Derived from
   * deterministic facts only; see `terminal-authority.ts`. Diagnostic: nothing
   * branches on it.
   */
  readonly authority: TerminalAuthority;
  /**
   * The terminal gate's DECISION on the deliverable, separate from the
   * verifier's verdict below: `accepted:true` with a failing verifier reads as
   * "overridden by deliverable decision: <reason>". Null when the gate did not decide.
   */
  readonly deliverable: { readonly outcome: "pass" | "block"; readonly reason: string; readonly accepted: boolean } | null;
  /** The verifier's own verdict (`verified` + failed check names); null when none was recorded. */
  readonly verifierVerdict: { readonly verified: boolean; readonly failedChecks: readonly string[] } | null;
  /**
   * Requirement ids / failed-check ids that kept `status` from `completed`
   * (contract-coverage + delegation outstanding criteria, plus the verifier's
   * failed checks when the gate refused the deliverable). Empty when nothing
   * held it back. Diagnostic: nothing branches on it.
   */
  readonly outstanding: readonly string[];
  /** Provider/stream error class when the run ended in an LLM error (authority `error`); absent otherwise. */
  readonly errorClass?: string;
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
  /** Finalization arm that overrode the kernel-minted status, when one did. */
  readonly arm?: TerminalAuthority;
  /** Criteria that held the status back (see {@link TerminalOutcome.outstanding}); failed verifier checks are added here when the gate refused. */
  readonly outstanding?: readonly string[];
}): TerminalOutcome {
  const { status, meta, ledger } = args;
  const decision = meta.deliverableDecision;
  const verdict = decision ? { accepted: decision.accepted, summary: decision.verdictSummary } : null;
  const answerSatisfied = answerSatisfiedIn(ledger);
  const failedChecks = decision?.verifier?.failedChecks ?? [];
  const outstanding = [
    ...new Set([...(args.outstanding ?? []), ...(decision?.accepted === false ? failedChecks : [])]),
  ];
  return {
    status,
    terminatedBy: meta.terminatedBy ?? null,
    provenance: decision?.chosen ?? meta.deliverableProvenance ?? "none",
    verdict,
    answerSatisfied,
    success: status === "completed" && verdict?.accepted !== false && answerSatisfied !== false,
    authority: args.arm ?? deriveTerminalAuthority(meta),
    deliverable: decision
      ? { outcome: decision.accepted ? "pass" : "block", reason: decision.why, accepted: decision.accepted }
      : null,
    verifierVerdict: decision?.verifier
      ? { verified: decision.verifier.verified, failedChecks: decision.verifier.failedChecks }
      : null,
    outstanding,
    ...(meta.errorClass !== undefined ? { errorClass: meta.errorClass } : {}),
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
