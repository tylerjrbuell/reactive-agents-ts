import type { StoredTodoItem } from "../db/chat-queries.js";

/** Observable evidence one chat turn produced; the goal supervisor's progress signal. */
export interface TurnEvidence {
  /** Tool observations this turn that did not report failure (new tool-result evidence). */
  readonly toolResults: number;
  /** Checklist (to-do) items that became `completed` this turn and were not complete before. */
  readonly checklistCompleted: number;
}

/** Minimal reasoning-step shape read here (structural mirror of `ChatReply.reasoningSteps`). */
export interface EvidenceStep {
  readonly type: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Deterministic per-turn evidence: successful tool observations plus checklist items newly
 * completed between `before` and `after`. An observation counts unless its
 * `observationResult.success` is explicitly `false`.
 */
export function turnEvidenceOf(
  steps: readonly EvidenceStep[] | undefined,
  before: readonly Pick<StoredTodoItem, "id" | "status">[],
  after: readonly Pick<StoredTodoItem, "id" | "status">[],
): TurnEvidence {
  const toolResults = (steps ?? []).filter((s) => {
    if (s.type !== "observation") return false;
    const r = s.metadata?.observationResult as { success?: boolean } | undefined;
    return r?.success !== false;
  }).length;
  const alreadyDone = new Set(before.filter((i) => i.status === "completed").map((i) => i.id));
  const checklistCompleted = after.filter((i) => i.status === "completed" && !alreadyDone.has(i.id)).length;
  return { toolResults, checklistCompleted };
}
