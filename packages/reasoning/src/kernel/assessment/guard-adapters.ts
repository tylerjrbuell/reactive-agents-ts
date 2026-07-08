// File: src/kernel/assessment/guard-adapters.ts
//
// E2 — the guard-side adapters that let scattered kernel/RI guards CONSUME the
// RunAssessment (meta-loop Phase 5a, the D2 kill). Each guard used to hold a
// private run-progress counter; audit 02 found 8 of them misfire on long runs
// because none share a progress currency. These pure predicates read the ONE
// cached RunAssessment (state.meta.assessment) so every guard defers to the same
// perception node.
//
// DAG law: these READ the already-computed assessment — they never recompute it
// (E1 owns assess()) and never mutate the ledger. They are the sanctioned
// assessment READERS: keeping them in kernel/assessment/ means the check-run-
// assessment.sh invariant ("no private run-progress counters outside
// kernel/assessment/") has one clean home for guard-side consumption.
//
// LIFT-GATE DISCIPLINE: every predicate is OPT-IN behind the long-horizon
// profile (`horizonActive`). With the profile OFF each returns the neutral value
// (`false`) so the calling guard falls through to its byte-identical legacy path.
// The improvement is blessed by the bench gate before it can become default.

import type { RunAssessment } from "./assess.js";

/**
 * Guard 1 (audit 02-#3, low_delta) + Guard 3 (stall-deliverable staleness):
 * a successful NEW gather is PROGRESS. When the profile is on and this
 * iteration produced new substantive evidence (`evidenceDelta > 0`), a low
 * token delta / no-new-artifact iteration must NOT accrue toward an exit or
 * stall counter — the model is making real progress, just not writing a file
 * yet. OFF → `false` (the counter increments exactly as before).
 */
export function assessmentShowsEvidenceProgress(
  horizonActive: boolean,
  assessment: RunAssessment | undefined,
): boolean {
  return horizonActive && (assessment?.evidenceDelta ?? 0) > 0;
}

/**
 * Guard 1 (audit 02-#3, low_delta) counter step. Returns the NEXT
 * consecutive-low-delta count. Legacy (profile off): `lowDelta ? prev + 1 : 0`.
 * Migrated (profile on): a new gather (`evidenceProgress`) ALSO resets — a terse
 * model that keeps producing new evidence per iteration is progressing, not
 * stalling, so its small token delta must not accrue toward the low-delta exit.
 * OFF → byte-identical to the legacy expression.
 */
export function nextLowDeltaCount(
  prev: number,
  lowDelta: boolean,
  horizonActive: boolean,
  assessment: RunAssessment | undefined,
): number {
  const evidenceProgress = assessmentShowsEvidenceProgress(horizonActive, assessment);
  return lowDelta && !evidenceProgress ? prev + 1 : 0;
}

/**
 * Guard 3 (audit 02-#3, stall-deliverable staleness) counter step. Returns the
 * NEXT consecutive-stalled count. Legacy (profile off):
 * `artifactDelta > 0 ? 0 : prev + 1`. Migrated (profile on): new substantive
 * evidence (`evidenceProgress`) ALSO resets — a gathering iteration that
 * produced evidence but no file yet is not a stall, so the harness must not take
 * over completion mid-gather. OFF → byte-identical to the legacy expression.
 */
export function nextStalledCount(
  prev: number,
  artifactDelta: number,
  horizonActive: boolean,
  assessment: RunAssessment | undefined,
): number {
  const evidenceProgress = assessmentShowsEvidenceProgress(horizonActive, assessment);
  return artifactDelta > 0 || evidenceProgress ? 0 : prev + 1;
}

/**
 * Guard 5 (audit 02-#6, required-tool nudge "ignored"): a GATHERING-phase
 * iteration that did not call the required (usually terminal write) tool is not
 * "ignoring" the nudge — the run is legitimately still collecting inputs before
 * it can produce. When on and the assessment says the run is gathering, callers
 * must not count the iteration as an ignored nudge. OFF → `false`.
 */
export function assessmentIsGatheringPhase(
  horizonActive: boolean,
  assessment: RunAssessment | undefined,
): boolean {
  return horizonActive && assessment?.phase === "gather";
}

/**
 * Guard 2 (audit 02-#2, controller veto) + Guard 6 (audit 02-#5 / H6, RI
 * early-stop): the SYNTHESIS endgame must not be amputated. When on and the run
 * has reached the synthesize phase (all deterministic requirements met, the
 * model is composing the answer), a would-be veto/early-stop must stand down —
 * confiscating the endgame is exactly the long-horizon failure the sweep found.
 * OFF → `false`.
 */
export function assessmentIsSynthesizePhase(
  horizonActive: boolean,
  assessment: RunAssessment | undefined,
): boolean {
  return horizonActive && assessment?.phase === "synthesize";
}

/**
 * Guard 4 (audit 02-#11, F3 error-class arg-sensitivity): the trailing failure
 * streak is VARYING its arguments (`health.failureArgVariety > 1`) — the model
 * is exploring different fixes, not blindly repeating one malformed call — so an
 * arg-INSENSITIVE "repeated identical failure" class would misfire and yank the
 * model off a productive search. When on and args are varying, callers suppress
 * the immediate F3 redirect. OFF → `false`.
 */
export function assessmentFailuresAreArgVarying(
  horizonActive: boolean,
  assessment: RunAssessment | undefined,
): boolean {
  return horizonActive && (assessment?.health.failureArgVariety ?? 0) > 1;
}
