import { describe, expect, it } from "bun:test";
import { evaluateStrategySwitch } from "../../src/controller/strategy-switch.js";
import type { ControllerEvalParams } from "../../src/types.js";

const makeEntry = (composite: number, shape: string) => ({
  composite,
  trajectory: { shape, derivative: 0.0, momentum: 0.0 },
});

const makeParams = (overrides?: Partial<ControllerEvalParams>): ControllerEvalParams => ({
  entropyHistory: [],
  iteration: 5,
  maxIterations: 10,
  strategy: "reactive",
  calibration: { highEntropyThreshold: 0.8, convergenceThreshold: 0.3, calibrated: true, sampleCount: 25 },
  config: { earlyStop: false, strategySwitch: true },
  behavioralLoopScore: 0.8,
  // The kernel is the sole loop-stuck trigger authority (RC-3 fix): the
  // evaluator only escalates a stall the kernel already redirected on. These
  // cases pin the entropy/loop-score conditions, so they corroborate by
  // default; the corroboration gate itself is pinned in
  // tests/strategy-switch-confidence.test.ts.
  kernelLoopSignal: { redirectsIssued: 1 },
  ...overrides,
});

describe("evaluateStrategySwitch", () => {
  it("returns null when trajectory is converging (not flat)", () => {
    const params = makeParams({
      entropyHistory: [
        makeEntry(0.5, "converging"),
        makeEntry(0.4, "converging"),
        makeEntry(0.3, "converging"),
      ],
    });
    expect(evaluateStrategySwitch(params)).toBeNull();
  });

  it("returns null when loop score is below 0.45", () => {
    const params = makeParams({
      entropyHistory: [
        makeEntry(0.5, "flat"),
        makeEntry(0.5, "flat"),
        makeEntry(0.5, "flat"),
      ],
      behavioralLoopScore: 0.3,
    });
    expect(evaluateStrategySwitch(params)).toBeNull();
  });

  it("returns null when loop score is exactly 0.45 (boundary, not above)", () => {
    const params = makeParams({
      entropyHistory: [
        makeEntry(0.5, "flat"),
        makeEntry(0.5, "flat"),
        makeEntry(0.5, "flat"),
      ],
      behavioralLoopScore: 0.45,
    });
    expect(evaluateStrategySwitch(params)).toBeNull();
  });

  it("returns null when fewer than flatCount flat iterations", () => {
    const params = makeParams({
      entropyHistory: [
        makeEntry(0.5, "flat"),
        makeEntry(0.5, "flat"),
      ],
    });
    expect(evaluateStrategySwitch(params)).toBeNull();
  });

  it("fires switch-strategy when flat for 3+ iterations AND loop score > 0.7", () => {
    const params = makeParams({
      entropyHistory: [
        makeEntry(0.6, "diverging"),
        makeEntry(0.5, "flat"),
        makeEntry(0.5, "flat"),
        makeEntry(0.5, "flat"),
      ],
      strategy: "reactive",
      behavioralLoopScore: 0.85,
    });

    const result = evaluateStrategySwitch(params);
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("switch-strategy");
    expect(result!.from).toBe("reactive");
    expect(result!.to).toBe("plan-execute-reflect");
    expect(result!.reason).toContain("flat for 3 iterations");
    expect(result!.reason).toContain("0.85");
  });

  it("uses current strategy in from field and suggests alternative in to field", () => {
    const params = makeParams({
      entropyHistory: [
        makeEntry(0.5, "flat"),
        makeEntry(0.5, "flat"),
        makeEntry(0.5, "flat"),
      ],
      strategy: "plan-execute-reflect",
      behavioralLoopScore: 0.9,
    });

    const result = evaluateStrategySwitch(params);
    expect(result).not.toBeNull();
    expect(result!.from).toBe("plan-execute-reflect");
    expect(result!.to).toBe("reactive");
  });

  it("respects custom flatIterationsBeforeSwitch from config", () => {
    // Only 3 flat entries but config requires 4 — should return null
    const params = makeParams({
      entropyHistory: [
        makeEntry(0.5, "flat"),
        makeEntry(0.5, "flat"),
        makeEntry(0.5, "flat"),
      ],
      config: { earlyStop: false, strategySwitch: true, flatIterationsBeforeSwitch: 4 },
    });
    expect(evaluateStrategySwitch(params)).toBeNull();

    // 4 flat entries with flatIterationsBeforeSwitch 4 — should fire
    const params2 = makeParams({
      entropyHistory: [
        makeEntry(0.5, "flat"),
        makeEntry(0.5, "flat"),
        makeEntry(0.5, "flat"),
        makeEntry(0.5, "flat"),
      ],
      config: { earlyStop: false, strategySwitch: true, flatIterationsBeforeSwitch: 4 },
    });
    const result = evaluateStrategySwitch(params2);
    expect(result).not.toBeNull();
    expect(result!.reason).toContain("flat for 4 iterations");
  });

  // RI census 2026-11-06 (R3): with switching disabled or exhausted the kernel
  // turns a switch request into a switching_exhausted exit (5 of 13 dispatches,
  // e.g. 01M6QANRRJTJ2BGFR7Z4MWAAW6). The evaluator proposes no switch then.
  // RED-ON-CUT: drop the `switchingAvailable === false` guard in
  // strategy-switch.ts → the first case returns a decision.
  describe("switchingAvailable (R3)", () => {
    const stuck = [makeEntry(0.5, "flat"), makeEntry(0.5, "flat"), makeEntry(0.5, "flat")];

    it("no switch decision when the run cannot switch", () => {
      expect(evaluateStrategySwitch(makeParams({ entropyHistory: stuck, switchingAvailable: false }))).toBeNull();
    });

    it("the same evidence switches when switching is available or the signal is omitted", () => {
      expect(evaluateStrategySwitch(makeParams({ entropyHistory: stuck, switchingAvailable: true }))?.decision).toBe("switch-strategy");
      expect(evaluateStrategySwitch(makeParams({ entropyHistory: stuck }))?.decision).toBe("switch-strategy");
    });
  });

  it("returns null when only some recent entries are flat (mixed shapes)", () => {
    const params = makeParams({
      entropyHistory: [
        makeEntry(0.5, "flat"),
        makeEntry(0.5, "diverging"),
        makeEntry(0.5, "flat"),
      ],
    });
    expect(evaluateStrategySwitch(params)).toBeNull();
  });
});
