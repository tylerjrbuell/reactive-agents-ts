# Layer 7: Orchestration - AI Agent Implementation Spec

## Overview

Multi-agent coordination system with orchestrator-workers pattern, durable execution via event sourcing, human-in-the-loop approval gates, workflow engine, agent mesh networking, and **A2A protocol support** for cross-framework agent interoperability. This layer enables complex tasks to be decomposed and distributed across specialized agents (internal and external), with crash recovery and deterministic replay.

**Package:** `@reactive-agents/orchestration`
**Dependencies:** `@reactive-agents/core` (EventBus, types), `@reactive-agents/llm-provider` (LLMService), `@reactive-agents/identity` (delegation, authorization), `@reactive-agents/reasoning` (agent reasoning), `@reactive-agents/cost` (budget tracking)

---

## Package Structure

```
@reactive-agents/orchestration/
├── src/
│   ├── index.ts                          # Public API exports
│   ├── orchestration-service.ts          # Main OrchestrationService (Effect service)
│   ├── types.ts                          # All types & schemas
│   ├── workflows/
│   │   ├── workflow-engine.ts            # Workflow definition & execution
│   │   └── workflow-patterns.ts          # Sequential, parallel, map-reduce, pipeline
│   ├── multi-agent/
│   │   ├── orchestrator.ts               # Orchestrator agent logic
│   │   └── worker-pool.ts               # Worker agent lifecycle management
│   ├── durable/
│   │   ├── event-sourcing.ts            # Event log & state reconstruction
│   │   └── checkpoint-manager.ts        # Checkpoint creation & recovery
│   ├── human-in-loop/
│   │   └── approval-gates.ts            # Approval request & response handling
│   └── mesh/
│       └── agent-mesh.ts                # Agent discovery & communication
│   ├── a2a/
│   │   ├── a2a-server.ts                # Expose agents as A2A endpoints
│   │   ├── a2a-client.ts                # Consume external A2A agents
│   │   ├── agent-card.ts                # Agent Card generation & management
│   │   └── a2a-transport.ts             # JSON-RPC 2.0 / HTTP / SSE transport
│   └── agent-as-tool/
│       └── agent-tool-adapter.ts        # Register agents as callable tools
├── tests/
│   ├── orchestration-service.test.ts
│   ├── workflows/
│   │   └── workflow-engine.test.ts
│   ├── multi-agent/
│   │   └── orchestrator.test.ts
│   ├── durable/
│   │   └── event-sourcing.test.ts
│   └── human-in-loop/
│       └── approval-gates.test.ts
└── package.json
```

---

## Build Order

1. `src/types.ts` — WorkflowStep, WorkflowDefinition, WorkflowState, AgentRole, CheckpointData schemas
2. `src/errors.ts` — All error types (OrchestrationError, WorkflowError, CheckpointError, ApprovalError, MeshError)
3. `src/durable/event-sourcing.ts` — Event log and state reconstruction
4. `src/durable/checkpoint-manager.ts` — Checkpoint creation and crash recovery
5. `src/workflows/workflow-patterns.ts` — Sequential, parallel, map-reduce, pipeline patterns
6. `src/workflows/workflow-engine.ts` — Workflow definition and execution engine
7. `src/human-in-loop/approval-gates.ts` — Approval request and response handling
8. `src/multi-agent/worker-pool.ts` — Worker agent lifecycle management
9. `src/multi-agent/orchestrator.ts` — Orchestrator agent logic
10. `src/mesh/agent-mesh.ts` — Agent discovery and communication mesh
11. `src/a2a/a2a-transport.ts` — JSON-RPC 2.0 / HTTP / SSE transport
12. `src/a2a/agent-card.ts` — Agent Card generation and management
13. `src/a2a/a2a-server.ts` — Expose agents as A2A endpoints
14. `src/a2a/a2a-client.ts` — Consume external A2A agents
15. `src/agent-as-tool/agent-tool-adapter.ts` — Register agents as callable tools
16. `src/orchestration-service.ts` — Main OrchestrationService Context.Tag + OrchestrationServiceLive
17. `src/index.ts` — Public re-exports
18. Tests for each module

---

## Core Types & Schemas

```typescript
import { Schema, Data, Effect, Context, Layer, Fiber } from "effect";

// ─── Workflow ───

export const WorkflowIdSchema = Schema.String.pipe(Schema.brand("WorkflowId"));
export type WorkflowId = typeof WorkflowIdSchema.Type;

export const WorkflowPattern = Schema.Literal(
  "sequential",
  "parallel",
  "orchestrator-workers",
  "map-reduce",
  "pipeline",
  "evaluator-optimizer",
);
export type WorkflowPattern = typeof WorkflowPattern.Type;

export const WorkflowState = Schema.Literal(
  "pending",
  "running",
  "paused", // Waiting for human approval
  "completed",
  "failed",
  "recovering", // Replaying from checkpoint
);
export type WorkflowState = typeof WorkflowState.Type;

export const WorkflowStepSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  agentId: Schema.optional(Schema.String),
  input: Schema.Unknown,
  output: Schema.optional(Schema.Unknown),
  status: Schema.Literal(
    "pending",
    "running",
    "completed",
    "failed",
    "skipped",
  ),
  startedAt: Schema.optional(Schema.DateFromSelf),
  completedAt: Schema.optional(Schema.DateFromSelf),
  error: Schema.optional(Schema.String),
  retryCount: Schema.Number,
  maxRetries: Schema.Number,
});
export type WorkflowStep = typeof WorkflowStepSchema.Type;

export const WorkflowSchema = Schema.Struct({
  id: WorkflowIdSchema,
  name: Schema.String,
  pattern: WorkflowPattern,
  steps: Schema.Array(WorkflowStepSchema),
  state: WorkflowState,
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf,
  completedAt: Schema.optional(Schema.DateFromSelf),
  metadata: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});
export type Workflow = typeof WorkflowSchema.Type;

// ─── Domain Events (for event sourcing) ───

export const DomainEventSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("WorkflowCreated"),
    workflowId: WorkflowIdSchema,
    timestamp: Schema.DateFromSelf,
    payload: WorkflowSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("StepStarted"),
    workflowId: WorkflowIdSchema,
    timestamp: Schema.DateFromSelf,
    payload: Schema.Struct({ stepId: Schema.String, agentId: Schema.String }),
  }),
  Schema.Struct({
    type: Schema.Literal("StepCompleted"),
    workflowId: WorkflowIdSchema,
    timestamp: Schema.DateFromSelf,
    payload: Schema.Struct({ stepId: Schema.String, output: Schema.Unknown }),
  }),
  Schema.Struct({
    type: Schema.Literal("StepFailed"),
    workflowId: WorkflowIdSchema,
    timestamp: Schema.DateFromSelf,
    payload: Schema.Struct({ stepId: Schema.String, error: Schema.String }),
  }),
  Schema.Struct({
    type: Schema.Literal("WorkflowPaused"),
    workflowId: WorkflowIdSchema,
    timestamp: Schema.DateFromSelf,
    payload: Schema.Struct({
      reason: Schema.String,
      approvalRequired: Schema.Boolean,
    }),
  }),
  Schema.Struct({
    type: Schema.Literal("WorkflowResumed"),
    workflowId: WorkflowIdSchema,
    timestamp: Schema.DateFromSelf,
    payload: Schema.Struct({ approvedBy: Schema.optional(Schema.String) }),
  }),
  Schema.Struct({
    type: Schema.Literal("WorkflowCompleted"),
    workflowId: WorkflowIdSchema,
    timestamp: Schema.DateFromSelf,
    payload: Schema.Struct({ result: Schema.Unknown }),
  }),
  Schema.Struct({
    type: Schema.Literal("WorkflowFailed"),
    workflowId: WorkflowIdSchema,
    timestamp: Schema.DateFromSelf,
    payload: Schema.Struct({ error: Schema.String }),
  }),
);
export type DomainEvent = typeof DomainEventSchema.Type;

// ─── Checkpoint ───

export const CheckpointSchema = Schema.Struct({
  id: Schema.String,
  workflowId: WorkflowIdSchema,
  timestamp: Schema.DateFromSelf,
  state: WorkflowSchema,
  eventIndex: Schema.Number, // Index into event log (replay from here)
});
export type Checkpoint = typeof CheckpointSchema.Type;

// ─── Approval Request ───

export const ApprovalRequestSchema = Schema.Struct({
  id: Schema.String,
  workflowId: WorkflowIdSchema,
  stepId: Schema.String,
  description: Schema.String,
  riskLevel: Schema.Literal("low", "medium", "high", "critical"),
  requestedAt: Schema.DateFromSelf,
  timeoutMs: Schema.Number,
  status: Schema.Literal("pending", "approved", "rejected", "timeout"),
  respondedBy: Schema.optional(Schema.String),
  respondedAt: Schema.optional(Schema.DateFromSelf),
});
export type ApprovalRequest = typeof ApprovalRequestSchema.Type;

// ─── Worker Agent ───

export const WorkerAgentSchema = Schema.Struct({
  agentId: Schema.String,
  specialty: Schema.String,
  status: Schema.Literal("idle", "busy", "failed", "draining"),
  currentWorkflowId: Schema.optional(WorkflowIdSchema),
  currentStepId: Schema.optional(Schema.String),
  completedTasks: Schema.Number,
  failedTasks: Schema.Number,
  avgLatencyMs: Schema.Number,
});
export type WorkerAgent = typeof WorkerAgentSchema.Type;
```

---

## Error Types

```typescript
import { Data } from "effect";

export class WorkflowError extends Data.TaggedError("WorkflowError")<{
  readonly message: string;
  readonly workflowId?: string;
  readonly cause?: unknown;
}> {}

export class WorkflowStepError extends Data.TaggedError("WorkflowStepError")<{
  readonly message: string;
  readonly workflowId: string;
  readonly stepId: string;
  readonly cause?: unknown;
}> {}

export class CheckpointError extends Data.TaggedError("CheckpointError")<{
  readonly message: string;
  readonly workflowId: string;
}> {}

export class ApprovalTimeoutError extends Data.TaggedError(
  "ApprovalTimeoutError",
)<{
  readonly message: string;
  readonly workflowId: string;
  readonly stepId: string;
  readonly timeoutMs: number;
}> {}

export class WorkerPoolError extends Data.TaggedError("WorkerPoolError")<{
  readonly message: string;
  readonly availableWorkers: number;
  readonly requiredWorkers: number;
}> {}
```

---

## Effect Service Definition

```typescript
import { Effect, Context } from "effect";

export class OrchestrationService extends Context.Tag("OrchestrationService")<
  OrchestrationService,
  {
    /**
     * Create and execute a workflow with the specified pattern.
     */
    readonly executeWorkflow: (
      name: string,
      pattern: WorkflowPattern,
      steps: readonly Omit<
        WorkflowStep,
        "status" | "startedAt" | "completedAt" | "error" | "retryCount"
      >[],
      options?: { maxRetries?: number; timeoutMs?: number },
    ) => Effect.Effect<Workflow, WorkflowError | WorkflowStepError>;

    /**
     * Resume a paused or crashed workflow from its last checkpoint.
     */
    readonly resumeWorkflow: (
      workflowId: WorkflowId,
    ) => Effect.Effect<Workflow, WorkflowError | CheckpointError>;

    /**
     * Pause a running workflow (e.g., for human approval).
     */
    readonly pauseWorkflow: (
      workflowId: WorkflowId,
      reason: string,
    ) => Effect.Effect<void, WorkflowError>;

    /**
     * Request human approval for a workflow step.
     * Blocks until approved, rejected, or timeout.
     */
    readonly requestApproval: (
      workflowId: WorkflowId,
      stepId: string,
      description: string,
      riskLevel: "low" | "medium" | "high" | "critical",
      timeoutMs?: number,
    ) => Effect.Effect<ApprovalRequest, ApprovalTimeoutError>;

    /**
     * Respond to an approval request.
     */
    readonly respondToApproval: (
      approvalId: string,
      approved: boolean,
      respondedBy: string,
    ) => Effect.Effect<void, WorkflowError>;

    /**
     * Create a checkpoint of the current workflow state.
     */
    readonly checkpoint: (
      workflowId: WorkflowId,
    ) => Effect.Effect<Checkpoint, CheckpointError>;

    /**
     * Get the status of a workflow.
     */
    readonly getWorkflow: (
      workflowId: WorkflowId,
    ) => Effect.Effect<Workflow, WorkflowError>;

    /**
     * List all active workflows.
     */
    readonly listWorkflows: (filter?: {
      state?: WorkflowState;
      pattern?: WorkflowPattern;
    }) => Effect.Effect<readonly Workflow[], WorkflowError>;

    /**
     * Spawn a worker agent and add it to the pool.
     */
    readonly spawnWorker: (
      specialty: string,
    ) => Effect.Effect<WorkerAgent, WorkerPoolError>;

    /**
     * Get the full event history for a workflow (for debugging/replay).
     */
    readonly getEventLog: (
      workflowId: WorkflowId,
    ) => Effect.Effect<readonly DomainEvent[], WorkflowError>;
  }
>() {}
```

---

## Workflow Engine Implementation

```typescript
import { Effect, Ref, Array as A } from "effect";
import { EventBus } from "@reactive-agents/core";

export const makeWorkflowEngine = Effect.gen(function* () {
  const eventBus = yield* EventBus;
  const workflowsRef = yield* Ref.make<Map<string, Workflow>>(new Map());
  const eventLogRef = yield* Ref.make<DomainEvent[]>([]);

  const appendEvent = (event: DomainEvent): Effect.Effect<void, never> =>
    Effect.gen(function* () {
      yield* Ref.update(eventLogRef, (events) => [...events, event]);
      yield* eventBus.publish({
        type: `orchestration.${event.type}`,
        payload: event,
      });
    });

  const executeSequential = (
    workflow: Workflow,
    executeStep: (
      step: WorkflowStep,
    ) => Effect.Effect<unknown, WorkflowStepError>,
  ): Effect.Effect<Workflow, WorkflowError | WorkflowStepError> =>
    Effect.gen(function* () {
      let currentWorkflow = { ...workflow, state: "running" as const };
      yield* updateWorkflow(currentWorkflow);

      for (const step of currentWorkflow.steps) {
        yield* appendEvent({
          type: "StepStarted",
          workflowId: workflow.id,
          timestamp: new Date(),
          payload: { stepId: step.id, agentId: step.agentId ?? "default" },
        });

        const result = yield* executeStepWithRetry(step, executeStep);

        yield* appendEvent({
          type: "StepCompleted",
          workflowId: workflow.id,
          timestamp: new Date(),
          payload: { stepId: step.id, output: result },
        });

        // Update step in workflow
        currentWorkflow = {
          ...currentWorkflow,
          steps: currentWorkflow.steps.map((s) =>
            s.id === step.id
              ? {
                  ...s,
                  status: "completed" as const,
                  output: result,
                  completedAt: new Date(),
                }
              : s,
          ),
          updatedAt: new Date(),
        };
        yield* updateWorkflow(currentWorkflow);

        // Checkpoint after each step
        yield* createCheckpoint(currentWorkflow);
      }

      currentWorkflow = {
        ...currentWorkflow,
        state: "completed" as const,
        completedAt: new Date(),
      };
      yield* updateWorkflow(currentWorkflow);

      yield* appendEvent({
        type: "WorkflowCompleted",
        workflowId: workflow.id,
        timestamp: new Date(),
        payload: { result: currentWorkflow.steps.map((s) => s.output) },
      });

      return currentWorkflow;
    });

  const executeParallel = (
    workflow: Workflow,
    executeStep: (
      step: WorkflowStep,
    ) => Effect.Effect<unknown, WorkflowStepError>,
  ): Effect.Effect<Workflow, WorkflowError | WorkflowStepError> =>
    Effect.gen(function* () {
      let currentWorkflow = { ...workflow, state: "running" as const };
      yield* updateWorkflow(currentWorkflow);

      const results = yield* Effect.all(
        currentWorkflow.steps.map((step) =>
          Effect.gen(function* () {
            yield* appendEvent({
              type: "StepStarted",
              workflowId: workflow.id,
              timestamp: new Date(),
              payload: { stepId: step.id, agentId: step.agentId ?? "default" },
            });

            const result = yield* executeStepWithRetry(step, executeStep);

            yield* appendEvent({
              type: "StepCompleted",
              workflowId: workflow.id,
              timestamp: new Date(),
              payload: { stepId: step.id, output: result },
            });

            return { stepId: step.id, output: result };
          }),
        ),
        { concurrency: "unbounded" },
      );

      currentWorkflow = {
        ...currentWorkflow,
        state: "completed" as const,
        completedAt: new Date(),
        steps: currentWorkflow.steps.map((s) => {
          const result = results.find((r) => r.stepId === s.id);
          return result
            ? {
                ...s,
                status: "completed" as const,
                output: result.output,
                completedAt: new Date(),
              }
            : s;
        }),
      };
      yield* updateWorkflow(currentWorkflow);

      yield* appendEvent({
        type: "WorkflowCompleted",
        workflowId: workflow.id,
        timestamp: new Date(),
        payload: { result: results.map((r) => r.output) },
      });

      return currentWorkflow;
    });

  const executeMapReduce = (
    workflow: Workflow,
    executeStep: (
      step: WorkflowStep,
    ) => Effect.Effect<unknown, WorkflowStepError>,
  ): Effect.Effect<Workflow, WorkflowError | WorkflowStepError> =>
    Effect.gen(function* () {
      // Last step is the "reduce" step, all others are "map" steps
      const mapSteps = workflow.steps.slice(0, -1);
      const reduceStep = workflow.steps[workflow.steps.length - 1];

      // Map phase: parallel execution
      const mapResults = yield* Effect.all(
        mapSteps.map((step) => executeStepWithRetry(step, executeStep)),
        { concurrency: "unbounded" },
      );

      // Reduce phase: aggregate results
      const reduceInput = { ...reduceStep, input: mapResults };
      const finalResult = yield* executeStepWithRetry(reduceInput, executeStep);

      const completedWorkflow: Workflow = {
        ...workflow,
        state: "completed" as const,
        completedAt: new Date(),
        steps: [
          ...mapSteps.map((s, i) => ({
            ...s,
            status: "completed" as const,
            output: mapResults[i],
            completedAt: new Date(),
          })),
          {
            ...reduceStep,
            status: "completed" as const,
            output: finalResult,
            completedAt: new Date(),
          },
        ],
      };
      yield* updateWorkflow(completedWorkflow);

      return completedWorkflow;
    });

  // ─── Step retry logic ───

  const executeStepWithRetry = (
    step: WorkflowStep,
    executeStep: (
      step: WorkflowStep,
    ) => Effect.Effect<unknown, WorkflowStepError>,
  ): Effect.Effect<unknown, WorkflowStepError> =>
    executeStep(step).pipe(
      Effect.retry({
        times: step.maxRetries,
        schedule: { delays: [1000, 2000, 4000] }, // Exponential backoff
      }),
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* appendEvent({
            type: "StepFailed",
            workflowId: "" as WorkflowId, // Would be set properly in context
            timestamp: new Date(),
            payload: { stepId: step.id, error: String(error) },
          });
          return yield* Effect.fail(error);
        }),
      ),
    );

  // ─── State management helpers ───

  const updateWorkflow = (workflow: Workflow): Effect.Effect<void, never> =>
    Ref.update(workflowsRef, (map) => {
      const newMap = new Map(map);
      newMap.set(workflow.id, workflow);
      return newMap;
    });

  const createCheckpoint = (
    workflow: Workflow,
  ): Effect.Effect<Checkpoint, never> =>
    Effect.gen(function* () {
      const events = yield* Ref.get(eventLogRef);
      const checkpoint: Checkpoint = {
        id: crypto.randomUUID(),
        workflowId: workflow.id,
        timestamp: new Date(),
        state: workflow,
        eventIndex: events.length,
      };
      return checkpoint;
    });

  return {
    executeSequential,
    executeParallel,
    executeMapReduce,
    appendEvent,
    updateWorkflow,
    createCheckpoint,
    workflowsRef,
    eventLogRef,
  };
});
```

---

## Event Sourcing & Checkpoint Manager

```typescript
import { Effect, Ref } from "effect";

export const makeEventSourcing = Effect.gen(function* () {
  const checkpointsRef = yield* Ref.make<Map<string, Checkpoint[]>>(new Map());

  const saveCheckpoint = (
    checkpoint: Checkpoint,
  ): Effect.Effect<void, CheckpointError> =>
    Ref.update(checkpointsRef, (map) => {
      const newMap = new Map(map);
      const existing = newMap.get(checkpoint.workflowId) ?? [];
      newMap.set(checkpoint.workflowId, [...existing, checkpoint]);
      return newMap;
    }).pipe(
      Effect.mapError(
        (e) =>
          new CheckpointError({
            message: "Failed to save checkpoint",
            workflowId: checkpoint.workflowId,
          }),
      ),
    );

  const loadLatestCheckpoint = (
    workflowId: WorkflowId,
  ): Effect.Effect<Checkpoint, CheckpointError> =>
    Effect.gen(function* () {
      const map = yield* Ref.get(checkpointsRef);
      const checkpoints = map.get(workflowId);

      if (!checkpoints || checkpoints.length === 0) {
        return yield* Effect.fail(
          new CheckpointError({
            message: `No checkpoint found for workflow ${workflowId}`,
            workflowId,
          }),
        );
      }

      // Return most recent checkpoint
      return checkpoints[checkpoints.length - 1];
    });

  const replayFromCheckpoint = (
    checkpoint: Checkpoint,
    events: readonly DomainEvent[],
  ): Effect.Effect<Workflow, CheckpointError> =>
    Effect.gen(function* () {
      let workflow = checkpoint.state;

      // Replay events that occurred after the checkpoint
      const eventsToReplay = events.slice(checkpoint.eventIndex);

      for (const event of eventsToReplay) {
        workflow = applyEvent(workflow, event);
      }

      return workflow;
    });

  return { saveCheckpoint, loadLatestCheckpoint, replayFromCheckpoint };
});

// ─── Pure event application (deterministic) ───

function applyEvent(workflow: Workflow, event: DomainEvent): Workflow {
  switch (event.type) {
    case "StepStarted":
      return {
        ...workflow,
        steps: workflow.steps.map((s) =>
          s.id === event.payload.stepId
            ? {
                ...s,
                status: "running" as const,
                startedAt: event.timestamp,
                agentId: event.payload.agentId,
              }
            : s,
        ),
        updatedAt: event.timestamp,
      };

    case "StepCompleted":
      return {
        ...workflow,
        steps: workflow.steps.map((s) =>
          s.id === event.payload.stepId
            ? {
                ...s,
                status: "completed" as const,
                output: event.payload.output,
                completedAt: event.timestamp,
              }
            : s,
        ),
        updatedAt: event.timestamp,
      };

    case "StepFailed":
      return {
        ...workflow,
        steps: workflow.steps.map((s) =>
          s.id === event.payload.stepId
            ? {
                ...s,
                status: "failed" as const,
                error: event.payload.error,
                retryCount: s.retryCount + 1,
              }
            : s,
        ),
        updatedAt: event.timestamp,
      };

    case "WorkflowPaused":
      return {
        ...workflow,
        state: "paused" as const,
        updatedAt: event.timestamp,
      };

    case "WorkflowResumed":
      return {
        ...workflow,
        state: "running" as const,
        updatedAt: event.timestamp,
      };

    case "WorkflowCompleted":
      return {
        ...workflow,
        state: "completed" as const,
        completedAt: event.timestamp,
        updatedAt: event.timestamp,
      };

    case "WorkflowFailed":
      return {
        ...workflow,
        state: "failed" as const,
        updatedAt: event.timestamp,
      };

    default:
      return workflow;
  }
}
```

---

## Human-in-the-Loop Approval Gates

```typescript
import { Effect, Ref, Deferred, Queue } from "effect";
import { EventBus } from "@reactive-agents/core";

export const makeApprovalGates = Effect.gen(function* () {
  const eventBus = yield* EventBus;
  const pendingRef = yield* Ref.make<
    Map<
      string,
      {
        request: ApprovalRequest;
        deferred: Deferred.Deferred<ApprovalRequest, ApprovalTimeoutError>;
      }
    >
  >(new Map());

  const requestApproval = (
    workflowId: WorkflowId,
    stepId: string,
    description: string,
    riskLevel: "low" | "medium" | "high" | "critical",
    timeoutMs: number = 300_000, // 5 minutes default
  ): Effect.Effect<ApprovalRequest, ApprovalTimeoutError> =>
    Effect.gen(function* () {
      const request: ApprovalRequest = {
        id: crypto.randomUUID(),
        workflowId,
        stepId,
        description,
        riskLevel,
        requestedAt: new Date(),
        timeoutMs,
        status: "pending",
      };

      // Create a deferred that will be resolved when the approval comes
      const deferred = yield* Deferred.make<
        ApprovalRequest,
        ApprovalTimeoutError
      >();

      yield* Ref.update(pendingRef, (map) => {
        const newMap = new Map(map);
        newMap.set(request.id, { request, deferred });
        return newMap;
      });

      // Publish approval request event (UI/CLI will pick this up)
      yield* eventBus.publish({
        type: "orchestration.approval-requested",
        payload: {
          approvalId: request.id,
          workflowId,
          stepId,
          description,
          riskLevel,
          timeoutMs,
        },
      });

      // Wait for response or timeout
      const result = yield* Deferred.await(deferred).pipe(
        Effect.timeout(`${timeoutMs} millis`),
        Effect.mapError(
          () =>
            new ApprovalTimeoutError({
              message: `Approval timed out after ${timeoutMs}ms`,
              workflowId,
              stepId,
              timeoutMs,
            }),
        ),
      );

      return result;
    });

  const respond = (
    approvalId: string,
    approved: boolean,
    respondedBy: string,
  ): Effect.Effect<void, WorkflowError> =>
    Effect.gen(function* () {
      const pending = yield* Ref.get(pendingRef);
      const entry = pending.get(approvalId);

      if (!entry) {
        return yield* Effect.fail(
          new WorkflowError({
            message: `Approval request ${approvalId} not found`,
          }),
        );
      }

      const updatedRequest: ApprovalRequest = {
        ...entry.request,
        status: approved ? "approved" : "rejected",
        respondedBy,
        respondedAt: new Date(),
      };

      if (approved) {
        yield* Deferred.succeed(entry.deferred, updatedRequest);
      } else {
        yield* Deferred.fail(
          entry.deferred,
          new ApprovalTimeoutError({
            message: `Approval rejected by ${respondedBy}`,
            workflowId: entry.request.workflowId,
            stepId: entry.request.stepId,
            timeoutMs: entry.request.timeoutMs,
          }),
        );
      }

      // Cleanup
      yield* Ref.update(pendingRef, (map) => {
        const newMap = new Map(map);
        newMap.delete(approvalId);
        return newMap;
      });

      yield* eventBus.publish({
        type: approved
          ? "orchestration.approval-granted"
          : "orchestration.approval-rejected",
        payload: { approvalId, respondedBy },
      });
    });

  return { requestApproval, respond };
});
```

---

## Worker Pool Management

```typescript
import { Effect, Ref } from "effect";

export const makeWorkerPool = Effect.gen(function* () {
  const workersRef = yield* Ref.make<Map<string, WorkerAgent>>(new Map());

  const spawn = (
    specialty: string,
  ): Effect.Effect<WorkerAgent, WorkerPoolError> =>
    Effect.gen(function* () {
      const worker: WorkerAgent = {
        agentId: `worker-${crypto.randomUUID().slice(0, 8)}`,
        specialty,
        status: "idle",
        completedTasks: 0,
        failedTasks: 0,
        avgLatencyMs: 0,
      };

      yield* Ref.update(workersRef, (map) => {
        const newMap = new Map(map);
        newMap.set(worker.agentId, worker);
        return newMap;
      });

      return worker;
    });

  const assignTask = (
    workflowId: WorkflowId,
    stepId: string,
    requiredSpecialty?: string,
  ): Effect.Effect<WorkerAgent, WorkerPoolError> =>
    Effect.gen(function* () {
      const workers = yield* Ref.get(workersRef);

      // Find idle worker with matching specialty
      let candidate: WorkerAgent | undefined;
      for (const worker of workers.values()) {
        if (worker.status === "idle") {
          if (!requiredSpecialty || worker.specialty === requiredSpecialty) {
            candidate = worker;
            break;
          }
        }
      }

      if (!candidate) {
        return yield* Effect.fail(
          new WorkerPoolError({
            message: `No idle worker available${requiredSpecialty ? ` with specialty "${requiredSpecialty}"` : ""}`,
            availableWorkers: [...workers.values()].filter(
              (w) => w.status === "idle",
            ).length,
            requiredWorkers: 1,
          }),
        );
      }

      // Mark as busy
      const assigned = {
        ...candidate,
        status: "busy" as const,
        currentWorkflowId: workflowId,
        currentStepId: stepId,
      };

      yield* Ref.update(workersRef, (map) => {
        const newMap = new Map(map);
        newMap.set(assigned.agentId, assigned);
        return newMap;
      });

      return assigned;
    });

  const releaseWorker = (
    agentId: string,
    success: boolean,
    latencyMs: number,
  ): Effect.Effect<void, never> =>
    Ref.update(workersRef, (map) => {
      const newMap = new Map(map);
      const worker = newMap.get(agentId);
      if (worker) {
        const totalTasks = worker.completedTasks + worker.failedTasks + 1;
        newMap.set(agentId, {
          ...worker,
          status: "idle" as const,
          currentWorkflowId: undefined,
          currentStepId: undefined,
          completedTasks: success
            ? worker.completedTasks + 1
            : worker.completedTasks,
          failedTasks: success ? worker.failedTasks : worker.failedTasks + 1,
          avgLatencyMs:
            (worker.avgLatencyMs * (totalTasks - 1) + latencyMs) / totalTasks,
        });
      }
      return newMap;
    });

  const getStatus = Effect.gen(function* () {
    const workers = yield* Ref.get(workersRef);
    const all = [...workers.values()];
    return {
      total: all.length,
      idle: all.filter((w) => w.status === "idle").length,
      busy: all.filter((w) => w.status === "busy").length,
      failed: all.filter((w) => w.status === "failed").length,
      workers: all,
    };
  });

  return { spawn, assignTask, releaseWorker, getStatus };
});
```

---

## Main OrchestrationService Implementation

```typescript
import { Effect, Layer } from "effect";
import { EventBus } from "@reactive-agents/core";

export const OrchestrationServiceLive = Layer.effect(
  OrchestrationService,
  Effect.gen(function* () {
    const engine = yield* makeWorkflowEngine;
    const eventSourcing = yield* makeEventSourcing;
    const approvalGates = yield* makeApprovalGates;
    const workerPool = yield* makeWorkerPool;

    // Default step executor (delegates to agent reasoning)
    const defaultExecuteStep = (
      step: WorkflowStep,
    ): Effect.Effect<unknown, WorkflowStepError> =>
      Effect.gen(function* () {
        // In real implementation, this would call the reasoning service
        // for the assigned agent to process the step
        return step.input; // Placeholder
      }).pipe(
        Effect.mapError(
          (e) =>
            new WorkflowStepError({
              message: `Step ${step.id} failed`,
              workflowId: "",
              stepId: step.id,
              cause: e,
            }),
        ),
      );

    const executeWorkflow = (
      name: string,
      pattern: WorkflowPattern,
      steps: readonly Omit<
        WorkflowStep,
        "status" | "startedAt" | "completedAt" | "error" | "retryCount"
      >[],
      options?: { maxRetries?: number; timeoutMs?: number },
    ): Effect.Effect<Workflow, WorkflowError | WorkflowStepError> =>
      Effect.gen(function* () {
        const workflow: Workflow = {
          id: crypto.randomUUID() as WorkflowId,
          name,
          pattern,
          steps: steps.map((s) => ({
            ...s,
            status: "pending" as const,
            retryCount: 0,
            maxRetries: options?.maxRetries ?? 3,
          })),
          state: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        yield* engine.appendEvent({
          type: "WorkflowCreated",
          workflowId: workflow.id,
          timestamp: new Date(),
          payload: workflow,
        });

        // Execute based on pattern
        switch (pattern) {
          case "sequential":
            return yield* engine.executeSequential(
              workflow,
              defaultExecuteStep,
            );
          case "parallel":
            return yield* engine.executeParallel(workflow, defaultExecuteStep);
          case "map-reduce":
            return yield* engine.executeMapReduce(workflow, defaultExecuteStep);
          case "orchestrator-workers":
            return yield* engine.executeParallel(workflow, defaultExecuteStep);
          case "pipeline":
            return yield* engine.executeSequential(
              workflow,
              defaultExecuteStep,
            );
        }
      });

    const resumeWorkflow = (workflowId: WorkflowId) =>
      Effect.gen(function* () {
        const checkpoint =
          yield* eventSourcing.loadLatestCheckpoint(workflowId);
        const events = yield* Ref.get(engine.eventLogRef);
        const workflow = yield* eventSourcing.replayFromCheckpoint(
          checkpoint,
          events,
        );

        yield* engine.appendEvent({
          type: "WorkflowResumed",
          workflowId,
          timestamp: new Date(),
          payload: {},
        });

        // Re-execute from the first incomplete step
        const pendingSteps = workflow.steps.filter(
          (s) => s.status === "pending" || s.status === "failed",
        );
        // Continue execution...

        return workflow;
      });

    const pauseWorkflow = (workflowId: WorkflowId, reason: string) =>
      engine
        .appendEvent({
          type: "WorkflowPaused",
          workflowId,
          timestamp: new Date(),
          payload: { reason, approvalRequired: true },
        })
        .pipe(
          Effect.mapError(
            (e) =>
              new WorkflowError({
                message: "Failed to pause workflow",
                workflowId,
              }),
          ),
        );

    const requestApproval = approvalGates.requestApproval;
    const respondToApproval = approvalGates.respond;

    const checkpoint = (workflowId: WorkflowId) =>
      Effect.gen(function* () {
        const workflows = yield* Ref.get(engine.workflowsRef);
        const workflow = workflows.get(workflowId);
        if (!workflow) {
          return yield* Effect.fail(
            new CheckpointError({
              message: `Workflow ${workflowId} not found`,
              workflowId,
            }),
          );
        }
        const cp = yield* engine.createCheckpoint(workflow);
        yield* eventSourcing.saveCheckpoint(cp);
        return cp;
      });

    const getWorkflow = (workflowId: WorkflowId) =>
      Effect.gen(function* () {
        const workflows = yield* Ref.get(engine.workflowsRef);
        const workflow = workflows.get(workflowId);
        if (!workflow) {
          return yield* Effect.fail(
            new WorkflowError({
              message: `Workflow ${workflowId} not found`,
              workflowId,
            }),
          );
        }
        return workflow;
      });

    const listWorkflows = (filter?: {
      state?: WorkflowState;
      pattern?: WorkflowPattern;
    }) =>
      Effect.gen(function* () {
        const workflows = yield* Ref.get(engine.workflowsRef);
        let result = [...workflows.values()];
        if (filter?.state)
          result = result.filter((w) => w.state === filter.state);
        if (filter?.pattern)
          result = result.filter((w) => w.pattern === filter.pattern);
        return result;
      });

    const spawnWorker = (specialty: string) => workerPool.spawn(specialty);

    const getEventLog = (workflowId: WorkflowId) =>
      Effect.gen(function* () {
        const events = yield* Ref.get(engine.eventLogRef);
        return events.filter((e) => e.workflowId === workflowId);
      });

    return {
      executeWorkflow,
      resumeWorkflow,
      pauseWorkflow,
      requestApproval,
      respondToApproval,
      checkpoint,
      getWorkflow,
      listWorkflows,
      spawnWorker,
      getEventLog,
    };
  }),
);
```

---

## Testing

```typescript
import { Effect, Layer } from "effect";
import { describe, it, expect } from "vitest";
import { OrchestrationService, OrchestrationServiceLive } from "../src";

const TestOrchestrationLayer = OrchestrationServiceLive.pipe(
  Layer.provide(TestEventBusLayer),
  Layer.provide(TestIdentityLayer),
);

describe("OrchestrationService", () => {
  it("should execute a sequential workflow", async () => {
    const program = Effect.gen(function* () {
      const orchestration = yield* OrchestrationService;

      const workflow = yield* orchestration.executeWorkflow(
        "test-workflow",
        "sequential",
        [
          {
            id: "step-1",
            name: "Research",
            input: "Find relevant data",
            maxRetries: 3,
          },
          {
            id: "step-2",
            name: "Analyze",
            input: "Analyze the data",
            maxRetries: 3,
          },
          {
            id: "step-3",
            name: "Report",
            input: "Generate report",
            maxRetries: 3,
          },
        ],
      );

      expect(workflow.state).toBe("completed");
      expect(workflow.steps.every((s) => s.status === "completed")).toBe(true);
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(TestOrchestrationLayer)),
    );
  });

  it("should execute a parallel workflow", async () => {
    const program = Effect.gen(function* () {
      const orchestration = yield* OrchestrationService;

      const workflow = yield* orchestration.executeWorkflow(
        "parallel-workflow",
        "parallel",
        [
          { id: "task-a", name: "Task A", input: "Do A", maxRetries: 2 },
          { id: "task-b", name: "Task B", input: "Do B", maxRetries: 2 },
          { id: "task-c", name: "Task C", input: "Do C", maxRetries: 2 },
        ],
      );

      expect(workflow.state).toBe("completed");
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(TestOrchestrationLayer)),
    );
  });

  it("should checkpoint and resume workflows", async () => {
    const program = Effect.gen(function* () {
      const orchestration = yield* OrchestrationService;

      const workflow = yield* orchestration.executeWorkflow(
        "durable-workflow",
        "sequential",
        [
          { id: "step-1", name: "Step 1", input: "input-1", maxRetries: 3 },
          { id: "step-2", name: "Step 2", input: "input-2", maxRetries: 3 },
        ],
      );

      // Create checkpoint
      const cp = yield* orchestration.checkpoint(workflow.id);
      expect(cp.workflowId).toBe(workflow.id);

      // Retrieve event log for debugging
      const events = yield* orchestration.getEventLog(workflow.id);
      expect(events.length).toBeGreaterThan(0);
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(TestOrchestrationLayer)),
    );
  });

  it("should spawn and manage workers", async () => {
    const program = Effect.gen(function* () {
      const orchestration = yield* OrchestrationService;

      const worker = yield* orchestration.spawnWorker("research");
      expect(worker.status).toBe("idle");
      expect(worker.specialty).toBe("research");
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(TestOrchestrationLayer)),
    );
  });

  it("should list active workflows", async () => {
    const program = Effect.gen(function* () {
      const orchestration = yield* OrchestrationService;

      yield* orchestration.executeWorkflow("wf-1", "sequential", [
        { id: "s1", name: "S1", input: "i1", maxRetries: 1 },
      ]);

      const all = yield* orchestration.listWorkflows();
      expect(all.length).toBeGreaterThanOrEqual(1);
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(TestOrchestrationLayer)),
    );
  });
});
```

---

## Configuration

```typescript
export const OrchestrationConfig = {
  // Workflow execution
  workflows: {
    maxConcurrentSteps: 10,
    defaultMaxRetries: 3,
    defaultTimeoutMs: 300_000, // 5 minutes per workflow
    stepTimeoutMs: 60_000, // 1 minute per step
  },

  // Worker pool
  workerPool: {
    maxWorkers: 20,
    idleTimeoutMs: 120_000, // Drain idle workers after 2 minutes
    healthCheckIntervalMs: 30_000,
  },

  // Event sourcing
  eventSourcing: {
    checkpointIntervalSteps: 1, // Checkpoint after every step
    maxEventsInMemory: 10_000,
    eventRetentionDays: 30,
  },

  // Human-in-the-loop
  approval: {
    defaultTimeoutMs: 300_000, // 5 minutes
    autoApproveRiskLevel: "low", // Auto-approve low-risk steps
    requireApprovalAbove: "high", // Always require approval for high/critical
  },
};
```

---

## Performance Targets

| Metric                       | Target          | Notes                          |
| ---------------------------- | --------------- | ------------------------------ |
| Workflow creation            | <5ms            | Including event emission       |
| Step dispatch                | <10ms           | Including worker assignment    |
| Checkpoint creation          | <20ms           | State serialization + storage  |
| Checkpoint recovery          | <100ms          | Replay events to rebuild state |
| Event append                 | <1ms            | Append-only, in-memory         |
| Worker spawn                 | <50ms           | Including identity setup       |
| Parallel workflow (10 steps) | <2x single step | Near-linear parallelism        |

---

## Integration Points

- **EventBus** (Layer 1): All workflow state transitions emit domain events
- **Identity** (Layer 6): Worker agents get delegated permissions from orchestrator, all actions audited
- **Reasoning** (Layer 3): Each worker step is processed by the reasoning engine
- **Cost** (Layer 5): Workflow costs tracked across all steps and workers
- **Observability** (Layer 9): Workflow traces exported as OpenTelemetry spans
- **Interaction** (Layer 10): Human approval gates surface through the interaction layer
- **A2A Protocol**: Agents exposed via A2A can be discovered and invoked by external agents from any framework
- **Tools** (Layer 8): Agents can be registered as tools via the agent-as-tool adapter

---

## A2A Protocol Support (Agent-to-Agent Interoperability)

A2A is the emerging industry standard (21.9K stars, Linux Foundation) for agent-to-agent communication. It complements MCP (which handles agent-to-tool communication) by enabling agent-to-agent collaboration across frameworks.

**Relationship:** MCP = agent ↔ tools | A2A = agent ↔ agent

### A2A Types

```typescript
// ─── A2A Agent Card (RFC-compliant) ───

export const A2AAgentCardSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  url: Schema.String, // Agent endpoint URL
  version: Schema.String,
  capabilities: Schema.Struct({
    streaming: Schema.optional(Schema.Boolean), // Supports SSE streaming
    pushNotifications: Schema.optional(Schema.Boolean),
    stateTransitionHistory: Schema.optional(Schema.Boolean),
  }),
  skills: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      description: Schema.String,
      tags: Schema.optional(Schema.Array(Schema.String)),
      examples: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
  authentication: Schema.optional(
    Schema.Struct({
      schemes: Schema.Array(Schema.String), // e.g., ['bearer', 'apiKey']
    }),
  ),
  defaultInputModes: Schema.optional(Schema.Array(Schema.String)),
  defaultOutputModes: Schema.optional(Schema.Array(Schema.String)),
});
export type A2AAgentCard = typeof A2AAgentCardSchema.Type;

// ─── A2A Task ───

export const A2ATaskState = Schema.Literal(
  "submitted",
  "working",
  "input-required",
  "completed",
  "canceled",
  "failed",
);
export type A2ATaskState = typeof A2ATaskState.Type;

export const A2ATaskSchema = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.optional(Schema.String),
  status: Schema.Struct({
    state: A2ATaskState,
    message: Schema.optional(
      Schema.Struct({
        role: Schema.Literal("agent", "user"),
        parts: Schema.Array(
          Schema.Struct({
            type: Schema.Literal("text", "file", "data"),
            text: Schema.optional(Schema.String),
            mimeType: Schema.optional(Schema.String),
            data: Schema.optional(Schema.Unknown),
          }),
        ),
      }),
    ),
  }),
  history: Schema.optional(Schema.Array(Schema.Unknown)),
});
export type A2ATask = typeof A2ATaskSchema.Type;
```

### A2A Server (Expose Agents)

```typescript
// ─── A2AServer: Expose reactive-agents as A2A endpoints ───

export class A2AServer extends Context.Tag("A2AServer")<
  A2AServer,
  {
    // Generate Agent Card from agent configuration
    readonly generateAgentCard: (
      agentId: string,
      config: { skills: string[]; description: string; url: string },
    ) => Effect.Effect<A2AAgentCard>;

    // Start HTTP server exposing A2A JSON-RPC 2.0 methods
    readonly serve: (
      port: number,
      agentId: string,
    ) => Effect.Effect<void, A2AServerError>;

    // Handle incoming A2A task (JSON-RPC 2.0)
    readonly handleTask: (
      method:
        | "tasks/send"
        | "tasks/sendSubscribe"
        | "tasks/get"
        | "tasks/cancel",
      params: unknown,
    ) => Effect.Effect<A2ATask, A2ATaskError>;

    // Stream task updates via SSE
    readonly streamTask: (
      taskId: string,
    ) => Effect.Effect<Stream.Stream<A2ATask>, A2ATaskError>;
  }
>() {}
```

### A2A Client (Consume External Agents)

```typescript
// ─── A2AClient: Consume external A2A-compatible agents ───

export class A2AClient extends Context.Tag("A2AClient")<
  A2AClient,
  {
    // Discover agent by fetching its Agent Card
    readonly discover: (
      agentUrl: string,
    ) => Effect.Effect<A2AAgentCard, A2ADiscoveryError>;

    // Send a task to an external A2A agent
    readonly sendTask: (
      agentUrl: string,
      message: { role: "user"; parts: Array<{ type: "text"; text: string }> },
    ) => Effect.Effect<A2ATask, A2ATaskError>;

    // Send a task and subscribe to streaming updates (SSE)
    readonly sendTaskSubscribe: (
      agentUrl: string,
      message: { role: "user"; parts: Array<{ type: "text"; text: string }> },
    ) => Effect.Effect<Stream.Stream<A2ATask>, A2ATaskError>;

    // Get task status
    readonly getTask: (
      agentUrl: string,
      taskId: string,
    ) => Effect.Effect<A2ATask, A2ATaskError>;

    // Cancel a running task
    readonly cancelTask: (
      agentUrl: string,
      taskId: string,
    ) => Effect.Effect<A2ATask, A2ATaskError>;
  }
>() {}
```

### Agent-as-Tool Adapter

```typescript
// ─── AgentToolAdapter: Register agents as callable tools ───

export class AgentToolAdapter extends Context.Tag("AgentToolAdapter")<
  AgentToolAdapter,
  {
    // Wrap a local agent as a tool that can be used by other agents
    readonly wrapAsLocalTool: (
      agentId: string,
      description: string,
    ) => Effect.Effect<{
      name: string;
      description: string;
      inputSchema: unknown;
      execute: (input: unknown) => Effect.Effect<unknown, AgentToolError>;
    }>;

    // Wrap an external A2A agent as a tool
    readonly wrapAsRemoteTool: (agentCard: A2AAgentCard) => Effect.Effect<{
      name: string;
      description: string;
      inputSchema: unknown;
      execute: (input: unknown) => Effect.Effect<unknown, AgentToolError>;
    }>;
  }
>() {}
```

### A2A Error Types

```typescript
export class A2AServerError extends Data.TaggedError("A2AServerError")<{
  readonly message: string;
  readonly code: number;
}> {}

export class A2ADiscoveryError extends Data.TaggedError("A2ADiscoveryError")<{
  readonly agentUrl: string;
  readonly message: string;
}> {}

export class A2ATaskError extends Data.TaggedError("A2ATaskError")<{
  readonly taskId: string;
  readonly message: string;
  readonly state: string;
}> {}

export class AgentToolError extends Data.TaggedError("AgentToolError")<{
  readonly agentId: string;
  readonly message: string;
}> {}
```

---

## Success Criteria

- [ ] Sequential, parallel, and map-reduce workflow patterns working
- [ ] Event sourcing captures all state transitions
- [ ] Checkpoint + replay survives crashes
- [ ] Human-in-the-loop approval gates block and resume workflows
- [ ] Worker pool manages concurrent agents with specialty routing
- [ ] Multi-agent coordination shows 90%+ improvement over single agent on complex tasks
- [ ] A2A Server exposes agents with valid Agent Cards at `/.well-known/agent.json`
- [ ] A2A Client can discover and invoke external A2A-compliant agents
- [ ] Agent-as-tool adapter allows nesting agents as tools in other agents
- [ ] All operations use Effect-TS patterns (no raw async/await)

---

## Package Config

### File: `package.json`

```json
{
  "name": "@reactive-agents/orchestration",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "dependencies": {
    "effect": "^3.10.0",
    "@reactive-agents/core": "workspace:*",
    "@reactive-agents/llm-provider": "workspace:*",
    "@reactive-agents/identity": "workspace:*",
    "@reactive-agents/reasoning": "workspace:*",
    "@reactive-agents/cost": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "bun-types": "latest"
  }
}
```

---

**Status: Ready for implementation**
**Priority: Phase 3 (Weeks 11-13)**
