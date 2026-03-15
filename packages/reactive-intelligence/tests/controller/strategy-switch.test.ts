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
  config: { earlyStop: false, contextCompression: false, strategySwitch: true },
  contextPressure: 0.3,
  behavioralLoopScore: 0.8,
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

  it("returns null when loop score is below 0.7", () => {
    const params = makeParams({
      entropyHistory: [
        makeEntry(0.5, "flat"),
        makeEntry(0.5, "flat"),
        makeEntry(0.5, "flat"),
      ],
      behavioralLoopScore: 0.5,
    });
    expect(evaluateStrategySwitch(params)).toBeNull();
  });

  it("returns null when loop score is exactly 0.7 (not above)", () => {
    const params = makeParams({
      entropyHistory: [
        makeEntry(0.5, "flat"),
        makeEntry(0.5, "flat"),
        makeEntry(0.5, "flat"),
      ],
      behavioralLoopScore: 0.7,
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
      config: { earlyStop: false, contextCompression: false, strategySwitch: true, flatIterationsBeforeSwitch: 4 },
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
      config: { earlyStop: false, contextCompression: false, strategySwitch: true, flatIterationsBeforeSwitch: 4 },
    });
    const result = evaluateStrategySwitch(params2);
    expect(result).not.toBeNull();
    expect(result!.reason).toContain("flat for 4 iterations");
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
