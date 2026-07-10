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

import type { RunScore, SessionReport, TaskVariantReport } from "./types.js";

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

// ── pass^k (tau-bench reliability) ───────────────────────────────────────────

/** The k values every pass^k surface reports. Fixed so tables line up. */
export const PASS_K_VALUES: readonly number[] = [1, 2, 4, 8];

/**
 * pass^k estimator: given `c` solves observed in `n` runs, the probability
 * that `k` runs drawn WITHOUT replacement are all solves = C(c,k)/C(n,k).
 *
 * Computed as Π_{i=0..k-1} (c−i)/(n−i) — no factorials, no overflow.
 *
 * Honesty edges:
 *   • k > n (or k < 1, or degenerate inputs) → `undefined`. The data cannot
 *     support the estimate; returning 0 would fake "never reliable" out of
 *     "not enough runs to know".
 *   • c < k → exactly 0: you cannot draw k solves from fewer than k of them.
 */
export function passKEstimate(n: number, c: number, k: number): number | undefined {
  if (!Number.isInteger(n) || !Number.isInteger(c) || !Number.isInteger(k)) return undefined;
  if (k < 1 || n < 1 || c < 0 || c > n) return undefined;
  if (k > n) return undefined;
  if (c < k) return 0;
  let p = 1;
  for (let i = 0; i < k; i++) p *= (c - i) / (n - i);
  return p;
}

/**
 * The pass^k projection of one cell's runs, for k ∈ {@link PASS_K_VALUES}
 * where n ≥ k. Solves are {@link isSolved} (completed AND full accuracy) —
 * partial credit is not a solve, so it cannot launder into reliability.
 */
export function passKOf(
  runs: readonly RunScore[],
): ReadonlyArray<{ readonly k: number; readonly estimate: number }> {
  const n = runs.length;
  const c = runs.filter(isSolved).length;
  const out: Array<{ k: number; estimate: number }> = [];
  for (const k of PASS_K_VALUES) {
    const estimate = passKEstimate(n, c, k);
    if (estimate !== undefined) out.push({ k, estimate });
  }
  return out;
}

/**
 * Render the session-level pass^k table (one row per variant), or `undefined`
 * when the report carries no pass^k data. Pure — the caller decides where it
 * prints.
 */
export function formatPassKSummary(report: SessionReport): string | undefined {
  const rows = report.passKByVariant ?? [];
  const withData = rows.filter((r) => r.passK.length > 0);
  if (withData.length === 0) return undefined;

  const ks = PASS_K_VALUES.filter((k) => withData.some((r) => r.passK.some((e) => e.k === k)));
  const header =
    `  pass^k (reliability — P(all k runs solve), mean over tasks):\n` +
    `    ${"variant".padEnd(20)} ${ks.map((k) => `k=${k}`.padStart(6)).join("  ")}`;
  const lines = withData.map((r) => {
    const cells = ks.map((k) => {
      const e = r.passK.find((x) => x.k === k);
      return (e === undefined ? "—" : `${(e.estimate * 100).toFixed(0)}%`).padStart(6);
    });
    return `    ${r.variantId.slice(0, 19).padEnd(20)} ${cells.join("  ")}`;
  });
  return [header, ...lines].join("\n");
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
