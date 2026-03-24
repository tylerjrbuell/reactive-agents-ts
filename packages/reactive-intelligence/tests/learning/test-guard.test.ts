import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { LearningEngineService, LearningEngineServiceLive } from "../../src/learning/learning-engine.js";
import type { RunCompletedData } from "../../src/learning/learning-engine.js";
import type { CalibrationStore } from "../../src/calibration/calibration-store.js";
import type { BanditStore } from "../../src/learning/bandit-store.js";

const mockCalibrationStore: CalibrationStore = {
  load: () => null,
  save: () => {},
};

const mockBanditStore: BanditStore = {
  load: () => null,
  save: () => {},
};

const makeData = (overrides: Partial<RunCompletedData> = {}): RunCompletedData => ({
  modelId: overrides.modelId ?? "claude-sonnet-4",
  provider: overrides.provider,
  taskDescription: "Write a function",
  strategy: "reactive",
  outcome: "success",
  entropyHistory: [{ composite: 0.3, trajectory: { shape: "converging" } }],
  totalTokens: 100,
  durationMs: 1000,
  temperature: 0.7,
  maxIterations: 5,
  ...overrides,
});

describe("LearningEngineService test guard", () => {
  const layer = LearningEngineServiceLive(mockCalibrationStore, mockBanditStore);

  it("onRunCompleted() returns no-op for test provider", async () => {
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const engine = yield* LearningEngineService;
          return yield* engine.onRunCompleted(makeData({ provider: "test" }));
        }),
        layer,
      ),
    );
    expect(result.calibrationUpdated).toBe(false);
    expect(result.banditUpdated).toBe(false);
    expect(result.skillSynthesized).toBe(false);
    expect(result.taskCategory).toBe("test");
  });

  it("onRunCompleted() returns no-op for test modelId", async () => {
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const engine = yield* LearningEngineService;
          return yield* engine.onRunCompleted(makeData({ modelId: "test" }));
        }),
        layer,
      ),
    );
    expect(result.taskCategory).toBe("test");
  });

  it("onRunCompleted() returns no-op for test- prefix modelId", async () => {
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const engine = yield* LearningEngineService;
          return yield* engine.onRunCompleted(makeData({ modelId: "test-scenario-1" }));
        }),
        layer,
      ),
    );
    expect(result.taskCategory).toBe("test");
  });

  it("onRunCompleted() processes normally for real providers", async () => {
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const engine = yield* LearningEngineService;
          return yield* engine.onRunCompleted(makeData({ modelId: "claude-sonnet-4", provider: "anthropic" }));
        }),
        layer,
      ),
    );
    // Real provider should process — taskCategory should not be "test"
    expect(result.taskCategory).not.toBe("test");
  });
});
