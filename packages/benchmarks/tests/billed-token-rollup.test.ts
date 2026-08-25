import { describe, expect, it } from "bun:test";
import { aggregateRuns } from "../src/runner.js";
import type { HarnessVariant } from "../src/types.js";

// `aggregateRuns` is the function at runner.ts:950 that folds RunScore[] into
// a TaskVariantReport. It was already exported (signature:
// `(taskId, modelVariantId, variant, runs)`, not the single-array form
// sketched in the brief) — this test calls the real signature. It is pure
// and this is the only way to pin the rollup without a live model.

const variant: HarnessVariant = {
  type: "internal",
  id: "ra-full",
  label: "RA Full",
  config: {},
};

describe("billed-token rollup", () => {
  it("means billed tokens and cache reads separately from raw tokens", () => {
    const report = aggregateRuns("task-1", "model-1", variant, [
      {
        runIndex: 0,
        dimensions: [{ dimension: "accuracy", score: 1 }],
        tokensUsed: 10_500,
        billedTokens: 1_500,
        cacheReadTokens: 9_000,
        durationMs: 10,
        status: "pass" as const,
        output: "",
      },
      {
        runIndex: 1,
        dimensions: [{ dimension: "accuracy", score: 1 }],
        tokensUsed: 10_500,
        billedTokens: 2_500,
        cacheReadTokens: 8_000,
        durationMs: 10,
        status: "pass" as const,
        output: "",
      },
    ]);

    expect(report.meanTokens).toBe(10_500);
    expect(report.meanBilledTokens).toBe(2_000);
    expect(report.meanCacheReadTokens).toBe(8_500);
  });

  it("falls back to raw tokens when no run reports a billed figure", () => {
    const report = aggregateRuns("task-2", "model-1", variant, [
      {
        runIndex: 0,
        dimensions: [{ dimension: "accuracy", score: 1 }],
        tokensUsed: 4_000,
        durationMs: 10,
        status: "pass" as const,
        output: "",
      },
    ]);

    // A provider without cache reporting must not read as "0 billed tokens",
    // which would make every such arm trivially pass the cost leg.
    expect(report.meanBilledTokens).toBe(4_000);
    expect(report.meanCacheReadTokens).toBe(0);
  });
});
