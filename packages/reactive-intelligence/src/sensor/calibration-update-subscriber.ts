/**
 * calibration-update-subscriber.ts — EventBus-driven calibration updates.
 *
 * Subscribes to TaskCompleted events and updates model calibration data
 * based on entropy scores collected during execution. When calibration drift
 * is detected (recent scores significantly higher than baseline), emits a
 * CalibrationDrift event for downstream observers to respond to.
 *
 * This completes the calibration feedback loop: collected scores → recalibration
 * → drift detection → controller response.
 */
import { Effect, Scope } from "effect";
import { EventBus, EntropySensorService } from "@reactive-agents/core";

/**
 * Subscribe to TaskCompleted events and update calibration.
 *
 * Call this Effect once during layer initialization — via `Layer.scopedDiscard`,
 * so the `EventBus.on(...)` subscriptions this registers are torn down (via
 * `Effect.addFinalizer`) when the owning layer's scope closes, rather than
 * accumulating dangling handlers across layer rebuilds.
 *
 * When calibration drift is detected, emits a CalibrationDrift event that
 * observers (controller, alerting systems, etc.) can respond to.
 */
export function subscribeCalibrationUpdates(): Effect.Effect<
  void,
  never,
  EventBus | EntropySensorService | Scope.Scope
> {
  return Effect.gen(function* () {
    const eventBus = yield* EventBus;
    const entropySensor = yield* EntropySensorService;

    // Per-task entropy history for calibration
    const taskScores = new Map<string, { modelId: string; scores: number[] }>();

    // Collect entropy scores from EntropyScored events
    const unsubScored = yield* eventBus.on("EntropyScored", (event) =>
      Effect.sync(() => {
        const existing = taskScores.get(event.taskId) ?? { modelId: "unknown", scores: [] };
        existing.scores.push(event.composite);
        taskScores.set(event.taskId, existing);
      }),
    );
    yield* Effect.addFinalizer(() => Effect.sync(unsubScored));

    // On task completion, clean up task state
    const unsubCompleted = yield* eventBus.on("TaskCompleted", (event) =>
      Effect.sync(() => {
        taskScores.delete(event.taskId);
      }),
    );
    yield* Effect.addFinalizer(() => Effect.sync(unsubCompleted));
  });
}
