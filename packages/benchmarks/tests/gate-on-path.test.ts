// Run: bun test packages/benchmarks/tests/gate-on-path.test.ts
//
// Wiring audit 2026-07-09: `evaluateLiftGate` had ZERO production callers. It was
// reachable only through `rax eval gate --report <file>`, which needs a report
// that only `--output` persists — so a normal ablation printed point means with
// no uncertainty, and the means got eyeballed into "findings" (twice).
//
// These tests pin the ON-PATH behavior: a session that cannot support a
// comparison must SAY so, and a named baseline→candidate must produce a verdict.

import { describe, expect, it } from "bun:test";
import { gateReceiptFor, minRunsInReport, powerWarningFor, variantIdsIn } from "../src/gate/on-path.js";
import { DEFAULT_LIFT_POLICY } from "../src/gate/types.js";
import type { SessionReport, TaskVariantReport } from "../src/types.js";

const runsOf = (accuracy: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({
    runIndex: i,
    dimensions: [{ dimension: "accuracy", score: i < Math.round(accuracy * n) ? 1 : 0 }],
    tokensUsed: 1000,
    durationMs: 10,
    status: "success" as const,
  }));

const cell = (
  modelVariantId: string,
  variantId: string,
  accuracy: number,
  n: number,
  meanTokens = 1000,
): TaskVariantReport =>
  ({
    taskId: "rw-1",
    modelVariantId,
    variantId,
    variantLabel: variantId,
    runs: runsOf(accuracy, n),
    meanScores: [{ dimension: "accuracy", score: accuracy }],
    variance: 0,
    meanTokens,
    meanDurationMs: 10,
    passRate: accuracy,
  }) as TaskVariantReport;

const report = (rows: readonly TaskVariantReport[]): SessionReport =>
  ({ taskReports: rows }) as SessionReport;

const twoTier = (n: number, baseAcc: number, candAcc: number, candTokens = 1000) =>
  report([
    cell("cogito-8b", "base", baseAcc, n),
    cell("cogito-8b", "cand", candAcc, n, candTokens),
    cell("qwen3-4b", "base", baseAcc, n),
    cell("qwen3-4b", "cand", candAcc, n, candTokens),
  ]);

describe("powerWarningFor — the unconditional check on every multi-variant session", () => {
  it("warns when any cell is below the policy's minimum runs", () => {
    const w = powerWarningFor(twoTier(1, 0.5, 0.54), DEFAULT_LIFT_POLICY);
    expect(w).toBeDefined();
    expect(w).toContain("UNDERPOWERED");
    expect(w).toContain("NOT evidence of an effect");
  });

  it("is silent when the session is adequately sampled", () => {
    expect(powerWarningFor(twoTier(50, 0.5, 0.54), DEFAULT_LIFT_POLICY)).toBeUndefined();
  });

  it("is silent for a single-variant session (nothing to compare)", () => {
    expect(powerWarningFor(report([cell("m", "only", 0.5, 1)]))).toBeUndefined();
  });

  it("reports the true minimum across cells, not the maximum", () => {
    const mixed = report([cell("m", "base", 0.5, 40), cell("m", "cand", 0.5, 2)]);
    expect(minRunsInReport(mixed)).toBe(2);
    expect(powerWarningFor(mixed)).toContain("n=2");
  });
});

describe("gateReceiptFor — a named comparison always yields a verdict", () => {
  it("an under-sampled comparison reports UNDERPOWERED, never a lift claim", () => {
    const receipt = gateReceiptFor(twoTier(1, 0.5, 0.54), "base", "cand");
    expect(receipt.toLowerCase()).toContain("underpowered");
  });

  it("a genuine, well-sampled lift reports DEFAULT-ON", () => {
    const receipt = gateReceiptFor(twoTier(40, 0.2, 0.9, 1050), "base", "cand");
    expect(receipt.toLowerCase()).toContain("default-on");
  });

  it("a genuine, well-sampled regression reports REJECT", () => {
    const receipt = gateReceiptFor(twoTier(40, 0.9, 0.2), "base", "cand");
    expect(receipt.toLowerCase()).toContain("reject");
  });

  it("names the missing variants instead of silently comparing nothing", () => {
    const receipt = gateReceiptFor(twoTier(40, 0.5, 0.6), "base", "nope");
    expect(receipt).toContain("not in this session");
    expect(receipt).toContain("nope");
  });

  it("variantIdsIn enumerates the report's variants", () => {
    expect([...variantIdsIn(twoTier(3, 0.5, 0.5))].sort()).toEqual(["base", "cand"]);
  });
});
