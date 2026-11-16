/**
 * planning/plan-events.ts — the plan events a strategy's plan emits.
 *
 * Pure projection beside {@link ./plan-checklist.ts}: given the previous and next
 * step snapshots it returns the typed core `PlanRecorded` / `PlanStepStatusChanged`
 * events, so a strategy plan reaches consumers (Cortex, any subscriber) through
 * the same events as `agent.plan()`. `planId` is the strategy run's task id,
 * stable across patches. No clock, no bus: the caller stamps and publishes.
 */
import type {
  ChecklistItemStatus,
  PlanRecordedEvent,
  PlanStep as CorePlanStep,
  PlanStepStatus,
  PlanStepStatusChangedEvent,
} from "@reactive-agents/core";

/** A plan step as last published: identity (id + title) and its core status. */
export interface PlanEventSnapshotStep {
  readonly id: string;
  readonly title: string;
  readonly tool?: string;
  readonly status: PlanStepStatus;
}

/** What has been published so far; `undefined` before the first sync. */
export type PlanEventSnapshot = readonly PlanEventSnapshotStep[] | undefined;

const CORE_STATUS: Readonly<Record<ChecklistItemStatus, PlanStepStatus>> = {
  pending: "pending",
  in_progress: "in-progress",
  completed: "done",
};

/** Core status of a checklist-row status (`done` = completed). */
export const toCorePlanStatus = (s: ChecklistItemStatus): PlanStepStatus => CORE_STATUS[s];

const sameSteps = (a: readonly PlanEventSnapshotStep[], b: readonly PlanEventSnapshotStep[]): boolean =>
  a.length === b.length && a.every((s, i) => s.id === b[i]?.id && s.title === b[i]?.title);

/** Who/when stamped onto every event of one sync. */
export interface PlanEventStamp {
  readonly planId: string;
  readonly taskId: string;
  readonly agentId?: string;
  readonly timestamp: number;
}

/**
 * Pure: the events that bring subscribers from `prev` to `next`.
 * - first sync, or the step set (ids + titles, in order) changed: one `PlanRecorded`
 *   carrying the full step list with current statuses (it already says where
 *   every step stands, so no status events follow it);
 * - same step set: one `PlanStepStatusChanged` per step whose status differs;
 * - nothing changed: no events.
 */
export function planStepEvents(
  prev: PlanEventSnapshot,
  next: readonly PlanEventSnapshotStep[],
  stamp: PlanEventStamp,
): { readonly snapshot: readonly PlanEventSnapshotStep[]; readonly events: readonly (PlanRecordedEvent | PlanStepStatusChangedEvent)[] } {
  const who = { taskId: stamp.taskId, ...(stamp.agentId !== undefined ? { agentId: stamp.agentId } : {}) };
  if (prev === undefined || !sameSteps(prev, next)) {
    if (next.length === 0) return { snapshot: next, events: [] };
    const steps: CorePlanStep[] = next.map((s) => ({
      id: s.id,
      title: s.title,
      ...(s.tool !== undefined ? { tool: s.tool } : {}),
      status: s.status,
    }));
    return {
      snapshot: next,
      events: [{ _tag: "PlanRecorded", planId: stamp.planId, steps, source: "model", ...who, timestamp: stamp.timestamp }],
    };
  }
  const events = next.flatMap((s, i): PlanStepStatusChangedEvent[] => {
    const from = prev[i]!.status;
    return from === s.status
      ? []
      : [{ _tag: "PlanStepStatusChanged", planId: stamp.planId, stepId: s.id, from, to: s.status, ...who, timestamp: stamp.timestamp }];
  });
  return { snapshot: next, events };
}
