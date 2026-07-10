import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import type { DriftReport, TaskVariantReport, ScoreDelta } from "./types.js"

const DEFAULT_REGRESSION_THRESHOLD = 0.15

/**
 * Compare current task-variant reports against a stored baseline.
 * Returns a DriftReport identifying regressions and improvements.
 */
export function computeDrift(
  baseline: ReadonlyArray<TaskVariantReport>,
  current: ReadonlyArray<TaskVariantReport>,
  baselineGitSha: string,
  regressionThreshold = DEFAULT_REGRESSION_THRESHOLD,
): DriftReport {
  const regressions: ScoreDelta[] = []
  const improvements: ScoreDelta[] = []

  // A cell present in the BASELINE but absent from the current run is not
  // "no data" — it is a regression in coverage. The old loop iterated only
  // `current`, so a task that was deleted, renamed, filtered out, or crashed
  // hard enough to emit no report registered as no regression at all. That
  // makes "stop measuring" the cheapest way to turn the gate green.
  const key = (c: { taskId: string; variantId: string }) => `${c.taskId}::${c.variantId}`
  const currentKeys = new Set(current.map(key))
  const baselineKeys = new Set(baseline.map(key))
  const droppedCells = baseline
    .filter(b => !currentKeys.has(key(b)))
    .map(b => ({ taskId: b.taskId, variantId: b.variantId }))
  const newCells = current
    .filter(c => !baselineKeys.has(key(c)))
    .map(c => ({ taskId: c.taskId, variantId: c.variantId }))

  for (const cur of current) {
    const base = baseline.find(b => b.taskId === cur.taskId && b.variantId === cur.variantId)
    if (!base) continue

    for (const curScore of cur.meanScores) {
      const baseScore = base.meanScores.find(s => s.dimension === curScore.dimension)
      if (!baseScore) continue
      const delta = curScore.score - baseScore.score
      if (delta < -regressionThreshold) {
        regressions.push({ taskId: cur.taskId, variantId: cur.variantId,
          dimension: curScore.dimension, baselineScore: baseScore.score,
          currentScore: curScore.score, delta })
      } else if (delta > regressionThreshold) {
        improvements.push({ taskId: cur.taskId, variantId: cur.variantId,
          dimension: curScore.dimension, baselineScore: baseScore.score,
          currentScore: curScore.score, delta })
      }
    }
  }

  return {
    baselineGitSha,
    regressions,
    improvements,
    droppedCells,
    newCells,
    hasRegressions: regressions.length > 0,
    maxRegressionDelta: regressions.length > 0
      ? Math.min(...regressions.map(r => r.delta))
      : 0,
  }
}

/**
 * Returns true if the run must fail CI.
 *
 * Two independent reasons:
 *   1. A score regression beyond the threshold.
 *   2. ANY dropped cell — a baseline cell the current run did not measure.
 *
 * (2) is not optional. Without it the gate rewards measuring less: delete the
 * failing task and the suite goes green. Adding NEW cells never fails; more
 * coverage is the direction we want.
 */
export function exceedsThreshold(drift: DriftReport, failThreshold = DEFAULT_REGRESSION_THRESHOLD): boolean {
  if (drift.droppedCells.length > 0) return true
  return drift.hasRegressions && Math.abs(drift.maxRegressionDelta) > failThreshold
}

/**
 * Serialize task-variant reports to a baseline JSON file at `path`.
 *
 * A baseline is a COMMITTED artifact, diffed by every later run. It keeps only
 * what drift (and a future power-aware drift) needs: the ids, the mean scores,
 * and each run's dimension scores + status + tokens.
 *
 * Raw model prose, trace ids, and diagnoses are stripped. They ballooned the
 * file (76 KB for six cells), churned the diff on every re-baseline, and baked
 * unreviewed model output into the repository.
 */
export function saveBaseline(reports: ReadonlyArray<TaskVariantReport>, gitSha: string, path: string): void {
  const slim = reports.map(r => ({
    taskId: r.taskId,
    modelVariantId: r.modelVariantId,
    variantId: r.variantId,
    variantLabel: r.variantLabel,
    meanScores: r.meanScores,
    variance: r.variance,
    meanTokens: r.meanTokens,
    meanDurationMs: r.meanDurationMs,
    passRate: r.passRate,
    solveRate: r.solveRate,
    runs: r.runs.map(run => ({
      runIndex: run.runIndex,
      status: run.status,
      tokensUsed: run.tokensUsed,
      durationMs: run.durationMs,
      dimensions: run.dimensions,
    })),
  }))
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ gitSha, reports: slim, savedAt: new Date().toISOString() }, null, 2), "utf8")
}

/** Load a previously saved baseline. Returns null if file doesn't exist. */
export function loadBaseline(path: string): { gitSha: string; reports: ReadonlyArray<TaskVariantReport> } | null {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { gitSha: string; reports: ReadonlyArray<TaskVariantReport> }
    return raw
  } catch (e) {
    if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT") return null
    throw e
  }
}

/**
 * The cells a baseline/drift check should compare.
 *
 * `report.ablation` is populated only for MULTI-variant sessions. A
 * single-variant run has `ablation: []`, so `ablation.flatMap(a => a.variants)`
 * yields nothing — and `--save-baseline` would happily write an EMPTY baseline,
 * against which every future drift check passes vacuously. `taskReports` is
 * always populated, so prefer it and fall back to ablation.
 */
export function baselineCells(report: {
  readonly taskReports?: ReadonlyArray<TaskVariantReport>;
  readonly ablation?: ReadonlyArray<{ readonly variants: ReadonlyArray<TaskVariantReport> }>;
}): ReadonlyArray<TaskVariantReport> {
  const fromTasks = report.taskReports ?? []
  if (fromTasks.length > 0) return fromTasks
  return report.ablation?.flatMap(a => a.variants) ?? []
}

/** An empty baseline makes every later drift check vacuous. Refuse to write one. */
export function assertBaselineCells(cells: ReadonlyArray<TaskVariantReport>): void {
  if (cells.length === 0) {
    throw new Error(
      "Refusing to save an empty baseline: the run produced no task-variant cells, " +
      "and every future drift check would pass against it vacuously.",
    )
  }
}
