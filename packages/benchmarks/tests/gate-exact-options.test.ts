// Run: bun run repo test packages/benchmarks/tests/gate-exact-options.test.ts
//
// Measurement overhaul Phase 0.1 (wiki/Planning/Implementation-Plans/2026-11-18-measurement-overhaul.md):
//  - one gate-options builder shared by `rax eval gate` and `run.ts` (audit 01 D7)
//  - `runsNeeded` fixed (the ~T factor, no z_beta; audit 01 D6) and printed
//  - per-task Fisher p and exact McNemar b,c on receipts, ADDITIVE: the v1 decision is untouched
import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { aggregateRuns } from "../src/runner.js"
import { evaluateLiftGate } from "../src/gate/gate.js"
import { DEFAULT_LIFT_POLICY } from "../src/gate/types.js"
import { formatGateReceipt } from "../src/gate/receipt.js"
import { gateOptionsFor, modelsOfReport } from "../src/gate/options.js"
import { fisherExactP, holmAdjust, mcnemarExactP, pairByRun, pairedLift, runsNeededFor } from "../src/gate/exact.js"
import type { RunScore, SessionReport, TaskVariantReport } from "../src/types.js"

const run = (accuracy: number, i: number): RunScore => ({
  runIndex: i,
  dimensions: [{ dimension: "accuracy", score: accuracy, evidence: "" }],
  tokensUsed: 1000,
  durationMs: 10,
  status: "pass",
})
const cell = (taskId: string, model: string, variantId: string, scores: readonly number[], tokens = 1000): TaskVariantReport => ({
  ...aggregateRuns(taskId, model, { type: "internal", id: variantId, label: variantId, config: {} }, scores.map(run)),
  meanTokens: tokens,
  meanBilledTokens: tokens,
  meanCacheReadTokens: 0,
})
const report = (rows: readonly TaskVariantReport[], extra: object = {}): SessionReport => ({ taskReports: rows, ...extra }) as SessionReport
const ones = (k: number, n: number): number[] => Array.from({ length: n }, (_, i) => (i < k ? 1 : 0))

describe("exact tests", () => {
  it("Fisher exact two-sided p matches hand-computed hypergeometric values", () => {
    expect(fisherExactP(5, 5, 0, 5)).toBeCloseTo(2 / 252, 6)
    expect(fisherExactP(0, 5, 2, 5)).toBeCloseTo(20 / 45, 6)
    expect(fisherExactP(4, 4, 0, 4)).toBeCloseTo(2 / 70, 6)
    expect(fisherExactP(3, 5, 3, 5)).toBeCloseTo(1, 10)
    expect(fisherExactP(0, 0, 3, 5)).toBe(1)
  })
  it("exact McNemar is a two-sided binomial on the discordant pairs", () => {
    expect(mcnemarExactP(0, 5)).toBeCloseTo(0.0625, 6)
    expect(mcnemarExactP(2, 0)).toBeCloseTo(0.5, 6)
    expect(mcnemarExactP(0, 8)).toBeCloseTo(2 / 256, 6)
    expect(mcnemarExactP(0, 0)).toBe(1)
    expect(mcnemarExactP(4, 4)).toBe(1)
  })
  it("Holm adjusts step-down and keeps input order", () => {
    const adj = holmAdjust([0.04, 0.01, 0.5])
    expect(adj[1]).toBeCloseTo(0.03, 10)
    expect(adj[0]).toBeCloseTo(0.08, 10)
    expect(adj[2]).toBeCloseTo(0.5, 10)
  })
  it("pairByRun pairs on run index and counts gains (b) and losses (c)", () => {
    const base = [0, 1, 2, 3].map((index) => ({ index, solved: index < 2 }))
    const cand = [0, 1, 2, 4].map((index) => ({ index, solved: index === 0 || index === 2 || index === 4 }))
    expect(pairByRun(base, cand)).toEqual({ pairs: 3, b: 1, c: 1 })
  })
})

describe("runsNeeded (audit 01 D6)", () => {
  it("scales as 1/T and carries z_beta: 6 tasks need ~1/6 of one task's runs; far below the old ~T-times-too-big figure", () => {
    const one = runsNeededFor(0.5, 3, 1, 1.96)
    const six = runsNeededFor(0.5, 3, 6, 1.96)
    // old formula: 2 * 1.96^2 * 0.25 / 0.03^2 = 2134 regardless of T
    expect(one).toBeGreaterThan(2134)
    expect(six).toBeLessThan(one / 5)
    expect(six).toBe(Math.ceil((2 * (1.96 + 0.8416) ** 2 * 0.25) / (6 * 0.03 ** 2)))
  })
  it("the gate reports it from the real producer, and the receipt prints it", () => {
    const tasks = ["a", "b", "c", "d", "e", "f"]
    const rows = tasks.flatMap((t) => [cell(t, "m", "base", ones(2, 5)), cell(t, "m", "cand", ones(3, 5))])
    const v = evaluateLiftGate(report(rows), "base", "cand")
    expect(v.perTier[0]!.runsNeeded).toBe(runsNeededFor(Math.sqrt((3 / 7) * (4 / 7)), 3, 6, 1.96))
    expect(formatGateReceipt(v)).toContain(`runsNeeded: ${v.perTier[0]!.runsNeeded}/cell`)
  })
})

describe("exact evidence on receipts is additive (v1 decision unchanged)", () => {
  // lft-shaped: one task collapses 5/5 -> 0/5, the rest hold
  const rows = [
    ...["t1", "t2", "t3", "t4", "t5"].flatMap((t) => [cell(t, "m", "off", ones(5, 5)), cell(t, "m", "lft", ones(5, 5))]),
    cell("exact-value", "m", "off", ones(5, 5)),
    cell("exact-value", "m", "lft", ones(0, 5)),
  ]
  it("per-task Fisher p and McNemar b,c are present and printed", () => {
    const v = evaluateLiftGate(report(rows), "off", "lft")
    const ex = v.perTier[0]!.exact!
    const ev = ex.perTask.find((t) => t.taskId === "exact-value")!
    expect(ev).toMatchObject({ baselineSolved: 5, baselineRuns: 5, candidateSolved: 0, candidateRuns: 5 })
    expect(ev.fisherP).toBeCloseTo(2 / 252, 6)
    expect(ex.mcnemar).toMatchObject({ pairs: 30, b: 0, c: 5 })
    const text = formatGateReceipt(v)
    expect(text).toContain("Fisher p=0.0079")
    expect(text).toContain("exact McNemar (run-paired, nominal): +0 gained / -5 lost of 30 pairs, p=0.0625")
  })
  it("v1 decision is unchanged: a 5/5 -> 0/5 collapse (Fisher p=0.0079) still lands where v1 puts it", () => {
    // The pooled 1-sigma band is not cleared (z = 1.0); the exact evidence is shown
    // beside it but no v1 rule reads it (the per-task veto is gate v2's job).
    const v = evaluateLiftGate(report(rows), "off", "lft")
    expect(v.decision).toBe("opt-in")
    expect(v.perTier[0]!.regresses).toBe(false)
  })
  it("the gate's SE is the shared pairedLift estimator", () => {
    const v = evaluateLiftGate(report(rows), "off", "lft")
    const t = v.perTier[0]!
    const shared = pairedLift(t.perTask)
    expect(t.stdErrPp).toBeCloseTo(shared.stdErrPp, 10)
    expect(t.liftPp).toBeCloseTo(shared.liftPp, 10)
  })
})

describe("one gate-options builder for both entry points (audit 01 D7)", () => {
  const models = [
    { id: "cogito:8b", provider: "ollama" },
    { id: "claude-haiku-4-5", provider: "anthropic" },
  ]
  it("ollama tiers are token-free, paid tiers are not; long-horizon tasks are classified", () => {
    const o = gateOptionsFor(models)
    expect(o.isTokenFreeTier?.("cogito:8b")).toBe(true)
    expect(o.isTokenFreeTier?.("claude-haiku-4-5")).toBe(false)
    expect(gateOptionsFor(models, ["claude-haiku-4-5"]).isTokenFreeTier?.("claude-haiku-4-5")).toBe(true)
    expect(o.tasks?.some((t) => t.tags?.includes("horizon:long"))).toBe(true)
  })
  it("modelsOfReport reads the report's models field and ignores junk", () => {
    expect(modelsOfReport({ models: [{ id: "a", provider: "ollama" }, { id: 3 }, null] })).toEqual([{ id: "a", provider: "ollama" }])
    expect(modelsOfReport({})).toEqual([])
    expect(modelsOfReport(null)).toEqual([])
  })
  it("a local tier with +40% tokens PASSES with the shared options and is cost-bound without them", () => {
    const tasks = ["a", "b", "c", "d", "e", "f"]
    const rows = ["cogito:8b", "qwen3:4b"].flatMap((m) =>
      tasks.flatMap((t) => [cell(t, m, "base", ones(0, 30), 1000), cell(t, m, "cand", ones(30, 30), 1400)]),
    )
    const rep = report(rows, { models: [{ id: "cogito:8b", provider: "ollama" }, { id: "qwen3:4b", provider: "ollama" }] })
    const shared = evaluateLiftGate(rep, "base", "cand", DEFAULT_LIFT_POLICY, gateOptionsFor(modelsOfReport(rep)))
    const bare = evaluateLiftGate(rep, "base", "cand", DEFAULT_LIFT_POLICY)
    expect(shared.decision).toBe("default-on")
    expect(bare.decision).not.toBe("default-on")
  })
  // wire it AND pin it: both entry points must call the builder (a unit test of
  // `gateOptionsFor` alone would stay green if either call site were cut).
  it("both entry points call gateOptionsFor", () => {
    const root = join(import.meta.dir, "..", "..", "..")
    const cli = readFileSync(join(root, "apps/cli/src/commands/eval-gate.ts"), "utf8")
    const bench = readFileSync(join(root, "packages/benchmarks/src/run.ts"), "utf8")
    expect(cli).toMatch(/evaluateLiftGate\([^)]*options\)/)
    expect(cli).toContain("gateOptionsFor(modelsOfReport(report)")
    expect(bench).toContain("gateOptionsFor(session.models)")
    // runSession records the tier providers the CLI path needs
    expect(readFileSync(join(root, "packages/benchmarks/src/runner.ts"), "utf8")).toContain("models: session.models.map(")
  })
})
