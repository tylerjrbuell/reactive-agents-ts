import { describe, test, expect } from "bun:test";
import { computeConformalThreshold, computeCalibration } from "../../src/calibration/conformal.js";

describe("conformal calibration", () => {
  test("returns uncalibrated when fewer than 20 runs", () => {
    const cal = computeCalibration("test-model", [0.3, 0.4, 0.5]);
    expect(cal.calibrated).toBe(false);
    expect(cal.sampleCount).toBe(3);
  });

  test("calibrates after 20 runs with α=0.10", () => {
    // 20 scores from 0.1 to 0.9
    const scores = Array.from({ length: 20 }, (_, i) => 0.1 + (i * 0.04));
    const cal = computeCalibration("test-model", scores);
    expect(cal.calibrated).toBe(true);
    expect(cal.sampleCount).toBe(20);
    // highEntropyThreshold should be near the 19th/20th percentile
    expect(cal.highEntropyThreshold).toBeGreaterThan(0.7);
    expect(cal.highEntropyThreshold).toBeLessThan(1.0);
  });

  test("convergence threshold uses α=0.30 (looser)", () => {
    const scores = Array.from({ length: 20 }, (_, i) => 0.1 + (i * 0.04));
    const cal = computeCalibration("test-model", scores);
    expect(cal.convergenceThreshold).toBeLessThan(cal.highEntropyThreshold);
  });

  test("detects drift when recent scores deviate significantly", () => {
    const baseScores = Array.from({ length: 20 }, () => 0.3);
    const cal = computeCalibration("test-model", baseScores);
    expect(cal.driftDetected).toBe(false);

    // Now add extreme scores
    const driftScores = [...baseScores, 0.9, 0.95, 0.85];
    const cal2 = computeCalibration("test-model", driftScores);
    expect(cal2.driftDetected).toBe(true);
  });

  test("quantile function returns correct percentile", () => {
    const sorted = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    const q90 = computeConformalThreshold(sorted, 0.10);
    expect(q90).toBeGreaterThanOrEqual(0.9);
  });
});
