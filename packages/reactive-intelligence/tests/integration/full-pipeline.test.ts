import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import {
  ReactiveControllerService,
  ReactiveControllerServiceLive,
} from "../../src/controller/controller-service.js";
import {
  LearningEngineService,
  LearningEngineServiceLive,
} from "../../src/learning/learning-engine.js";
import type { RunCompletedData } from "../../src/learning/learning-engine.js";
import { CalibrationStore } from "../../src/calibration/calibration-store.js";
import { BanditStore } from "../../src/learning/bandit-store.js";
import type { ControllerEvalParams } from "../../src/types.js";

describe("Reactive Intelligence Pipeline Integration", () => {
  // ─── Controller ───

  describe("Controller", () => {
    const controllerLayer = ReactiveControllerServiceLive({
      earlyStop: true,
      contextCompression: true,
      strategySwitch: true,
    });

    it("should fire early-stop when entropy converges for 2+ iterations", async () => {
      const params: ControllerEvalParams = {
        entropyHistory: [
          { composite: 0.5, trajectory: { shape: "converging", derivative: -0.1, momentum: 0.5 } },
          { composite: 0.35, trajectory: { shape: "converging", derivative: -0.15, momentum: 0.4 } },
          { composite: 0.25, trajectory: { shape: "converging", derivative: -0.1, momentum: 0.3 } },
        ],
        iteration: 5,
        maxIterations: 10,
        strategy: "reactive",
        calibration: { highEntropyThreshold: 0.8, convergenceThreshold: 0.3, calibrated: true, sampleCount: 25 },
        config: { earlyStop: true, contextCompression: false, strategySwitch: false },
        contextPressure: 0.3,
        behavioralLoopScore: 0,
      };

      const program = Effect.gen(function* () {
        const controller = yield* ReactiveControllerService;
        const decisions = yield* controller.evaluate(params);
        expect(decisions.length).toBeGreaterThan(0);
        expect(decisions[0]).toMatchObject({ decision: "early-stop" });
        expect((decisions[0] as any).iterationsSaved).toBe(5); // 10 - 5
      });
      await Effect.runPromise(program.pipe(Effect.provide(controllerLayer)));
    });

    it("should fire strategy-switch when flat for 3+ iterations with high loop score", async () => {
      const params: ControllerEvalParams = {
        entropyHistory: [
          { composite: 0.6, trajectory: { shape: "flat", derivative: 0, momentum: 0.6 } },
          { composite: 0.6, trajectory: { shape: "flat", derivative: 0, momentum: 0.6 } },
          { composite: 0.6, trajectory: { shape: "flat", derivative: 0, momentum: 0.6 } },
        ],
        iteration: 5,
        maxIterations: 10,
        strategy: "reactive",
        calibration: { highEntropyThreshold: 0.8, convergenceThreshold: 0.3, calibrated: true, sampleCount: 25 },
        config: { earlyStop: false, contextCompression: false, strategySwitch: true },
        contextPressure: 0.3,
        behavioralLoopScore: 0.8,
      };

      const program = Effect.gen(function* () {
        const controller = yield* ReactiveControllerService;
        const decisions = yield* controller.evaluate(params);
        expect(decisions.length).toBeGreaterThan(0);
        const switchDecision = decisions.find((d) => d.decision === "switch-strategy");
        expect(switchDecision).toBeDefined();
        expect((switchDecision as any).from).toBe("reactive");
        expect((switchDecision as any).to).toBe("plan-execute-reflect");
      });
      await Effect.runPromise(program.pipe(Effect.provide(controllerLayer)));
    });

    it("should fire compression when context pressure exceeds threshold", async () => {
      const params: ControllerEvalParams = {
        entropyHistory: [{ composite: 0.5, trajectory: { shape: "flat", derivative: 0, momentum: 0.5 } }],
        iteration: 5,
        maxIterations: 10,
        strategy: "reactive",
        calibration: { highEntropyThreshold: 0.8, convergenceThreshold: 0.3, calibrated: true, sampleCount: 25 },
        config: { earlyStop: false, contextCompression: true, strategySwitch: false },
        contextPressure: 0.9,
        behavioralLoopScore: 0,
      };

      const program = Effect.gen(function* () {
        const controller = yield* ReactiveControllerService;
        const decisions = yield* controller.evaluate(params);
        const compress = decisions.find((d) => d.decision === "compress");
        expect(compress).toBeDefined();
        expect((compress as any).sections).toContain("tool-results");
      });
      await Effect.runPromise(program.pipe(Effect.provide(controllerLayer)));
    });

    it("should return no decisions when nothing triggers", async () => {
      const params: ControllerEvalParams = {
        entropyHistory: [{ composite: 0.5, trajectory: { shape: "flat", derivative: 0, momentum: 0.5 } }],
        iteration: 2,
        maxIterations: 10,
        strategy: "reactive",
        calibration: { highEntropyThreshold: 0.8, convergenceThreshold: 0.3, calibrated: true, sampleCount: 25 },
        config: { earlyStop: true, contextCompression: true, strategySwitch: true },
        contextPressure: 0.3,
        behavioralLoopScore: 0.1,
      };

      const program = Effect.gen(function* () {
        const controller = yield* ReactiveControllerService;
        const decisions = yield* controller.evaluate(params);
        expect(decisions).toEqual([]);
      });
      await Effect.runPromise(program.pipe(Effect.provide(controllerLayer)));
    });

    it("should fire multiple decisions when multiple triggers active", async () => {
      const params: ControllerEvalParams = {
        entropyHistory: [
          { composite: 0.25, trajectory: { shape: "converging", derivative: -0.15, momentum: 0.3 } },
          { composite: 0.2, trajectory: { shape: "converging", derivative: -0.1, momentum: 0.25 } },
        ],
        iteration: 5,
        maxIterations: 10,
        strategy: "reactive",
        calibration: { highEntropyThreshold: 0.8, convergenceThreshold: 0.3, calibrated: true, sampleCount: 25 },
        config: { earlyStop: true, contextCompression: true, strategySwitch: false },
        contextPressure: 0.9,
        behavioralLoopScore: 0,
      };

      const program = Effect.gen(function* () {
        const controller = yield* ReactiveControllerService;
        const decisions = yield* controller.evaluate(params);
        expect(decisions.length).toBeGreaterThanOrEqual(2);
        const types = decisions.map((d) => d.decision);
        expect(types).toContain("early-stop");
        expect(types).toContain("compress");
      });
      await Effect.runPromise(program.pipe(Effect.provide(controllerLayer)));
    });
  });

  // ─── Learning Engine ───

  describe("Learning Engine", () => {
    function makeLearningLayer() {
      const calibrationStore = new CalibrationStore(":memory:");
      const banditStore = new BanditStore(":memory:");
      const layer = LearningEngineServiceLive(calibrationStore, banditStore);
      return { calibrationStore, banditStore, layer };
    }

    it("should synthesize skill on converging entropy + successful outcome", async () => {
      const { layer, calibrationStore } = makeLearningLayer();

      // Pre-seed calibration with 20+ samples so computeCalibration returns a real threshold
      // Mean ~0.5, so highEntropyThreshold (90th pctl) will be ~0.8+
      const seedScores = Array.from({ length: 25 }, (_, i) => 0.3 + (i / 25) * 0.5);
      const { computeCalibration } = await import("../../src/calibration/conformal.js");
      const seedCal = computeCalibration("claude-sonnet-4-20250514", seedScores);
      calibrationStore.save(seedCal);

      const data: RunCompletedData = {
        modelId: "claude-sonnet-4-20250514",
        taskDescription: "Write a function to sort an array",
        strategy: "reactive",
        outcome: "success",
        entropyHistory: [
          { composite: 0.6, trajectory: { shape: "diverging" } },
          { composite: 0.4, trajectory: { shape: "converging" } },
          { composite: 0.25, trajectory: { shape: "converging" } },
        ],
        totalTokens: 3000,
        durationMs: 8000,
        temperature: 0.7,
        maxIterations: 10,
      };

      const program = Effect.gen(function* () {
        const engine = yield* LearningEngineService;
        const result = yield* engine.onRunCompleted(data);
        expect(result.calibrationUpdated).toBe(true);
        expect(result.banditUpdated).toBe(true);
        expect(result.skillSynthesized).toBe(true);
        expect(result.taskCategory).toBe("code-generation");
      });
      await Effect.runPromise(program.pipe(Effect.provide(layer)));
    });

    it("should not synthesize skill on failed outcome", async () => {
      const { layer } = makeLearningLayer();

      const data: RunCompletedData = {
        modelId: "claude-sonnet-4-20250514",
        taskDescription: "Search for recent AI news",
        strategy: "reactive",
        outcome: "failure",
        entropyHistory: [
          { composite: 0.7, trajectory: { shape: "diverging" } },
          { composite: 0.8, trajectory: { shape: "diverging" } },
        ],
        totalTokens: 5000,
        durationMs: 15000,
        temperature: 0.7,
        maxIterations: 10,
      };

      const program = Effect.gen(function* () {
        const engine = yield* LearningEngineService;
        const result = yield* engine.onRunCompleted(data);
        expect(result.calibrationUpdated).toBe(true);
        expect(result.banditUpdated).toBe(true);
        expect(result.skillSynthesized).toBe(false);
        expect(result.taskCategory).toBe("research");
      });
      await Effect.runPromise(program.pipe(Effect.provide(layer)));
    });

    it("should classify task and update bandit arm stats", async () => {
      const { layer, banditStore } = makeLearningLayer();

      const data: RunCompletedData = {
        modelId: "gpt-4o",
        taskDescription: "Send an email notification and summarize the data",
        strategy: "plan-execute-reflect",
        outcome: "success",
        entropyHistory: [
          { composite: 0.3, trajectory: { shape: "converging" } },
        ],
        totalTokens: 2000,
        durationMs: 5000,
        temperature: 0.5,
        maxIterations: 8,
      };

      const program = Effect.gen(function* () {
        const engine = yield* LearningEngineService;
        const result = yield* engine.onRunCompleted(data);

        // Task has "send" + "summarize" = multi-tool
        expect(result.taskCategory).toBe("multi-tool");
        expect(result.banditUpdated).toBe(true);

        // Verify bandit store was actually persisted
        const contextBucket = `gpt-4o:multi-tool`;
        const arm = banditStore.load(contextBucket, "plan-execute-reflect");
        expect(arm).not.toBeNull();
        expect(arm!.pulls).toBe(1);
        // mean entropy = 0.3, reward = 0.7 > 0.5 → alpha incremented
        expect(arm!.alpha).toBe(2); // 1 (prior) + 1 (success)
        expect(arm!.beta).toBe(1);  // unchanged
      });
      await Effect.runPromise(program.pipe(Effect.provide(layer)));
    });
  });
});
