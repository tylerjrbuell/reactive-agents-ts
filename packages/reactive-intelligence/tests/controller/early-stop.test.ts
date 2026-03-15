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
});
