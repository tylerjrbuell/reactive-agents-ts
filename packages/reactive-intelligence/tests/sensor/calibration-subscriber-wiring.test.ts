/**
 * calibration-subscriber-wiring.test.ts
 *
 * `subscribeCalibrationUpdates()` (calibration-update-subscriber.ts) was, until
 * this fix, an `Effect.gen` function that nothing in the monorepo ever called.
 * Its own doc comment says "Call this Effect once during layer initialization" —
 * but no caller existed, so the `EventBus.on("EntropyScored", ...)` and
 * `EventBus.on("TaskCompleted", ...)` handlers it registers were NEVER
 * installed, even when `enableReactiveIntelligence` was on and `EntropyScored`
 * events were genuinely being published by `reactive-observer.ts`.
 *
 * This test proves the wiring fix in `createReactiveIntelligenceLayer`
 * (src/runtime.ts) genuinely closes that gap: building the RI layer now
 * actually calls `subscribeCalibrationUpdates()`, which actually registers
 * both handlers on the real `EventBus`. A wrapping `EventBus` layer counts
 * `on(...)` registrations so the test can observe this without depending on
 * the subscriber's private in-memory state.
 *
 * It also asserts that publishing `EntropyScored` then `TaskCompleted` through
 * the now-live handlers does not crash the layer (the handlers run for real).
 *
 * NOTE ON SCOPE: `subscribeCalibrationUpdates()` itself only accumulates
 * per-task composite scores in a private `Map` and discards them on
 * `TaskCompleted` — it does not currently call `EntropySensorService.updateCalibration`
 * or publish `CalibrationDrift` (its doc comment's "recalibration → drift
 * detection → controller response" is aspirational, not yet implemented; the
 * `EntropyScored` event also carries no `modelId`, so per-model calibration
 * cannot be attributed correctly without a schema change). That gap is
 * separate from — and out of scope for — the wiring gap this test targets;
 * this test intentionally does not assert calibration-store mutation or a
 * `CalibrationDrift` emission, since neither occurs in the current
 * implementation even when correctly wired.
 */
import { describe, test, expect } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { EventBus, EventBusLive, EntropySensorService } from "@reactive-agents/core";
import type { ModelCalibrationLike } from "@reactive-agents/core";
import { createReactiveIntelligenceLayer } from "../../src/runtime.js";
import { subscribeCalibrationUpdates } from "../../src/sensor/calibration-update-subscriber.js";

describe("calibration-update-subscriber wiring", () => {
  test("createReactiveIntelligenceLayer registers EntropyScored + TaskCompleted handlers at layer build time", async () => {
    const registeredTags: string[] = [];

    // Wrap the real EventBusLive so `on(...)` registrations are observable —
    // this is the only externally-visible signal that `subscribeCalibrationUpdates()`
    // actually ran, since its accumulated state is private to the closure.
    const observingEventBusLayer = Layer.effect(
      EventBus,
      Effect.gen(function* () {
        const real = yield* EventBus;
        return {
          publish: real.publish,
          subscribe: real.subscribe,
          on: (<T extends Parameters<typeof real.on>[0]>(
            tag: T,
            handler: Parameters<typeof real.on>[1],
          ) => {
            registeredTags.push(tag);
            return real.on(tag, handler);
          }) as typeof real.on,
        };
      }),
    ).pipe(Layer.provide(EventBusLive));

    // Build the RI layer with the observing bus provided — mirrors how
    // `packages/runtime/src/runtime.ts` provides its shared `eventBusLayer`.
    // calibrationDbPath: ":memory:" — CalibrationStore defaults to a REAL
    // disk path (~/.reactive-agents/calibration.db); tests must never touch it.
    const riLayer = createReactiveIntelligenceLayer({ calibrationDbPath: ":memory:" }).pipe(
      Layer.provide(observingEventBusLayer),
    );

    await Effect.runPromise(Effect.void.pipe(Effect.provide(riLayer)));

    // Before the fix, `subscribeCalibrationUpdates()` was never called, so
    // NEITHER of these registrations ever happened — `registeredTags` would
    // be empty and this assertion would fail.
    expect(registeredTags).toContain("EntropyScored");
    expect(registeredTags).toContain("TaskCompleted");
  });

  test("the now-live handlers process EntropyScored → TaskCompleted without crashing the layer", async () => {
    // `Layer.provide` consumes EventBusLive as input and does not re-expose it
    // in the output — merge the SAME `EventBusLive` reference back in (Effect
    // memoizes same-reference layers within one build) so the test can also
    // resolve `EventBus` to publish on the identical shared instance.
    // calibrationDbPath: ":memory:" — CalibrationStore defaults to a REAL
    // disk path (~/.reactive-agents/calibration.db); tests must never touch it.
    const riLayer = Layer.merge(
      EventBusLive,
      createReactiveIntelligenceLayer({ calibrationDbPath: ":memory:" }).pipe(
        Layer.provide(EventBusLive),
      ),
    );

    const program = Effect.gen(function* () {
      const bus = yield* EventBus;

      yield* bus.publish({
        _tag: "EntropyScored",
        taskId: "wiring-test-task",
        iteration: 1,
        composite: 0.42,
        sources: {
          token: 0.4,
          structural: 0.3,
          semantic: null,
          behavioral: 0.5,
          contextPressure: 0.1,
        },
        trajectory: { derivative: 0, shape: "flat", momentum: 0 },
        confidence: "high",
        modelTier: "frontier",
        iterationWeight: 1,
      });

      yield* bus.publish({ _tag: "TaskCompleted", taskId: "wiring-test-task", success: true });

      // No throw = the calibration subscriber's handlers ran to completion for
      // both events on the real bus.
      return true;
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(riLayer)));
    expect(result).toBe(true);
  });
});

/**
 * Calibration feedback loop: TaskCompleted (carrying modelId) triggers
 * updateCalibration() over the task's accumulated EntropyScored scores, and
 * a CalibrationDrift event is published iff the sensor reports drift.
 *
 * These tests exercise `subscribeCalibrationUpdates()` directly against a
 * fake `EntropySensorService` so drift/no-drift outcomes are deterministic —
 * they don't depend on feeding 20+ real samples through the actual conformal
 * calibration math.
 */
describe("calibration-update-subscriber — recalibration + drift emission", () => {
  const makeFakeSensor = (calibration: ModelCalibrationLike) => {
    const calls: { modelId: string; scores: readonly number[] }[] = [];
    const service: Context.Tag.Service<typeof EntropySensorService> = {
      score: () => {
        throw new Error("not used in this test");
      },
      scoreContext: () => {
        throw new Error("not used in this test");
      },
      getCalibration: () => Effect.succeed(calibration),
      updateCalibration: (modelId: string, runScores: readonly number[]) =>
        Effect.sync(() => {
          calls.push({ modelId, scores: runScores });
          return calibration;
        }),
      getTrajectory: () => {
        throw new Error("not used in this test");
      },
    };
    const layer = Layer.succeed(EntropySensorService, service);
    return { layer, calls };
  };

  const scoredEvent = (taskId: string, iteration: number, composite: number, modelId?: string) => ({
    _tag: "EntropyScored" as const,
    taskId,
    iteration,
    composite,
    sources: { token: 0.1, structural: 0.1, semantic: null, behavioral: 0.1, contextPressure: 0.1 },
    trajectory: { derivative: 0, shape: "flat" as const, momentum: 0 },
    confidence: "high" as const,
    modelTier: "frontier" as const,
    iterationWeight: 1,
    ...(modelId ? { modelId } : {}),
  });

  test("TaskCompleted with modelId + accumulated scores invokes updateCalibration", async () => {
    const nonDrifting: ModelCalibrationLike = {
      modelId: "gpt-test",
      calibrated: true,
      sampleCount: 3,
      highEntropyThreshold: 0.8,
      convergenceThreshold: 0.4,
      driftDetected: false,
    };
    const { layer: sensorLayer, calls } = makeFakeSensor(nonDrifting);

    const testLayer = Layer.merge(
      EventBusLive,
      Layer.scopedDiscard(subscribeCalibrationUpdates()).pipe(
        Layer.provide(sensorLayer),
        Layer.provide(EventBusLive),
      ),
    );

    const program = Effect.gen(function* () {
      const bus = yield* EventBus;
      yield* bus.publish(scoredEvent("task-a", 1, 0.3, "gpt-test"));
      yield* bus.publish(scoredEvent("task-a", 2, 0.35, "gpt-test"));
      yield* bus.publish({ _tag: "TaskCompleted", taskId: "task-a", success: true, modelId: "gpt-test" });
    });

    await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

    expect(calls.length).toBe(1);
    expect(calls[0]?.modelId).toBe("gpt-test");
    expect(calls[0]?.scores).toEqual([0.3, 0.35]);
  });

  test("drift-flagged calibration publishes a CalibrationDrift event with correct fields", async () => {
    const drifting: ModelCalibrationLike = {
      modelId: "gpt-drift",
      calibrated: true,
      sampleCount: 20,
      highEntropyThreshold: 0.8,
      convergenceThreshold: 0.4,
      driftDetected: true,
    };
    const { layer: sensorLayer } = makeFakeSensor(drifting);

    const testLayer = Layer.merge(
      EventBusLive,
      Layer.scopedDiscard(subscribeCalibrationUpdates()).pipe(
        Layer.provide(sensorLayer),
        Layer.provide(EventBusLive),
      ),
    );

    // 17 baseline scores around 0.2, then 3 spiking scores around 0.9 —
    // engineered so the last-3 mean is clearly >2 stddev above the overall mean.
    const baseline = Array.from({ length: 17 }, () => 0.2);
    const spike = [0.9, 0.92, 0.95];
    const scores = [...baseline, ...spike];

    const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
    const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length;
    const stddev = Math.sqrt(variance);
    const recent = scores.slice(-5);
    const observedMean = recent.reduce((s, v) => s + v, 0) / recent.length;
    const expectedSigma = (observedMean - mean) / stddev;

    const program = Effect.gen(function* () {
      const bus = yield* EventBus;

      let received: { modelId: string; taskId: string; expectedMean: number; observedMean: number; deviationSigma: number } | undefined;
      yield* bus.on("CalibrationDrift", (event) =>
        Effect.sync(() => {
          received = event;
        }),
      );

      for (let i = 0; i < scores.length; i++) {
        yield* bus.publish(scoredEvent("task-drift", i + 1, scores[i]!, "gpt-drift"));
      }
      yield* bus.publish({ _tag: "TaskCompleted", taskId: "task-drift", success: true, modelId: "gpt-drift" });

      // yield to let the async on() handler registered above process the publish
      yield* Effect.sleep("10 millis");

      return received;
    });

    const received = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

    expect(received).toBeDefined();
    expect(received?.taskId).toBe("task-drift");
    expect(received?.modelId).toBe("gpt-drift");
    expect(received?.expectedMean).toBeCloseTo(mean, 6);
    expect(received?.observedMean).toBeCloseTo(observedMean, 6);
    expect(received?.deviationSigma).toBeCloseTo(expectedSigma, 6);
  });

  test("non-drifting calibration does NOT publish CalibrationDrift", async () => {
    const nonDrifting: ModelCalibrationLike = {
      modelId: "gpt-stable",
      calibrated: true,
      sampleCount: 20,
      highEntropyThreshold: 0.8,
      convergenceThreshold: 0.4,
      driftDetected: false,
    };
    const { layer: sensorLayer } = makeFakeSensor(nonDrifting);

    const testLayer = Layer.merge(
      EventBusLive,
      Layer.scopedDiscard(subscribeCalibrationUpdates()).pipe(
        Layer.provide(sensorLayer),
        Layer.provide(EventBusLive),
      ),
    );

    const program = Effect.gen(function* () {
      const bus = yield* EventBus;

      let driftReceived = false;
      yield* bus.on("CalibrationDrift", () =>
        Effect.sync(() => {
          driftReceived = true;
        }),
      );

      yield* bus.publish(scoredEvent("task-stable", 1, 0.3, "gpt-stable"));
      yield* bus.publish({ _tag: "TaskCompleted", taskId: "task-stable", success: true, modelId: "gpt-stable" });
      yield* Effect.sleep("10 millis");

      return driftReceived;
    });

    const driftReceived = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));
    expect(driftReceived).toBe(false);
  });

  test("TaskCompleted with no modelId (undefined) does not crash and does not call updateCalibration", async () => {
    const calibration: ModelCalibrationLike = {
      modelId: "unused",
      calibrated: false,
      sampleCount: 0,
      highEntropyThreshold: 0.8,
      convergenceThreshold: 0.4,
      driftDetected: false,
    };
    const { layer: sensorLayer, calls } = makeFakeSensor(calibration);

    const testLayer = Layer.merge(
      EventBusLive,
      Layer.scopedDiscard(subscribeCalibrationUpdates()).pipe(
        Layer.provide(sensorLayer),
        Layer.provide(EventBusLive),
      ),
    );

    const program = Effect.gen(function* () {
      const bus = yield* EventBus;
      // No modelId on either the EntropyScored or TaskCompleted event.
      yield* bus.publish(scoredEvent("task-nomodel", 1, 0.3));
      yield* bus.publish({ _tag: "TaskCompleted", taskId: "task-nomodel", success: true });
      return true;
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));
    expect(result).toBe(true);
    expect(calls.length).toBe(0);
  });
});
