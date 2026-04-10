// Run: bun test packages/reasoning/tests/kernel/calibration-wiring.test.ts --timeout 15000
import { Effect } from "effect";
import { describe, it, expect } from "bun:test";
import { runReactiveObserver } from "../../src/strategies/kernel/utils/reactive-observer.js";
import type { KernelState, KernelRunOptions, MaybeService, EventBusInstance } from "../../src/strategies/kernel/kernel-state.js";
import type { StrategyServices } from "../../src/strategies/kernel/utils/service-utils.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeKernelState(overrides: Partial<KernelState> = {}): KernelState {
  return {
    taskId: "test-task-1",
    strategy: "reactive",
    kernelType: "react",
    steps: [
      { type: "thought", content: "Analyzing the task", metadata: {} },
    ],
    toolsUsed: new Set<string>(),
    scratchpad: new Map<string, string>(),
    iteration: 3,
    tokens: 500,
    cost: 0,
    status: "thinking" as const,
    output: null,
    error: null,
    meta: {
      entropy: {
        modelId: "test-model-42",
        entropyHistory: [
          {
            composite: 0.5,
            sources: { token: 0.3, structural: 0.4, semantic: 0.5, behavioral: 0.2, contextPressure: 0.1 },
            trajectory: { derivative: -0.1, shape: "converging", momentum: -0.05 },
            confidence: "medium",
            modelTier: "local",
            iteration: 2,
            iterationWeight: 0.8,
            timestamp: Date.now(),
          },
        ],
      },
    },
    controllerDecisionLog: [],
    ...overrides,
  } as KernelState;
}

function makeRunOptions(): KernelRunOptions {
  return {
    maxIterations: 10,
    strategy: "reactive",
    kernelType: "react",
    modelId: "test-model-42",
  };
}

function noneService<T>(): MaybeService<T> {
  return { _tag: "None" };
}

function someService<T>(value: T): MaybeService<T> {
  return { _tag: "Some", value };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Calibration wiring: reactive-observer → controller", () => {
  it("should pass calibrated thresholds from EntropySensorService to controller", async () => {
    // Track what calibration params the controller receives
    let capturedCalibration: Record<string, unknown> | null = null;

    const mockEntropySensor = {
      score: () => Effect.succeed({
        composite: 0.5,
        sources: { token: 0.3, structural: 0.4, semantic: 0.5, behavioral: 0.2, contextPressure: 0.1 },
        trajectory: { derivative: -0.1, shape: "converging", momentum: -0.05 },
        confidence: "medium" as const,
        modelTier: "local" as const,
        iteration: 3,
        iterationWeight: 0.8,
        timestamp: Date.now(),
      }),
      scoreContext: () => Effect.succeed({
        utilizationPct: 0.5,
        sections: [],
        atRiskSections: [],
        compressionHeadroom: 0.5,
      }),
      getCalibration: (_modelId: string) => Effect.succeed({
        modelId: "test-model-42",
        calibrated: true,
        sampleCount: 25,
        highEntropyThreshold: 0.72,
        convergenceThreshold: 0.35,
      }),
      updateCalibration: (_modelId: string, _runScores: readonly number[]) => Effect.succeed({
        modelId: "test-model-42",
        calibrated: true,
        sampleCount: 26,
        highEntropyThreshold: 0.72,
        convergenceThreshold: 0.35,
      }),
      getTrajectory: (_taskId: string) => Effect.succeed({
        history: [],
        derivative: 0,
        momentum: 0,
        shape: "insufficient-data" as const,
      }),
    };

    const mockController = {
      evaluate: (params: Record<string, unknown>) => {
        capturedCalibration = params.calibration as Record<string, unknown>;
        return Effect.succeed([]);
      },
    };

    const services: StrategyServices = {
      llm: {} as any,
      toolService: noneService(),
      promptService: noneService(),
      eventBus: noneService(),
      entropySensor: someService(mockEntropySensor),
      reactiveController: someService(mockController),
    };

    const state = makeKernelState();
    const options = makeRunOptions();

    await Effect.runPromise(
      runReactiveObserver(state, services, noneService(), 0, options),
    );

    // The controller should have received calibrated thresholds — NOT the hardcoded defaults
    expect(capturedCalibration).not.toBeNull();
    expect(capturedCalibration!.calibrated).toBe(true);
    expect(capturedCalibration!.sampleCount).toBe(25);
    expect(capturedCalibration!.highEntropyThreshold).toBe(0.72);
    expect(capturedCalibration!.convergenceThreshold).toBe(0.35);
  }, 15000);

  it("should fall back to uncalibrated defaults when sensor has no calibration data", async () => {
    let capturedCalibration: Record<string, unknown> | null = null;

    const mockEntropySensor = {
      score: () => Effect.succeed({
        composite: 0.5,
        sources: { token: 0.3, structural: 0.4, semantic: 0.5, behavioral: 0.2, contextPressure: 0.1 },
        trajectory: { derivative: -0.1, shape: "converging", momentum: -0.05 },
        confidence: "medium" as const,
        modelTier: "local" as const,
        iteration: 3,
        iterationWeight: 0.8,
        timestamp: Date.now(),
      }),
      scoreContext: () => Effect.succeed({
        utilizationPct: 0.5,
        sections: [],
        atRiskSections: [],
        compressionHeadroom: 0.5,
      }),
      getCalibration: (_modelId: string) => Effect.succeed({
        modelId: "unknown-model",
        calibrated: false,
        sampleCount: 0,
        highEntropyThreshold: 0.8,
        convergenceThreshold: 0.4,
      }),
      updateCalibration: (_modelId: string, _runScores: readonly number[]) => Effect.succeed({
        modelId: "unknown-model",
        calibrated: false,
        sampleCount: 1,
        highEntropyThreshold: 0.8,
        convergenceThreshold: 0.4,
      }),
      getTrajectory: (_taskId: string) => Effect.succeed({
        history: [],
        derivative: 0,
        momentum: 0,
        shape: "insufficient-data" as const,
      }),
    };

    const mockController = {
      evaluate: (params: Record<string, unknown>) => {
        capturedCalibration = params.calibration as Record<string, unknown>;
        return Effect.succeed([]);
      },
    };

    const services: StrategyServices = {
      llm: {} as any,
      toolService: noneService(),
      promptService: noneService(),
      eventBus: noneService(),
      entropySensor: someService(mockEntropySensor),
      reactiveController: someService(mockController),
    };

    const state = makeKernelState();
    const options = makeRunOptions();

    await Effect.runPromise(
      runReactiveObserver(state, services, noneService(), 0, options),
    );

    // Even uncalibrated should come from the sensor, not hardcoded
    expect(capturedCalibration).not.toBeNull();
    expect(capturedCalibration!.calibrated).toBe(false);
    expect(capturedCalibration!.sampleCount).toBe(0);
  }, 15000);
});

describe("CalibrationDrift event emission", () => {
  it("should emit CalibrationDrift event when sensor reports driftDetected", async () => {
    const publishedEvents: unknown[] = [];

    const mockEntropySensor = {
      score: () => Effect.succeed({
        composite: 0.5,
        sources: { token: 0.3, structural: 0.4, semantic: 0.5, behavioral: 0.2, contextPressure: 0.1 },
        trajectory: { derivative: -0.1, shape: "converging", momentum: -0.05 },
        confidence: "medium" as const,
        modelTier: "local" as const,
        iteration: 3,
        iterationWeight: 0.8,
        timestamp: Date.now(),
      }),
      scoreContext: () => Effect.succeed({
        utilizationPct: 0.5,
        sections: [],
        atRiskSections: [],
        compressionHeadroom: 0.5,
      }),
      getCalibration: (_modelId: string) => Effect.succeed({
        modelId: "test-model-42",
        calibrated: true,
        sampleCount: 30,
        highEntropyThreshold: 0.72,
        convergenceThreshold: 0.35,
        // Signal drift detected
        driftDetected: true,
        expectedMean: 0.45,
        observedMean: 0.72,
        deviationSigma: 2.8,
      }),
      updateCalibration: (_modelId: string, _runScores: readonly number[]) => Effect.succeed({
        modelId: "test-model-42",
        calibrated: true,
        sampleCount: 31,
        highEntropyThreshold: 0.72,
        convergenceThreshold: 0.35,
      }),
      getTrajectory: (_taskId: string) => Effect.succeed({
        history: [],
        derivative: 0,
        momentum: 0,
        shape: "insufficient-data" as const,
      }),
    };

    const mockController = {
      evaluate: () => Effect.succeed([]),
    };

    const mockEventBus: EventBusInstance = {
      publish: (event: unknown) => {
        publishedEvents.push(event);
        return Effect.void;
      },
    };

    const services: StrategyServices = {
      llm: {} as any,
      toolService: noneService(),
      promptService: noneService(),
      eventBus: someService(mockEventBus),
      entropySensor: someService(mockEntropySensor),
      reactiveController: someService(mockController),
    };

    const state = makeKernelState();
    const options = makeRunOptions();

    await Effect.runPromise(
      runReactiveObserver(state, services, someService(mockEventBus), 0, options),
    );

    const driftEvent = publishedEvents.find(
      (e: any) => e._tag === "CalibrationDrift",
    ) as any;
    expect(driftEvent).toBeDefined();
    expect(driftEvent.modelId).toBe("test-model-42");
    expect(driftEvent.taskId).toBe("test-task-1");
  }, 15000);

  it("should NOT emit CalibrationDrift when no drift detected", async () => {
    const publishedEvents: unknown[] = [];

    const mockEntropySensor = {
      score: () => Effect.succeed({
        composite: 0.5,
        sources: { token: 0.3, structural: 0.4, semantic: 0.5, behavioral: 0.2, contextPressure: 0.1 },
        trajectory: { derivative: -0.1, shape: "converging", momentum: -0.05 },
        confidence: "medium" as const,
        modelTier: "local" as const,
        iteration: 3,
        iterationWeight: 0.8,
        timestamp: Date.now(),
      }),
      scoreContext: () => Effect.succeed({
        utilizationPct: 0.5,
        sections: [],
        atRiskSections: [],
        compressionHeadroom: 0.5,
      }),
      getCalibration: (_modelId: string) => Effect.succeed({
        modelId: "test-model-42",
        calibrated: true,
        sampleCount: 30,
        highEntropyThreshold: 0.72,
        convergenceThreshold: 0.35,
        driftDetected: false,
      }),
      updateCalibration: (_modelId: string, _runScores: readonly number[]) => Effect.succeed({
        modelId: "test-model-42",
        calibrated: true,
        sampleCount: 31,
        highEntropyThreshold: 0.72,
        convergenceThreshold: 0.35,
      }),
      getTrajectory: (_taskId: string) => Effect.succeed({
        history: [],
        derivative: 0,
        momentum: 0,
        shape: "insufficient-data" as const,
      }),
    };

    const mockController = {
      evaluate: () => Effect.succeed([]),
    };

    const mockEventBus: EventBusInstance = {
      publish: (event: unknown) => {
        publishedEvents.push(event);
        return Effect.void;
      },
    };

    const services: StrategyServices = {
      llm: {} as any,
      toolService: noneService(),
      promptService: noneService(),
      eventBus: someService(mockEventBus),
      entropySensor: someService(mockEntropySensor),
      reactiveController: someService(mockController),
    };

    const state = makeKernelState();
    const options = makeRunOptions();

    await Effect.runPromise(
      runReactiveObserver(state, services, someService(mockEventBus), 0, options),
    );

    const driftEvent = publishedEvents.find(
      (e: any) => e._tag === "CalibrationDrift",
    );
    expect(driftEvent).toBeUndefined();
  }, 15000);
});
