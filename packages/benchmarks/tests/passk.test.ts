// Run: bun test packages/benchmarks/tests/passk.test.ts
//
// pass^k (tau-bench) — the reliability metric the mean hides.
//
// A cell that solves 4/8 runs and a cell that solves 8/8-then-0/8 across two
// tasks can carry the same mean accuracy while being wildly different products.
// pass^k = C(c,k)/C(n,k) is the probability that k runs drawn WITHOUT
// replacement from the observed n are all solves — the unbiased estimator of
// "ships k times in a row" from the data we actually have.
//
// Honesty edges pinned here:
//   • k > n  → the estimate DOES NOT EXIST (absent), never a fake 0.
//   • c < k  → exactly 0 (you cannot draw k solves from c < k of them).
//   • c = n  → exactly 1.

import { describe, expect, it } from "bun:test";
import {
  passKEstimate,
  passKOf,
  formatPassKSummary,
} from "../src/report-format.js";
import { aggregateRuns, aggregatePassKByVariant } from "../src/runner.js";
import type { RunScore, SessionReport, TaskVariantReport } from "../src/types.js";

// ── fixtures ─────────────────────────────────────────────────────────────────

/** A run with the given accuracy; solved iff accuracy ≥ 1 (status "pass"). */
const run = (accuracy: number, i: number): RunScore => ({
  runIndex: i,
  dimensions: [{ dimension: "accuracy", score: accuracy, evidence: "" }],
  tokensUsed: 1000,
  durationMs: 10,
  status: "pass",
});

const runsOf = (scores: readonly number[]): RunScore[] => scores.map(run);

/** `ones` solved runs out of `n`. */
const bernoulli = (ones: number, n: number): number[] =>
  Array.from({ length: n }, (_, i) => (i < ones ? 1 : 0));

const cell = (
  taskId: string,
  variantId: string,
  scores: readonly number[],
): TaskVariantReport =>
  aggregateRuns(
    taskId,
    "model-a",
    { type: "internal", id: variantId, label: variantId, config: {} },
    runsOf(scores),
  );

// ── 1. the estimator ─────────────────────────────────────────────────────────

describe("passKEstimate — binomial edges", () => {
  it("c=0 → 0 for every k ≤ n", () => {
    expect(passKEstimate(8, 0, 1)).toBe(0);
    expect(passKEstimate(8, 0, 8)).toBe(0);
  });

  it("c=n → 1 for every k ≤ n", () => {
    expect(passKEstimate(8, 8, 1)).toBe(1);
    expect(passKEstimate(8, 8, 8)).toBe(1);
  });

  it("k > n → absent (undefined), never a fake 0", () => {
    expect(passKEstimate(4, 2, 8)).toBeUndefined();
    expect(passKEstimate(7, 7, 8)).toBeUndefined();
  });

  it("c < k → exactly 0 (n=8, c=4, k=8)", () => {
    expect(passKEstimate(8, 4, 8)).toBe(0);
  });

  // Kills the naive (c/n)^k mutant: 0.25 ≠ 6/28.
  it("n=8, c=4, k=2 → C(4,2)/C(8,2) = 6/28 (NOT (c/n)^k = 0.25)", () => {
    expect(passKEstimate(8, 4, 2)).toBeCloseTo(6 / 28, 12);
    expect(passKEstimate(8, 4, 2)).not.toBeCloseTo(0.25, 3);
  });

  it("n=10, c=7, k=4 → C(7,4)/C(10,4) = 35/210 = 1/6", () => {
    expect(passKEstimate(10, 7, 4)).toBeCloseTo(1 / 6, 12);
  });

  it("is monotonically non-increasing in k", () => {
    const ks = [1, 2, 4, 8];
    const estimates = ks.map((k) => passKEstimate(16, 10, k)!);
    for (let i = 1; i < estimates.length; i++) {
      expect(estimates[i]!).toBeLessThanOrEqual(estimates[i - 1]!);
    }
  });
});

describe("passKOf — per-cell projection", () => {
  it("emits k ∈ {1,2,4,8} only where n ≥ k", () => {
    const out = passKOf(runsOf(bernoulli(2, 3)));
    expect(out.map((e) => e.k)).toEqual([1, 2]);
    expect(out[0]!.estimate).toBeCloseTo(2 / 3, 12);
    // C(2,2)/C(3,2) = 1/3
    expect(out[1]!.estimate).toBeCloseTo(1 / 3, 12);
  });

  it("counts only SOLVED runs (status pass AND accuracy ≥ 1)", () => {
    // 0.9 is partial credit, not a solve.
    const out = passKOf(runsOf([1, 0.9, 0.9, 0.9]));
    expect(out.find((e) => e.k === 1)!.estimate).toBeCloseTo(1 / 4, 12);
  });

  it("empty runs → empty projection", () => {
    expect(passKOf([])).toEqual([]);
  });
});

// ── 2. the producer: aggregateRuns carries passK ─────────────────────────────

describe("aggregateRuns — passK population", () => {
  it("n=8, c=4 → k∈{1,2,4,8} with exact hypergeometric values", () => {
    const c = cell("t1", "v", bernoulli(4, 8));
    expect(c.passK).toBeDefined();
    const byK = new Map(c.passK!.map((e) => [e.k, e.estimate]));
    expect(byK.get(1)!).toBeCloseTo(0.5, 12);
    expect(byK.get(2)!).toBeCloseTo(6 / 28, 12);
    expect(byK.get(4)!).toBeCloseTo(1 / 70, 12); // C(4,4)/C(8,4)
    expect(byK.get(8)!).toBe(0); // c < k
  });

  it("n=3 → only k∈{1,2}; k=8 is ABSENT, not 0", () => {
    const c = cell("t1", "v", bernoulli(2, 3));
    expect(c.passK!.map((e) => e.k)).toEqual([1, 2]);
  });

  it("zero runs → no passK field content", () => {
    const c = aggregateRuns(
      "t1",
      "model-a",
      { type: "internal", id: "v", label: "v", config: {} },
      [],
    );
    expect(c.passK ?? []).toEqual([]);
  });
});

// ── 3. session-level aggregation ─────────────────────────────────────────────

describe("aggregatePassKByVariant", () => {
  it("means per variant per k, emitting k only when EVERY cell has n ≥ k", () => {
    const reports = [
      cell("t1", "cand", bernoulli(4, 8)), // ks 1,2,4,8
      cell("t2", "cand", bernoulli(4, 4)), // ks 1,2,4 only (n=4)
    ];
    const out = aggregatePassKByVariant(reports);
    const candRow = out!.find((v) => v.variantId === "cand");
    expect(candRow).toBeDefined();
    const byK = new Map(candRow!.passK.map((e) => [e.k, e.estimate]));
    // k=8 dropped: t2 cannot report it (n=4 < 8) — a mean over a shifting
    // task subset would not be comparable across variants.
    expect(byK.has(8)).toBe(false);
    expect(byK.get(1)!).toBeCloseTo((0.5 + 1) / 2, 12);
    expect(byK.get(2)!).toBeCloseTo((6 / 28 + 1) / 2, 12);
    expect(byK.get(4)!).toBeCloseTo((1 / 70 + 1) / 2, 12);
  });

  it("ignores cells with zero runs instead of zeroing the variant", () => {
    const empty = aggregateRuns(
      "t3",
      "model-a",
      { type: "internal", id: "cand", label: "cand", config: {} },
      [],
    );
    const out = aggregatePassKByVariant([cell("t1", "cand", bernoulli(8, 8)), empty]);
    const candRow = out!.find((v) => v.variantId === "cand");
    expect(new Map(candRow!.passK.map((e) => [e.k, e.estimate])).get(8)!).toBe(1);
  });

  it("returns undefined when nothing is measurable", () => {
    expect(aggregatePassKByVariant([])).toBeUndefined();
  });
});

// ── 4. rendering ─────────────────────────────────────────────────────────────

describe("formatPassKSummary", () => {
  it("renders a per-variant pass^k table", () => {
    const report = {
      taskReports: [],
      passKByVariant: [
        {
          variantId: "ra-full",
          passK: [
            { k: 1, estimate: 0.75 },
            { k: 4, estimate: 0.31 },
          ],
        },
      ],
    } as unknown as SessionReport;
    const out = formatPassKSummary(report);
    expect(out).toBeDefined();
    expect(out!).toContain("pass^k");
    expect(out!).toContain("ra-full");
    expect(out!).toContain("k=1");
    expect(out!).toContain("75");
    expect(out!).toContain("31");
  });

  it("returns undefined when the report carries no pass^k data", () => {
    const report = { taskReports: [] } as unknown as SessionReport;
    expect(formatPassKSummary(report)).toBeUndefined();
  });
});
