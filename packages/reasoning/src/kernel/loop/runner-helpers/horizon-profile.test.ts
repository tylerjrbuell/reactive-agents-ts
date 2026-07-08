/**
 * horizon-profile.test.ts — A2 opt-in long-horizon guard scaling.
 *
 * Proves each scaled constant in BOTH states:
 *   - OFF (no `horizonProfile`)  → resolver returns `undefined` (the
 *     byte-identical signal; every consumer keeps its literal).
 *   - ON  (`horizonProfile: "long"`, maxIterations: 50) → scaled value.
 *
 * maxIterations: 50 is chosen so every scaled constant differs from its
 * default, making the on/off contrast observable per field.
 */
import { describe, expect, it } from "bun:test";
import {
  resolveHorizonProfile,
  windowDecisions,
  HORIZON_VETO_WINDOW,
} from "./horizon-profile.js";

describe("resolveHorizonProfile — OFF by default (byte-identical signal)", () => {
  it("returns undefined when horizonProfile is absent", () => {
    expect(resolveHorizonProfile({ maxIterations: 50 })).toBeUndefined();
  });

  it("returns undefined for horizonProfile: undefined at any maxIterations", () => {
    expect(
      resolveHorizonProfile({ horizonProfile: undefined, maxIterations: 50 }),
    ).toBeUndefined();
    expect(
      resolveHorizonProfile({ horizonProfile: undefined, maxIterations: 8 }),
    ).toBeUndefined();
  });
});

describe("resolveHorizonProfile — ON (horizonProfile: long, maxIterations: 50)", () => {
  const p = resolveHorizonProfile({ horizonProfile: "long", maxIterations: 50 })!;

  it("is defined under the profile", () => {
    expect(p).toBeDefined();
  });

  // stall threshold: 2 → max(2, ceil(0.10 * maxIter)); 50 → 5.
  it("scales stall threshold (default 2) to 5", () => {
    expect(p.stallThreshold).toBe(5);
  });

  // RI stall threshold: 4 → max(4, ceil(0.10 * maxIter)); 50 → 5.
  it("scales RI stall threshold (default 4) to 5", () => {
    expect(p.stallThresholdRI).toBe(5);
  });

  // maxConsecutiveThoughts: 3 → 5 for maxIter >= 30.
  it("scales maxConsecutiveThoughts (default 3) to 5", () => {
    expect(p.maxConsecutiveThoughts).toBe(5);
  });

  // ignoredNudgeTolerance: 2 → max(2, ceil(0.10 * maxIter)); 50 → 5.
  it("scales ignoredNudgeTolerance (default 2) to 5", () => {
    expect(p.ignoredNudgeTolerance).toBe(5);
  });

  // required-tool nudge bonus: +2 → max(2, ceil(0.10 * maxIter)); 50 → 5.
  it("scales required-tool nudge bonus (default +2) to +5", () => {
    expect(p.requiredToolNudgeBonus).toBe(5);
  });

  // redirect budget: 1 → 2 for maxIter >= 30.
  it("scales grounding/coverage redirect budget (default 1) to 2", () => {
    expect(p.redirectBudget).toBe(2);
  });

  // oracle nudge bonus: ceil(0.05 * maxIter); 50 → 3.
  it("scales oracle nudge bonus (default +0) to +3", () => {
    expect(p.oracleNudgeBonus).toBe(3);
  });

  // veto counters windowed to last N=10.
  it("windows veto counters to last 10 decision-log entries", () => {
    expect(p.vetoDecisionWindow).toBe(HORIZON_VETO_WINDOW);
    expect(p.vetoDecisionWindow).toBe(10);
  });
});

describe("resolveHorizonProfile — sub-30 iter engages proportional but not the ≥30 step scalings", () => {
  // At maxIterations: 20, the ≥30-gated constants stay at defaults (3 / 1) but
  // the proportional constants still scale (ceil(0.10 * 20) = 2 → floors hold).
  const p = resolveHorizonProfile({ horizonProfile: "long", maxIterations: 20 })!;

  it("keeps maxConsecutiveThoughts at 3 below the 30-iter threshold", () => {
    expect(p.maxConsecutiveThoughts).toBe(3);
  });

  it("keeps redirect budget at 1 below the 30-iter threshold", () => {
    expect(p.redirectBudget).toBe(1);
  });

  it("floors stall threshold at 2 and RI stall at 4", () => {
    // ceil(0.10 * 20) = 2 → stall floor 2, RI floor 4.
    expect(p.stallThreshold).toBe(2);
    expect(p.stallThresholdRI).toBe(4);
  });
});

describe("windowDecisions", () => {
  const log = Array.from({ length: 15 }, (_, i) => `stall-detect: iter ${i}`);

  it("returns the log unchanged when window is undefined (profile off)", () => {
    expect(windowDecisions(log, undefined)).toBe(log);
  });

  it("returns the log unchanged when window >= length", () => {
    expect(windowDecisions(log, 20)).toBe(log);
  });

  it("returns only the last N entries when window < length", () => {
    const windowed = windowDecisions(log, 10);
    expect(windowed).toHaveLength(10);
    expect(windowed[0]).toBe("stall-detect: iter 5");
    expect(windowed[9]).toBe("stall-detect: iter 14");
  });

  it("treats a non-positive window as no windowing", () => {
    expect(windowDecisions(log, 0)).toBe(log);
  });
});
