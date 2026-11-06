// File: src/h3/long-horizon.ts — pre-registered metrics for the H3 long-horizon suite (Plan 9 0e).
//
//   bun run src/h3/long-horizon.ts <results.json>...   # one summary line per tier|task|arm
//
// The four metrics were declared in Plan 9 before any run was read:
//   1. cap-cutoff-with-progress rate: runs that ended on the iteration cap while
//      evidence was still growing (new evidence in the last PROGRESS_WINDOW iterations).
//   2. stall misfire rate: runs in which a stall/loop guard TERMINATED while
//      evidence was growing (new evidence in the PROGRESS_WINDOW iterations up to the fire).
//   3. pass^k over the k runs of a cell (tau-bench definition, `passHatK`).
//   4. mean billed tokens.
//
// "New evidence" is read from the run ledger in the trace (`ledger-entry`
// events), never from model text: an `artifact` entry with a path+digest not
// seen before, or a successful, non-refused, non-harness-authored tool result
// whose (tool, preview) was not seen before. Re-reading the same file is not
// new evidence. Traces without ledger entries fall back to distinct successful
// `tool-call-end` results. Meta tools never count.
import { readFileSync } from "node:fs"
import type { H3Cell, H3Results } from "./run-h3.js"
import { isMeasured } from "./report.js"
import { passHatK, wilson } from "./stats.js"

/** Iterations that count as "still growing" (pre-registered, do not tune on outcomes). */
export const PROGRESS_WINDOW = 2

/** Guards that end a run for lack of progress. A `terminate` from one of these is a stall fire. */
export const STALL_GUARDS: readonly string[] = [
  "loop_resolution",
  "stall_deliverable",
  "required_tool_quota",
  "low_delta_guard",
  "dispatcher_early_stop",
  "oracle_forced",
]

/** Harness meta tools: their results are not task evidence. */
const META_TOOLS: ReadonlySet<string> = new Set([
  "recall", "final-answer", "brief", "pulse", "find", "todo", "checkpoint", "discover-tools", "store", "get-skill-section",
])

/** Termination labels that mean "the iteration cap ended the run". */
const CAP_LABEL = /max[_-]?iterations/i

/** Per-run long-horizon facts, read once from the trace (zero tokens). */
export interface LongHorizonFacts {
  /** Last iteration seen in the trace (-1 when none). */
  readonly lastIter: number
  /** The run ended on the iteration cap (`terminatedBy` matches max_iterations). */
  readonly hitCap: boolean
  /** Iterations in which new evidence landed, ascending. */
  readonly evidenceIters: readonly number[]
  /** Evidence source: the run ledger, or the tool-call fallback for traces without one. */
  readonly evidenceSource: "ledger" | "tool-calls"
  /** Ended on the cap with new evidence in the last {@link PROGRESS_WINDOW} iterations. */
  readonly capCutoffWithProgress: boolean
  /** Stall-guard `terminate` events. */
  readonly stallFires: number
  /** Stall fires with new evidence in the window up to the fire. */
  readonly stallMisfires: number
  /** `guard@iter` for each misfire. */
  readonly misfires: readonly string[]
}

type Ev = Readonly<Record<string, unknown>>

const iterOf = (e: Ev): number => (typeof e.iter === "number" ? e.iter : -1)
const str = (v: unknown): string => (typeof v === "string" ? v : "")

/** New-evidence keys per ledger entry; null when the entry is not evidence. */
function ledgerKey(x: Readonly<Record<string, unknown>>): string | null {
  if (x.kind === "artifact") return `artifact:${str(x.path)}:${str(x.digest) || String(x.seq ?? "")}`
  if (x.kind !== "tool-result") return null
  if (x.success !== true || x.refused === true || x.harnessAuthored === true) return null
  const tool = str(x.toolName)
  if (META_TOOLS.has(tool)) return null
  return `result:${tool}:${str(x.preview)}`
}

/** Extract {@link LongHorizonFacts} from a trace's parsed events. Pure. */
export function longHorizonFactsOf(events: readonly Ev[], window: number = PROGRESS_WINDOW): LongHorizonFacts {
  const lastIter = events.reduce((m, e) => Math.max(m, iterOf(e)), -1)
  const done = events.find((e) => e.kind === "run-completed")
  const hitCap = CAP_LABEL.test(str(done?.terminatedBy))

  const ledgerEvents = events.filter((e) => e.kind === "ledger-entry")
  const evidenceSource: LongHorizonFacts["evidenceSource"] = ledgerEvents.length > 0 ? "ledger" : "tool-calls"
  const seen = new Set<string>()
  const iters = new Set<number>()
  const note = (key: string | null, iter: number): void => {
    if (key === null || seen.has(key)) return
    seen.add(key)
    iters.add(iter)
  }
  if (evidenceSource === "ledger") {
    for (const e of ledgerEvents) {
      const entries = Array.isArray(e.entries) ? (e.entries as ReadonlyArray<Record<string, unknown>>) : []
      for (const x of entries) note(ledgerKey(x), iterOf(e))
    }
  } else {
    for (const e of events) {
      if (e.kind !== "tool-call-end" || e.ok === false || META_TOOLS.has(str(e.toolName))) continue
      note(`call:${str(e.toolName)}:${JSON.stringify(e.result ?? null).slice(0, 2000)}`, iterOf(e))
    }
  }
  const evidenceIters = [...iters].sort((a, b) => a - b)
  const grewIn = (lo: number, hi: number): boolean => evidenceIters.some((i) => i >= lo && i <= hi)

  const fires = events.filter(
    (e) => e.kind === "guard-fired" && e.outcome === "terminate" && STALL_GUARDS.includes(str(e.guard)),
  )
  const misfires = fires
    .filter((e) => grewIn(iterOf(e) - window + 1, iterOf(e)))
    .map((e) => `${str(e.guard)}@${iterOf(e)}`)

  return {
    lastIter,
    hitCap,
    evidenceIters,
    evidenceSource,
    capCutoffWithProgress: hitCap && grewIn(lastIter - window + 1, lastIter),
    stallFires: fires.length,
    stallMisfires: misfires.length,
    misfires,
  }
}

/** Read a trace file and extract its facts; null without a readable trace. */
export function longHorizonFactsFromTrace(traceFile: string | null): LongHorizonFacts | null {
  if (!traceFile) return null
  try {
    const events = readFileSync(traceFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Ev)
    return longHorizonFactsOf(events)
  } catch {
    return null
  }
}

/** One tier|task|arm row of the long-horizon report. */
export interface LongHorizonSummary {
  readonly tier: string
  readonly taskId: string
  readonly variant: string
  /** Measured runs (see `isMeasured`): the denominator of every rate. */
  readonly n: number
  /** Measured runs with trace facts; rates count only these in the numerator. */
  readonly withFacts: number
  readonly solved: number
  readonly ci: { readonly lo: number; readonly hi: number }
  /** pass^k at the results file's k; undefined when n < k. */
  readonly passHatK: number | undefined
  readonly k: number
  readonly capHits: number
  readonly capCutoffWithProgress: number
  readonly capCutoffWithProgressRate: number
  /** Runs with at least one stall misfire. */
  readonly stallMisfireRuns: number
  readonly stallMisfireRate: number
  readonly stallFireRuns: number
  readonly meanBilledTokens: number | null
  readonly meanIterations: number | null
}

const meanOf = (xs: readonly number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/** Group cells by tier|task|arm and compute the pre-registered metrics. Pure. */
export function summarizeLongHorizon(cells: readonly H3Cell[], k: number): LongHorizonSummary[] {
  const groups = new Map<string, H3Cell[]>()
  for (const c of cells) {
    const key = `${c.tier}\u0000${c.taskId}\u0000${c.variant}`
    groups.set(key, [...(groups.get(key) ?? []), c])
  }
  return [...groups.values()].map((g) => {
    const m = g.filter(isMeasured)
    const facts = m.flatMap((c) => (c.longHorizon ? [c.longHorizon] : []))
    const solved = m.filter((c) => c.solved).length
    const n = m.length
    const capCut = facts.filter((f) => f.capCutoffWithProgress).length
    const misRuns = facts.filter((f) => f.stallMisfires > 0).length
    return {
      tier: g[0]!.tier,
      taskId: g[0]!.taskId,
      variant: g[0]!.variant,
      n,
      withFacts: facts.length,
      solved,
      ci: wilson(solved, n),
      passHatK: passHatK(n, solved, k),
      k,
      capHits: facts.filter((f) => f.hitCap).length,
      capCutoffWithProgress: capCut,
      capCutoffWithProgressRate: n ? capCut / n : 0,
      stallMisfireRuns: misRuns,
      stallMisfireRate: n ? misRuns / n : 0,
      stallFireRuns: facts.filter((f) => f.stallFires > 0).length,
      meanBilledTokens: meanOf(m.flatMap((c) => (c.billedTokens == null ? [] : [c.billedTokens]))),
      meanIterations: meanOf(m.flatMap((c) => (c.iterations == null ? [] : [c.iterations]))),
    }
  })
}

/** Greppable one-line form of a summary row. */
export function longHorizonLine(s: LongHorizonSummary): string {
  const f = (x: number | null | undefined, d = 2): string => (x == null ? "-" : x.toFixed(d))
  return [
    `LH|${s.tier}|${s.taskId}|${s.variant}`,
    `n=${s.n}`,
    `facts=${s.withFacts}`,
    `solved=${s.solved}`,
    `ci=[${f(s.ci.lo)},${f(s.ci.hi)}]`,
    `pass^${s.k}=${f(s.passHatK)}`,
    `capHits=${s.capHits}`,
    `capCutWithProgress=${s.capCutoffWithProgress}(${f(s.capCutoffWithProgressRate)})`,
    `stallMisfire=${s.stallMisfireRuns}(${f(s.stallMisfireRate)})`,
    `stallFireRuns=${s.stallFireRuns}`,
    `billed=${f(s.meanBilledTokens, 0)}`,
    `iters=${f(s.meanIterations, 1)}`,
  ].join("|")
}

if (import.meta.main) {
  const files = process.argv.slice(2).filter((a) => !a.startsWith("--"))
  if (files.length === 0) {
    console.error("usage: bun run src/h3/long-horizon.ts <results.json>...")
    process.exit(2)
  }
  const results = files.map((f) => JSON.parse(readFileSync(f, "utf8")) as H3Results)
  const k = Math.max(...results.map((r) => r.k))
  for (const s of summarizeLongHorizon(results.flatMap((r) => r.cells), k)) console.log(longHorizonLine(s))
}
