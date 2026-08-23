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
import { Effect, Layer } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import { createReactiveIntelligenceLayer } from "../../src/runtime.js";

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
    const riLayer = createReactiveIntelligenceLayer().pipe(
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
    const riLayer = Layer.merge(
      EventBusLive,
      createReactiveIntelligenceLayer().pipe(Layer.provide(EventBusLive)),
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
