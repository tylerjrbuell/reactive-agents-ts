// File: src/aggregate.ts
/**
 * Pure result-aggregation helpers for benchmark sessions (abstention metrics,
 * per-cell aggregation, pass^k, ablation, dimension summaries). Extracted
 * verbatim from runner.ts (GH #268); runner.ts re-exports them.
 */
import type {
  HarnessVariant, TaskVariantReport, AblationResult, SessionReport, RunScore,
  DimensionScore, QualityDimension, InconclusiveReason,
} from "./types.js"
import { ALL_TASKS } from "./all-tasks.js"
import { completionRateOf, passKOf, PASS_K_VALUES, solveRateOf, runInconclusiveReasonOf } from "./report-format.js"
import { computeReliability } from "./judge.js"

/** Aggregate trap-only abstention metrics across runs. */
export function aggregateAbstention(
  runs: ReadonlyArray<{ abstainExpected: boolean; abstained: boolean }>,
): { abstentionAccuracy: number; fabricationUnderTrapRate: number } {
  const traps = runs.filter((r) => r.abstainExpected)
  if (traps.length === 0) return { abstentionAccuracy: 0, fabricationUnderTrapRate: 0 }
  const correct = traps.filter((r) => r.abstained).length
  return {
    abstentionAccuracy: correct / traps.length,
    fabricationUnderTrapRate: (traps.length - correct) / traps.length,
  }
}

export function aggregateRuns(
  taskId: string,
  modelVariantId: string,
  variant: HarnessVariant,
  runs: ReadonlyArray<RunScore>,
): TaskVariantReport {
  if (runs.length === 0) {
    return { taskId, modelVariantId, variantId: variant.id, variantLabel: variant.label,
      runs: [], meanScores: [], variance: 0, meanTokens: 0, meanBilledTokens: 0, meanCacheReadTokens: 0,
      meanDurationMs: 0, passRate: 0, solveRate: 0 }
  }

  const dims = [...new Set(runs.flatMap(r => r.dimensions.map(d => d.dimension)))] as QualityDimension[]

  // A dimension result the judge could not score carries `scoreState:
  // "inconclusive"` and a placeholder `score: 0`. That 0 is NOT an observation,
  // so it must never enter a mean — averaging it in turns a judge outage into a
  // claim about the agent ("reasoning 0%"). Unmeasured results are dropped; a
  // dimension NO run could measure is OMITTED from `meanScores` entirely, so a
  // renderer has nothing to print rather than a fabricated 0%.
  const measuredScores = (dim: QualityDimension): number[] =>
    runs.flatMap(r => {
      const d = r.dimensions.find(x => x.dimension === dim)
      if (d === undefined || d.scoreState === "inconclusive") return []
      return [d.score]
    })

  const meanScores: DimensionScore[] = dims.flatMap(dim => {
    const scores = measuredScores(dim)
    if (scores.length === 0) return []
    return [{ dimension: dim, score: scores.reduce((a, b) => a + b, 0) / scores.length }]
  })

  const accuracyScores = measuredScores("accuracy")
  const mean = accuracyScores.length > 0
    ? accuracyScores.reduce((a, b) => a + b, 0) / accuracyScores.length
    : 0
  const variance = accuracyScores.length > 0
    ? accuracyScores.reduce((a, b) => a + (b - mean) ** 2, 0) / accuracyScores.length
    : 0
  const reliability = computeReliability(runs)

  // The CELL is inconclusive when NO run measured accuracy — the metric every
  // downstream verdict (isSolved, lift, drift) reads. Some-measured is still a
  // measured cell: the outage runs are simply excluded above, exactly as the
  // report-format helpers' doc contract describes.
  const cellInconclusive: InconclusiveReason | undefined =
    accuracyScores.length === 0
      ? runs.map(runInconclusiveReasonOf).find((x): x is InconclusiveReason => x !== undefined)
      : undefined

  if (!meanScores.find(s => s.dimension === "reliability")) {
    meanScores.push({ dimension: "reliability", score: reliability })
  }

  return {
    taskId, modelVariantId,
    variantId: variant.id, variantLabel: variant.label,
    runs,
    meanScores,
    variance: Math.sqrt(variance),
    meanTokens: Math.round(runs.reduce((a, r) => a + r.tokensUsed, 0) / runs.length),
    // Fall back to the RAW figure per run, not to 0 — a provider with no cache
    // reporting must score as "billed everything", which is the truth.
    meanBilledTokens: Math.round(
      runs.reduce((a, r) => a + (r.billedTokens ?? r.tokensUsed), 0) / runs.length,
    ),
    meanCacheReadTokens: Math.round(
      runs.reduce((a, r) => a + (r.cacheReadTokens ?? 0), 0) / runs.length,
    ),
    meanDurationMs: Math.round(runs.reduce((a, r) => a + r.durationMs, 0) / runs.length),
    passRate: completionRateOf(runs),
    solveRate: solveRateOf(runs),
    passK: passKOf(runs),
    ...(cellInconclusive !== undefined ? { inconclusive: cellInconclusive } : {}),
  }
}

/**
 * Session-level pass^k: per variant, the mean of per-task estimates. A k is
 * emitted ONLY when every measured cell (runs > 0) of that variant carries it
 * — averaging over whichever tasks happened to have n ≥ k would compare
 * different task subsets across variants, the same composition bug the paired
 * gate exists to kill. Returns `undefined` when nothing is measurable.
 */
export function aggregatePassKByVariant(
  reports: ReadonlyArray<TaskVariantReport>,
): SessionReport["passKByVariant"] {
  const byVariant = new Map<string, TaskVariantReport[]>()
  for (const r of reports) {
    if (r.inconclusive || r.runs.length === 0) continue
    if (!byVariant.has(r.variantId)) byVariant.set(r.variantId, [])
    byVariant.get(r.variantId)!.push(r)
  }
  if (byVariant.size === 0) return undefined

  const out: Array<{ variantId: string; passK: Array<{ k: number; estimate: number }> }> = []
  for (const [variantId, cells] of byVariant) {
    const passK: Array<{ k: number; estimate: number }> = []
    for (const k of PASS_K_VALUES) {
      const estimates: number[] = []
      let everyCellCarriesK = true
      for (const c of cells) {
        const e = (c.passK ?? passKOf(c.runs)).find(x => x.k === k)?.estimate
        if (e === undefined) { everyCellCarriesK = false; break } // this cell has n < k
        estimates.push(e)
      }
      if (!everyCellCarriesK) continue
      passK.push({ k, estimate: estimates.reduce((a, b) => a + b, 0) / estimates.length })
    }
    out.push({ variantId, passK })
  }
  return out
}

export function computeAllAblation(reports: ReadonlyArray<TaskVariantReport>): ReadonlyArray<AblationResult> {
  const groups = new Map<string, TaskVariantReport[]>()
  for (const r of reports) {
    const key = `${r.taskId}::${r.modelVariantId}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(r)
  }

  const results: AblationResult[] = []
  for (const [key, variants] of groups) {
    const [taskId, modelVariantId] = key.split("::") as [string, string]
    const baseline = variants.find(v => v.variantId === "bare-llm")
    const full = variants.find(v => v.variantId === "ra-full")
    if (!baseline || !full) continue

    const baseAcc = baseline.meanScores.find(s => s.dimension === "accuracy")?.score ?? 0
    const fullAcc = full.meanScores.find(s => s.dimension === "accuracy")?.score ?? 0

    const allDims = [...new Set(variants.flatMap(v => v.meanScores.map(s => s.dimension)))] as QualityDimension[]
    const perDimensionLift = allDims.map(dim => {
      const baseScore = baseline.meanScores.find(s => s.dimension === dim)?.score ?? 0
      const fullScore = full.meanScores.find(s => s.dimension === dim)?.score ?? 0
      return { dimension: dim, lift: fullScore - baseScore }
    })

    const bestVariant = [...variants].sort((a, b) =>
      (b.meanScores.find(s => s.dimension === "accuracy")?.score ?? 0) -
      (a.meanScores.find(s => s.dimension === "accuracy")?.score ?? 0)
    )[0]!

    const taskName = ALL_TASKS.find(t => t.id === taskId)?.name ?? taskId
    results.push({
      taskId, taskName, modelVariantId, variants,
      harnessLift: fullAcc - baseAcc,
      perDimensionLift,
      bestVariantId: bestVariant.variantId,
      baselineVariantId: "bare-llm",
    })
  }
  return results
}

export function summarizeDimensions(
  reports: ReadonlyArray<TaskVariantReport>,
): SessionReport["dimensionSummary"] {
  const dims = [...new Set(reports.flatMap(r => r.meanScores.map(s => s.dimension)))] as QualityDimension[]
  return dims.map(dim => {
    const variantIds = [...new Set(reports.map(r => r.variantId))]
    return {
      dimension: dim,
      byVariant: variantIds.map(variantId => {
        // A cell that carries no entry for this dimension did not MEASURE it
        // (aggregateRuns omits unmeasured dimensions). Skipping is the whole
        // point: `?? 0` here averaged an unmeasured cell in as a real zero, so
        // one judge outage dragged the session mean toward 0 for every
        // judge-scored dimension.
        const scores = reports
          .filter(r => r.variantId === variantId)
          .flatMap(r => {
            const s = r.meanScores.find(x => x.dimension === dim)
            return s === undefined ? [] : [s.score]
          })
        return {
          variantId,
          meanScore: scores.length === 0 ? 0 : scores.reduce((a, b) => a + b, 0) / scores.length,
        }
      }),
    }
  })
}
