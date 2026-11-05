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
import { isMetaTool } from "./progress-arbiter.js";

/**
 * ABLATION SEAM (2026-07-26). The evidence-delta reset is opt-in behind the
 * long-horizon profile by design (see LIFT-GATE DISCIPLINE above) — promoting it
 * to default-on requires the per-task-class lift rule, and the lift rule
 * requires a measurement. This env var is how the bench builds the candidate
 * arm: a `HarnessVariant` sets it via `config.env`, which `runSession` applies
 * for the duration of that arm and restores after (the generalised VERIFIER_ENV
 * pattern, `benchmarks/src/runner.ts`).
 *
 * Unset (every production run, every test) → `horizonActive` alone decides, so
 * behaviour is byte-identical to before this seam existed. It is deliberately
 * NOT a public wither: it exists to be measured, not shipped.
 */
const EVIDENCE_RESET_ENV = "REACTIVE_AGENTS_EVIDENCE_DELTA_RESET";

/**
 * Is the evidence-delta reset live for this run? The ONE place the gate is
 * decided, so the profile flag and the ablation override cannot drift apart
 * across the predicates below.
 */
function evidenceResetActive(horizonActive: boolean): boolean {
  return horizonActive || process.env[EVIDENCE_RESET_ENV] === "1";
}

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
  return evidenceResetActive(horizonActive) && (assessment?.evidenceDelta ?? 0) > 0;
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
 * Terminal meta tools: calling one is a COMPLETION PROPOSAL, not bookkeeping
 * churn, so a pass that only attempts to finish is not exempt from the stall
 * count (a model repeatedly proposing a rejected finish is genuinely stalled).
 */
const TERMINAL_META_TOOLS: ReadonlySet<string> = new Set(["final-answer", "task-complete"]);

/**
 * Is one tool call stall-EXEMPT — a non-terminal META tool (bookkeeping churn
 * the stall counter must neither count nor reset on)? The single predicate
 * {@link isMetaOnlyPass} and the stall guard's `metaCallsExcluded` share.
 */
export function isStallExemptTool(toolName: string | undefined): boolean {
  return isMetaTool(toolName) && toolName !== undefined && !TERMINAL_META_TOOLS.has(toolName);
}

/**
 * Plan 9 Phase 2a (audit F-E): is this think/act pass META-ONLY — every tool
 * call it made (act pass: `executed`) or queued (think pass ending in
 * `acting`: `queued`, read only when nothing executed) is a non-terminal META
 * tool (todo, brief, pulse, checkpoint, recall, find, ...; the same META class
 * the progress arbiter refuses to credit as evidence)? A pass with no tool call
 * at all (idle prose) is NOT meta-only — it stays a stall. Pure, deterministic:
 * reads tool names the pass's own action steps / pending calls already carry.
 */
export function isMetaOnlyPass(
  executed: readonly string[],
  queued: readonly { readonly name: string }[] | undefined,
): boolean {
  const names = executed.length > 0 ? executed : (queued ?? []).map((q) => q.name);
  return names.length > 0 && names.every(isStallExemptTool);
}

/**
 * Guard 3 (audit 02-#3, stall-deliverable staleness) counter step. Returns the
 * NEXT consecutive-stalled count. Legacy (profile off):
 * `artifactDelta > 0 ? 0 : prev + 1`. Migrated (profile on): new substantive
 * evidence (`evidenceProgress`) ALSO resets — a gathering iteration that
 * produced evidence but no file yet is not a stall, so the harness must not take
 * over completion mid-gather.
 *
 * Plan 9 Phase 2a (audit F-E, ALL paths, not lift-gated): a META-ONLY pass
 * (`metaOnly`, see {@link isMetaOnlyPass}) HOLDS the count — no increment, no
 * reset. Bookkeeping churn is neither progress nor a stall. A new artifact or
 * (profile on) new evidence still resets first. `metaOnly` false/omitted →
 * byte-identical to the expressions above.
 */
export function nextStalledCount(
  prev: number,
  artifactDelta: number,
  horizonActive: boolean,
  assessment: RunAssessment | undefined,
  metaOnly = false,
): number {
  const evidenceProgress = assessmentShowsEvidenceProgress(horizonActive, assessment);
  if (artifactDelta > 0 || evidenceProgress) return 0;
  return metaOnly ? prev : prev + 1;
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
