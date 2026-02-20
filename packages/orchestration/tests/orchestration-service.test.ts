import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { OrchestrationService, OrchestrationServiceLive } from "../src/orchestration-service.js";
import type { WorkflowId, WorkflowStep } from "../src/types.js";
import { WorkflowStepError } from "../src/errors.js";

const runWithService = <A, E>(
  effect: Effect.Effect<A, E, OrchestrationService>,
): Promise<A> =>
  Effect.gen(function* () {
    const svc = yield* OrchestrationServiceLive;
    return yield* effect.pipe(
      Effect.provideService(OrchestrationService, svc),
    );
  }).pipe(Effect.runPromise);

const simpleExecuteStep = (step: WorkflowStep) =>
  Effect.succeed(`result-${step.id}`);

const makeSteps = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `step-${i}`,
    name: `Step ${i}`,
    input: { data: i },
    maxRetries: 3,
  }));

describe("OrchestrationService", () => {
  it("should execute a sequential workflow", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* OrchestrationService;
        return yield* svc.executeWorkflow(
          "test-sequential",
          "sequential",
          makeSteps(3),
          simpleExecuteStep,
        );
      }),
    );

    expect(result.name).toBe("test-sequential");
    expect(result.pattern).toBe("sequential");
    expect(result.state).toBe("completed");
    expect(result.steps).toHaveLength(3);
    expect(result.steps.every((s) => s.status === "completed")).toBe(true);
    expect(result.steps[0]!.output).toBe("result-step-0");
  });

  it("should execute a parallel workflow", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* OrchestrationService;
        return yield* svc.executeWorkflow(
          "test-parallel",
          "parallel",
          makeSteps(4),
          simpleExecuteStep,
        );
      }),
    );

    expect(result.state).toBe("completed");
    expect(result.pattern).toBe("parallel");
    expect(result.steps).toHaveLength(4);
    expect(result.steps.every((s) => s.status === "completed")).toBe(true);
  });

  it("should execute a map-reduce workflow", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* OrchestrationService;
        return yield* svc.executeWorkflow(
          "test-map-reduce",
          "map-reduce",
          makeSteps(3),
          simpleExecuteStep,
        );
      }),
    );

    expect(result.state).toBe("completed");
    expect(result.steps).toHaveLength(3);
  });

  it("should get a workflow after execution", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* OrchestrationService;
        const wf = yield* svc.executeWorkflow(
          "test-get",
          "sequential",
          makeSteps(1),
          simpleExecuteStep,
        );
        return yield* svc.getWorkflow(wf.id);
      }),
    );

    expect(result.name).toBe("test-get");
    expect(result.state).toBe("completed");
  });

  it("should list workflows with optional filter", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* OrchestrationService;
        yield* svc.executeWorkflow("wf-1", "sequential", makeSteps(1), simpleExecuteStep);
        yield* svc.executeWorkflow("wf-2", "parallel", makeSteps(2), simpleExecuteStep);
        return yield* svc.listWorkflows({ state: "completed" });
      }),
    );

    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("should pause and checkpoint a workflow", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* OrchestrationService;
        const wf = yield* svc.executeWorkflow(
          "test-pause",
          "sequential",
          makeSteps(1),
          simpleExecuteStep,
        );
        // Pause the completed workflow (simulating post-completion pause)
        yield* svc.pauseWorkflow(wf.id, "manual pause");
        const paused = yield* svc.getWorkflow(wf.id);
        expect(paused.state).toBe("paused");

        // Create checkpoint
        const cp = yield* svc.checkpoint(wf.id);
        expect(cp.workflowId).toBe(wf.id);
        expect(cp.state.name).toBe("test-pause");
        return cp;
      }),
    );

    expect(result.id).toBeDefined();
  });

  it("should spawn workers", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* OrchestrationService;
        const w1 = yield* svc.spawnWorker("research");
        const w2 = yield* svc.spawnWorker("coding");
        expect(w1.specialty).toBe("research");
        expect(w2.specialty).toBe("coding");
        expect(w1.status).toBe("idle");
        return [w1, w2];
      }),
    );

    expect(result).toHaveLength(2);
  });

  it("should record event log entries", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* OrchestrationService;
        const wf = yield* svc.executeWorkflow(
          "test-events",
          "sequential",
          makeSteps(2),
          simpleExecuteStep,
        );
        return yield* svc.getEventLog(wf.id);
      }),
    );

    // Should have: WorkflowCreated, StepStarted*2, StepCompleted*2, WorkflowCompleted
    expect(result.length).toBeGreaterThanOrEqual(6);
    expect(result[0]!.type).toBe("WorkflowCreated");
    expect(result[result.length - 1]!.type).toBe("WorkflowCompleted");
  });

  it("should fail getWorkflow for unknown ID", async () => {
    const result = await Effect.gen(function* () {
      const svc = yield* OrchestrationServiceLive;
      return yield* svc
        .getWorkflow("nonexistent" as WorkflowId)
        .pipe(
          Effect.flip,
          Effect.provideService(OrchestrationService, svc),
        );
    }).pipe(Effect.runPromise);

    expect(result._tag).toBe("WorkflowError");
  });
});
