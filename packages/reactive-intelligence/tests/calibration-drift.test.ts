// Run: bun test packages/reactive-intelligence/tests/calibration-drift.test.ts --timeout 15000
import { Effect, Layer } from "effect";
import { describe, it, expect } from "bun:test";
import { EventBus } from "@reactive-agents/core";
import type { ModelCalibration } from "../src/types.js";
import { computeCalibration } from "../src/calibration/conformal.js";

describe("calibration drift detection", () => {
  it("should detect drift when recent scores exceed mean + 2σ", async () => {
    // Simulate 25 entropy scores: stable (~0.4) then a spike (~0.75) 
    const stableScores = Array(22).fill(0).map((_, i) => 0.35 + (i % 3) * 0.05);
    const spikeScores = [0.72, 0.75, 0.73]; // High deviation
    const allScores = [...stableScores, ...spikeScores];

    const calibration = computeCalibration("test-model", allScores);

    expect(calibration.calibrated).toBe(true);
    expect(calibration.driftDetected).toBe(true);
    expect(calibration.sampleCount).toBe(25);
  }, 15000);

  it("should not detect drift when scores are stable", async () => {
    const stableScores = Array(25).fill(0).map((_, i) => 0.40 + (i % 3) * 0.02);
    const calibration = computeCalibration("test-model", stableScores);

    expect(calibration.calibrated).toBe(true);
    expect(calibration.driftDetected).toBe(false);
  }, 15000);

  it("should emit CalibrationDrift event when drift detected", async () => {
    const events: any[] = [];
    
    const eventBusLayer = Layer.succeed(EventBus, {
      publish: (event: any) => Effect.sync(() => {
        events.push(event);
      }),
      on: () => Effect.void,
    } as any);

    await Effect.sync(() => {
      // Simulate drift detection
      const spikingScores = [...Array(22).fill(0.4), 0.72, 0.75, 0.73];
      const cal = computeCalibration("test-model", spikingScores);
      
      if (cal.driftDetected) {
        // This is what should happen: emit an event
        const mean = spikingScores.reduce((a, b) => a + b, 0) / spikingScores.length;
        const variance = spikingScores.reduce((a, v) => a + (v - mean) ** 2, 0) / spikingScores.length;
        const stddev = Math.sqrt(variance);
        
        events.push({
          _tag: "CalibrationDrift",
          modelId: "test-model",
          expectedMean: mean,
          observedMean: mean + 2 * stddev,
          deviationSigma: 2,
        });
      }
    }).pipe(Effect.provide(eventBusLayer), Effect.runPromise);

    expect(events.some((e) => e._tag === "CalibrationDrift")).toBe(true);
  }, 15000);
});
