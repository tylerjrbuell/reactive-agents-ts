import { describe, expect, it } from "bun:test";
import { evaluateCompression } from "../../src/controller/context-compressor.js";
import type { ControllerEvalParams } from "../../src/types.js";

const makeParams = (overrides?: Partial<ControllerEvalParams>): ControllerEvalParams => ({
  entropyHistory: [],
  iteration: 5,
  maxIterations: 10,
  strategy: "reactive",
  calibration: { highEntropyThreshold: 0.8, convergenceThreshold: 0.3, calibrated: true, sampleCount: 25 },
  config: { earlyStop: false, contextCompression: true, strategySwitch: false },
  contextPressure: 0.3,
  behavioralLoopScore: 0,
  ...overrides,
});

describe("evaluateCompression", () => {
  it("returns null when context pressure is below threshold", () => {
    const params = makeParams({ contextPressure: 0.3 });
    expect(evaluateCompression(params)).toBeNull();
  });

  it("returns null when pressure equals threshold exactly", () => {
    const params = makeParams({ contextPressure: 0.8 });
    expect(evaluateCompression(params)).toBeNull();
  });

  it("fires compress when pressure exceeds default threshold (0.80)", () => {
    const params = makeParams({ contextPressure: 0.92 });
    const result = evaluateCompression(params);
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("compress");
    expect(result!.sections).toEqual(["tool-results", "history"]);
    expect(result!.estimatedSavings).toBe(Math.round((0.92 - 0.80) * 1000)); // 120
  });

  it("respects custom threshold from config", () => {
    const params = makeParams({
      contextPressure: 0.65,
      config: { earlyStop: false, contextCompression: true, strategySwitch: false, compressionThreshold: 0.6 },
    });
    const result = evaluateCompression(params);
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("compress");
    expect(result!.estimatedSavings).toBe(Math.round((0.65 - 0.6) * 1000)); // 50

    // Below custom threshold — should return null
    const params2 = makeParams({
      contextPressure: 0.55,
      config: { earlyStop: false, contextCompression: true, strategySwitch: false, compressionThreshold: 0.6 },
    });
    expect(evaluateCompression(params2)).toBeNull();
  });

  it("estimated savings scales with pressure above threshold", () => {
    const low = evaluateCompression(makeParams({ contextPressure: 0.85 }));
    const mid = evaluateCompression(makeParams({ contextPressure: 0.90 }));
    const high = evaluateCompression(makeParams({ contextPressure: 0.98 }));

    expect(low).not.toBeNull();
    expect(mid).not.toBeNull();
    expect(high).not.toBeNull();

    // Savings should increase with pressure
    expect(low!.estimatedSavings).toBe(50);   // (0.85 - 0.80) * 1000
    expect(mid!.estimatedSavings).toBe(100);  // (0.90 - 0.80) * 1000
    expect(high!.estimatedSavings).toBe(180); // (0.98 - 0.80) * 1000

    expect(low!.estimatedSavings).toBeLessThan(mid!.estimatedSavings);
    expect(mid!.estimatedSavings).toBeLessThan(high!.estimatedSavings);
  });
});
