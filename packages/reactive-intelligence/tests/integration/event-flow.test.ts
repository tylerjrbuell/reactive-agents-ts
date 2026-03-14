import { describe, test, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { EntropySensorService } from "@reactive-agents/core";
import { createReactiveIntelligenceLayer } from "../../src/runtime.js";

describe("entropy service integration", () => {
  test("EntropySensorService composes with other layers", async () => {
    const layer = createReactiveIntelligenceLayer();

    const program = Effect.gen(function* () {
      const sensor = yield* EntropySensorService;

      // Score a thought
      const score = yield* sensor.score({
        thought: "The capital of France is Paris.",
        taskDescription: "Find capitals",
        strategy: "reactive",
        iteration: 1,
        maxIterations: 10,
        modelId: "test",
        temperature: 0.5,
        kernelState: {
          taskId: "integration-test",
          strategy: "reactive",
          kernelType: "react",
          steps: [],
          toolsUsed: new Set(),
          iteration: 1,
          tokens: 0,
          status: "thinking",
          output: null,
          error: null,
          meta: {},
        },
      });

      expect(score.composite).toBeGreaterThanOrEqual(0);
      expect(score.composite).toBeLessThanOrEqual(1);
      expect(score.sources).toBeDefined();
      expect(score.confidence).toBeDefined();

      // Get trajectory
      const trajectory = yield* sensor.getTrajectory("integration-test");
      expect(trajectory.history).toHaveLength(1);

      // Get calibration
      const cal = yield* sensor.getCalibration("test");
      expect(cal.calibrated).toBe(false);

      return score;
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
    expect(result).toBeDefined();
  });

  test("full reactive-intelligence package builds successfully", async () => {
    // Verify all exports are accessible
    const ri = await import("../../src/index.js");

    expect(ri.computeTokenEntropy).toBeDefined();
    expect(ri.computeStructuralEntropy).toBeDefined();
    expect(ri.computeSemanticEntropy).toBeDefined();
    expect(ri.computeBehavioralEntropy).toBeDefined();
    expect(ri.computeContextPressure).toBeDefined();
    expect(ri.computeCompositeEntropy).toBeDefined();
    expect(ri.computeEntropyTrajectory).toBeDefined();
    expect(ri.iterationWeight).toBeDefined();
    expect(ri.lookupModel).toBeDefined();
    expect(ri.computeCalibration).toBeDefined();
    expect(ri.CalibrationStore).toBeDefined();
    expect(ri.EntropySensorServiceLive).toBeDefined();
    expect(ri.createReactiveIntelligenceLayer).toBeDefined();
  });
});
