/**
 * state/resume-epoch.ts — what a resumed run does NOT inherit from the run it
 * continues.
 *
 * A durable resume (`KernelInput.resumeState`) restores the checkpoint state
 * verbatim, and the runtime raises a spent iteration cap (`run-resume.ts`).
 * Two pieces of that state describe the stopped run's budget, not the resumed
 * one, and ended the resumed run on its first pass (gate attempt 5, B5,
 * runtime `resume-iteration-cap.test.ts`):
 *
 *   1. The low-delta streak (`consecutiveLowDeltaCount`). It counts consecutive
 *      passes of THIS run; carried over, the first resumed pass tripped
 *      `low_delta_guard` before its tool call ran. A resume starts it at 0
 *      (`resetResumedStreaks`, kernel/assessment/guard-adapters.ts: the run-
 *      progress counters' home, scripts/check-run-assessment.sh).
 *   2. The budget answer turn the spent cap reserved (`budget-answer-turn.ts`,
 *      a `max_iterations` deny-once with `answerTurnAt`). Under the raised cap
 *      that call was not the last one, so it must not count as the run's one
 *      exit denial or its one answer turn: the resumed budget gets its own
 *      ({@link gateHistory}, read by the exit gate's `disposeExit` inputs).
 *
 * Steps are never dropped from `state.steps` (the systems record stays whole).
 * Leaf module: type-only imports.
 */
import type { ReasoningStep } from "../../types/index.js";

/**
 * True for a budget answer-turn reservation the current cap has outgrown: the
 * reserved call (its `answerTurnAt` LLM call, at its iteration) would not be the
 * last one `maxIterations` allows, so the cap was raised after it (a resume).
 */
export function isSpentCapReservation(step: ReasoningStep, maxIterations: number): boolean {
  const record = step.metadata?.exitGate;
  if (record?.proposedBy !== "max_iterations" || record.answerTurnAt === undefined) return false;
  const iteration = step.metadata?.intervention?.iter ?? 0;
  return record.answerTurnAt < maxIterations - 1 && iteration < maxIterations - 1;
}

/**
 * The steps the exit gate's once-per-run rules read (`deniedBefore`,
 * `answerTurnGiven`): all of them except spent-cap reservations. Returns
 * `steps` by identity when there is none.
 */
export function gateHistory(steps: readonly ReasoningStep[], maxIterations: number): readonly ReasoningStep[] {
  return steps.some((s) => isSpentCapReservation(s, maxIterations))
    ? steps.filter((s) => !isSpentCapReservation(s, maxIterations))
    : steps;
}
