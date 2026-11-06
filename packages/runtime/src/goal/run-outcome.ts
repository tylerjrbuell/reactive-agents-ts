import type { GoalRunOutcome } from "./types.js";

/** The slice of an `AgentResult` (or `ChatReply`) the goal supervisor reads. */
export interface GoalRunResultSlice {
  readonly goalAchieved?: boolean | null;
  /** The run's summed assessment evidence (`AgentResult.evidenceDelta`). Wins over `events`. */
  readonly evidenceDelta?: number;
  readonly metadata?: { readonly outstandingCriteria?: readonly string[] };
  /** `ChatReply.outstandingCriteria` (a chat reply has no `metadata`). */
  readonly outstandingCriteria?: readonly string[];
}

/** Any event stream item; only `AssessmentEmitted` entries are read. */
export interface GoalRunEventSlice {
  readonly _tag: string;
  readonly evidenceDelta?: number;
}

/**
 * Map a finished run onto the supervisor's {@link GoalRunOutcome}. Pure.
 *
 * Progress comes from `result.evidenceDelta` (the run's own total) when set.
 * Otherwise `events` (the run's EventBus events, any order) are summed: their
 * `AssessmentEmitted` entries carry the kernel's `RunAssessment.evidenceDelta`.
 * With neither, progress is left to the caller's flag.
 */
export function goalRunOf(
  result: GoalRunResultSlice,
  events?: readonly GoalRunEventSlice[],
): GoalRunOutcome {
  const outstanding = result.metadata?.outstandingCriteria ?? result.outstandingCriteria;
  const assessed = events?.filter((e) => e._tag === "AssessmentEmitted");
  const evidenceDelta =
    result.evidenceDelta ?? assessed?.reduce((n, e) => n + (e.evidenceDelta ?? 0), 0);
  return {
    goalAchieved: result.goalAchieved ?? null,
    ...(outstanding !== undefined ? { outstanding } : {}),
    ...(evidenceDelta !== undefined ? { evidenceDelta } : {}),
  };
}
