import { Effect, Ref } from "effect";
import type { Workflow, WorkflowStep, WorkflowId, DomainEvent, Checkpoint } from "../types.js";
import type { WorkflowStepError, WorkflowError } from "../errors.js";
import { WorkflowStepError as WorkflowStepErrorClass } from "../errors.js";

const DEFAULT_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

type ApprovalCallback = (approved: boolean, reason?: string) => void;

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
  readonly resolveStepApproval: (stepId: string, approved: boolean, reason?: string) => Effect.Effect<boolean, never>;
  readonly workflowsRef: Ref.Ref<Map<string, Workflow>>;
  readonly eventLogRef: Ref.Ref<DomainEvent[]>;
}

export const makeWorkflowEngine = Effect.gen(function* () {
  const workflowsRef = yield* Ref.make<Map<string, Workflow>>(new Map());
  const eventLogRef = yield* Ref.make<DomainEvent[]>([]);
  const pendingApprovals = yield* Ref.make<Map<string, ApprovalCallback>>(new Map());

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

  // ─── Approval gate ───

  const awaitStepApproval = (stepId: string): Effect.Effect<{ approved: boolean; reason?: string }, never> =>
    Effect.async<{ approved: boolean; reason?: string }>((resume) => {
      Effect.runSync(
        Ref.update(pendingApprovals, (m) => {
          const next = new Map(m);
          next.set(stepId, (approved, reason) => resume(Effect.succeed({ approved, reason })));
          return next;
        }),
      );
      // Cleanup on fiber interruption
      return Effect.sync(() => {
        Effect.runSync(
          Ref.update(pendingApprovals, (m) => {
            const next = new Map(m);
            next.delete(stepId);
            return next;
          }),
        );
      });
    }).pipe(
      Effect.timeout(DEFAULT_APPROVAL_TIMEOUT_MS),
      Effect.map((opt) => (opt === undefined ? { approved: false, reason: "Approval timed out" } : opt)),
      Effect.catchAll(() => Effect.succeed({ approved: false, reason: "Approval timed out" })),
    );

  const resolveStepApproval = (stepId: string, approved: boolean, reason?: string): Effect.Effect<boolean, never> =>
    Effect.gen(function* () {
      const approvals = yield* Ref.get(pendingApprovals);
      const callback = approvals.get(stepId);
      if (callback) {
        callback(approved, reason);
        yield* Ref.update(pendingApprovals, (m) => {
          const next = new Map(m);
          next.delete(stepId);
          return next;
        });
        return true;
      }
      return false;
    });

  // ─── Sequential execution with optional approval gates ───

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

        // Approval gate: pause and wait if step requires approval
        if (step.requiresApproval) {
          const { approved, reason } = yield* awaitStepApproval(step.id);
          if (!approved) {
            yield* appendEvent({
              type: "StepFailed",
              workflowId: workflow.id,
              timestamp: new Date(),
              payload: { stepId: step.id, error: reason ?? "Step rejected by approver" },
            });
            return yield* Effect.fail(
              new WorkflowStepErrorClass({
                message: reason ?? "Step rejected by approver",
                stepId: step.id,
                workflowId: workflow.id,
              }),
            );
          }
        }

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
    resolveStepApproval,
    workflowsRef,
    eventLogRef,
  } satisfies WorkflowEngine;
});
