import { Effect, Context, Ref } from "effect";
import type {
  Workflow,
  WorkflowId,
  WorkflowPattern,
  WorkflowStep,
  WorkflowState,
  DomainEvent,
  Checkpoint,
  WorkerAgent,
} from "./types.js";
import { WorkflowError, WorkflowStepError, CheckpointError, WorkerPoolError } from "./errors.js";
import { makeWorkflowEngine, type WorkflowEngine } from "./workflows/workflow-engine.js";
import { makeEventSourcing, type EventSourcing } from "./durable/event-sourcing.js";
import { makeWorkerPool, type WorkerPool } from "./multi-agent/worker-pool.js";

export class OrchestrationService extends Context.Tag("OrchestrationService")<
  OrchestrationService,
  {
    readonly executeWorkflow: (
      name: string,
      pattern: WorkflowPattern,
      steps: readonly Omit<WorkflowStep, "status" | "startedAt" | "completedAt" | "error" | "retryCount">[],
      executeStep: (step: WorkflowStep) => Effect.Effect<unknown, WorkflowStepError>,
      options?: { maxRetries?: number },
    ) => Effect.Effect<Workflow, WorkflowError | WorkflowStepError>;

    readonly resumeWorkflow: (
      workflowId: WorkflowId,
      executeStep: (step: WorkflowStep) => Effect.Effect<unknown, WorkflowStepError>,
    ) => Effect.Effect<Workflow, WorkflowError | CheckpointError | WorkflowStepError>;

    readonly pauseWorkflow: (
      workflowId: WorkflowId,
      reason: string,
    ) => Effect.Effect<void, WorkflowError>;

    readonly checkpoint: (
      workflowId: WorkflowId,
    ) => Effect.Effect<Checkpoint, CheckpointError | WorkflowError>;

    readonly getWorkflow: (
      workflowId: WorkflowId,
    ) => Effect.Effect<Workflow, WorkflowError>;

    readonly listWorkflows: (filter?: {
      state?: WorkflowState;
      pattern?: WorkflowPattern;
    }) => Effect.Effect<readonly Workflow[], never>;

    readonly spawnWorker: (
      specialty: string,
    ) => Effect.Effect<WorkerAgent, WorkerPoolError>;

    readonly getEventLog: (
      workflowId?: WorkflowId,
    ) => Effect.Effect<readonly DomainEvent[], never>;
  }
>() {}

export const OrchestrationServiceLive = Effect.gen(function* () {
  const engine: WorkflowEngine = yield* makeWorkflowEngine;
  const eventSourcing: EventSourcing = yield* makeEventSourcing;
  const workerPool: WorkerPool = yield* makeWorkerPool;

  const executeWorkflow = (
    name: string,
    pattern: WorkflowPattern,
    steps: readonly Omit<WorkflowStep, "status" | "startedAt" | "completedAt" | "error" | "retryCount">[],
    executeStep: (step: WorkflowStep) => Effect.Effect<unknown, WorkflowStepError>,
    options?: { maxRetries?: number },
  ): Effect.Effect<Workflow, WorkflowError | WorkflowStepError> =>
    Effect.gen(function* () {
      const maxRetries = options?.maxRetries ?? 3;
      const workflowId = crypto.randomUUID() as WorkflowId;

      const fullSteps: WorkflowStep[] = steps.map((s) => ({
        ...s,
        status: "pending" as const,
        retryCount: 0,
        maxRetries,
      }));

      const workflow: Workflow = {
        id: workflowId,
        name,
        pattern,
        steps: fullSteps,
        state: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      yield* engine.updateWorkflow(workflow);
      yield* engine.appendEvent({
        type: "WorkflowCreated",
        workflowId,
        timestamp: new Date(),
        payload: workflow,
      });

      let result: Workflow;
      switch (pattern) {
        case "parallel":
          result = yield* engine.executeParallel(workflow, executeStep);
          break;
        case "map-reduce":
          result = yield* engine.executeMapReduce(workflow, executeStep);
          break;
        case "sequential":
        case "pipeline":
        case "orchestrator-workers":
        default:
          result = yield* engine.executeSequential(workflow, executeStep);
          break;
      }

      // Save a final checkpoint (best-effort, don't fail the workflow)
      const cp = yield* engine.createCheckpoint(result);
      yield* eventSourcing.saveCheckpoint(cp).pipe(Effect.catchAll(() => Effect.void));

      return result;
    });

  const resumeWorkflow = (
    workflowId: WorkflowId,
    executeStep: (step: WorkflowStep) => Effect.Effect<unknown, WorkflowStepError>,
  ): Effect.Effect<Workflow, WorkflowError | CheckpointError | WorkflowStepError> =>
    Effect.gen(function* () {
      const checkpoint = yield* eventSourcing.loadLatestCheckpoint(workflowId);
      const events = yield* Ref.get(engine.eventLogRef);
      const workflow = yield* eventSourcing.replayFromCheckpoint(checkpoint, events);

      // Resume workflow by marking it running and re-executing pending steps
      const resumed: Workflow = { ...workflow, state: "running" as const, updatedAt: new Date() };
      yield* engine.updateWorkflow(resumed);
      yield* engine.appendEvent({
        type: "WorkflowResumed",
        workflowId,
        timestamp: new Date(),
        payload: {},
      });

      // Re-execute only pending/failed steps
      const pendingSteps = resumed.steps.filter((s) => s.status === "pending" || s.status === "failed");
      let current = resumed;
      for (const step of pendingSteps) {
        yield* engine.appendEvent({
          type: "StepStarted",
          workflowId,
          timestamp: new Date(),
          payload: { stepId: step.id, agentId: step.agentId ?? "default" },
        });

        const result = yield* executeStep(step);

        yield* engine.appendEvent({
          type: "StepCompleted",
          workflowId,
          timestamp: new Date(),
          payload: { stepId: step.id, output: result },
        });

        current = {
          ...current,
          steps: current.steps.map((s) =>
            s.id === step.id
              ? { ...s, status: "completed" as const, output: result, completedAt: new Date() }
              : s,
          ),
          updatedAt: new Date(),
        };
        yield* engine.updateWorkflow(current);
      }

      current = { ...current, state: "completed" as const, completedAt: new Date() };
      yield* engine.updateWorkflow(current);
      return current;
    });

  const pauseWorkflow = (
    workflowId: WorkflowId,
    reason: string,
  ): Effect.Effect<void, WorkflowError> =>
    Effect.gen(function* () {
      const workflows = yield* Ref.get(engine.workflowsRef);
      const workflow = workflows.get(workflowId);
      if (!workflow) {
        return yield* Effect.fail(
          new WorkflowError({ message: `Workflow ${workflowId} not found`, workflowId }),
        );
      }

      const paused: Workflow = { ...workflow, state: "paused" as const, updatedAt: new Date() };
      yield* engine.updateWorkflow(paused);
      yield* engine.appendEvent({
        type: "WorkflowPaused",
        workflowId,
        timestamp: new Date(),
        payload: { reason },
      });
    });

  const checkpoint = (
    workflowId: WorkflowId,
  ): Effect.Effect<Checkpoint, CheckpointError | WorkflowError> =>
    Effect.gen(function* () {
      const workflows = yield* Ref.get(engine.workflowsRef);
      const workflow = workflows.get(workflowId);
      if (!workflow) {
        return yield* Effect.fail(
          new WorkflowError({ message: `Workflow ${workflowId} not found`, workflowId }),
        );
      }

      const cp = yield* engine.createCheckpoint(workflow);
      yield* eventSourcing.saveCheckpoint(cp);
      return cp;
    });

  const getWorkflow = (
    workflowId: WorkflowId,
  ): Effect.Effect<Workflow, WorkflowError> =>
    Effect.gen(function* () {
      const workflows = yield* Ref.get(engine.workflowsRef);
      const workflow = workflows.get(workflowId);
      if (!workflow) {
        return yield* Effect.fail(
          new WorkflowError({ message: `Workflow ${workflowId} not found`, workflowId }),
        );
      }
      return workflow;
    });

  const listWorkflows = (filter?: {
    state?: WorkflowState;
    pattern?: WorkflowPattern;
  }): Effect.Effect<readonly Workflow[], never> =>
    Effect.gen(function* () {
      const workflows = yield* Ref.get(engine.workflowsRef);
      let all = [...workflows.values()];
      if (filter?.state) {
        all = all.filter((w) => w.state === filter.state);
      }
      if (filter?.pattern) {
        all = all.filter((w) => w.pattern === filter.pattern);
      }
      return all;
    });

  const spawnWorker = (specialty: string): Effect.Effect<WorkerAgent, WorkerPoolError> =>
    workerPool.spawn(specialty);

  const getEventLog = (
    workflowId?: WorkflowId,
  ): Effect.Effect<readonly DomainEvent[], never> =>
    Effect.gen(function* () {
      const events = yield* Ref.get(engine.eventLogRef);
      if (workflowId) {
        return events.filter((e) => e.workflowId === workflowId);
      }
      return events;
    });

  return {
    executeWorkflow,
    resumeWorkflow,
    pauseWorkflow,
    checkpoint,
    getWorkflow,
    listWorkflows,
    spawnWorker,
    getEventLog,
  } as const;
});
