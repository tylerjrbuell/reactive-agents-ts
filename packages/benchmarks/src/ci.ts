import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import type { DriftReport, TaskVariantReport, QualityDimension } from "./types.js"

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
  type Entry = { taskId: string; variantId: string; dimension: QualityDimension; baselineScore: number; currentScore: number; delta: number }
  const regressions: Entry[] = []
  const improvements: Entry[] = []

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
    hasRegressions: regressions.length > 0,
    maxRegressionDelta: regressions.length > 0
      ? Math.min(...regressions.map(r => r.delta))
      : 0,
  }
}

/** Returns true if the drift report has regressions exceeding the CI failure threshold. */
export function exceedsThreshold(drift: DriftReport, failThreshold = DEFAULT_REGRESSION_THRESHOLD): boolean {
  return drift.hasRegressions && Math.abs(drift.maxRegressionDelta) > failThreshold
}

/** Serialize task-variant reports to a baseline JSON file at `path`. */
export function saveBaseline(reports: ReadonlyArray<TaskVariantReport>, gitSha: string, path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ gitSha, reports, savedAt: new Date().toISOString() }, null, 2), "utf8")
}

/** Load a previously saved baseline. Returns null if file doesn't exist. */
export function loadBaseline(path: string): { gitSha: string; reports: ReadonlyArray<TaskVariantReport> } | null {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { gitSha: string; reports: ReadonlyArray<TaskVariantReport> }
    return raw
  } catch {
    return null
  }
}
