import { describe, expect, it } from "bun:test";
import { evaluateStallDetect } from "../../src/controller/evaluators/stall-detect.js";
import type { ControllerEvalParams } from "../../src/types.js";

const flat = (composite = 0.15) => ({
  composite,
  trajectory: { shape: "flat", derivative: 0, momentum: 0 },
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

// DEFECT 1 (2026-05-31): stall-detect.ts hardcoded `tier = "local"`, so the
// STALL_WINDOW_BY_TIER table (local:2, mid:3, large:4, frontier:5) was dead and
// the window was ALWAYS 2 — firing a premature give-up at iter 2 on every tier.
// These tests pin the tier-gated window so the table is honored.
describe("evaluateStallDetect — tier-gated stall window", () => {
  it("local: 2 flat entries at iter 2 FIRES (window=2)", () => {
    const r = evaluateStallDetect(makeParams({
      tier: "local",
      iteration: 2,
      entropyHistory: [flat(), flat()],
    }));
    expect(r).not.toBeNull();
    expect(r!.decision).toBe("stall-detect");
    expect(r!.stalledIterations).toBe(2);
  });

  it("mid: 2 flat entries at iter 2 does NOT fire (mid window=3, not 2)", () => {
    // RED on the hardcoded-local bug: window was 2 → this fired prematurely.
    const r = evaluateStallDetect(makeParams({
      tier: "mid",
      iteration: 2,
      entropyHistory: [flat(), flat()],
    }));
    expect(r).toBeNull();
  });

  it("mid: only 2 flat entries even at a later iteration does NOT fire (needs 3 in window)", () => {
    const r = evaluateStallDetect(makeParams({
      tier: "mid",
      iteration: 5,
      entropyHistory: [flat(), flat()],
    }));
    expect(r).toBeNull();
  });

  it("mid: 3 flat entries at iter 3 FIRES (window=3)", () => {
    const r = evaluateStallDetect(makeParams({
      tier: "mid",
      iteration: 3,
      entropyHistory: [flat(), flat(), flat()],
    }));
    expect(r).not.toBeNull();
    expect(r!.stalledIterations).toBe(3);
  });

  it("frontier: 4 flat entries at iter 4 does NOT fire (frontier window=5)", () => {
    const r = evaluateStallDetect(makeParams({
      tier: "frontier",
      iteration: 4,
      entropyHistory: [flat(), flat(), flat(), flat()],
    }));
    expect(r).toBeNull();
  });

  it("frontier: 5 flat entries at iter 5 FIRES (window=5)", () => {
    const r = evaluateStallDetect(makeParams({
      tier: "frontier",
      iteration: 5,
      entropyHistory: [flat(), flat(), flat(), flat(), flat()],
    }));
    expect(r).not.toBeNull();
    expect(r!.stalledIterations).toBe(5);
  });

  it("permissive default: omitted tier behaves as local (window=2) — preserves outer-loop callers", () => {
    const r = evaluateStallDetect(makeParams({
      // tier intentionally omitted
      iteration: 2,
      entropyHistory: [flat(), flat()],
    }));
    expect(r).not.toBeNull();
    expect(r!.stalledIterations).toBe(2);
  });

  it("does not fire when a non-flat entry is in the window", () => {
    const r = evaluateStallDetect(makeParams({
      tier: "local",
      iteration: 2,
      entropyHistory: [flat(), flat(0.5)],
    }));
    expect(r).toBeNull();
  });

  it("yields to tool-failure-streak when consecutiveToolFailures >= 2", () => {
    const r = evaluateStallDetect(makeParams({
      tier: "local",
      iteration: 2,
      entropyHistory: [flat(), flat()],
      consecutiveToolFailures: 2,
    }));
    expect(r).toBeNull();
  });
});
