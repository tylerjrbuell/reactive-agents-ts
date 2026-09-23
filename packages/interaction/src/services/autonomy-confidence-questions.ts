/**
 * autonomy-confidence-questions.ts — Task 11b (shadow-only, no invert step
 * written in this task — see the plan's "Explicitly out of scope" §4 note on
 * blast radius). Batched judgment questions mirroring the two hand-tuned
 * constants `PreferenceLearner.shouldAutoApprove` decides on today:
 * `pattern.confidence` (built from the `+0.1` increment in `recordApproval`)
 * and the `< 0.7` auto-approve gate.
 *
 *  - `preferenceMatch` — Score over how well the recorded history supports
 *    an established approval pattern for this task type.
 *  - `safeToAutoApprove` — Noul: is it safe to auto-approve given the
 *    recorded pattern (occurrences, recorded action, cost threshold)?
 *    Reversibility of the underlying action is NOT tracked anywhere in
 *    `ApprovalPattern` today, so this question judges from the recorded
 *    pattern alone — a known gap, not silently assumed away.
 *
 * Backend-agnostic — works against whichever `JudgmentBackend` (jev, llm, or
 * a future third) the caller's `JudgmentService` was constructed with.
 */
import type { JudgmentAnswer, JudgmentEntry, NoulSpec, QuestionSpecs, ScoreSpec } from "@reactive-agents/judgment";
import type { ApprovalAction } from "../types/preference.js";

const PREFERENCE_MATCH_LEVELS: readonly [string, string, string] = [
  "The recorded history for `taskType` is sparse or inconsistent — little evidence of an established pattern.",
  "The recorded history shows a plausible but not yet strongly established pattern for `taskType`.",
  "The recorded history shows a strong, consistent pattern of the user approving `taskType`.",
];

export interface AutonomyConfidenceQuestionsInput {
  readonly taskType: string;
  readonly occurrences: number;
  readonly heuristicConfidence: number;
  readonly recordedAction: ApprovalAction;
  readonly costThreshold?: number;
  readonly cost?: number;
}

export const buildAutonomyConfidenceState = (input: AutonomyConfidenceQuestionsInput): JudgmentEntry => ({
  taskType: input.taskType,
  occurrences: input.occurrences,
  heuristicConfidence: input.heuristicConfidence,
  recordedAction: input.recordedAction,
  ...(input.costThreshold !== undefined ? { costThreshold: input.costThreshold } : {}),
  ...(input.cost !== undefined ? { cost: input.cost } : {}),
});

export const buildAutonomyConfidenceQuestions = (): QuestionSpecs => ({
  preferenceMatch: {
    type: "score",
    instructions:
      "Rate how well this action matches the user's established approval pattern, given `occurrences`, `heuristicConfidence`, and `recordedAction` in state.",
    criteria: PREFERENCE_MATCH_LEVELS,
  } satisfies ScoreSpec,
  safeToAutoApprove: {
    type: "noul",
    instructions:
      "Given the user's past preference pattern for `taskType` (`occurrences`, `recordedAction`, and `costThreshold`/`cost` if present in state), is it safe to auto-approve this action without asking the user? Reversibility of the action itself is not tracked in state — judge from the recorded pattern alone.",
  } satisfies NoulSpec,
});

/** Maps the `safeToAutoApprove` Noul to a boolean verdict — `null` if the answer isn't Noul-shaped. */
export const answerToSafeToAutoApprove = (answer: JudgmentAnswer): boolean | null =>
  answer.kind === "noul" ? answer.probability >= 0.5 : null;

/** `preferenceMatch`'s three Score levels, indexed 0/1/2 — matches `PREFERENCE_MATCH_LEVELS` above. */
const PREFERENCE_MATCH_LABELS: readonly [string, string, string] = ["sparse", "plausible", "strong"];

/** Maps the `preferenceMatch` Score to one of the three level labels — `null` if the answer isn't Score-shaped. */
export const answerToPreferenceMatchLabel = (answer: JudgmentAnswer): string | null => {
  if (answer.kind !== "score") return null;
  const idx = Math.max(0, Math.min(2, Math.round(answer.value)));
  return PREFERENCE_MATCH_LABELS[idx] ?? null;
};

/**
 * Buckets the existing heuristic `pattern.confidence` (0-1) into the same
 * three labels, so the shadow has a comparable "current" value — the
 * heuristic constant `preferenceMatch` is designed to eventually replace
 * (see the plan's Task 11b Step 1 note).
 */
export const confidenceToPreferenceMatchLabel = (confidence: number): string =>
  confidence >= 0.8 ? "strong" : confidence >= 0.5 ? "plausible" : "sparse";
