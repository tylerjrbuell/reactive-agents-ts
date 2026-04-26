// Run: bun test packages/reasoning/tests/kernel/calibration-wiring.test.ts --timeout 15000
import { Effect } from "effect";
import { describe, it, expect } from "bun:test";
import { runReactiveObserver } from "../../src/kernel/capabilities/reflect/reactive-observer.js";
import type { KernelState, KernelRunOptions, MaybeService, EventBusInstance } from "../../src/kernel/state/kernel-state.js";
import type { StrategyServices } from "../../src/kernel/utils/service-utils.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeKernelState(overrides: Partial<KernelState> = {}): KernelState {
  return {
    taskId: "test-task-1",
    strategy: "reactive",
    kernelType: "react",
    messages: [],
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
      dispatcher: noneService(),
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
      dispatcher: noneService(),
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
      dispatcher: noneService(),
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
      dispatcher: noneService(),
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

describe("IC-16: entropy iteration off-by-one (trivial-1step regression)", () => {
  // think.ts pre-increments state.iteration on every exit path (terminal and continuing).
  // When a fast-path or oracle exit returns, state.iteration is already bumped to 1.
  // runReactiveObserver must score entropy with completedIteration = s.iteration - 1 = 0,
  // so that the EntropyScored trace event carries iter=0.
  // traceStats().iterations = Math.max(0, maxIter + 1) = Math.max(0, 0 + 1) = 1 ✓
  // Before the fix, iter=1 was used → traceStats reported 2 iterations on a 1-step run.
  it("entropy sensor receives completedIteration (s.iteration - 1), not post-increment value", async () => {
    let capturedIteration: number | null = null;

    const mockEntropySensor = {
      score: (params: Record<string, unknown>) => {
        capturedIteration = params.iteration as number;
        return Effect.succeed({
          composite: 0.3,
          sources: { token: 0.2, structural: 0.3, semantic: 0.3, behavioral: 0.1, contextPressure: 0.05 },
          trajectory: { derivative: -0.05, shape: "converging", momentum: -0.02 },
          confidence: "high" as const,
          modelTier: "mid" as const,
          iteration: params.iteration as number,
          iterationWeight: 1.0,
          timestamp: Date.now(),
        });
      },
      scoreContext: () => Effect.succeed({
        utilizationPct: 0.1,
        sections: [],
        atRiskSections: [],
        compressionHeadroom: 0.9,
      }),
      getCalibration: (_modelId: string) => Effect.succeed({
        modelId: "test-model",
        calibrated: false,
        sampleCount: 0,
        highEntropyThreshold: 0.8,
        convergenceThreshold: 0.4,
      }),
      updateCalibration: (_modelId: string, _runScores: readonly number[]) => Effect.succeed({
        modelId: "test-model",
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

    const services: StrategyServices = {
      llm: {} as any,
      toolService: noneService(),
      promptService: noneService(),
      eventBus: noneService(),
      entropySensor: someService(mockEntropySensor),
      reactiveController: noneService(),
      dispatcher: noneService(),
    };

    // Simulate the state as returned by think.ts fast-path:
    // - iteration has been pre-incremented from 0 → 1
    // - status is "done" (fast-path terminal exit)
    // - steps contains one thought step (added before fast-path fires)
    const state = makeKernelState({
      iteration: 1, // post-increment from fast-path (was 0 when LLM was called)
      status: "done" as const,
      steps: [
        { type: "thought", content: "Paris is the capital of France.", metadata: {} },
      ],
    });
    const options = makeRunOptions();

    await Effect.runPromise(
      runReactiveObserver(state, services, noneService(), 0, options),
    );

    // The entropy sensor must receive the completed iteration (0), not the
    // post-incremented value (1). Using 1 would make traceStats report 2 iterations.
    expect(capturedIteration).toBe(0);
  }, 15000);

  it("EntropyScored event carries completedIteration when eventBus is present", async () => {
    const publishedEvents: unknown[] = [];

    const mockEntropySensor = {
      score: (_params: Record<string, unknown>) => Effect.succeed({
        composite: 0.3,
        sources: { token: 0.2, structural: 0.3, semantic: 0.3, behavioral: 0.1, contextPressure: 0.05 },
        trajectory: { derivative: -0.05, shape: "converging", momentum: -0.02 },
        confidence: "high" as const,
        modelTier: "mid" as const,
        // No iteration field — forces the ternary in reactive-observer.ts to use
        // the completedIteration fallback, which is what this test validates.
        iterationWeight: 1.0,
        timestamp: Date.now(),
      }),
      scoreContext: () => Effect.succeed({
        utilizationPct: 0.1,
        sections: [],
        atRiskSections: [],
        compressionHeadroom: 0.9,
      }),
      getCalibration: (_modelId: string) => Effect.succeed({
        modelId: "test-model",
        calibrated: false,
        sampleCount: 0,
        highEntropyThreshold: 0.8,
        convergenceThreshold: 0.4,
      }),
      updateCalibration: (_modelId: string, _runScores: readonly number[]) => Effect.succeed({
        modelId: "test-model",
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
      reactiveController: noneService(),
      dispatcher: noneService(),
    };

    // state.iteration=1 simulates post-increment from think.ts fast-path
    const state = makeKernelState({
      iteration: 1,
      status: "done" as const,
      steps: [
        { type: "thought", content: "Paris is the capital of France.", metadata: {} },
      ],
    });

    await Effect.runPromise(
      runReactiveObserver(state, services, someService(mockEventBus), 0, makeRunOptions()),
    );

    const entropyEvent = publishedEvents.find(
      (e: any) => e._tag === "EntropyScored",
    ) as any;
    expect(entropyEvent).toBeDefined();
    // iter must be 0 (the completed iteration), not 1 (the post-incremented value)
    expect(entropyEvent.iteration).toBe(0);
  }, 15000);
});
