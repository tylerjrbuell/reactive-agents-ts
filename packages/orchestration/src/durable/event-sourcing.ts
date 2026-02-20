import { Effect, Ref } from "effect";
import type { Workflow, WorkflowId, DomainEvent, Checkpoint } from "../types.js";
import { CheckpointError } from "../errors.js";

export interface EventSourcing {
  readonly saveCheckpoint: (checkpoint: Checkpoint) => Effect.Effect<void, CheckpointError>;
  readonly loadLatestCheckpoint: (workflowId: WorkflowId) => Effect.Effect<Checkpoint, CheckpointError>;
  readonly replayFromCheckpoint: (checkpoint: Checkpoint, events: readonly DomainEvent[]) => Effect.Effect<Workflow, CheckpointError>;
}

export const makeEventSourcing = Effect.gen(function* () {
  const checkpointsRef = yield* Ref.make<Map<string, Checkpoint[]>>(new Map());

  const saveCheckpoint = (checkpoint: Checkpoint): Effect.Effect<void, CheckpointError> =>
    Ref.update(checkpointsRef, (map) => {
      const newMap = new Map(map);
      const existing = newMap.get(checkpoint.workflowId) ?? [];
      newMap.set(checkpoint.workflowId, [...existing, checkpoint]);
      return newMap;
    }).pipe(
      Effect.mapError(() => new CheckpointError({ message: "Failed to save checkpoint", workflowId: checkpoint.workflowId })),
    );

  const loadLatestCheckpoint = (workflowId: WorkflowId): Effect.Effect<Checkpoint, CheckpointError> =>
    Effect.gen(function* () {
      const map = yield* Ref.get(checkpointsRef);
      const checkpoints = map.get(workflowId);
      if (!checkpoints || checkpoints.length === 0) {
        return yield* Effect.fail(
          new CheckpointError({ message: `No checkpoint found for workflow ${workflowId}`, workflowId }),
        );
      }
      return checkpoints[checkpoints.length - 1]!;
    });

  const replayFromCheckpoint = (
    checkpoint: Checkpoint,
    events: readonly DomainEvent[],
  ): Effect.Effect<Workflow, CheckpointError> =>
    Effect.gen(function* () {
      let workflow = checkpoint.state;
      const eventsToReplay = events.slice(checkpoint.eventIndex);

      for (const event of eventsToReplay) {
        workflow = applyEvent(workflow, event);
      }

      return workflow;
    });

  return { saveCheckpoint, loadLatestCheckpoint, replayFromCheckpoint } satisfies EventSourcing;
});

function applyEvent(workflow: Workflow, event: DomainEvent): Workflow {
  switch (event.type) {
    case "StepStarted":
      return {
        ...workflow,
        steps: workflow.steps.map((s) =>
          s.id === event.payload.stepId
            ? { ...s, status: "running" as const, startedAt: event.timestamp, agentId: event.payload.agentId }
            : s,
        ),
        updatedAt: event.timestamp,
      };
    case "StepCompleted":
      return {
        ...workflow,
        steps: workflow.steps.map((s) =>
          s.id === event.payload.stepId
            ? { ...s, status: "completed" as const, output: event.payload.output, completedAt: event.timestamp }
            : s,
        ),
        updatedAt: event.timestamp,
      };
    case "StepFailed":
      return {
        ...workflow,
        steps: workflow.steps.map((s) =>
          s.id === event.payload.stepId
            ? { ...s, status: "failed" as const, error: event.payload.error, retryCount: s.retryCount + 1 }
            : s,
        ),
        updatedAt: event.timestamp,
      };
    case "WorkflowCompleted":
      return { ...workflow, state: "completed" as const, completedAt: event.timestamp, updatedAt: event.timestamp };
    case "WorkflowFailed":
      return { ...workflow, state: "failed" as const, updatedAt: event.timestamp };
    case "WorkflowPaused":
      return { ...workflow, state: "paused" as const, updatedAt: event.timestamp };
    case "WorkflowResumed":
      return { ...workflow, state: "running" as const, updatedAt: event.timestamp };
    default:
      return workflow;
  }
}
