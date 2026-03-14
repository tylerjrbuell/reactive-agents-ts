import { describe, test, expect } from "bun:test";
import { computeEntropyTrajectory, classifyTrajectoryShape, iterationWeight } from "../../src/sensor/entropy-trajectory.js";

describe("entropy trajectory (1F)", () => {
  test("returns flat trajectory for single data point", () => {
    const result = computeEntropyTrajectory([0.5], 10);
    expect(result.shape).toBe("flat");
    expect(result.derivative).toBe(0);
    expect(result.history).toEqual([0.5]);
  });

  test("detects converging trajectory (falling entropy)", () => {
    const result = computeEntropyTrajectory([0.8, 0.6, 0.4, 0.2], 10);
    expect(result.shape).toBe("converging");
    expect(result.derivative).toBeLessThan(0);
  });

  test("detects diverging trajectory (rising entropy)", () => {
    const result = computeEntropyTrajectory([0.2, 0.4, 0.6, 0.8], 10);
    expect(result.shape).toBe("diverging");
    expect(result.derivative).toBeGreaterThan(0);
  });

  test("detects flat trajectory (constant entropy)", () => {
    const result = computeEntropyTrajectory([0.5, 0.51, 0.49, 0.5], 10);
    expect(result.shape).toBe("flat");
  });

  test("detects v-recovery (drops then rises)", () => {
    const result = computeEntropyTrajectory([0.7, 0.3, 0.2, 0.5, 0.7], 10);
    expect(result.shape).toBe("v-recovery");
  });

  test("detects oscillating trajectory", () => {
    const result = computeEntropyTrajectory([0.8, 0.2, 0.8, 0.2, 0.8, 0.2], 10);
    expect(result.shape).toBe("oscillating");
  });

  test("iteration weight is low early, high late", () => {
    const early = iterationWeight(1, 10);
    const late = iterationWeight(9, 10);
    expect(early).toBeLessThan(0.3);
    expect(late).toBeGreaterThan(0.7);
  });

  test("iteration weight at midpoint is ~0.5", () => {
    const mid = iterationWeight(5, 10);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
  });
});
