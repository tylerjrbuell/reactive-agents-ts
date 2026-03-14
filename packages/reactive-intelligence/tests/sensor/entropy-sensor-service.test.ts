import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { EntropySensorService } from "@reactive-agents/core";
import { createReactiveIntelligenceLayer } from "../../src/runtime.js";

describe("EntropySensorService", () => {
  const testLayer = createReactiveIntelligenceLayer();

  const makeKernelState = (overrides: Record<string, unknown> = {}) => ({
    taskId: "test-1",
    strategy: "reactive",
    kernelType: "react",
    steps: [] as any[],
    toolsUsed: new Set<string>(),
    scratchpad: new Map<string, string>(),
    iteration: 1,
    tokens: 0,
    cost: 0,
    status: "thinking" as const,
    output: null,
    error: null,
    meta: {},
    ...overrides,
  });

  test("score() returns EntropyScore for a basic thought", async () => {
    const program = Effect.gen(function* () {
      const sensor = yield* EntropySensorService;
      return yield* sensor.score({
        thought: "I need to search for the capital of France.",
        taskDescription: "Find the capital of France",
        strategy: "reactive",
        iteration: 1,
        maxIterations: 10,
        modelId: "cogito:14b",
        temperature: 0.3,
        kernelState: makeKernelState(),
      });
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));
    expect(result.composite).toBeGreaterThanOrEqual(0);
    expect(result.composite).toBeLessThanOrEqual(1);
    expect(result.sources.structural).toBeDefined();
    expect(result.sources.behavioral).toBeDefined();
    expect(result.confidence).toBeDefined();
    expect(result.iteration).toBe(1);
  });

  test("score() never fails — catches internal errors", async () => {
    const program = Effect.gen(function* () {
      const sensor = yield* EntropySensorService;
      return yield* sensor.score({
        thought: "",
        taskDescription: "",
        strategy: "",
        iteration: 0,
        maxIterations: 0,
        modelId: "",
        temperature: 0,
        kernelState: makeKernelState({
          taskId: "test-2",
          strategy: "",
          kernelType: "",
          iteration: 0,
        }),
      });
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));
    expect(result).toBeDefined();
    expect(result.composite).toBeGreaterThanOrEqual(0);
  });

  test("getTrajectory() returns trajectory for a given taskId", async () => {
    const program = Effect.gen(function* () {
      const sensor = yield* EntropySensorService;
      const ks = makeKernelState({ taskId: "traj-test" });

      // Score twice to build trajectory
      yield* sensor.score({
        thought: "First thought about the problem",
        taskDescription: "Test task",
        strategy: "reactive",
        iteration: 1,
        maxIterations: 10,
        modelId: "test",
        temperature: 0.5,
        kernelState: ks,
      });

      yield* sensor.score({
        thought: "Second thought with more analysis",
        taskDescription: "Test task",
        strategy: "reactive",
        iteration: 2,
        maxIterations: 10,
        modelId: "test",
        temperature: 0.5,
        kernelState: { ...ks, iteration: 2 },
      });

      return yield* sensor.getTrajectory("traj-test");
    });

    const trajectory = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));
    expect(trajectory.history).toHaveLength(2);
    expect(trajectory.shape).toBeDefined();
  });

  test("getCalibration() returns uncalibrated for new model", async () => {
    const program = Effect.gen(function* () {
      const sensor = yield* EntropySensorService;
      return yield* sensor.getCalibration("brand-new-model");
    });

    const cal = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));
    expect(cal.calibrated).toBe(false);
    expect(cal.sampleCount).toBe(0);
  });
});
