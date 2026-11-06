import { describe, expect, test } from "bun:test";
import { evaluateStrategySwitch } from "../src/controller/strategy-switch.js";
import type { ControllerEvalParams } from "../src/types.js";

const flatEntry = (composite: number) => ({
  composite,
  trajectory: { shape: "flat" as const, derivative: 0, momentum: 0.1 },
});

const makeParams = (overrides?: Partial<ControllerEvalParams>): ControllerEvalParams => ({
  entropyHistory: [flatEntry(0.6), flatEntry(0.61), flatEntry(0.62)],
  iteration: 4,
  maxIterations: 10,
  strategy: "plan-execute-reflect",
  calibration: { highEntropyThreshold: 0.8, convergenceThreshold: 0.3, calibrated: true, sampleCount: 25 },
  config: { earlyStop: false, strategySwitch: true, flatIterationsBeforeSwitch: 3 },
  behavioralLoopScore: 0.69,
  // The kernel is the sole loop-stuck trigger authority (RC-3 fix): the
  // evaluator only escalates a stall the kernel already redirected on, so
  // every case that expects a switch has to supply corroboration.
  kernelLoopSignal: { redirectsIssued: 1 },
  ...overrides,
});

describe("evaluateStrategySwitch confidence", () => {
  test("emits a confidence scaled by how far the loop score exceeds the bar", () => {
    const decision = evaluateStrategySwitch(makeParams({ behavioralLoopScore: 0.69 }));
    expect(decision).not.toBeNull();
    expect(decision!.confidence).toBeGreaterThan(0);
    expect(decision!.confidence).toBeLessThanOrEqual(1);
  });

  test("a barely-over-threshold loop score yields lower confidence than a high one", () => {
    const mk = (loop: number) => evaluateStrategySwitch(makeParams({ behavioralLoopScore: loop }));
    expect(mk(0.46)!.confidence!).toBeLessThan(mk(0.9)!.confidence!);
  });
});

describe("evaluateStrategySwitch kernel corroboration", () => {
  const stuckParams = (kernelRedirects: number | undefined) => ({
    entropyHistory: [flatEntry(0.6), flatEntry(0.61), flatEntry(0.62)],
    config: { flatIterationsBeforeSwitch: 3 },
    strategy: "plan-execute-reflect",
    iteration: 4,
    behavioralLoopScore: 0.69,
    ...(kernelRedirects === undefined ? {} : { kernelLoopSignal: { redirectsIssued: kernelRedirects } }),
  });

  test("does not switch when the kernel has issued no loop redirect", () => {
    expect(evaluateStrategySwitch(stuckParams(0) as never)).toBeNull();
  });

  test("switches once the kernel has already redirected", () => {
    expect(evaluateStrategySwitch(stuckParams(1) as never)).not.toBeNull();
  });

  test("absent kernel signal is treated as no corroboration", () => {
    expect(evaluateStrategySwitch(stuckParams(undefined) as never)).toBeNull();
  });
});
