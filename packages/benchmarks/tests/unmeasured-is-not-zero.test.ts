// Run: bun test packages/benchmarks/tests/unmeasured-is-not-zero.test.ts
//
// A score that was NOT MEASURED must never be reported as a measured 0
// (2026-07-26).
//
// The `scoreState: "inconclusive"` lane exists and the judge emits it correctly
// — `judge.ts` stamps `judge-outage` / `judge-error` / `stub-judge` on every
// dimension it could not score, and `report-format.ts` carries helpers to read
// it. But NOTHING between the judge and the persisted report consumed any of
// that:
//
//   - `aggregateRuns` never set `TaskVariantReport.inconclusive` (the field was
//     typed `PreFlightViolation`, so only the PREFLIGHT lane could ever reach
//     it) — so `inconclusiveCells` was ALWAYS `[]` and `partialMeasurement`
//     ALWAYS `false`, no matter how much went unmeasured.
//   - both `aggregateRuns` and `summarizeDimensions` read a dimension with
//     `?.score ?? 0`, so an unmeasured dimension was averaged in as a real zero.
//
// Observed live 2026-07-26: with the judge server down, a full real-world sweep
// reported `reasoning 0%`, `tool-mastery 0%`, `scope-discipline 0%` — none of
// which were measurements — under a top-level `partialMeasurement: false`. The
// SAME cell (rw-9, same model, same variant) read `0% ✗` with the judge down and
// `100% ✓` with it up. Every bench-derived verdict is read off these reports.
//
// RED-ON-CUT: restore `?? 0` in either aggregation site, or drop the
// `inconclusive` assignment in aggregateRuns, and the matching case below fails.
import { describe, expect, it } from "bun:test";
import { aggregateRuns, summarizeDimensions } from "../src/runner.js";
import type { HarnessVariant, RunScore } from "../src/types.js";

const VARIANT: HarnessVariant = { type: "internal", id: "ra-full", label: "RA Full", config: {} };

function run(
  dims: ReadonlyArray<{ dimension: string; score: number; inconclusive?: boolean }>,
): RunScore {
  return {
    runIndex: 0,
    dimensions: dims.map((d) => ({
      dimension: d.dimension,
      score: d.score,
      ...(d.inconclusive
        ? { scoreState: "inconclusive" as const, inconclusiveReason: "judge-outage" as const, judgeScored: true }
        : {}),
    })),
    tokensUsed: 100,
    durationMs: 1000,
    status: "pass",
    output: "",
  } as RunScore;
}

describe("an unmeasured dimension is excluded, not averaged as 0", () => {
  it("CONTROL: a MEASURED 0 still counts", () => {
    const r = aggregateRuns("t1", "m", VARIANT, [
      run([{ dimension: "accuracy", score: 1 }, { dimension: "reasoning", score: 0 }]),
    ]);
    expect(r.meanScores.find((s) => s.dimension === "reasoning")?.score).toBe(0);
  });

  it("omits a dimension no run could measure", () => {
    const r = aggregateRuns("t1", "m", VARIANT, [
      run([
        { dimension: "accuracy", score: 1 },
        { dimension: "reasoning", score: 0, inconclusive: true },
      ]),
    ]);
    // Absent — NOT a 0%. A rendered "reasoning 0%" is a claim about the agent.
    expect(r.meanScores.find((s) => s.dimension === "reasoning")).toBeUndefined();
    // The measured dimension is untouched.
    expect(r.meanScores.find((s) => s.dimension === "accuracy")?.score).toBe(1);
  });

  it("averages only the runs that measured the dimension", () => {
    const r = aggregateRuns("t1", "m", VARIANT, [
      run([{ dimension: "accuracy", score: 1 }, { dimension: "reasoning", score: 0.8 }]),
      run([{ dimension: "accuracy", score: 1 }, { dimension: "reasoning", score: 0, inconclusive: true }]),
    ]);
    // 0.8, not (0.8 + 0) / 2 = 0.4.
    expect(r.meanScores.find((s) => s.dimension === "reasoning")?.score).toBeCloseTo(0.8, 5);
  });

  it("summarizeDimensions skips cells that carry no measurement", () => {
    const measured = aggregateRuns("t1", "m", VARIANT, [
      run([{ dimension: "accuracy", score: 1 }, { dimension: "reasoning", score: 0.6 }]),
    ]);
    const unmeasured = aggregateRuns("t2", "m", VARIANT, [
      run([{ dimension: "accuracy", score: 1 }, { dimension: "reasoning", score: 0, inconclusive: true }]),
    ]);
    const summary = summarizeDimensions([measured, unmeasured]);
    const reasoning = summary.find((d) => d.dimension === "reasoning");
    // 0.6 from the one cell that measured it — not 0.3.
    expect(reasoning?.byVariant[0]?.meanScore).toBeCloseTo(0.6, 5);
  });
});

describe("a cell whose ACCURACY went unmeasured is an inconclusive cell", () => {
  it("CONTROL: a measured cell is not marked inconclusive", () => {
    const r = aggregateRuns("t1", "m", VARIANT, [run([{ dimension: "accuracy", score: 0 }])]);
    expect(r.inconclusive).toBeUndefined();
  });

  it("marks the cell with the judge's own reason", () => {
    const r = aggregateRuns("t1", "m", VARIANT, [
      run([{ dimension: "accuracy", score: 0, inconclusive: true }]),
    ]);
    expect(r.inconclusive).toBe("judge-outage");
  });

  it("does NOT let an unmeasured accuracy score as a 0 solve", () => {
    const r = aggregateRuns("t1", "m", VARIANT, [
      run([{ dimension: "accuracy", score: 0, inconclusive: true }]),
    ]);
    // The cell is excluded upstream; it must not also assert "0% accuracy".
    expect(r.meanScores.find((s) => s.dimension === "accuracy")).toBeUndefined();
  });

  it("stays measured when only SOME runs are inconclusive", () => {
    const r = aggregateRuns("t1", "m", VARIANT, [
      run([{ dimension: "accuracy", score: 1 }]),
      run([{ dimension: "accuracy", score: 0, inconclusive: true }]),
    ]);
    expect(r.inconclusive).toBeUndefined();
    // Averaged over the measured run only — an outage must not halve the score.
    expect(r.meanScores.find((s) => s.dimension === "accuracy")?.score).toBe(1);
  });
});
