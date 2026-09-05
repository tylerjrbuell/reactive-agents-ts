import { describe, expect, it } from "bun:test";
import { aggregateRuns, billedTokenFields } from "../src/runner.js";
import type { HarnessVariant, RunScore } from "../src/types.js";

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

describe("billedTokenFields — never a defined-but-wrong 0", () => {
  it("returns the accumulated fields when the LLMRequestCompleted subscriber fired", () => {
    expect(billedTokenFields(true, 1_500, 9_000)).toEqual({
      billedTokens: 1_500,
      cacheReadTokens: 9_000,
    });
  });

  it("omits both fields (not 0) when the subscriber never fired — e.g. a subscribe race or a dropped event", () => {
    // Even though the initializers sat at 0 the whole time, that 0 must never
    // be reported as a genuine observation.
    expect(billedTokenFields(false, 0, 0)).toEqual({});
  });

  it("a RunScore built from an unfired subscriber falls back to raw tokensUsed in aggregateRuns, not to a silently-averaged 0", () => {
    const fields = billedTokenFields(false, 0, 0);
    const runScore: RunScore = {
      runIndex: 0,
      dimensions: [{ dimension: "accuracy", score: 1 }],
      tokensUsed: 6_000,
      durationMs: 10,
      status: "pass" as const,
      output: "",
      ...fields,
    };
    // Prove the fields are genuinely absent on the object, not present-as-0 —
    // `in` distinguishes "key missing" from "key: undefined".
    expect("billedTokens" in runScore).toBe(false);
    expect("cacheReadTokens" in runScore).toBe(false);

    const variant: HarnessVariant = { type: "internal", id: "ra-full", label: "RA Full", config: {} };
    const report = aggregateRuns("task-3", "model-1", variant, [runScore]);
    expect(report.meanBilledTokens).toBe(6_000);
    expect(report.meanCacheReadTokens).toBe(0);
  });
});
