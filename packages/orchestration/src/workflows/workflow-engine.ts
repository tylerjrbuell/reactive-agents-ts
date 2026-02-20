import { Effect, Ref } from "effect";
import type { Workflow, WorkflowStep, WorkflowId, DomainEvent, Checkpoint } from "../types.js";
import type { WorkflowStepError, WorkflowError } from "../errors.js";

export interface WorkflowEngine {
  readonly executeSequential: (
    workflow: Workflow,
    executeStep: (step: WorkflowStep) => Effect.Effect<unknown, WorkflowStepError>,
  ) => Effect.Effect<Workflow, WorkflowError | WorkflowStepError>;
  readonly executeParallel: (
    workflow: Workflow,
    executeStep: (step: WorkflowStep) => Effect.Effect<unknown, WorkflowStepError>,
  ) => Effect.Effect<Workflow, WorkflowError | WorkflowStepError>;
  readonly executeMapReduce: (
    workflow: Workflow,
    executeStep: (step: WorkflowStep) => Effect.Effect<unknown, WorkflowStepError>,
  ) => Effect.Effect<Workflow, WorkflowError | WorkflowStepError>;
  readonly appendEvent: (event: DomainEvent) => Effect.Effect<void, never>;
  readonly updateWorkflow: (workflow: Workflow) => Effect.Effect<void, never>;
  readonly createCheckpoint: (workflow: Workflow) => Effect.Effect<Checkpoint, never>;
  readonly workflowsRef: Ref.Ref<Map<string, Workflow>>;
  readonly eventLogRef: Ref.Ref<DomainEvent[]>;
}

export const makeWorkflowEngine = Effect.gen(function* () {
  const workflowsRef = yield* Ref.make<Map<string, Workflow>>(new Map());
  const eventLogRef = yield* Ref.make<DomainEvent[]>([]);

  const appendEvent = (event: DomainEvent): Effect.Effect<void, never> =>
    Ref.update(eventLogRef, (events) => [...events, event]);

  const updateWorkflow = (workflow: Workflow): Effect.Effect<void, never> =>
    Ref.update(workflowsRef, (map) => {
      const newMap = new Map(map);
      newMap.set(workflow.id, workflow);
      return newMap;
    });

  const createCheckpoint = (workflow: Workflow): Effect.Effect<Checkpoint, never> =>
    Effect.gen(function* () {
      const events = yield* Ref.get(eventLogRef);
      return {
        id: crypto.randomUUID(),
        workflowId: workflow.id,
        timestamp: new Date(),
        state: workflow,
        eventIndex: events.length,
      };
    });

  const executeSequential = (
    workflow: Workflow,
    executeStep: (step: WorkflowStep) => Effect.Effect<unknown, WorkflowStepError>,
  ): Effect.Effect<Workflow, WorkflowError | WorkflowStepError> =>
    Effect.gen(function* () {
      let current: Workflow = { ...workflow, state: "running" as const };
      yield* updateWorkflow(current);

      for (const step of current.steps) {
        yield* appendEvent({
          type: "StepStarted",
          workflowId: workflow.id,
          timestamp: new Date(),
          payload: { stepId: step.id, agentId: step.agentId ?? "default" },
        });

        const result = yield* executeStep(step);

        yield* appendEvent({
          type: "StepCompleted",
          workflowId: workflow.id,
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
        yield* updateWorkflow(current);
      }

      current = { ...current, state: "completed" as const, completedAt: new Date() };
      yield* updateWorkflow(current);

      yield* appendEvent({
        type: "WorkflowCompleted",
        workflowId: workflow.id,
        timestamp: new Date(),
        payload: { result: current.steps.map((s) => s.output) },
      });

      return current;
    });

  const executeParallel = (
    workflow: Workflow,
    executeStep: (step: WorkflowStep) => Effect.Effect<unknown, WorkflowStepError>,
  ): Effect.Effect<Workflow, WorkflowError | WorkflowStepError> =>
    Effect.gen(function* () {
      let current: Workflow = { ...workflow, state: "running" as const };
      yield* updateWorkflow(current);

      const results = yield* Effect.all(
        current.steps.map((step) =>
          Effect.gen(function* () {
            yield* appendEvent({
              type: "StepStarted",
              workflowId: workflow.id,
              timestamp: new Date(),
              payload: { stepId: step.id, agentId: step.agentId ?? "default" },
            });
            const result = yield* executeStep(step);
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

      current = {
        ...current,
        state: "completed" as const,
        completedAt: new Date(),
        steps: current.steps.map((s) => {
          const result = results.find((r) => r.stepId === s.id);
          return result
            ? { ...s, status: "completed" as const, output: result.output, completedAt: new Date() }
            : s;
        }),
      };
      yield* updateWorkflow(current);

      yield* appendEvent({
        type: "WorkflowCompleted",
        workflowId: workflow.id,
        timestamp: new Date(),
        payload: { result: results.map((r) => r.output) },
      });

      return current;
    });

  const executeMapReduce = (
    workflow: Workflow,
    executeStep: (step: WorkflowStep) => Effect.Effect<unknown, WorkflowStepError>,
  ): Effect.Effect<Workflow, WorkflowError | WorkflowStepError> =>
    Effect.gen(function* () {
      const mapSteps = workflow.steps.slice(0, -1);
      const reduceStep = workflow.steps[workflow.steps.length - 1]!;

      // Map phase: parallel
      const mapResults = yield* Effect.all(
        mapSteps.map((step) => executeStep(step)),
        { concurrency: "unbounded" },
      );

      // Reduce phase
      const reduceInput = { ...reduceStep, input: mapResults };
      const finalResult = yield* executeStep(reduceInput);

      const completedWorkflow: Workflow = {
        ...workflow,
        state: "completed" as const,
        completedAt: new Date(),
        updatedAt: new Date(),
        steps: [
          ...mapSteps.map((s, i) => ({
            ...s,
            status: "completed" as const,
            output: mapResults[i],
            completedAt: new Date(),
          })),
          { ...reduceStep, status: "completed" as const, output: finalResult, completedAt: new Date() },
        ],
      };
      yield* updateWorkflow(completedWorkflow);

      return completedWorkflow;
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
  } satisfies WorkflowEngine;
});
