// Run: bun run repo test packages/benchmarks/tests/h3-verdict-paired.test.ts
//
// Measurement overhaul Phase 0.7 (audit 03 D1): the H3 verdict's pass-rate claim reads the
// lift gate's paired-by-task estimator (+ per-task Holm-Fisher), on graded accuracy where
// cells carry it. Red-on-cut: the old disjoint-pooled-Wilson read prints NO-CHANGE here.
import { describe, expect, it } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { compareTargeted } from "../src/h3/verdict.js"
import { pairedRead } from "../src/h3/paired.js"
import { intervalsDisjoint, wilson } from "../src/h3/stats.js"
import type { H3Cell, H3Results } from "../src/h3/run-h3.js"

const cell = (tier: string, taskId: string, run: number, solved: boolean, over: Partial<H3Cell> = {}): H3Cell => ({
  cellId: `${tier}|${taskId}|${run}`, taskId, variant: "ra-default", tier, run,
  accuracy: solved ? 1 : 0, solved, status: solved ? "pass" : "fail", inconclusive: false,
  tokens: 100, billedTokens: 100, durationMs: 1000, iterations: 1, terminatedBy: "end_turn",
  causeLabel: "none", causeAuthority: null, toolSurface: [], traceFile: null, traceDir: "/tmp",
  failureModes: [], honestyLabel: null, ...over,
})
const cellsOf = (tier: string, task: string, solvedN: number, n = 5, over: Partial<H3Cell> = {}): H3Cell[] =>
  Array.from({ length: n }, (_, i) => cell(tier, task, i, i < solvedN, over))
const reasonOf = (c: H3Cell): string => (c.solved ? "not-failed" : "model:x")

describe("verdict pass-rate uses the gate's paired-by-task estimator", () => {
  // The lft shape: 6 tasks x 5 runs on one tier; one task collapses 5/5 -> 0/5, one flaky task loses 2.
  const tasks = ["a", "b", "c", "d"]
  const before = [...tasks.flatMap((t) => cellsOf("g", t, 5)), ...cellsOf("g", "exact-value", 5), ...cellsOf("g", "trap", 5)]
  const after = [...tasks.flatMap((t) => cellsOf("g", t, 5)), ...cellsOf("g", "exact-value", 0), ...cellsOf("g", "trap", 3)]

  it("old rule: pooled Wilson intervals overlap, so the pass-rate gap was 'within noise'", () => {
    expect(intervalsDisjoint(wilson(25, 30), wilson(18, 30))).toBe(false)
  })
  it("a collapsed task (5/5 -> 0/5) is RESOLVABLE and the verdict is regressed, not NO-CHANGE", () => {
    const v = compareTargeted(before, after, "harness:none", reasonOf)
    expect(v.passRateResolvable).toBe(true)
    expect(v.paired.resolvableDown).toBe(true)
    expect(v.paired.tiers[0]!.collapsedTasks).toEqual(["exact-value"])
    expect(v.decision).toBe("regressed")
    expect(v.rationale).toContain("REGRESSION RESOLVABLE")
    expect(v.rationale).toContain("exact-value collapsed")
    expect(v.rationale).toContain("McNemar +0/-")
  })
  it("equal arms stay within noise (no false resolvable)", () => {
    const v = compareTargeted(before, before.map((c) => ({ ...c })), "harness:none", reasonOf)
    expect(v.paired.resolvable).toBe(false)
    expect(v.decision).toBe("no-change")
  })
  it("a regression in one tier outranks a gain in another", () => {
    const b = [...before, ...tasks.flatMap((t) => cellsOf("h", t, 0)), ...cellsOf("h", "exact-value", 0), ...cellsOf("h", "trap", 0)]
    const a = [...after, ...tasks.flatMap((t) => cellsOf("h", t, 5)), ...cellsOf("h", "exact-value", 5), ...cellsOf("h", "trap", 5)]
    const p = pairedRead(b, a)
    expect(p.tiers.find((t) => t.tier === "h")!.up).toBe(true)
    expect(p.resolvableDown).toBe(true)
    expect(p.resolvableUp).toBe(false)
  })
  it("a single paired task has no between-task term: only the exact test may resolve it (0/5 -> 3/5 does not)", () => {
    const p = pairedRead(cellsOf("q", "rw-2", 0), cellsOf("q", "rw-2", 3))
    expect(p.resolvable).toBe(false)
  })
})

describe("verdict reads graded accuracy where available", () => {
  it("unsolved cells whose partial-credit accuracy rose resolve a gain that binary solved cannot see", () => {
    const acc = (tier: string, task: string, a: number): H3Cell[] => cellsOf(tier, task, 0, 5, { accuracy: a })
    const before = ["a", "b", "c"].flatMap((t) => [...acc("c", t, 0.2)])
    const after = ["a", "b", "c"].flatMap((t) => [...acc("c", t, 0.8)])
    const p = pairedRead(before, after)
    expect(p.metric).toBe("accuracy")
    expect(p.liftPp).toBeCloseTo(60, 6)
    expect(p.resolvableUp).toBe(true)
    // binary view of the same cells: nothing solved in either arm
    const binary = pairedRead(before.map((c) => ({ ...c, accuracy: null })), after.map((c) => ({ ...c, accuracy: null })))
    expect(binary.metric).toBe("solved")
    expect(binary.liftPp).toBe(0)
  })
  it("a timed-out cell (accuracy null) counts as 0, not as a gap", () => {
    const t = cell("c", "a", 0, false, { accuracy: null, inconclusive: true, error: "execution-timeout" })
    const p = pairedRead([cell("c", "a", 0, true)], [t])
    expect(p.liftPp).toBe(-100)
  })
})

describe("timed-out cells' tokens stay in the token mean", () => {
  it("a recovered timeout raises the arm mean; an unrecoverable one is counted, never zeroed", () => {
    const base = cellsOf("q", "a", 5, 2, { billedTokens: 100, tokens: 100 })
    const timeout = (billed: number | null, tokens: number): H3Cell =>
      cell("q", "a", 9, false, { accuracy: null, inconclusive: true, error: "execution-timeout", billedTokens: billed, tokens })
    const withTokens = compareTargeted(base, [...base, timeout(900, 900)], "r", reasonOf)
    expect(withTokens.after.meanBilledTokens).toBeCloseTo(366.67, 1) // (100+100+900)/3, not 100
    expect(withTokens.after.timeouts).toBe(1)
    const without = compareTargeted(base, [...base, timeout(null, 0)], "r", reasonOf)
    expect(without.after.tokenUnknown).toBe(1)
    expect(without.rationale).toContain("tokens unknown for 0+1 cells")
  })
})

// Replay on the real saved lft/off data (2026-11-18 speedups), when the checkout carries it.
const RESULTS = join(import.meta.dir, "..", "..", "..", "wiki", "Research", "Ablations", "2026-11-18-speedups", "results")
describe.skipIf(!existsSync(join(RESULTS, "lft-h3-gemma4_e4b.json")))("replay: the saved lft case (gemma4:e4b -24.4pp, gate REJECT)", () => {
  const load = (f: string): H3Cell[] => (JSON.parse(readFileSync(join(RESULTS, f), "utf8")) as H3Results).cells
  const before = [...load("off-h3-gemma4_e4b.json"), ...load("off-h3-cogito_14b.json")]
  const after = [...load("lft-h3-gemma4_e4b.json"), ...load("lft-h3-cogito_14b.json")]
  it("is no longer NO-CHANGE: regressed, matching the gate's -24.4pp / SE 16.4 on gemma4:e4b", () => {
    const v = compareTargeted(before, after, "harness:none", reasonOf)
    expect(v.before.solved).toBe(41)
    expect(v.after.solved).toBe(35)
    expect(v.decision).toBe("regressed")
    const gemma = v.paired.tiers.find((t) => t.tier === "gemma4:e4b")!
    expect(gemma.liftPp).toBeCloseTo(-24.4, 0)
    expect(gemma.stdErrPp).toBeCloseTo(16.4, 0)
    expect(gemma.collapsedTasks).toEqual(["h3-exact-value"])
    expect(gemma.mcnemar).toMatchObject({ b: 0, c: 8 })
    expect(v.paired.tiers.find((t) => t.tier === "cogito:14b")!.down).toBe(false)
  })
})
