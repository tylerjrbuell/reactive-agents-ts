// File: src/h3/report.ts — aggregate H3 results JSON into per-task x tier stats.
//   bun run src/h3/report.ts <results.json>... [--md]   # summary lines (+ table with --md)
import { readFileSync } from "node:fs"
import type { H3Cell, H3Results } from "./run-h3.js"
import { intervalsDisjoint, passHatK, wilson } from "./stats.js"

export interface CellStats {
  readonly tier: string
  readonly taskId: string
  readonly variant: string
  /** Measured (non-inconclusive) runs. Timeouts/crashes COUNT as unsolved runs. */
  readonly n: number
  readonly inconclusive: number
  readonly solved: number
  readonly rate: number
  readonly ci: { lo: number; hi: number }
  /** pass^k at k=5 (undefined when n<5). */
  readonly passHat5: number | undefined
  readonly meanTokens: number
  readonly meanBilledTokens: number | null
  /** Mean kernel iterations (tool-surface-resolved); reads 0 for strategies that emit none (plan-execute). */
  readonly meanIterations: number | null
  /** Mean LLM calls (llm-exchange events): comparable across strategies. */
  readonly meanLlmCalls: number | null
  readonly causes: Readonly<Record<string, number>>
  readonly meanDurationSec: number
}

/**
 * Measurement policy (declared before any outcome was read): a wall-clock
 * `execution-timeout` is a FAILURE to deliver within the cell budget and counts
 * as an unsolved measured run — the runner flags it `inconclusive`, which would
 * silently drop exactly the runaway runs a baseline must keep. Every other
 * inconclusive (capability-source preflight, judge outage, harness error) is a
 * non-observation and leaves the denominator.
 */
export const isMeasured = (c: H3Cell): boolean => !c.inconclusive || c.error === "execution-timeout"

const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/** LLM calls in a trace = llm-exchange events. */
export function llmCallsOf(traceFile: string | null): number | null {
  if (!traceFile) return null
  try {
    return readFileSync(traceFile, "utf8").trim().split("\n").filter((l) => l.includes('"kind":"llm-exchange"')).length
  } catch {
    return null
  }
}

export function statsFor(cells: readonly H3Cell[], llmCalls: (c: H3Cell) => number | null = () => null): CellStats[] {
  const groups = new Map<string, H3Cell[]>()
  for (const c of cells) {
    const key = `${c.tier}\u0000${c.taskId}\u0000${c.variant}`
    groups.set(key, [...(groups.get(key) ?? []), c])
  }
  return [...groups.values()].map((g) => {
    const measured = g.filter(isMeasured)
    const solved = measured.filter((c) => c.solved).length
    const causes: Record<string, number> = {}
    for (const c of measured) causes[c.causeLabel] = (causes[c.causeLabel] ?? 0) + 1
    const billed = measured.filter((c) => c.billedTokens != null).map((c) => c.billedTokens as number)
    const its = measured.filter((c) => c.iterations != null).map((c) => c.iterations as number)
    const calls = measured.map(llmCalls).filter((x): x is number => x != null)
    return {
      tier: g[0]!.tier, taskId: g[0]!.taskId, variant: g[0]!.variant,
      n: measured.length, inconclusive: g.length - measured.length, solved,
      rate: measured.length ? solved / measured.length : 0,
      ci: wilson(solved, measured.length),
      passHat5: passHatK(measured.length, solved, 5),
      meanTokens: Math.round(mean(measured.map((c) => c.tokens))),
      meanBilledTokens: billed.length ? Math.round(mean(billed)) : null,
      meanIterations: its.length ? Math.round(mean(its) * 10) / 10 : null,
      meanLlmCalls: calls.length ? Math.round(mean(calls) * 10) / 10 : null,
      causes,
      meanDurationSec: Math.round(mean(measured.map((c) => c.durationMs)) / 1000),
    }
  })
}

const pct = (x: number): string => `${(x * 100).toFixed(0)}%`
const fmtCauses = (c: Readonly<Record<string, number>>): string =>
  Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(",")

/** One machine-greppable line per (tier, task, variant) cell. */
export function summaryLines(stats: readonly CellStats[]): string[] {
  return stats.map((s) =>
    `H3|${s.tier}|${s.taskId}|${s.variant}|n=${s.n}|inconclusive=${s.inconclusive}|solved=${s.solved}|rate=${s.rate.toFixed(2)}|ci95=${s.ci.lo.toFixed(2)}-${s.ci.hi.toFixed(2)}|pass5=${s.passHat5 === undefined ? "NA" : s.passHat5.toFixed(2)}|tok=${s.meanTokens}|billed=${s.meanBilledTokens ?? "NA"}|llmcalls=${s.meanLlmCalls ?? "NA"}|it=${s.meanIterations ?? "NA"}|causes=${fmtCauses(s.causes)}`,
  )
}

export function markdownTable(stats: readonly CellStats[]): string {
  const rows = stats.map((s) =>
    `| ${s.tier} | ${s.taskId}${s.variant === "ra-default" ? "" : ` (${s.variant})`} | ${s.solved}/${s.n}${s.inconclusive ? ` (+${s.inconclusive} inconcl.)` : ""} | ${pct(s.rate)} | ${pct(s.ci.lo)}-${pct(s.ci.hi)} | ${s.passHat5 === undefined ? "NA" : s.passHat5.toFixed(2)} | ${s.meanBilledTokens ?? s.meanTokens} | ${s.meanLlmCalls ?? "NA"} | ${s.meanDurationSec}s | ${fmtCauses(s.causes)} |`,
  )
  return ["| tier | task | solved | rate | Wilson 95% | pass^5 | tokens | LLM calls | dur | cause labels |", "|---|---|---|---|---|---|---|---|---|---|", ...rows].join("\n")
}

/** Tier-level pooled rate over the default-arm cells. */
export function tierTotals(stats: readonly CellStats[]): Array<{ tier: string; n: number; solved: number; rate: number; ci: { lo: number; hi: number }; tokens: number }> {
  const tiers = [...new Set(stats.map((s) => s.tier))]
  return tiers.map((tier) => {
    const g = stats.filter((s) => s.tier === tier && s.variant === "ra-default")
    const n = g.reduce((a, s) => a + s.n, 0)
    const solved = g.reduce((a, s) => a + s.solved, 0)
    const tokens = g.reduce((a, s) => a + s.meanTokens * s.n, 0)
    return { tier, n, solved, rate: n ? solved / n : 0, ci: wilson(solved, n), tokens }
  })
}

/** True iff a difference between two cells is resolvable at their n (disjoint Wilson CIs). */
export const resolvable = (a: CellStats, b: CellStats): boolean => intervalsDisjoint(a.ci, b.ci)

if (import.meta.main) {
  const files = process.argv.slice(2).filter((a) => !a.startsWith("--"))
  const cells = files.flatMap((f) => (JSON.parse(readFileSync(f, "utf8")) as H3Results).cells)
  const stats = statsFor(cells, (c) => llmCallsOf(c.traceFile))
  if (process.argv.includes("--md")) console.log(markdownTable(stats))
  console.log(summaryLines(stats).join("\n"))
  for (const t of tierTotals(stats)) console.log(`H3TIER|${t.tier}|n=${t.n}|solved=${t.solved}|rate=${t.rate.toFixed(3)}|ci95=${t.ci.lo.toFixed(2)}-${t.ci.hi.toFixed(2)}|meanTok=${t.n ? Math.round(t.tokens / t.n) : 0}`)
}
