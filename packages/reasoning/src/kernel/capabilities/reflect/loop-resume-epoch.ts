/**
 * loop-resume-epoch.ts — the loop-guard epoch a resume starts.
 *
 * A run stopped by loop detection and then resumed (`loop/loop-stop.ts`
 * `resumeFromStop`) carries the very steps that tripped the guard. Left in the
 * window they would re-trip the detector on the first resumed pass and keep
 * counting as spent loop-guidance cycles. The resume appends ONE marker step
 * (a `harness_signal` stamped with {@link LOOP_RESUME_ACTOR}); every loop-guard
 * reader reads only the steps AFTER the last marker through
 * {@link stepsSinceLoopResume}. Steps are never dropped from `state.steps`
 * (the systems record stays whole): only the guard's view is windowed.
 *
 * Leaf module: type-only imports, so the detector and the guidance counter can
 * both read it without a cycle.
 */
import type { ReasoningStep } from "../../../types/index.js";

/** Intervention actor stamped on the resume's epoch marker step. */
export const LOOP_RESUME_ACTOR = "loop-stop-resume";

/** True for the epoch marker step a resume appends. */
export const isLoopResumeMarker = (step: ReasoningStep): boolean =>
  step.type === "harness_signal" && step.metadata?.intervention?.actor === LOOP_RESUME_ACTOR;

/** The steps after the last resume marker (all of them when the run was never resumed). */
export function stepsSinceLoopResume(steps: readonly ReasoningStep[]): readonly ReasoningStep[] {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (isLoopResumeMarker(steps[i]!)) return steps.slice(i + 1);
  }
  return steps;
}
