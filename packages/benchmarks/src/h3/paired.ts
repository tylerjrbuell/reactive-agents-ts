// File: src/h3/paired.ts — the H3 verdict's pass-rate read, on the lift gate's estimator.
//
// Audit 03 D1: `verdict.ts` called a pass-rate gap resolvable only when two
// POOLED Wilson intervals were disjoint (~22-25pp at 60 cells/arm). The gate
// pairs by task and resolves ~10-12pp at the same n, so the quick verdict said
// NO-CHANGE (`41/48 -> 35/48, within noise`) for a lever the gate rejected
// (gemma4:e4b h3-exact-value 0/5 -> 5/5). This module reads the SAME cells with
// the gate's own paired-by-task estimator (`gate/exact.ts`), per tier, plus the
// per-task exact tests the pooled read averaged away.
//
// Pure. No I/O.
import { agrestiStdErr } from "../report-format.js"
import { fisherExactP, holmAdjust, mcnemarOf, pairByRun, pairedLift, type McNemar } from "../gate/exact.js"
import { isMeasured } from "./report.js"
import type { H3Cell } from "./run-h3.js"

/** Two-sided level for both reads (band z = 1.96, per-task Holm alpha). */
export const PAIRED_ALPHA = 0.05
const PROMOTION_Z = 1.96

/** A task is the cell's task plus its non-default arm (`task@arm`). */
export const taskKeyOf = (c: H3Cell): string => `${c.taskId}${c.variant === "ra-default" ? "" : `@${c.variant}`}`

/** One paired task inside a tier. */
export interface PairedTask {
  readonly task: string
  readonly baselineSolved: number
  readonly baselineRuns: number
  readonly candidateSolved: number
  readonly candidateRuns: number
  readonly dPp: number
  readonly sePp: number
  readonly fisherP: number
  /** Fisher p after Holm correction across this tier's tasks. */
  readonly holmP: number
}

/** The paired read of one model tier. */
export interface PairedTier {
  readonly tier: string
  readonly tasks: readonly PairedTask[]
  readonly liftPp: number
  readonly stdErrPp: number
  /** The 95% band was cleared on the mean lift (needs >= 2 paired tasks: one task has no between-task term). */
  readonly bandResolvable: boolean
  /** Tasks whose Holm-adjusted Fisher p < alpha and whose candidate solved fewer (a collapse the mean averages away). */
  readonly collapsedTasks: readonly string[]
  /** Same, candidate solved more. */
  readonly gainedTasks: readonly string[]
  readonly mcnemar: McNemar
  readonly down: boolean
  readonly up: boolean
}

/** The whole comparison: every tier, and the verdict-level resolution. */
export interface PairedRead {
  /** `accuracy` when any measured cell carries a graded accuracy, else binary `solved`. */
  readonly metric: "accuracy" | "solved"
  readonly tiers: readonly PairedTier[]
  /** Mean of the tier lifts, points of `metric`. */
  readonly liftPp: number
  /** Some tier resolvably regressed (conservative: a regression anywhere outranks a gain elsewhere). */
  readonly resolvableDown: boolean
  /** Some tier resolvably gained and none regressed. */
  readonly resolvableUp: boolean
  readonly resolvable: boolean
}

const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/**
 * Paired read of `before` vs `after`. `before` must already be restricted to the
 * cells present in `after` (the verdict does that). Tasks measured in only one
 * arm are excluded, never pooled (same rule as the gate).
 */
export function pairedRead(before: readonly H3Cell[], after: readonly H3Cell[]): PairedRead {
  const b = before.filter(isMeasured)
  const a = after.filter(isMeasured)
  const metric: PairedRead["metric"] = [...b, ...a].some((c) => c.accuracy !== null) ? "accuracy" : "solved"
  // A measured cell without a graded accuracy (a timeout) is a failure, never a gap.
  const score = (c: H3Cell): number => (metric === "accuracy" ? (c.accuracy ?? (c.solved ? 1 : 0)) : c.solved ? 1 : 0)

  const group = (cells: readonly H3Cell[]): Map<string, H3Cell[]> => {
    const m = new Map<string, H3Cell[]>()
    for (const c of cells) {
      const k = `${c.tier}\u0000${taskKeyOf(c)}`
      m.set(k, [...(m.get(k) ?? []), c])
    }
    return m
  }
  const gb = group(b)
  const ga = group(a)
  const tiers = [...new Set([...b, ...a].map((c) => c.tier))].sort()

  const out: PairedTier[] = tiers.flatMap((tier): PairedTier[] => {
    const keys = [...ga.keys()].filter((k) => k.startsWith(`${tier}\u0000`) && gb.has(k)).sort()
    if (keys.length === 0) return []
    const rows = keys.map((k) => {
      const base = gb.get(k) ?? []
      const cand = ga.get(k) ?? []
      const pB = mean(base.map(score))
      const pC = mean(cand.map(score))
      const bSolved = base.filter((c) => c.solved).length
      const cSolved = cand.filter((c) => c.solved).length
      return {
        task: k.slice(k.indexOf("\u0000") + 1),
        baselineSolved: bSolved,
        baselineRuns: base.length,
        candidateSolved: cSolved,
        candidateRuns: cand.length,
        dPp: (pC - pB) * 100,
        sePp: Math.sqrt(agrestiStdErr(pB, base.length) ** 2 + agrestiStdErr(pC, cand.length) ** 2) * 100,
        fisherP: fisherExactP(bSolved, base.length, cSolved, cand.length),
        paired: pairByRun(
          base.map((c) => ({ index: c.run, solved: c.solved })),
          cand.map((c) => ({ index: c.run, solved: c.solved })),
        ),
      }
    })
    const holm = holmAdjust(rows.map((r) => r.fisherP))
    const tasks: PairedTask[] = rows.map(({ paired: _paired, ...r }, i) => ({ ...r, holmP: holm[i] ?? 1 }))
    const { liftPp, stdErrPp } = pairedLift(tasks)
    const bandResolvable = tasks.length >= 2 && Math.abs(liftPp) > PROMOTION_Z * stdErrPp
    const collapsedTasks = tasks.filter((t) => t.holmP < PAIRED_ALPHA && t.candidateSolved / t.candidateRuns < t.baselineSolved / t.baselineRuns).map((t) => t.task)
    const gainedTasks = tasks.filter((t) => t.holmP < PAIRED_ALPHA && t.candidateSolved / t.candidateRuns > t.baselineSolved / t.baselineRuns).map((t) => t.task)
    return [
      {
        tier,
        tasks,
        liftPp,
        stdErrPp,
        bandResolvable,
        collapsedTasks,
        gainedTasks,
        mcnemar: mcnemarOf(rows.map((r) => r.paired)),
        down: (bandResolvable && liftPp < 0) || collapsedTasks.length > 0,
        up: (bandResolvable && liftPp > 0) || gainedTasks.length > 0,
      },
    ]
  })

  const resolvableDown = out.some((t) => t.down)
  const resolvableUp = !resolvableDown && out.some((t) => t.up)
  return { metric, tiers: out, liftPp: mean(out.map((t) => t.liftPp)), resolvableDown, resolvableUp, resolvable: resolvableDown || resolvableUp }
}

/** One-line description of why a read resolved (or that it did not), for the rationale. */
export function describePaired(p: PairedRead): string {
  const head = `${p.metric} lift ${p.liftPp >= 0 ? "+" : ""}${p.liftPp.toFixed(1)}pp`
  const per = p.tiers
    .map((t) => {
      const why = [
        t.bandResolvable ? `band ${t.liftPp.toFixed(1)}pp vs ±${(PROMOTION_Z * t.stdErrPp).toFixed(1)}` : "",
        ...t.collapsedTasks.map((k) => `${k} collapsed (Holm p=${(t.tasks.find((x) => x.task === k)?.holmP ?? 1).toFixed(3)})`),
        ...t.gainedTasks.map((k) => `${k} gained (Holm p=${(t.tasks.find((x) => x.task === k)?.holmP ?? 1).toFixed(3)})`),
      ].filter((s) => s !== "")
      return `${t.tier} ${t.liftPp >= 0 ? "+" : ""}${t.liftPp.toFixed(1)}pp ±${t.stdErrPp.toFixed(1)} McNemar +${t.mcnemar.b}/-${t.mcnemar.c} p=${t.mcnemar.p.toFixed(3)}${why.length ? ` [${why.join("; ")}]` : ""}`
    })
    .join(" | ")
  const state = p.resolvableDown ? "REGRESSION RESOLVABLE" : p.resolvableUp ? "GAIN RESOLVABLE" : "within noise"
  return `${head}, ${state}${per ? ` (${per})` : ""}`
}
