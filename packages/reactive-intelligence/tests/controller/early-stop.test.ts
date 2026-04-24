import { describe, expect, it } from "bun:test";
import { evaluateEarlyStop } from "../../src/controller/early-stop.js";
import type { ControllerEvalParams } from "../../src/types.js";

const makeEntry = (composite: number, shape: string) => ({
  composite,
  trajectory: { shape, derivative: -0.1, momentum: -0.05 },
});

const makeParams = (overrides?: Partial<ControllerEvalParams>): ControllerEvalParams => ({
  entropyHistory: [],
  iteration: 5,
  maxIterations: 10,
  strategy: "reactive",
  calibration: { highEntropyThreshold: 0.8, convergenceThreshold: 0.3, calibrated: true, sampleCount: 25 },
  config: { earlyStop: true, contextCompression: false, strategySwitch: false },
  contextPressure: 0.3,
  behavioralLoopScore: 0,
  ...overrides,
});

describe("evaluateEarlyStop", () => {
  it("returns null when trajectory is NOT converging (shape is flat)", () => {
    const params = makeParams({
      entropyHistory: [makeEntry(0.2, "flat"), makeEntry(0.2, "flat")],
    });
    expect(evaluateEarlyStop(params)).toBeNull();
  });

  it("returns null when fewer than convergenceCount converging entries", () => {
    const params = makeParams({
      entropyHistory: [makeEntry(0.2, "converging")],
    });
    expect(evaluateEarlyStop(params)).toBeNull();
  });

  it("returns null on iteration < 2 (too early)", () => {
    const params = makeParams({
      iteration: 1,
      entropyHistory: [makeEntry(0.2, "converging"), makeEntry(0.2, "converging")],
    });
    expect(evaluateEarlyStop(params)).toBeNull();
  });

  it("returns null when composite is above convergence threshold", () => {
    const params = makeParams({
      entropyHistory: [makeEntry(0.5, "converging"), makeEntry(0.5, "converging")],
    });
    expect(evaluateEarlyStop(params)).toBeNull();
  });

  it("fires early-stop when converging for convergenceCount iterations AND composite <= threshold", () => {
    const params = makeParams({
      entropyHistory: [
        makeEntry(0.6, "diverging"),
        makeEntry(0.4, "flat"),
        makeEntry(0.25, "converging"),
        makeEntry(0.2, "converging"),
      ],
      iteration: 5,
      maxIterations: 10,
    });

    const result = evaluateEarlyStop(params);
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("early-stop");
    expect(result!.reason).toContain("converging for 2 iterations");
    expect(result!.reason).toContain("composite: 0.200");
    expect(result!.reason).toContain("threshold: 0.3");
    expect(result!.iterationsSaved).toBe(5);
  });

  it("uses custom convergenceCount from config when provided", () => {
    // Only 2 converging entries but convergenceCount is 3 — should return null
    const params = makeParams({
      entropyHistory: [makeEntry(0.2, "converging"), makeEntry(0.2, "converging")],
      config: { earlyStop: true, contextCompression: false, strategySwitch: false, earlyStopConvergenceCount: 3 },
    });
    expect(evaluateEarlyStop(params)).toBeNull();

    // 3 converging entries with convergenceCount 3 — should fire
    const params2 = makeParams({
      entropyHistory: [makeEntry(0.2, "converging"), makeEntry(0.2, "converging"), makeEntry(0.15, "converging")],
      config: { earlyStop: true, contextCompression: false, strategySwitch: false, earlyStopConvergenceCount: 3 },
    });
    const result = evaluateEarlyStop(params2);
    expect(result).not.toBeNull();
    expect(result!.reason).toContain("converging for 3 iterations");
  });

  it("returns null when only some recent entries are converging (mixed)", () => {
    const params = makeParams({
      entropyHistory: [makeEntry(0.2, "converging"), makeEntry(0.2, "flat")],
    });
    expect(evaluateEarlyStop(params)).toBeNull();
  });

  // Overflow guard tests
  it("overflow fires at exactly iteration === maxIterations - iterationsBeforeMax (default: 2)", () => {
    // iteration=8, maxIterations=10 → 8 >= 10 - 2 → fires
    const params = makeParams({
      entropyHistory: [makeEntry(0.6, "flat"), makeEntry(0.6, "flat")],
      iteration: 8,
      maxIterations: 10,
    });
    const result = evaluateEarlyStop(params);
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("early-stop");
    expect(result!.reason).toContain("Approaching maxIterations");
    expect(result!.reason).toContain("iter=8");
    expect(result!.reason).toContain("max=10");
    expect(result!.iterationsSaved).toBe(2);
  });

  it("overflow does NOT fire at iteration === maxIterations - iterationsBeforeMax - 1 (one below boundary)", () => {
    // iteration=7, maxIterations=10 → 7 < 10 - 2 → does NOT fire
    const params = makeParams({
      entropyHistory: [makeEntry(0.6, "flat"), makeEntry(0.6, "flat")],
      iteration: 7,
      maxIterations: 10,
    });
    expect(evaluateEarlyStop(params)).toBeNull();
  });

  it("overflow does NOT fire when maxIterations === 0", () => {
    const params = makeParams({
      entropyHistory: [makeEntry(0.6, "flat"), makeEntry(0.6, "flat")],
      iteration: 5,
      maxIterations: 0,
    });
    expect(evaluateEarlyStop(params)).toBeNull();
  });

  it("respects custom earlyStopIterationsBeforeMax: 3 (fires at maxIterations - 3)", () => {
    // iteration=7, maxIterations=10, iterationsBeforeMax=3 → 7 >= 10 - 3 → fires
    const params = makeParams({
      entropyHistory: [makeEntry(0.6, "flat"), makeEntry(0.6, "flat")],
      iteration: 7,
      maxIterations: 10,
      config: { earlyStop: true, contextCompression: false, strategySwitch: false, earlyStopIterationsBeforeMax: 3 },
    });
    const result = evaluateEarlyStop(params);
    expect(result).not.toBeNull();
    expect(result!.reason).toContain("Approaching maxIterations");
  });

  it("convergence wins over overflow when both conditions are simultaneously true", () => {
    // Both: converging for 2 iterations AND iteration >= maxIterations - 2
    // iteration=8, maxIterations=10 → overflow fires, BUT convergence fires first
    const params = makeParams({
      entropyHistory: [
        makeEntry(0.4, "flat"),
        makeEntry(0.25, "converging"),
        makeEntry(0.2, "converging"),
      ],
      iteration: 8,
      maxIterations: 10,
    });
    const result = evaluateEarlyStop(params);
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("early-stop");
    // Convergence wins: reason should contain "Entropy converging", not "Approaching maxIterations"
    expect(result!.reason).toContain("Entropy converging");
  });
});
