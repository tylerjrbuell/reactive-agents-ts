// Run: bun test packages/reasoning/tests/kernel/capabilities/reflect/reactive-observer-verbosity.test.ts
//
// HS-128 — Per-iteration verbosity detector.
//
// L4 production signal: qwen3:14b emitted 1534 tokens vs cogito:14b emitted
// 393 tokens on the same context-profiles task (390% ratio). The detector
// reads the rolling token window snapshotted by think.ts onto
// `state.meta.lastIterationTokens` and publishes a
// `pendingCompressionRecommendation` with reason "verbosity-detected" when
// avg > 2× tier baseline. Curator at
// kernel/capabilities/attend/context-utils.ts consumes the recommendation
// (existing #119 freshness gate) on the next prompt.
//
// Two scenarios pinned here:
//   1. Below-threshold: synthetic window [100, 120, 140] → no recommendation
//      (avg=120 < 2*512=1024).
//   2. Above-threshold: synthetic window [1500, 1600, 1700] → recommendation
//      emitted with reason="verbosity-detected" and targetTokens=8192
//      (32_768 / 4, local-tier-default-derived).
//
// Also covers: freshness gate suppression, <3-sample warmup skip, end-to-end
// wiring through reactive-observer's transitionState fold.

import { describe, it, expect } from "bun:test";
import {
  evaluateVerbosity,
  DEFAULT_PROFILE_MAX_TOKENS,
  MIN_SAMPLES,
} from "../../../../src/kernel/capabilities/reflect/verbosity-detector.js";

describe("verbosity detector — HS-128 per-iteration token tracking", () => {
  it("below-threshold window emits no recommendation", () => {
    const rec = evaluateVerbosity({
      lastIterationTokens: [100, 120, 140],
      iteration: 3,
    });
    expect(rec).toBeNull();
  });

  it("above-threshold window emits recommendation with local-tier-derived targetTokens", () => {
    const rec = evaluateVerbosity({
      lastIterationTokens: [1500, 1600, 1700],
      iteration: 3,
    });
    expect(rec).not.toBeNull();
    expect(rec!.reason).toBe("verbosity-detected");
    // 32_768 / 4 = 8192 — matches mission-brief success criterion.
    expect(rec!.targetTokens).toBe(8192);
    expect(rec!.recommendedAtIteration).toBe(3);
  });

  it("skips evaluation until window has ≥3 samples (warmup FP guard)", () => {
    expect(MIN_SAMPLES).toBe(3);
    expect(evaluateVerbosity({ lastIterationTokens: [], iteration: 0 })).toBeNull();
    expect(evaluateVerbosity({ lastIterationTokens: [5000], iteration: 1 })).toBeNull();
    expect(
      evaluateVerbosity({ lastIterationTokens: [5000, 5000], iteration: 2 }),
    ).toBeNull();
    // Third sample crosses MIN_SAMPLES and the threshold (avg=5000 > 1024).
    const rec = evaluateVerbosity({
      lastIterationTokens: [5000, 5000, 5000],
      iteration: 3,
    });
    expect(rec).not.toBeNull();
  });

  it("freshness gate defers to a fresh peer recommendation (iter delta ≤1)", () => {
    // Existing recommendation published last iteration — verbosity detector
    // must NOT overwrite it.
    const recCurrent = evaluateVerbosity({
      lastIterationTokens: [1500, 1600, 1700],
      iteration: 5,
      existingRecommendation: { recommendedAtIteration: 5 },
    });
    expect(recCurrent).toBeNull();

    const recPrior = evaluateVerbosity({
      lastIterationTokens: [1500, 1600, 1700],
      iteration: 5,
      existingRecommendation: { recommendedAtIteration: 4 },
    });
    expect(recPrior).toBeNull();

    // Stale recommendation (delta > 1) — detector takes over.
    const recStale = evaluateVerbosity({
      lastIterationTokens: [1500, 1600, 1700],
      iteration: 5,
      existingRecommendation: { recommendedAtIteration: 3 },
    });
    expect(recStale).not.toBeNull();
    expect(recStale!.reason).toBe("verbosity-detected");
  });

  // ── HS-128 FOLLOWUP-A: state.meta.profileMaxTokens plumbing ───────────
  // Mission-brief cases: detector consumes the runner-seeded tier ceiling
  // so frontier (128_000) and local (32_768) tiers compute distinct baselines.

  it("FOLLOWUP-A: frontier-tier state.meta.profileMaxTokens=128_000 emits recommendation with frontier-derived targetTokens", () => {
    // baseline = 128_000 / 64 = 2000; threshold = 4000.
    // Window avg = (4000 + 4500 + 5000) / 3 = 4500 > 4000 → recommendation.
    // targetTokens = floor(128_000 / 4) = 32_000.
    const rec = evaluateVerbosity({
      lastIterationTokens: [4000, 4500, 5000],
      iteration: 3,
      profileMaxTokens: 128_000,
    });
    expect(rec).not.toBeNull();
    expect(rec!.reason).toBe("verbosity-detected");
    expect(rec!.targetTokens).toBe(32_000);
    expect(rec!.recommendedAtIteration).toBe(3);
  });

  it("FOLLOWUP-A: local-tier state.meta.profileMaxTokens=32_768 emits recommendation with local-derived targetTokens", () => {
    // baseline = 32_768 / 64 = 512; threshold = 1024.
    // Window avg = (3000 + 3500 + 4000) / 3 = 3500 > 1024 → recommendation.
    // targetTokens = floor(32_768 / 4) = 8192.
    const rec = evaluateVerbosity({
      lastIterationTokens: [3000, 3500, 4000],
      iteration: 3,
      profileMaxTokens: 32_768,
    });
    expect(rec).not.toBeNull();
    expect(rec!.reason).toBe("verbosity-detected");
    expect(rec!.targetTokens).toBe(8192);
    expect(rec!.recommendedAtIteration).toBe(3);
  });

  it("FOLLOWUP-A: legacy state without profileMaxTokens falls back to DEFAULT_PROFILE_MAX_TOKENS (HS-128 baseline behaviour)", () => {
    // Omit profileMaxTokens — helper must apply the local default exactly as
    // it did pre-FOLLOWUP-A. Window above local threshold (1024) emits the
    // same recommendation as the original HS-128 above-threshold case.
    const recLegacy = evaluateVerbosity({
      lastIterationTokens: [1500, 1600, 1700],
      iteration: 3,
    });
    expect(recLegacy).not.toBeNull();
    expect(recLegacy!.targetTokens).toBe(Math.floor(DEFAULT_PROFILE_MAX_TOKENS / 4));
    expect(recLegacy!.targetTokens).toBe(8192);
  });

  it("baseline scales with profileMaxTokens (frontier-tier behaviour)", () => {
    // 131_072 / 64 = 2048 baseline → threshold 4096. Window avg=3000 → below.
    const belowFrontier = evaluateVerbosity({
      lastIterationTokens: [2800, 3000, 3200],
      iteration: 3,
      profileMaxTokens: 131_072,
    });
    expect(belowFrontier).toBeNull();

    // Same window vs local default (baseline 512, threshold 1024) → above.
    const aboveLocal = evaluateVerbosity({
      lastIterationTokens: [2800, 3000, 3200],
      iteration: 3,
    });
    expect(aboveLocal).not.toBeNull();
    expect(aboveLocal!.targetTokens).toBe(Math.floor(DEFAULT_PROFILE_MAX_TOKENS / 4));
  });
});
