// Run: bun test packages/benchmarks/tests/gate-rationale-noise.test.ts
//
// A result the gate itself calls INSIGNIFICANT must not read like a near-miss.
//
// Observed 2026-07-09 on a real ablation (long-horizon profile, cogito:8b, n=3):
//
//     DECISION: OPT-IN — 1 tier(s) · -10.6pp lift · 46.7% tok — below the promotion bar
//
// A -10.6pp result printed as "OPT-IN … below the promotion bar". "Opt-in" reads
// as a weak endorsement, and "below the bar" reads as "almost". Neither is true:
// the lift was inside the noise band, so the run measured NOTHING. And the same
// comparison, run twice at n=3, flipped sign (+4.5pp, then -10.6pp) — which is
// exactly what a noise-level result looks like.
//
// The decision enum is deliberately unchanged (`opt-in` still means "do not
// promote"). What changes is the RATIONALE: when no tier reaches significance,
// say so, and say that it is not evidence of equivalence.

import { describe, expect, it } from "bun:test";
import { evaluateLiftGate } from "../src/gate/gate.js";
import type { SessionReport, TaskVariantReport } from "../src/types.js";

const cell = (variantId: string, accuracy: number, tokens = 1000, runs = 3): TaskVariantReport =>
  ({
    taskId: "t1",
    modelVariantId: "local",
    variantId,
    variantLabel: variantId,
    runs: Array.from({ length: runs }, (_, i) => ({
      runIndex: i,
      status: "pass",
      tokensUsed: tokens,
      durationMs: 1,
      dimensions: [{ dimension: "accuracy", score: accuracy }],
      output: "",
    })),
    meanScores: [{ dimension: "accuracy", score: accuracy }],
    variance: 0,
    meanTokens: tokens,
    meanDurationMs: 1,
    passRate: 1,
    solveRate: accuracy >= 1 ? 1 : 0,
  }) as unknown as TaskVariantReport;

const report = (base: number, cand: number, candTokens = 1000): SessionReport =>
  ({ taskReports: [cell("base", base), cell("cand", cand, candTokens)] }) as unknown as SessionReport;

describe("gate rationale — an insignificant result says so", () => {
  it("a NEGATIVE, insignificant lift is not described as 'below the promotion bar'", () => {
    const v = evaluateLiftGate(report(0.742, 0.636), "base", "cand"); // the real -10.6pp cell
    expect(v.decision).toBe("opt-in"); // enum unchanged: still "do not promote"
    expect(v.rationale).not.toContain("below the promotion bar");
    expect(v.rationale.toLowerCase()).toContain("noise");
  });

  it("it warns that noise is NOT evidence of equivalence", () => {
    const v = evaluateLiftGate(report(0.742, 0.636), "base", "cand");
    expect(v.rationale.toLowerCase()).toContain("not evidence");
  });

  it("a SIGNIFICANT lift held back only by token cost still reads as a near-miss", () => {
    // 0.0 -> 1.0 is unambiguously significant; the cost cap is what blocks it.
    const v = evaluateLiftGate(report(0.0, 1.0, 5000), "base", "cand");
    expect(v.decision).toBe("opt-in");
    expect(v.rationale).toContain("below the promotion bar");
  });

  it("a promoted result is unaffected", () => {
    const v = evaluateLiftGate(report(0.0, 1.0, 1000), "base", "cand");
    expect(v.rationale).not.toContain("noise");
  });
});
