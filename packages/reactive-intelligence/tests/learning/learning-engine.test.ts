import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { CalibrationStore } from "../../src/calibration/calibration-store.js";
import { computeCalibration } from "../../src/calibration/conformal.js";
import { BanditStore } from "../../src/learning/bandit-store.js";
import {
  LearningEngineService,
  LearningEngineServiceLive,
} from "../../src/learning/learning-engine.js";
import { classifyTaskCategory } from "../../src/learning/task-classifier.js";

const baseData = {
  modelId: "claude-3.5",
  taskDescription: "write a function to sort an array",
  strategy: "react",
  outcome: "success" as const,
  entropyHistory: [
    { composite: 0.6, trajectory: { shape: "flat" } },
    { composite: 0.4, trajectory: { shape: "converging" } },
    { composite: 0.3, trajectory: { shape: "converging" } },
  ],
  totalTokens: 1500,
  durationMs: 5000,
  temperature: 0.7,
  maxIterations: 10,
};

function runWithService(
  calibrationStore: CalibrationStore,
  banditStore: BanditStore,
  data: any,
) {
  const program = Effect.gen(function* () {
    const svc = yield* LearningEngineService;
    return yield* svc.onRunCompleted(data);
  });
  const layer = LearningEngineServiceLive(calibrationStore, banditStore);
  return Effect.runPromise(Effect.provide(program, layer));
}

describe("LearningEngineService bandit reward reads the run outcome", () => {
  const bucket = `claude-3.5:${classifyTaskCategory(baseData.taskDescription)}`;
  const confident = [
    { composite: 0.1, trajectory: { shape: "converging" } },
    { composite: 0.1, trajectory: { shape: "converging" } },
  ];
  const uncertain = [
    { composite: 0.9, trajectory: { shape: "diverging" } },
    { composite: 0.9, trajectory: { shape: "diverging" } },
  ];

  test("a confident failure is not a win", async () => {
    const banditStore = new BanditStore(":memory:");
    await runWithService(new CalibrationStore(":memory:"), banditStore, {
      ...baseData,
      outcome: "failure",
      entropyHistory: confident,
    });
    const arm = banditStore.load(bucket, "react");
    expect(arm).toEqual({ contextBucket: bucket, armId: "react", alpha: 1, beta: 2, pulls: 1 });
  });

  test("an uncertain success is a win", async () => {
    const banditStore = new BanditStore(":memory:");
    await runWithService(new CalibrationStore(":memory:"), banditStore, {
      ...baseData,
      outcome: "success",
      entropyHistory: uncertain,
    });
    const arm = banditStore.load(bucket, "react");
    expect(arm).toEqual({ contextBucket: bucket, armId: "react", alpha: 2, beta: 1, pulls: 1 });
  });

  test("a partial run is not a win", async () => {
    const banditStore = new BanditStore(":memory:");
    await runWithService(new CalibrationStore(":memory:"), banditStore, {
      ...baseData,
      outcome: "partial",
      entropyHistory: confident,
    });
    expect(banditStore.load(bucket, "react")?.beta).toBe(2);
  });

  test("arms persisted under the old reward keep accumulating", async () => {
    const banditStore = new BanditStore(":memory:");
    banditStore.save({ contextBucket: bucket, armId: "react", alpha: 5, beta: 3, pulls: 6 });
    await runWithService(new CalibrationStore(":memory:"), banditStore, baseData);
    expect(banditStore.load(bucket, "react")).toEqual({
      contextBucket: bucket,
      armId: "react",
      alpha: 6,
      beta: 3,
      pulls: 7,
    });
  });
});

describe("LearningEngineService", () => {
  test("onRunCompleted returns calibrationUpdated=true when entropy data present", async () => {
    const calibrationStore = new CalibrationStore(":memory:");
    const banditStore = new BanditStore(":memory:");

    const result = await runWithService(calibrationStore, banditStore, baseData);

    expect(result.calibrationUpdated).toBe(true);
    expect(result.banditUpdated).toBe(true);

    // Verify calibration was actually stored
    const cal = calibrationStore.load("claude-3.5");
    expect(cal).not.toBeNull();
    expect(cal!.sampleCount).toBe(1);
  });

  test("onRunCompleted classifies task category correctly", async () => {
    const calibrationStore = new CalibrationStore(":memory:");
    const banditStore = new BanditStore(":memory:");

    const result = await runWithService(calibrationStore, banditStore, baseData);
    expect(result.taskCategory).toBe("code-write");

    const result2 = await runWithService(calibrationStore, banditStore, {
      ...baseData,
      taskDescription: "search for the latest AI research papers",
    });
    expect(result2.taskCategory).toBe("deep-research");
  });

  test("onRunCompleted detects skill synthesis opportunity for high-signal runs", async () => {
    const calibrationStore = new CalibrationStore(":memory:");
    const banditStore = new BanditStore(":memory:");

    // Pre-seed calibration with 25 samples so it becomes calibrated (requires 20+)
    const scores = Array.from({ length: 25 }, (_, i) => 0.3 + (i % 5) * 0.05);
    const cal = computeCalibration("claude-3.5", scores);
    calibrationStore.save(cal);

    // Converging + success + low mean entropy → should synthesize
    const result = await runWithService(calibrationStore, banditStore, baseData);
    expect(result.skillSynthesized).toBe(true);

    // Failure outcome → should not synthesize
    const result2 = await runWithService(calibrationStore, banditStore, {
      ...baseData,
      outcome: "failure" as const,
    });
    expect(result2.skillSynthesized).toBe(false);
  });
});
