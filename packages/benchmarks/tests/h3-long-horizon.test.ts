// H3 long-horizon suite (Plan 9 0e): freeze integrity, grader soundness, the
// pre-registered metric extraction, the arm flag, and the A1 wiring through the
// real bench builder (scripted `test` provider: zero tokens, zero network).
import { describe, it, expect } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  LH_TASKS,
  LH_MIN_TOOL_CALLS,
  LH_NETWORK_TASKS,
  DEBUG_MODULES,
  INVOICES,
  ORDER_BATCHES,
  invoiceValid,
  pipelineClean,
} from "../src/h3/long-horizon-tasks.js"
import { lhHashes, lhSuiteHash, LH_MANIFEST_PATH } from "../src/h3/freeze.js"
import { LH_A0_VARIANT, LH_A1_VARIANT, cellIdOf, runH3, type H3Cell } from "../src/h3/run-h3.js"
import {
  longHorizonFactsOf,
  longHorizonLine,
  summarizeLongHorizon,
  PROGRESS_WINDOW,
  type LongHorizonFacts,
} from "../src/h3/long-horizon.js"
import { scoreTask } from "../src/judge.js"
import { runSession, writeFixtures } from "../src/runner.js"
import type { BenchmarkTask, ModelVariant } from "../src/types.js"

const task = (id: string): BenchmarkTask => LH_TASKS.find((t) => t.id === id)!
const NO_JUDGE = { judgeUrl: "http://127.0.0.1:1" }
const NEW_IDS = ["lh-debug-green", "lh-enumerate-audit", "lh-pipeline-stages"] as const

async function accuracy(t: BenchmarkTask, files: Record<string, string>): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), "h3-lh-test-"))
  try {
    writeFixtures(t, dir)
    for (const [p, c] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, p)), { recursive: true })
      writeFileSync(join(dir, p), c)
    }
    const dims = await scoreTask("done", t, dir, 0, 0, NO_JUDGE)
    return dims.find((d) => d.dimension === "accuracy")?.score ?? -1
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe("long-horizon suite freeze", () => {
  it("has the six 0e tasks in order", () => {
    expect(LH_TASKS.map((t) => t.id)).toEqual(["rw-4", "rw-7", "lh-1", ...NEW_IDS])
  })

  it("matches the committed manifest (any task edit must be a deliberate re-freeze)", () => {
    const m = JSON.parse(readFileSync(LH_MANIFEST_PATH, "utf8")) as { suiteHash: string; tasks: Record<string, string> }
    expect(lhHashes()).toEqual(m.tasks)
    expect(lhSuiteHash()).toBe(m.suiteHash)
  })

  it("every task has a deterministic grader and no judge dependency", () => {
    for (const t of LH_TASKS) {
      expect({ id: t.id, rubrics: t.dimensionRubrics ?? [] }).toEqual({ id: t.id, rubrics: [] })
      expect({ id: t.id, type: t.successCriteria?.type }).toEqual({ id: t.id, type: "verifiable" })
    }
  })

  it("the new tasks need at least 10 tool calls by design, with cap headroom above that floor", () => {
    for (const id of NEW_IDS) {
      const min = LH_MIN_TOOL_CALLS[id]!
      expect({ id, min: min >= 10 }).toEqual({ id, min: true })
      expect({ id, headroom: (task(id).maxIterations ?? 0) > min }).toEqual({ id, headroom: true })
    }
    expect(Object.keys(LH_MIN_TOOL_CALLS).sort()).toEqual(LH_TASKS.map((t) => t.id).sort())
  })

  it("only the inherited rw-4 and lh-1 need the network", () => {
    expect([...LH_NETWORK_TASKS].sort()).toEqual(["lh-1", "rw-4"])
    for (const id of NEW_IDS) expect(task(id).tools?.some((x) => x.name === "web-search" || x.name === "http-get")).toBe(false)
  })
})

describe("long-horizon graders", () => {
  it("lh-debug-green: buggy tree scores 0, one module fixed is partial, all fixed is 1.0", async () => {
    const t = task("lh-debug-green")
    expect(await accuracy(t, {})).toBe(0)
    const one = await accuracy(t, { "src/clamp.ts": DEBUG_MODULES[0]!.fixed })
    expect(one).toBeGreaterThan(0)
    expect(one).toBeLessThan(0.5)
    const all = Object.fromEntries(DEBUG_MODULES.map((m) => [`src/${m.name}.ts`, m.fixed]))
    expect(await accuracy(t, all)).toBe(1)
  })

  it("lh-debug-green: rewriting the visible tests earns nothing", async () => {
    const t = task("lh-debug-green")
    const cheat = Object.fromEntries(DEBUG_MODULES.map((m) => [`tests/${m.name}.test.ts`, `import { it } from "bun:test"\nit("ok", () => {})\n`]))
    expect(await accuracy(t, cheat)).toBe(0)
  })

  it("lh-enumerate-audit: four invalid invoices, one per rule family", () => {
    expect(INVOICES.length).toBe(12)
    expect(INVOICES.filter((x) => !invoiceValid(x)).length).toBe(4)
  })

  it("lh-enumerate-audit: exact audit = 1.0; all-valid guess and empty dir score < 1", async () => {
    const t = task("lh-enumerate-audit")
    const audit = JSON.stringify(INVOICES.map((x) => ({ id: x.id, valid: invoiceValid(x) })))
    const invalid = INVOICES.filter((x) => !invoiceValid(x)).map((x) => x.id).sort().join("\n")
    expect(await accuracy(t, { "audit.json": audit, "invalid.txt": invalid })).toBe(1)
    const guess = JSON.stringify(INVOICES.map((x) => ({ id: x.id, valid: true })))
    const g = await accuracy(t, { "audit.json": guess, "invalid.txt": "" })
    expect(g).toBeGreaterThan(0)
    expect(g).toBeLessThan(1)
    expect(await accuracy(t, {})).toBe(0)
  })

  it("lh-pipeline-stages: ground truth = 1.0; using the excluded batch or no dedupe scores < 1", async () => {
    const t = task("lh-pipeline-stages")
    const files = (rows: ReadonlyArray<{ orderId: string; region: string; amount: number }>): Record<string, string> => {
      const by: Record<string, { orders: number; total: number }> = {}
      for (const r of rows) {
        const c = by[r.region] ?? { orders: 0, total: 0 }
        by[r.region] = { orders: c.orders + 1, total: Math.round((c.total + r.amount) * 100) / 100 }
      }
      const total = rows.reduce((a, r) => a + r.amount, 0)
      const top = Object.entries(by).sort((a, b) => b[1].total - a[1].total)[0]![0]
      return {
        "clean.csv": ["order_id,region,amount", ...rows.map((r) => `${r.orderId},${r.region},${r.amount.toFixed(2)}`)].join("\n"),
        "by-region.json": JSON.stringify(by),
        "report.md": `# Report\nTotal revenue: ${total.toFixed(2)}\nTop region: ${top}\n`,
      }
    }
    expect(await accuracy(t, files(pipelineClean()))).toBe(1)
    const sloppy = ORDER_BATCHES.flatMap((b) => b.rows).filter((r) => r.amount >= 20)
    expect(await accuracy(t, files(sloppy))).toBeLessThan(1)
    expect(await accuracy(t, {})).toBe(0)
  })
})

// ── metric extraction over synthetic traces ──
const ledger = (iter: number, entries: ReadonlyArray<Record<string, unknown>>) => ({ kind: "ledger-entry", iter, entries })
const result = (tool: string, preview: string, extra: Record<string, unknown> = {}) => ({ kind: "tool-result", toolName: tool, success: true, preview, ...extra })
const done = (iter: number, terminatedBy: string) => ({ kind: "run-completed", iter, terminatedBy, status: "failure" })
const guard = (iter: number, g: string, outcome = "terminate") => ({ kind: "guard-fired", iter, guard: g, outcome, reason: "r" })

describe("longHorizonFactsOf", () => {
  it("cap cutoff WITH progress: cap label and new evidence in the last window", () => {
    const f = longHorizonFactsOf([
      ledger(0, [result("file-read", "a")]),
      ledger(5, [{ kind: "artifact", path: "x.txt", op: "write", digest: "d1" }]),
      done(5, "max_iterations"),
    ])
    expect(f.hitCap).toBe(true)
    expect(f.evidenceIters).toEqual([0, 5])
    expect(f.capCutoffWithProgress).toBe(true)
    expect(f.evidenceSource).toBe("ledger")
  })

  it("cap cutoff WITHOUT progress: evidence stopped before the window", () => {
    const f = longHorizonFactsOf([ledger(1, [result("file-read", "a")]), { kind: "iteration-enter", iter: 9 }, done(9, "max_iterations")])
    expect(f.hitCap).toBe(true)
    expect(f.capCutoffWithProgress).toBe(false)
  })

  it("re-reads, refusals, harness notes, failures and meta tools are not new evidence", () => {
    const f = longHorizonFactsOf([
      ledger(0, [result("file-read", "same")]),
      ledger(1, [result("file-read", "same")]),
      ledger(2, [result("file-read", "x", { refused: true }), result("file-read", "y", { harnessAuthored: true })]),
      ledger(3, [{ ...result("file-read", "z"), success: false }, result("recall", "memo")]),
      done(3, "max_iterations"),
    ])
    expect(f.evidenceIters).toEqual([0])
    expect(f.capCutoffWithProgress).toBe(false)
  })

  it("a stall terminate while evidence grew is a misfire; one after evidence stopped is not", () => {
    const f = longHorizonFactsOf([
      ledger(3, [result("file-read", "a")]),
      guard(4, "loop_resolution"),
      ledger(4, [result("file-read", "b")]),
      guard(9, "stall_deliverable"),
      done(9, "stall_deliverable"),
    ])
    expect(f.stallFires).toBe(2)
    expect(f.stallMisfires).toBe(1)
    expect(f.misfires).toEqual(["loop_resolution@4"])
    expect(f.hitCap).toBe(false)
  })

  // Task #43: a fire is a stall guard the exit gate LET end the run. Before
  // 2026-11-06 the guard emitted `terminate` before the gate decided, so a
  // denied proposal (deny-once) was counted as a fire. Both trace generations
  // resolve through the paired exit_gate event.
  const gate = (iter: number, proposedBy: string, gateDecision: string) =>
    ({ kind: "guard-fired", iter, guard: "exit_gate", outcome: "x", reason: "r", metadata: { proposedBy, gateDecision } })
  for (const [label, deniedOutcome] of [["legacy pre-gate terminate", "terminate"], ["gate-emitted block", "block"]] as const) {
    it(`${label}: a denied stall proposal is not a fire; the later handoff is`, () => {
      const f = longHorizonFactsOf([
        ledger(3, [result("file-read", "a")]),
        guard(4, "loop_resolution", deniedOutcome), gate(4, "loop_resolution", "deny-once"),
        ledger(5, [result("file-read", "b")]),
        guard(6, "stall_deliverable"), gate(6, "stall_deliverable", "handoff"),
        done(6, "harness_deliverable"),
      ])
      expect(f.stallFires).toBe(1)
      expect(f.misfires).toEqual(["stall_deliverable@6"])
    })
  }

  it("the A1 redirect (loop_resolution block) and non-stall guards are not stall fires", () => {
    const f = longHorizonFactsOf([ledger(2, [result("file-read", "a")]), guard(2, "loop_resolution", "block"), guard(2, "terminal_decision"), done(2, "end_turn")])
    expect(f.stallFires).toBe(0)
  })

  it("falls back to distinct tool-call-end results when the trace has no ledger", () => {
    const f = longHorizonFactsOf([
      { kind: "tool-call-end", iter: 0, toolName: "file-read", ok: true, result: "a" },
      { kind: "tool-call-end", iter: 1, toolName: "file-read", ok: true, result: "a" },
      { kind: "tool-call-end", iter: 2, toolName: "file-read", ok: false, result: "e" },
      done(2, "max-iterations:3"),
    ])
    expect(f.evidenceSource).toBe("tool-calls")
    expect(f.evidenceIters).toEqual([0])
    expect(f.hitCap).toBe(true)
    expect(f.capCutoffWithProgress).toBe(false)
  })

  it("window is pre-registered at 2", () => {
    expect(PROGRESS_WINDOW).toBe(2)
  })
})

describe("summarizeLongHorizon", () => {
  const facts = (o: Partial<LongHorizonFacts>): LongHorizonFacts => ({
    lastIter: 10, hitCap: false, evidenceIters: [], evidenceSource: "ledger", capCutoffWithProgress: false,
    stallFires: 0, stallMisfires: 0, misfires: [], ...o,
  })
  const cell = (run: number, solved: boolean, lh: LongHorizonFacts | null, billed: number | null = 1000): H3Cell => ({
    cellId: `m|lh-x@lh-a0|${run}`, taskId: "lh-x", variant: "lh-a0", tier: "m", run, accuracy: solved ? 1 : 0.5, solved,
    status: "pass", inconclusive: false, tokens: 1200, billedTokens: billed, durationMs: 1, iterations: 12, terminatedBy: null,
    causeLabel: "none", causeAuthority: null, toolSurface: [], traceFile: null, traceDir: "/x", failureModes: [], honestyLabel: null,
    longHorizon: lh,
  })

  it("computes pass^k, cap-cutoff-with-progress and stall misfire rates over measured runs", () => {
    const cells = [
      cell(0, true, facts({})),
      cell(1, true, facts({ stallFires: 1 })),
      cell(2, false, facts({ hitCap: true, capCutoffWithProgress: true })),
      cell(3, false, facts({ stallFires: 2, stallMisfires: 1 }), 3000),
      cell(4, true, null, null),
    ]
    const [s] = summarizeLongHorizon(cells, 5)
    expect(s!.n).toBe(5)
    expect(s!.withFacts).toBe(4)
    expect(s!.solved).toBe(3)
    expect(s!.passHatK).toBe(0)
    expect(s!.capHits).toBe(1)
    expect(s!.capCutoffWithProgressRate).toBeCloseTo(0.2, 10)
    expect(s!.stallMisfireRate).toBeCloseTo(0.2, 10)
    expect(s!.stallFireRuns).toBe(2)
    expect(s!.meanBilledTokens).toBe(1500)
    expect(longHorizonLine(s!)).toContain("LH|m|lh-x|lh-a0|n=5|facts=4|solved=3")
    const [all] = summarizeLongHorizon([cell(0, true, facts({})), cell(1, true, facts({}))], 2)
    expect(all!.passHatK).toBe(1)
  })
})

describe("long-horizon arms", () => {
  it("A0 and A1 differ only in the loopProgressAware harness switch", () => {
    const { harness, ...rest } = LH_A1_VARIANT.config
    expect(harness).toEqual({ loopProgressAware: true })
    expect(rest).toEqual(LH_A0_VARIANT.config)
    expect(LH_A0_VARIANT.config.harness).toBeUndefined()
    expect(LH_A0_VARIANT.config.workspace).toBe(true)
  })

  it("cell ids carry the arm; arm and suite flags are validated", async () => {
    expect(cellIdOf("m", "lh-debug-green", "lh-a1", 0)).toBe("m|lh-debug-green@lh-a1|0")
    const dir = mkdtempSync(join(tmpdir(), "h3-lh-arm-"))
    try {
      const base = { out: join(dir, "r.json"), traceRoot: join(dir, "t"), tiers: ["qwen3:4b"], k: 1, budgetSec: 0, cellTimeoutSec: 1 }
      expect((await runH3({ ...base, arm: "a1" })).error).toMatch(/needs --suite long-horizon/)
      expect((await runH3({ ...base, suite: "long-horizon", arm: "zz" })).error).toMatch(/unknown arm/)
      expect((await runH3({ ...base, suite: "long-horizon", noSwitch: true })).error).toMatch(/do not apply/)
      const r = await runH3({ ...base, suite: "long-horizon", arm: "a1" })
      expect(r).toEqual({ ran: 0, remaining: LH_TASKS.length })
      writeFileSync(base.out, JSON.stringify({ suite: "h3", version: "1", gitSha: "x", taskHashes: {}, k: 1, cells: [] }))
      expect((await runH3({ ...base, suite: "long-horizon" })).error).toMatch(/holds suite h3/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("A1 wiring through the bench builder (scripted test provider)", () => {
  const model: ModelVariant = {
    id: "scripted-test", provider: "test", model: "test", contextTier: "local",
    scenarios: { "lh-enumerate-audit": [{ text: "I cannot complete this." }] },
  }

  async function mechanisms(variant: typeof LH_A0_VARIANT): Promise<Record<string, unknown>> {
    const traceDir = mkdtempSync(join(tmpdir(), "h3-lh-wire-"))
    try {
      await runSession({
        id: "h3-lh-wire", name: "wire", version: "0", taskIds: ["lh-enumerate-audit"], tasks: LH_TASKS,
        models: [model], harnessVariants: [variant], runs: 1, traceDir, concurrency: 1, timeoutMs: 60_000, logLevel: "silent",
      })
      const file = readdirSync(traceDir).find((f) => f.endsWith(".jsonl"))
      expect(file).toBeDefined()
      const started = readFileSync(join(traceDir, file!), "utf8").trim().split("\n")
        .map((l) => JSON.parse(l) as { kind: string; config?: { mechanisms?: Record<string, unknown> } })
        .find((e) => e.kind === "run-started")
      return started?.config?.mechanisms ?? {}
    } finally {
      rmSync(traceDir, { recursive: true, force: true })
    }
  }

  it("A1 runs with loopProgressAware on; A0 runs with it off", async () => {
    expect((await mechanisms(LH_A1_VARIANT)).loopProgressAware).toBe(true)
    expect((await mechanisms(LH_A0_VARIANT)).loopProgressAware).not.toBe(true)
  }, 120_000)
})
