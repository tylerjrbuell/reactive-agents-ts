/**
 * plan-step-events.ts: `PlanStepStatusChanged` for chat-session turns.
 *
 * A session's plan IS its to-do list ({@link TodoCarry}). When a turn (streamed or
 * buffered) leaves the list with a step in a different status, this announcer
 * publishes one `PlanStepStatusChanged` per changed step, stamped with the session
 * id. Same diff as `agent.execute()` (`stepChanges`), so both paths agree.
 */
import type { PlanRecordedEvent, PlanStepStatusChangedEvent } from "@reactive-agents/core";
import { stepChanges } from "../agent/plan-facade.js";
import { planOfTodo, sessionPlanId } from "./session-plan.js";
import type { TodoSeedItem } from "./todo-seed.js";

/** Publication port for plan events (the engine's `publishPlan`). */
export type PlanEventPublisher = (event: PlanRecordedEvent | PlanStepStatusChangedEvent) => Promise<void>;

/** Step events for one list change. Pure. */
export function todoStepEvents(
  before: readonly TodoSeedItem[],
  after: readonly TodoSeedItem[],
  sessionId: string,
  timestamp: number,
): readonly PlanStepStatusChangedEvent[] {
  const meta = { id: sessionPlanId(sessionId), goal: "", createdAt: timestamp, source: "model" as const, tools: {} };
  const [from, to] = [planOfTodo(before, meta), planOfTodo(after, meta)];
  return from && to ? stepChanges(from, to, { sessionId, timestamp }) : [];
}

/**
 * A `TodoCarry` change listener that publishes the step events. A failed publish goes
 * to `onError` (the turn already ran; it must not fail). No publisher: a no-op.
 */
export const announceSteps =
  (publish: PlanEventPublisher | undefined, sessionId: string, onError: (e: unknown) => void) =>
  (before: readonly TodoSeedItem[], after: readonly TodoSeedItem[]): void => {
    if (publish === undefined) return;
    for (const event of todoStepEvents(before, after, sessionId, Date.now())) publish(event).catch(onError);
  };
