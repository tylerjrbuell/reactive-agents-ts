// Run: bun test packages/benchmarks/tests/scoring-inconclusive.test.ts
//
// Scoring-integrity wave (2026-07-11): an UNMEASURABLE score is INCONCLUSIVE,
// never a number.
//
// Four diseases this file pins shut:
//  1. Judge outage scored 0.0 — indistinguishable from model failure, poisoning
//     means and lift math. → inconclusive, reason "judge-outage".
//  2. Stub judge (JUDGE_LAYER != live) scored 0.95 on everything and nothing
//     downstream flagged it. → inconclusive, reason "stub-judge".
//  3. Inconclusive runs must be EXCLUDED from solve/pass^k/mean aggregation and
//     COUNTED visibly — and never silently droppable: > 20% inconclusive runs
//     flips the whole CELL verdict to inconclusive (anti-gaming bar).
//  4. isSolved: judge-scored accuracy is NEVER a pass^k solve unless the task
//     declares `solvedThreshold` (DECLARED METRIC CHANGE — see report-format.ts).

import { describe, it, expect, afterAll } from "bun:test";
import type { Server } from "bun";
import { computeReliability, scoreErrorCell, scoreTask } from "../src/judge.js";
import {
  accuracyDimensionOf,
  INCONCLUSIVE_CELL_FRACTION,
  inconclusiveCountsOf,
  inconclusiveFractionOf,
  isCellInconclusive,
  isRunInconclusive,
  isSolved,
  measuredRuns,
  passKOf,
  solveRateOf,
  statusCell,
} from "../src/report-format.js";
import { aggregateRuns, computeAllAblation } from "../src/runner.js";
import { evaluateLiftGate } from "../src/gate/index.js";
import { getVariant } from "../src/session.js";
import type {
  BenchDimensionScore,
  BenchmarkTask,
  RunScore,
  SessionReport,
  TaskVariantReport,
} from "../src/types.js";

// ── fixtures ─────────────────────────────────────────────────────────────────

function run(dim: BenchDimensionScore, i = 0, status: RunScore["status"] = "pass"): RunScore {
  return {
    runIndex: i,
    dimensions: [dim],
    tokensUsed: 100,
    durationMs: 1000,
    status,
    output: "out",
  };
}

const measured = (score: number, i = 0): RunScore =>
  run({ dimension: "accuracy", score, scoreState: "measured" }, i);
/** Legacy-shaped run: no scoreState at all — must read as measured. */
const legacy = (score: number, i = 0): RunScore =>
  run({ dimension: "accuracy", score }, i);
const outage = (i = 0): RunScore =>
  run({ dimension: "accuracy", score: 0, scoreState: "inconclusive", inconclusiveReason: "judge-outage" }, i);
const stub = (i = 0): RunScore =>
  run({ dimension: "accuracy", score: 0, scoreState: "inconclusive", inconclusiveReason: "stub-judge" }, i);
const judgeMeasured = (score: number, solvedThreshold?: number, i = 0): RunScore =>
  run({
    dimension: "accuracy", score, scoreState: "measured", judgeScored: true,
    ...(solvedThreshold !== undefined ? { solvedThreshold } : {}),
  }, i);

function cell(runs: readonly RunScore[], overrides?: Partial<TaskVariantReport>): TaskVariantReport {
  const scores = runs.map((r) => accuracyDimensionOf(r)?.score ?? 0);
  const mean = scores.length === 0 ? 0 : scores.reduce((a, b) => a + b, 0) / scores.length;
  return {
    taskId: "t1",
    modelVariantId: "m1",
    variantId: "v1",
    variantLabel: "v1",
    runs,
    meanScores: [{ dimension: "accuracy", score: mean }],
    variance: 0,
    meanTokens: 100,
    meanDurationMs: 1000,
    passRate: 1,
    solveRate: 0,
    ...overrides,
  };
}

function report(taskReports: readonly TaskVariantReport[]): SessionReport {
  return {
    generatedAt: "2026-07-11T00:00:00.000Z",
    runs: [],
    sessionId: "s",
    sessionVersion: "1.0.0",
    gitSha: "deadbeef",
    taskReports,
    reproducibility: {
      judgeModelSha: "unknown-no-judge-configured",
      judgeCodeSha: "unknown-no-judge-configured",
      runId: "r",
      replayCommand: "noop",
    },
  };
}

// ── 1+2: scoreTask lanes (outage lane is also pinned in judge-rpc.test.ts) ──

describe("scoreTask judge lanes", () => {
  let server: Server | undefined;
  afterAll(() => server?.stop(true));

  const judgeTask = (solvedThreshold?: number): BenchmarkTask => ({
    id: "jt-1",
    tier: "simple",
    name: "judge task",
    prompt: "p",
    successCriteria: {
      type: "llm-judge",
      rubric: "r",
      ...(solvedThreshold !== undefined ? { solvedThreshold } : {}),
    },
  });

  it("judge outage → inconclusive judge-outage, NOT a measured 0.0", async () => {
    const dims = await scoreTask("answer", judgeTask(), "/tmp", 0, 1, {
      judgeUrl: "http://127.0.0.1:1", // closed port — fails fast
    });
    const acc = dims.find((d) => d.dimension === "accuracy");
    expect(acc?.scoreState).toBe("inconclusive");
    expect(acc?.inconclusiveReason).toBe("judge-outage");
    expect(acc?.judgeScored).toBe(true);
  });

  it("live-shaped judge verdict → measured, and solvedThreshold is stamped on accuracy", async () => {
    // Minimal live-shaped judge-server double: NOT the stub layer, so the
    // verdict counts as a measurement.
    server = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({
          passed: true,
          overallScore: 0.7,
          recommendation: "accept",
          layerResults: [{ layerName: "requirement-check", score: 0.7, passed: true }],
        }),
    });
    const dims = await scoreTask("answer", judgeTask(0.6), "/tmp", 0, 1, {
      judgeUrl: `http://127.0.0.1:${server.port}`,
    });
    const acc = dims.find((d) => d.dimension === "accuracy");
    expect(acc?.scoreState).toBe("measured");
    expect(acc?.score).toBeCloseTo(0.7, 5);
    expect(acc?.judgeScored).toBe(true);
    expect(acc?.solvedThreshold).toBe(0.6);
  });
});

// ── 3: exclusion + visible counting + anti-gaming bar ───────────────────────

describe("inconclusive runs are excluded from aggregates and counted", () => {
  it("run/measured helpers: legacy runs are measured; inconclusive are not", () => {
    expect(isRunInconclusive(legacy(0))).toBe(false);
    expect(isRunInconclusive(measured(0))).toBe(false);
    expect(isRunInconclusive(outage())).toBe(true);
    expect(isRunInconclusive(stub())).toBe(true);
    expect(measuredRuns([measured(1, 0), outage(1), legacy(0, 2)])).toHaveLength(2);
  });

  it("solveRateOf: inconclusive runs leave the DENOMINATOR (not failures)", () => {
    // 2 measured solves + 2 outages: 2/2 measured, not 2/4.
    expect(solveRateOf([measured(1, 0), measured(1, 1), outage(2), outage(3)])).toBe(1);
    // all inconclusive → 0, never NaN
    expect(solveRateOf([outage(0), stub(1)])).toBe(0);
    // unchanged legacy behavior
    expect(solveRateOf([legacy(1, 0), legacy(0, 1)])).toBe(0.5);
  });

  it("passKOf: computed over measured runs only; inconclusive CELL emits nothing", () => {
    // 8 runs, 1 outage (12.5% ≤ 20%): pass^k over n=7 → k=8 absent, k∈{1,2,4} present.
    const oneOut = [...Array.from({ length: 7 }, (_, i) => measured(1, i)), outage(7)];
    const ks = passKOf(oneOut).map((e) => e.k);
    expect(ks).toEqual([1, 2, 4]);
    // 8 runs, 3 outages (37.5% > 20%): the cell is inconclusive → NO estimates,
    // even though 5 measured runs could technically support k ∈ {1,2,4}.
    const threeOut = [
      ...Array.from({ length: 5 }, (_, i) => measured(1, i)),
      outage(5), outage(6), outage(7),
    ];
    expect(passKOf(threeOut)).toEqual([]);
  });

  it("computeReliability ignores inconclusive runs (no fake variance from outage zeros)", () => {
    // Two identical measured scores + one outage-zero: perfectly consistent.
    expect(computeReliability([measured(1, 0), measured(1, 1), outage(2)])).toBe(1);
  });

  it(`anti-gaming: > ${INCONCLUSIVE_CELL_FRACTION * 100}% inconclusive runs flips the CELL verdict`, () => {
    const oneOfEight = cell([...Array.from({ length: 7 }, (_, i) => measured(1, i)), outage(7)]);
    expect(isCellInconclusive(oneOfEight)).toBe(false);
    const twoOfEight = cell([...Array.from({ length: 6 }, (_, i) => measured(1, i)), outage(6), stub(7)]);
    expect(inconclusiveFractionOf(twoOfEight.runs)).toBeCloseTo(0.25, 5);
    expect(isCellInconclusive(twoOfEight)).toBe(true);
  });

  it("statusCell renders INCONCLUSIVE with visible per-reason counts, never a verdict", () => {
    const c = cell([measured(1, 0), measured(1, 1), outage(2), outage(3), stub(4)]);
    const s = statusCell(c);
    expect(s).toContain("INCONCLUSIVE");
    expect(s).toContain("judge-outage 2/5");
    expect(s).toContain("stub-judge 1/5");
    expect(s).not.toContain("✓");
    // counts helper is what the render is built from
    expect(inconclusiveCountsOf(c.runs)).toEqual([
      { reason: "judge-outage", count: 2 },
      { reason: "stub-judge", count: 1 },
    ]);
  });

  it("statusCell: a measured cell is unaffected (tick still means solved)", () => {
    // The verdict is unchanged; the cell now also carries the error on the rate
    // it is reporting, so a ✓ from two runs cannot be read as a ✓ from fifty.
    const rendered = statusCell(cell([legacy(1, 0), legacy(1, 1)]));
    expect(rendered).toStartWith("✓");
    expect(rendered).toContain("n=2");
  });
});

// ── 4: isSolved semantics (declared metric change) ──────────────────────────

describe("isSolved — graded strict bar vs judge solvedThreshold", () => {
  it("graded/deterministic: solved = completed AND accuracy ≥ 1 (partial credit is not a solve)", () => {
    expect(isSolved(legacy(1))).toBe(true);
    expect(isSolved(measured(1))).toBe(true);
    expect(isSolved(measured(0.99))).toBe(false);
    expect(isSolved(run({ dimension: "accuracy", score: 1 }, 0, "error"))).toBe(false);
  });

  it("judge-scored WITHOUT solvedThreshold: NEVER solved (honest starvation beats fake solves)", () => {
    expect(isSolved(judgeMeasured(0.95))).toBe(false);
    expect(isSolved(judgeMeasured(1.0))).toBe(false);
  });

  it("judge-scored WITH declared solvedThreshold: solved iff measured score clears it", () => {
    expect(isSolved(judgeMeasured(0.7, 0.6))).toBe(true);
    expect(isSolved(judgeMeasured(0.5, 0.6))).toBe(false);
  });

  it("an inconclusive accuracy is never a solve", () => {
    expect(isSolved(outage())).toBe(false);
    expect(isSolved(stub())).toBe(false);
  });
});

// ── gate: inconclusive cells cannot feed a verdict ───────────────────────────

describe("lift gate under inconclusive runs", () => {
  const armCell = (
    variantId: string,
    taskId: string,
    runs: readonly RunScore[],
  ): TaskVariantReport => cell(runs, { variantId, taskId, variantLabel: variantId });

  it("a paired cell with > 20% inconclusive runs makes the tier INCONCLUSIVE (blocks promotion)", () => {
    const base = armCell("bare-llm", "t1", Array.from({ length: 8 }, (_, i) => measured(0, i)));
    // Candidate LOOKS like a huge lift — but 3 of its 8 runs were never measured.
    const cand = armCell("ra-full", "t1", [
      ...Array.from({ length: 5 }, (_, i) => measured(1, i)),
      outage(5), outage(6), outage(7),
    ]);
    const verdict = evaluateLiftGate(report([base, cand]), "bare-llm", "ra-full");
    expect(verdict.perTier).toHaveLength(1);
    expect(verdict.perTier[0]!.inconclusive).toBe(true);
    expect(verdict.partial).toBe(true);
    expect(verdict.decision).not.toBe("default-on");
  });

  it("≤ 20% inconclusive: tier stays conclusive and the lift is computed over MEASURED runs only", () => {
    const base = armCell("bare-llm", "t1", Array.from({ length: 8 }, (_, i) => measured(0, i)));
    // 7 measured solves + 1 outage-zero. If the outage's placeholder 0 leaked
    // into the mean, candidateMetric would read 0.875 instead of 1.0.
    const cand = armCell("ra-full", "t1", [
      ...Array.from({ length: 7 }, (_, i) => measured(1, i)),
      outage(7),
    ]);
    const verdict = evaluateLiftGate(report([base, cand]), "bare-llm", "ra-full");
    expect(verdict.perTier[0]!.inconclusive).toBe(false);
    expect(verdict.perTier[0]!.candidateMetric).toBe(1);
  });
});

// ── end-to-end: a real execution timeout, through the ACTUAL runner pipeline ─
//
// Found 2026-07-26 (live harness-warden bench, qwen3:4b, 2/2 reproductions):
// scoreErrorCell stamped no scoreState, so a genuine execution timeout under
// real GPU contention (not a model capability failure) was indistinguishable
// from a measured accuracy=0 — it stayed in solveRate/lift-gate denominators
// and produced a nonsensical -100% token-overhead reading (a timed-out cell
// reports tokensUsed:0). This section proves the FULL chain — scoreErrorCell →
// aggregateRuns → computeAllAblation — now correctly quarantines it, using the
// real functions (no hand-built "inconclusive" fixture) end to end.

describe("real execution-timeout cell, through scoreErrorCell → aggregateRuns → ablation", () => {
  const timeoutTask: BenchmarkTask = {
    id: "rw-2", tier: "real-world", name: "t", prompt: "p",
    primaryDimensions: ["accuracy"],
  } as unknown as BenchmarkTask;

  const runFromRealTimeout = (i: number): RunScore => ({
    runIndex: i,
    dimensions: scoreErrorCell(timeoutTask, "timeout", 150_090),
    tokensUsed: 0,
    durationMs: 150_090,
    status: "error",
    output: "",
  });

  it("a session where EVERY run timed out yields an INCONCLUSIVE cell, not a measured 0", () => {
    const runs = [runFromRealTimeout(0), runFromRealTimeout(1), runFromRealTimeout(2)];
    const cellReport = aggregateRuns("rw-2", "qwen3-4b", getVariant("ra-full"), runs);

    expect(cellReport.inconclusive).toBe("execution-timeout");
    // The old defect: meanScores would carry a fabricated 0 for accuracy.
    // Correct: accuracy is OMITTED entirely — nothing was measured to report.
    expect(cellReport.meanScores.find((s) => s.dimension === "accuracy")).toBeUndefined();
  });

  it("that cell is excluded from computeAllAblation (never poisons a lift verdict)", () => {
    const baseline = aggregateRuns("rw-2", "qwen3-4b", getVariant("bare-llm"), [
      { runIndex: 0, dimensions: [{ dimension: "accuracy", score: 0, scoreState: "measured" }],
        tokensUsed: 500, durationMs: 2000, status: "pass", output: "out" },
    ]);
    const candidateAllTimedOut = aggregateRuns("rw-2", "qwen3-4b", getVariant("ra-full"), [
      runFromRealTimeout(0),
    ]);

    // measuredReports filtering (runner.ts:1428) is what the real session loop
    // applies before ablation/verdicts — reproduce that gate here.
    const measuredReports = [baseline, candidateAllTimedOut].filter((r) => !r.inconclusive);
    expect(measuredReports).toEqual([baseline]);

    const ablation = computeAllAblation(measuredReports);
    expect(ablation).toEqual([]); // no paired baseline+candidate survives → no ablation row, not a fabricated one
  });

  it("a mixed cell (2 measured + 1 real timeout) stays measured, and the timeout run is excluded from the mean", () => {
    const measuredRun = (score: number, i: number): RunScore => ({
      runIndex: i,
      dimensions: [{ dimension: "accuracy", score, scoreState: "measured" }],
      tokensUsed: 400, durationMs: 5000, status: "pass", output: "out",
    });
    const runs = [measuredRun(1, 0), measuredRun(1, 1), runFromRealTimeout(2)];
    const cellReport = aggregateRuns("rw-2", "qwen3-4b", getVariant("ra-full"), runs);

    expect(cellReport.inconclusive).toBeUndefined();
    expect(cellReport.meanScores.find((s) => s.dimension === "accuracy")?.score).toBe(1);
    expect(measuredRuns(cellReport.runs)).toHaveLength(2);
  });
});
