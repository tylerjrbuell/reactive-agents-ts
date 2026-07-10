// File: src/report-format.ts
//
// "It ran" is not "it worked".
//
// `RunScore.status` is "pass" whenever the agent run COMPLETED without throwing
// or timing out (runner.ts). It carries no information about correctness. But
// `passRate` — literally "fraction of runs that did not crash" — was rendered in
// the session summary under a column a reader parses as solved/not-solved:
//
//     rw-4     0%   2796   6.8s   ✓
//
// Three runs that answered nothing rendered as three ticks. No verdict was
// corrupted (the lift gate reads `accuracy`; `computeDrift` never reads
// passRate), but this table is what a human reads before deciding whether a
// change helped — and it called a total failure a success.
//
// This module owns the distinction, as pure functions, so it is testable:
//
//   completionRate — the run finished           (the old `passRate`)
//   solveRate      — the run scored perfectly   (what the tick now means)
//
// A partially-credited run is NOT a solve: graded tasks award fractional scores,
// and 0.5 means half the requirements were met. The tick is reserved for a
// complete solve; everything else shows its number.

import type { RunScore, TaskVariantReport } from "./types.js";

/** A run's accuracy, or 0 when the dimension is absent (never NaN). */
export function accuracyOf(run: RunScore): number {
  return run.dimensions.find((d) => d.dimension === "accuracy")?.score ?? 0;
}

/** True only when the run finished AND earned full accuracy. */
export function isSolved(run: RunScore): boolean {
  return run.status === "pass" && accuracyOf(run) >= 1;
}

/** Fraction of runs that fully solved the task. Empty → 0, never NaN. */
export function solveRateOf(runs: readonly RunScore[]): number {
  if (runs.length === 0) return 0;
  return runs.filter(isSolved).length / runs.length;
}

/** Fraction of runs that completed without crashing/timing out. Empty → 0. */
export function completionRateOf(runs: readonly RunScore[]): number {
  if (runs.length === 0) return 0;
  return runs.filter((r) => r.status === "pass").length / runs.length;
}

/**
 * The `Status` cell for one task×variant row.
 *
 * A cell where every run CRASHED is reported distinctly from one where every run
 * completed and was simply wrong. Both score 0; they are not the same event, and
 * conflating "the harness broke" with "the model was wrong" is how a broken
 * harness gets mistaken for a hard task.
 */
export function statusCell(report: TaskVariantReport): string {
  const runs = report.runs;
  if (runs.length === 0) return "n/a";

  const completion = completionRateOf(runs);
  if (completion === 0) return "ERR"; // nothing even finished

  const solve = solveRateOf(runs);
  if (solve === 1) return "✓";
  if (solve === 0) return completion < 1 ? `✗ (${Math.round((1 - completion) * 100)}% err)` : "✗";
  return `${Math.round(solve * 100)}%`;
}
