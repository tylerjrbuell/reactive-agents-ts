// Run: bun test packages/benchmarks/tests/gate-significance.test.ts
//
// P0 (wiring audit 2026-07-09). The lift gate's verdict was decided by the
// SAMPLE COUNT, not by the effect.
//
// `gate.ts` computed `noisePp = significanceK * variance * 100`, but the field
// named `variance` on TaskVariantReport actually holds a population STANDARD
// DEVIATION (`runner.ts` stores `Math.sqrt(variance)`; `types.ts` even admits it
// in a doc-comment). A standard deviation is not an uncertainty about a mean:
//
//   • At runs=1 every cell's stddev is exactly 0, and `maxOf` is seeded at 0,
//     so the noise bar was 0pp — ANY nonzero difference read as "significant"
//     and a pure-noise 4pp lift was promoted to `default-on`. Most of this
//     repo's historical ablations ran `--runs 1`.
//   • At runs>1 with Bernoulli (0/1) accuracy cells the stddev sits near 0.5,
//     so the bar was ~50pp while the rule asks for 3pp — no achievable effect
//     could ever pass, and every real improvement was demoted to `opt-in`.
//
// The bar must be a STANDARD ERROR (shrinks with n), and "too few samples to
// conclude" must be a distinct, reachable verdict rather than silently
// masquerading as "no effect".
//
// These tests cross the producer/consumer seam that hid the bug: the old suite
// hand-fed the `variance` field and every `default-on` case passed `variance: 0`,
// so it only ever exercised the broken n=1 regime.

import { describe, expect, it } from "bun:test";
import { aggregateRuns } from "../src/runner.js";
import { evaluateLiftGate, projectTierEvidence } from "../src/gate/gate.js";
import { DEFAULT_LIFT_POLICY } from "../src/gate/types.js";
import type { RunScore, SessionReport, TaskVariantReport } from "../src/types.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const run = (accuracy: number, i: number): RunScore => ({
  runIndex: i,
  dimensions: [{ dimension: "accuracy", score: accuracy, evidence: "" }],
  tokensUsed: 1000,
  durationMs: 10,
  status: "success",
});

/** A cell whose per-run accuracy vector is exactly `scores`. */
const cell = (
  modelVariantId: string,
  variantId: string,
  scores: readonly number[],
  meanTokens = 1000,
): TaskVariantReport => {
  const agg = aggregateRuns(
    "rw-1",
    modelVariantId,
    { type: "internal", id: variantId, label: variantId, config: {} },
    scores.map(run),
  );
  return { ...agg, meanTokens };
};

const report = (rows: readonly TaskVariantReport[]): SessionReport =>
  ({ taskReports: rows }) as SessionReport;

/** Repeat a Bernoulli vector with `ones` successes out of `n`. */
const bernoulli = (ones: number, n: number): number[] =>
  Array.from({ length: n }, (_, i) => (i < ones ? 1 : 0));

const twoTier = (
  baseScores: readonly number[],
  candScores: readonly number[],
  baseTokens = 1000,
  candTokens = 1000,
): SessionReport =>
  report([
    cell("cogito-8b", "base", baseScores, baseTokens),
    cell("cogito-8b", "cand", candScores, candTokens),
    cell("qwen3-4b", "base", baseScores, baseTokens),
    cell("qwen3-4b", "cand", candScores, candTokens),
  ]);

// ─── 1. The producer/consumer seam: the bar must SHRINK with n ────────────────

describe("noise floor is a standard error, not a standard deviation", () => {
  it("the noise bar shrinks as n grows for the same underlying spread", () => {
    // Same p (0.5), more samples. A stddev bar is n-invariant; an SE bar shrinks.
    const small = projectTierEvidence(
      twoTier(bernoulli(2, 4), bernoulli(2, 4)),
      "base",
      "cand",
      DEFAULT_LIFT_POLICY,
    );
    const large = projectTierEvidence(
      twoTier(bernoulli(8, 16), bernoulli(8, 16)),
      "base",
      "cand",
      DEFAULT_LIFT_POLICY,
    );
    expect(small[0]).toBeDefined();
    expect(large[0]).toBeDefined();
    expect(large[0]!.noisePp).toBeLessThan(small[0]!.noisePp);
  });

  it("the bar is strictly positive at n=1 (never collapses to zero)", () => {
    const ev = projectTierEvidence(
      twoTier([1], [1]),
      "base",
      "cand",
      DEFAULT_LIFT_POLICY,
    );
    expect(ev[0]!.noisePp).toBeGreaterThan(0);
  });
});

// ─── 2. n=1 must NOT rubber-stamp noise as default-on ─────────────────────────

describe("n=1 degeneracy — the historical rubber-stamp", () => {
  it("two single-run cells with a small lift are NOT promoted to default-on", () => {
    // Pre-fix: every cell's `variance` is 0 → bar 0pp → significant → default-on.
    const v = evaluateLiftGate(twoTier([0], [1]), "base", "cand", DEFAULT_LIFT_POLICY);
    expect(v.decision).not.toBe("default-on");
  });

  it("n=1 is reported as underpowered, not as 'no effect'", () => {
    const v = evaluateLiftGate(twoTier([0], [1]), "base", "cand", DEFAULT_LIFT_POLICY);
    expect(v.decision).toBe("underpowered");
    expect(v.perTier[0]!.underpowered).toBe(true);
  });
});

// ─── 3. Underpowered is distinguishable from a true null ─────────────────────

describe("underpowered != no effect", () => {
  it("a well-sampled true null is 'opt-in' (we looked, and there is nothing)", () => {
    const v = evaluateLiftGate(
      twoTier(bernoulli(30, 60), bernoulli(30, 60)),
      "base",
      "cand",
      DEFAULT_LIFT_POLICY,
    );
    expect(v.decision).toBe("opt-in");
    expect(v.perTier[0]!.underpowered).toBe(false);
  });

  it("an under-sampled comparison is 'underpowered' (we did not look hard enough)", () => {
    const v = evaluateLiftGate(
      twoTier(bernoulli(1, 2), bernoulli(2, 2)),
      "base",
      "cand",
      DEFAULT_LIFT_POLICY,
    );
    expect(v.decision).toBe("underpowered");
  });

  it("an underpowered tier reports how many runs/arm it would need", () => {
    const ev = projectTierEvidence(
      twoTier(bernoulli(1, 2), bernoulli(2, 2)),
      "base",
      "cand",
      DEFAULT_LIFT_POLICY,
    );
    expect(ev[0]!.runsNeeded).toBeGreaterThan(2);
  });
});

// ─── 4. A real, well-sampled effect IS detectable ─────────────────────────────

describe("a genuine effect at adequate n reaches default-on", () => {
  it("a large, well-sampled lift with acceptable token cost is promoted", () => {
    // 20% -> 90% over 40 runs/arm: far outside any honest noise floor.
    const v = evaluateLiftGate(
      twoTier(bernoulli(8, 40), bernoulli(36, 40), 1000, 1050),
      "base",
      "cand",
      DEFAULT_LIFT_POLICY,
    );
    expect(v.decision).toBe("default-on");
    expect(v.perTier.every((t) => t.significant && !t.underpowered)).toBe(true);
  });

  it("a large, well-sampled REGRESSION is rejected", () => {
    const v = evaluateLiftGate(
      twoTier(bernoulli(36, 40), bernoulli(8, 40)),
      "base",
      "cand",
      DEFAULT_LIFT_POLICY,
    );
    expect(v.decision).toBe("reject");
  });

  it("a real lift swamped by token cost stays opt-in (cost half of the bar still bites)", () => {
    const v = evaluateLiftGate(
      twoTier(bernoulli(8, 40), bernoulli(36, 40), 1000, 5000),
      "base",
      "cand",
      DEFAULT_LIFT_POLICY,
    );
    expect(v.decision).toBe("opt-in");
  });
});

// ─── 5. The producer itself: aggregateRuns must expose n and a real spread ────

describe("aggregateRuns — the producer that mislabeled its own field", () => {
  it("carries the per-run vector so the gate can compute a standard error", () => {
    const c = cell("m", "v", [0, 1, 0, 1]);
    expect(c.runs).toHaveLength(4);
    expect(c.variance).toBeGreaterThan(0);
  });

  it("a single run has no measurable spread (which is why the bar must not use it)", () => {
    const c = cell("m", "v", [1]);
    expect(c.runs).toHaveLength(1);
    expect(c.variance).toBe(0);
  });
});
