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
        if (event.modelId) existing.modelId = event.modelId;
        existing.scores.push(event.composite);
        taskScores.set(event.taskId, existing);
      }),
    );
    yield* Effect.addFinalizer(() => Effect.sync(unsubScored));

    // On task completion, recalibrate against the accumulated scores and
    // publish CalibrationDrift when the sensor detects drift, then clean up.
    const unsubCompleted = yield* eventBus.on("TaskCompleted", (event) =>
      Effect.gen(function* () {
        const task = taskScores.get(event.taskId);
        const modelId = event.modelId;

        if (modelId && task && task.scores.length > 0) {
          const calibration = yield* entropySensor.updateCalibration(modelId, task.scores);

          if (calibration.driftDetected) {
            // Mirror computeCalibration()'s drift formula (conformal.ts:48-58):
            // mean/stddev over the full score array, drift measured against
            // the trailing min(5, max(3, n)) most recent scores.
            const scores = task.scores;
            const n = scores.length;
            const mean = scores.reduce((s, v) => s + v, 0) / n;
            const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
            const stddev = Math.sqrt(variance);
            const recentCount = Math.min(5, Math.max(3, n));
            const recentScores = scores.slice(-recentCount);
            const observedMean = recentScores.reduce((s, v) => s + v, 0) / recentScores.length;
            const deviationSigma = stddev > 0 ? (observedMean - mean) / stddev : 0;

            yield* eventBus.publish({
              _tag: "CalibrationDrift",
              taskId: event.taskId,
              modelId,
              expectedMean: mean,
              observedMean,
              deviationSigma,
            });
          }
        }

        taskScores.delete(event.taskId);
      }),
    );
    yield* Effect.addFinalizer(() => Effect.sync(unsubCompleted));
  });
}
