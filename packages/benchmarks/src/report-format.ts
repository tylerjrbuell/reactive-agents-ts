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

import type {
  BenchDimensionScore,
  DimensionScore,
  InconclusiveReason,
  RunScore,
  SessionReport,
  TaskVariantReport,
} from "./types.js";

/** Narrow a core DimensionScore to the bench extension (all added fields optional — sound). */
export function asBenchDimension(d: DimensionScore): BenchDimensionScore {
  return d as BenchDimensionScore;
}

/** The run's accuracy dimension with bench metadata, or undefined when absent. */
export function accuracyDimensionOf(run: RunScore): BenchDimensionScore | undefined {
  const d = run.dimensions.find((x) => x.dimension === "accuracy");
  return d === undefined ? undefined : asBenchDimension(d);
}

/** A run's accuracy, or 0 when the dimension is absent (never NaN). */
export function accuracyOf(run: RunScore): number {
  return accuracyDimensionOf(run)?.score ?? 0;
}

// ── Inconclusive lane (scoring-integrity wave, 2026-07-11) ───────────────────
//
// A run whose ACCURACY could not be measured (judge outage, judge malfunction,
// stub judge) is INCONCLUSIVE: excluded from solve/pass^k/mean aggregation and
// COUNTED visibly — never a numeric score. Keyed on accuracy specifically
// because accuracy is what every downstream verdict reads (isSolved, the lift
// metric, drift); a secondary judge dimension going unmeasured does not
// invalidate a deterministically-scored accuracy (e.g. the T0 trap cells).

/** True when this run's accuracy score could not be measured. */
export function isRunInconclusive(run: RunScore): boolean {
  return accuracyDimensionOf(run)?.scoreState === "inconclusive";
}

/** Why this run is inconclusive (undefined for measured runs). */
export function runInconclusiveReasonOf(run: RunScore): InconclusiveReason | undefined {
  const d = accuracyDimensionOf(run);
  return d?.scoreState === "inconclusive" ? d.inconclusiveReason : undefined;
}

/** The runs whose accuracy is a real observation. */
export function measuredRuns(runs: readonly RunScore[]): readonly RunScore[] {
  return runs.filter((r) => !isRunInconclusive(r));
}

/** Fraction of runs whose accuracy is inconclusive. Empty → 0, never NaN. */
export function inconclusiveFractionOf(runs: readonly RunScore[]): number {
  if (runs.length === 0) return 0;
  return runs.filter(isRunInconclusive).length / runs.length;
}

/** Inconclusive-run counts grouped by reason, for visible surfacing. */
export function inconclusiveCountsOf(
  runs: readonly RunScore[],
): ReadonlyArray<{ readonly reason: string; readonly count: number }> {
  const counts = new Map<string, number>();
  for (const r of runs) {
    if (!isRunInconclusive(r)) continue;
    const reason = runInconclusiveReasonOf(r) ?? "unknown";
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * ANTI-GAMING BAR: above this fraction of inconclusive runs, the whole CELL's
 * verdict is inconclusive. Without it, "drop the unmeasurable runs" would let
 * a mostly-unmeasured cell present a confident number built from its few
 * surviving runs.
 */
export const INCONCLUSIVE_CELL_FRACTION = 0.2;

/**
 * A cell is inconclusive when preflight refused to measure it (existing lane,
 * `TaskVariantReport.inconclusive`) OR when more than
 * {@link INCONCLUSIVE_CELL_FRACTION} of its runs are inconclusive.
 */
export function isCellInconclusive(report: TaskVariantReport): boolean {
  if (report.inconclusive !== undefined) return true;
  return inconclusiveFractionOf(report.runs) > INCONCLUSIVE_CELL_FRACTION;
}

/**
 * True only when the run finished AND its measured accuracy clears the solve bar.
 *
 * ── DECLARED METRIC CHANGE (2026-07-11, scoring-integrity wave) ─────────────
 * pass^k solve semantics, by scoring channel:
 *
 *  1. Deterministic channels (regex / verifiable / graded partial credit /
 *     abstention): solved = completed AND accuracy ≥ 1. Unchanged — this is
 *     correct tau-bench semantics: ALL checks pass, partial credit is not a
 *     solve.
 *  2. LLM-judge accuracy (`judgeScored`): solved ONLY when the task explicitly
 *     declares `solvedThreshold` on its llm-judge criteria AND the measured
 *     judge score clears it. A judge task WITHOUT a declared threshold is
 *     NEVER solved for pass^k. Previously the ≥1 bar applied to a continuous
 *     judge score, so judge tasks could not count as solved either — but that
 *     starvation was an accident of grading, not a decision. It is now the
 *     DECLARED default (honest starvation beats fake solves riding judge
 *     noise), with an explicit per-task escape hatch.
 *  3. An INCONCLUSIVE accuracy (judge outage / stub) is never a solve — and
 *     via {@link measuredRuns} it is not a failure either; it leaves the
 *     denominator entirely.
 */
export function isSolved(run: RunScore): boolean {
  if (run.status !== "pass") return false;
  const acc = accuracyDimensionOf(run);
  if (acc === undefined || acc.scoreState === "inconclusive") return false;
  if (acc.judgeScored === true) {
    return acc.solvedThreshold !== undefined && acc.score >= acc.solvedThreshold;
  }
  return acc.score >= 1;
}

/**
 * Fraction of MEASURED runs that fully solved the task. Empty (or fully
 * inconclusive) → 0, never NaN. Inconclusive runs leave the denominator: they
 * are non-observations, not failures — but note {@link isCellInconclusive}
 * flips the whole cell's verdict before a thin measured remainder can be
 * over-read.
 */
export function solveRateOf(runs: readonly RunScore[]): number {
  const measured = measuredRuns(runs);
  if (measured.length === 0) return 0;
  return measured.filter(isSolved).length / measured.length;
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
 * where n ≥ k. Solves are {@link isSolved} (completed AND clears the solve
 * bar) — partial credit is not a solve, so it cannot launder into reliability.
 *
 * Inconclusive runs are excluded from BOTH n and c: an unmeasured run is not a
 * draw from the solve distribution. When the cell itself is inconclusive
 * (> {@link INCONCLUSIVE_CELL_FRACTION} of runs unmeasured) NO estimate is
 * emitted — a pass^k built on a mostly-unmeasured cell would be exactly the
 * silent-drop gaming this lane forbids.
 */
export function passKOf(
  runs: readonly RunScore[],
): ReadonlyArray<{ readonly k: number; readonly estimate: number }> {
  if (inconclusiveFractionOf(runs) > INCONCLUSIVE_CELL_FRACTION) return [];
  const measured = measuredRuns(runs);
  const n = measured.length;
  const c = measured.filter(isSolved).length;
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

  // Inconclusive outranks everything: a cell that was not (sufficiently)
  // MEASURED must never render as a pass, a fail, or a percentage. The count
  // and reason are in the cell so the reader sees the outage, not a verdict.
  if (report.inconclusive !== undefined) {
    return `INCONCLUSIVE (preflight: ${report.inconclusive.kind})`;
  }
  if (isCellInconclusive(report)) {
    const counts = inconclusiveCountsOf(runs)
      .map((c) => `${c.reason} ${c.count}/${runs.length}`)
      .join(", ");
    return `INCONCLUSIVE (${counts})`;
  }

  if (runs.length === 0) return "n/a";

  const completion = completionRateOf(runs);
  if (completion === 0) return "ERR"; // nothing even finished

  const solve = solveRateOf(runs);
  if (solve === 1) return "✓";
  if (solve === 0) return completion < 1 ? `✗ (${Math.round((1 - completion) * 100)}% err)` : "✗";
  return `${Math.round(solve * 100)}%`;
}
