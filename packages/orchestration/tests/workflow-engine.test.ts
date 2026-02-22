import { describe, it, expect } from "bun:test";
import { Effect, Ref } from "effect";
import { makeWorkflowEngine } from "../src/workflows/workflow-engine.js";
import type { Workflow, WorkflowStep, DomainEvent, Checkpoint } from "../src/types.js";
import { WorkflowStepError } from "../src/errors.js";

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

const makeTestWorkflow = (name: string, steps: WorkflowStep[]): Workflow => ({
  id: `wf-${crypto.randomUUID()}` as any,
  name,
  pattern: "sequential",
  steps,
  state: "pending",
  createdAt: new Date(),
  updatedAt: new Date(),
});

const makeTestStep = (id: string, name: string): WorkflowStep => ({
  id,
  name,
  input: {},
  output: undefined,
  status: "pending",
  startedAt: undefined,
  completedAt: undefined,
  error: undefined,
  retryCount: 0,
  maxRetries: 3,
});

describe("WorkflowEngine", () => {
  it("executes steps in sequential order", async () => {
    const engine = await run(makeWorkflowEngine);
    const executionOrder: string[] = [];

    const executeStep = (step: WorkflowStep) =>
      Effect.gen(function* () {
        executionOrder.push(`start-${step.id}`);
        yield* Effect.sleep("1 millis");
        executionOrder.push(`end-${step.id}`);
        return `result-${step.id}`;
      });

    const steps = [makeTestStep("step-1", "First"), makeTestStep("step-2", "Second")];
    const workflow = makeTestWorkflow("test-sequential", steps);

    const result = await run(engine.executeSequential(workflow, executeStep));

    expect(result.state).toBe("completed");
    expect(executionOrder).toEqual(["start-step-1", "end-step-1", "start-step-2", "end-step-2"]);
  });

  it("executes steps in parallel concurrently", async () => {
    const engine = await run(makeWorkflowEngine);
    const executionOrder: string[] = [];

    const executeStep = (step: WorkflowStep) =>
      Effect.gen(function* () {
        executionOrder.push(`start-${step.id}`);
        yield* Effect.sleep("5 millis");
        executionOrder.push(`end-${step.id}`);
        return `result-${step.id}`;
      });

    const steps = [
      makeTestStep("step-1", "First"),
      makeTestStep("step-2", "Second"),
      makeTestStep("step-3", "Third"),
    ];
    const workflow = makeTestWorkflow("test-parallel", steps);

    const result = await run(engine.executeParallel(workflow, executeStep));

    expect(result.state).toBe("completed");
    expect(result.steps.every((s) => s.status === "completed")).toBe(true);
  });

  it("handles step failure", async () => {
    const engine = await run(makeWorkflowEngine);

    const executeStep = (_step: WorkflowStep) =>
      Effect.fail(
        new WorkflowStepError({
          message: "Step failed",
          stepId: "step-1",
          workflowId: "test",
        }),
      );

    const steps = [makeTestStep("step-1", "Failing Step")];
    const workflow = makeTestWorkflow("test-failure", steps);

    const error = await run(
      engine.executeSequential(workflow, executeStep).pipe(Effect.flip),
    );

    expect(error._tag).toBe("WorkflowStepError");
  });

  it("handles step execution errors", async () => {
    const engine = await run(makeWorkflowEngine);
    let executed = false;

    const executeStep = (_step: WorkflowStep) =>
      Effect.gen(function* () {
        executed = true;
        return yield* Effect.fail(
          new WorkflowStepError({
            message: "Step failed",
            stepId: "step-1",
            workflowId: "test",
          }),
        );
      });

    const steps = [makeTestStep("step-1", "Fail Step")];
    const workflow = makeTestWorkflow("test-error", steps);

    const errorResult = await Effect.runPromise(
      engine.executeSequential(workflow, executeStep).pipe(Effect.flip),
    );

    expect(executed).toBe(true);
    expect(errorResult).toBeDefined();
  });

  it("creates checkpoint with workflow state", async () => {
    const engine = await run(makeWorkflowEngine);

    const executeStep = (step: WorkflowStep) => Effect.succeed(`result-${step.id}`);

    const steps = [makeTestStep("step-1", "First")];
    const workflow = makeTestWorkflow("test-checkpoint", steps);

    await run(engine.executeSequential(workflow, executeStep));
    const workflowRef = await run(Ref.get(engine.workflowsRef));
    const storedWorkflow = workflowRef.get(workflow.id)!;

    const checkpoint = await run(engine.createCheckpoint(storedWorkflow));

    expect(checkpoint.workflowId).toBe(workflow.id);
    expect(checkpoint.state).toBeDefined();
    expect(checkpoint.eventIndex).toBeDefined();
  });

  it("records events during execution", async () => {
    const engine = await run(makeWorkflowEngine);

    const executeStep = (step: WorkflowStep) => Effect.succeed(`result-${step.id}`);

    const steps = [makeTestStep("step-1", "First"), makeTestStep("step-2", "Second")];
    const workflow = makeTestWorkflow("test-events", steps);

    await run(engine.executeSequential(workflow, executeStep));

    const events = await run(Ref.get(engine.eventLogRef));

    expect(events.length).toBeGreaterThanOrEqual(5);
    expect(events[0]?.type).toBe("StepStarted");
    expect(events[1]?.type).toBe("StepCompleted");
  });

  it("updates workflow state during execution", async () => {
    const engine = await run(makeWorkflowEngine);

    const executeStep = (_step: WorkflowStep) => Effect.succeed("done");

    const steps = [makeTestStep("step-1", "First")];
    const workflow = makeTestWorkflow("test-update", steps);

    await run(engine.executeSequential(workflow, executeStep));

    const workflowRef = await run(Ref.get(engine.workflowsRef));
    const stored = workflowRef.get(workflow.id)!;

    expect(stored.state).toBe("completed");
    expect(stored.completedAt).toBeDefined();
  });

  it("executes map-reduce workflow", async () => {
    const engine = await run(makeWorkflowEngine);

    const executeStep = (step: WorkflowStep) =>
      Effect.succeed(step.input && Array.isArray(step.input) ? step.input : [step.id]);

    const steps = [
      makeTestStep("map-1", "Map 1"),
      makeTestStep("map-2", "Map 2"),
      makeTestStep("reduce-1", "Reduce"),
    ];
    const workflow = makeTestWorkflow("test-mapreduce", steps);

    const result = await run(engine.executeMapReduce(workflow, executeStep));

    expect(result.state).toBe("completed");
    expect(result.steps).toHaveLength(3);
  });

  it("appends events correctly", async () => {
    const engine = await run(makeWorkflowEngine);

    const event: DomainEvent = {
      type: "StepStarted",
      workflowId: "test-wf" as any,
      timestamp: new Date(),
      payload: { stepId: "step-1", agentId: "agent-1" },
    };

    await run(engine.appendEvent(event));
    await run(engine.appendEvent(event));

    const events = await run(Ref.get(engine.eventLogRef));
    expect(events).toHaveLength(2);
  });

  it("updates workflow correctly", async () => {
    const engine = await run(makeWorkflowEngine);

    const workflow = makeTestWorkflow("test-update", []);
    await run(engine.updateWorkflow(workflow));

    const workflowRef = await run(Ref.get(engine.workflowsRef));
    const stored = workflowRef.get(workflow.id);

    expect(stored).toBeDefined();
    expect(stored?.name).toBe("test-update");
  });
});
