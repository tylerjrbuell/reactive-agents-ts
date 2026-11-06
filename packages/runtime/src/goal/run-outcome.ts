import type { GoalRunOutcome } from "./types.js";

/** The slice of an `AgentResult` the goal supervisor reads. */
export interface GoalRunResultSlice {
  readonly goalAchieved?: boolean | null;
  readonly metadata?: { readonly outstandingCriteria?: readonly string[] };
}

/** Any event stream item; only `AssessmentEmitted` entries are read. */
export interface GoalRunEventSlice {
  readonly _tag: string;
  readonly evidenceDelta?: number;
}

/**
 * Map a finished run onto the supervisor's {@link GoalRunOutcome}. Pure.
 *
 * `events` are the run's EventBus events (any order). Their `AssessmentEmitted`
 * entries carry the kernel's `RunAssessment.evidenceDelta`; the sum is the
 * segment's new evidence. Omit `events` to leave progress to the caller's flag.
 */
export function goalRunOf(
  result: GoalRunResultSlice,
  events?: readonly GoalRunEventSlice[],
): GoalRunOutcome {
  const outstanding = result.metadata?.outstandingCriteria;
  const assessed = events?.filter((e) => e._tag === "AssessmentEmitted");
  return {
    goalAchieved: result.goalAchieved ?? null,
    ...(outstanding !== undefined ? { outstanding } : {}),
    ...(assessed !== undefined
      ? { evidenceDelta: assessed.reduce((n, e) => n + (e.evidenceDelta ?? 0), 0) }
      : {}),
  };
}
