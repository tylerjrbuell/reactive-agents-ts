// Run: bun test packages/benchmarks/tests/solve-vs-complete.test.ts
//
// The summary table said `Acc 0%  ✓`.
//
// `RunScore.status` is set to "pass" whenever the agent run COMPLETED without
// throwing or timing out (`runner.ts:829`). It says nothing about whether the
// task was solved. `passRate` therefore means "fraction of runs that did not
// crash", but `run.ts:114` rendered it under a column any reader parses as
// solved/not-solved:
//
//     rw-4     0%   2796   6.8s   ✓
//
// Three runs that produced a completely wrong answer render as three ticks.
//
// Scope of the harm, verified: the lift gate reads `policy.metric` (accuracy),
// and `ci.ts`/`computeDrift` never read `passRate` — so no VERDICT was corrupted.
// The only consumer is the human-facing table. That is still worth fixing: this
// display is what a person reads before deciding whether a change helped, and it
// reported a run that answered nothing as a success.
//
// Fix: report the two facts separately and never conflate them.
//   • completionRate — the run finished (no crash/timeout)      [was `passRate`]
//   • solveRate      — the run actually scored a perfect accuracy
// The tick is reserved for SOLVED.

import { describe, expect, it } from "bun:test";
import { solveRateOf, statusCell } from "../src/report-format.js";
import type { RunScore, TaskVariantReport } from "../src/types.js";

const run = (accuracy: number, status: "pass" | "fail" = "pass"): RunScore =>
  ({
    status,
    tokensUsed: 100,
    durationMs: 1000,
    iterations: 1,
    dimensions: [{ dimension: "accuracy", score: accuracy }],
  }) as unknown as RunScore;

const report = (runs: readonly RunScore[]): TaskVariantReport =>
  ({
    taskId: "rw-4",
    modelVariantId: "m",
    variantId: "v",
    variantLabel: "V",
    runs,
    meanScores: [],
    variance: 0,
    meanTokens: 0,
    meanDurationMs: 0,
    passRate: runs.filter((r) => r.status === "pass").length / runs.length,
    solveRate: solveRateOf(runs),
  }) as unknown as TaskVariantReport;

describe("solveRate — 'it ran' is not 'it worked'", () => {
  it("a run that COMPLETED with accuracy 0 has solveRate 0", () => {
    // The exact cell that started this: Acc 0%, status pass.
    expect(solveRateOf([run(0)])).toBe(0);
  });

  it("a run that completed with a perfect score has solveRate 1", () => {
    expect(solveRateOf([run(1)])).toBe(1);
  });

  it("partial credit is NOT a solve (0.5 accuracy solved nothing fully)", () => {
    // Graded tasks award partial credit; a half-right answer must not tick.
    expect(solveRateOf([run(0.5)])).toBe(0);
  });

  it("mixed runs give a fraction", () => {
    expect(solveRateOf([run(1), run(0), run(1), run(0)])).toBe(0.5);
  });

  it("a crashed run is neither completed nor solved", () => {
    expect(solveRateOf([run(0, "fail")])).toBe(0);
  });

  it("no runs → 0, never NaN (an inconclusive cell must not poison the table)", () => {
    expect(solveRateOf([])).toBe(0);
  });
});

describe("statusCell — the tick means SOLVED, not 'did not crash'", () => {
  it("BUG: three completed-but-wrong runs must NOT render a tick", () => {
    const cell = statusCell(report([run(0), run(0), run(0)]));
    expect(cell).not.toContain("✓");
  });

  it("all runs solved → tick", () => {
    expect(statusCell(report([run(1), run(1)]))).toContain("✓");
  });

  it("nothing solved but everything ran → shows a cross, not a tick", () => {
    expect(statusCell(report([run(0), run(0)]))).toContain("✗");
  });

  it("a partially-solving cell shows the percentage", () => {
    expect(statusCell(report([run(1), run(0)]))).toContain("50%");
  });

  it("a cell that CRASHED is distinguishable from one that merely failed to solve", () => {
    // Both score 0. They are not the same event, and a reader must be able to
    // tell "the harness broke" from "the model was wrong".
    const crashed = statusCell(report([run(0, "fail"), run(0, "fail")]));
    const wrong = statusCell(report([run(0), run(0)]));
    expect(crashed).not.toBe(wrong);
    expect(crashed.toLowerCase()).toContain("err");
  });
});

// ─── WIRING: the real summary table must consume statusCell ──────────────────
//
// Every test above would stay green if `run.ts` kept its own inline
// `passRate === 1 ? "✓"` logic and never called this module. That is the exact
// failure mode being fixed, so pin the call site and the report field.

import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("WIRING: the summary table and the report use the solve/complete split", () => {
  const runSrc = readFileSync(join(import.meta.dir, "..", "src", "run.ts"), "utf8");
  const runnerSrc = readFileSync(join(import.meta.dir, "..", "src", "runner.ts"), "utf8");

  it("run.ts renders the Status column via statusCell(), not a passRate ternary", () => {
    expect(runSrc).toContain("statusCell(r)");
    // The old logic must be gone: passRate must never decide the tick again.
    expect(runSrc).not.toContain('r.passRate === 1 ? "✓"');
  });

  it("run.ts reports liveness and correctness as SEPARATE columns", () => {
    expect(runSrc).toContain('"Ran"');
    expect(runSrc).toContain("Solved");
  });

  it("runner.ts populates solveRate on every cell (so the field is never absent)", () => {
    expect(runnerSrc).toContain("solveRate: solveRateOf(runs)");
    expect(runnerSrc).toContain("solveRate: 0"); // the zeroed/inconclusive cells
  });
});
