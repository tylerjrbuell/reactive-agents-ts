import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { ReactiveControllerService, ReactiveControllerServiceLive } from "../../src/controller/controller-service.js";
import type { ControllerEvalParams } from "../../src/types.js";

const defaultParams: ControllerEvalParams = {
  entropyHistory: [
    { composite: 0.5, trajectory: { shape: "flat", derivative: 0, momentum: 0.5 } },
  ],
  iteration: 1,
  maxIterations: 10,
  strategy: "reactive",
  calibration: { highEntropyThreshold: 0.8, convergenceThreshold: 0.3, calibrated: false, sampleCount: 0 },
  config: { earlyStop: true, contextCompression: true, strategySwitch: true },
  contextPressure: 0.3,
  behavioralLoopScore: 0,
};

describe("ReactiveControllerService", () => {
  const layer = ReactiveControllerServiceLive({ earlyStop: true, contextCompression: true, strategySwitch: true });

  it("should return empty decisions when no triggers are met", async () => {
    const program = Effect.gen(function* () {
      const controller = yield* ReactiveControllerService;
      const decisions = yield* controller.evaluate(defaultParams);
      expect(decisions).toEqual([]);
    });
    await Effect.runPromise(program.pipe(Effect.provide(layer)));
  });

  it("should be resolvable as a service", async () => {
    const program = Effect.gen(function* () {
      const controller = yield* ReactiveControllerService;
      expect(controller.evaluate).toBeDefined();
    });
    await Effect.runPromise(program.pipe(Effect.provide(layer)));
  });
});
