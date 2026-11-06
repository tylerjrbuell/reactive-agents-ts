/**
 * Collects the kernel's `AssessmentEmitted` events for a chat session's ROOT runs,
 * one turn at a time, so a goal segment can hand them to `goalRunOf()` and let the
 * run's own `evidenceDelta` decide progress (no Cortex-side progress heuristic).
 *
 * Root = a task whose `AgentStarted` has no `parentRunId` (same rule as
 * `chat-ingest.ts`): a sub-agent's assessments belong to its own run, not the turn.
 */
import type { AgentEvent } from "@reactive-agents/core";
import type { GoalRunEventSlice } from "@reactive-agents/runtime";
import type { SubscribableAgent } from "./chat-ingest.js";

/** Per-session buffer; turns on one session are serialised, so begin/drain bracket one turn. */
export interface TurnAssessmentRecorder {
  /** Clear the buffer at the start of a turn. */
  readonly begin: () => void;
  /** The root-run assessments recorded since `begin()`. */
  readonly drain: () => GoalRunEventSlice[];
}

/** Subscribe `agent`; returns the recorder and its unsubscribe. */
export async function recordTurnAssessments(
  agent: SubscribableAgent,
): Promise<{ readonly recorder: TurnAssessmentRecorder; readonly unsubscribe: () => void }> {
  const roots = new Set<string>();
  let buffer: GoalRunEventSlice[] = [];
  const unsubscribe = await agent.subscribe((event: AgentEvent) => {
    const e = event as { readonly _tag: string } & Readonly<Record<string, unknown>>;
    const taskId = typeof e.taskId === "string" ? e.taskId : undefined;
    if (taskId === undefined) return;
    if (e._tag === "AgentStarted" && typeof e.parentRunId !== "string") roots.add(taskId);
    if (e._tag === "AssessmentEmitted" && roots.has(taskId) && typeof e.evidenceDelta === "number") {
      buffer.push({ _tag: "AssessmentEmitted", evidenceDelta: e.evidenceDelta });
    }
  });
  return {
    recorder: {
      begin: () => {
        buffer = [];
      },
      drain: () => {
        const out = buffer;
        buffer = [];
        return out;
      },
    },
    unsubscribe,
  };
}
