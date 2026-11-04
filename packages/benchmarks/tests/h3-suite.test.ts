// H3 frozen-suite tests: freeze integrity, grader soundness (correct workspace
// scores 1.0, empty workspace does not), statistics, and resume/registration.
import { describe, it, expect } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { H3_TASKS } from "../src/h3/tasks.js"
import { h3Hashes, h3SuiteHash, MANIFEST_PATH } from "../src/h3/freeze.js"
import { cellIdOf, runH3 } from "../src/h3/run-h3.js"
import { passHatK, wilson, intervalsDisjoint } from "../src/h3/stats.js"
import { statsFor, summaryLines } from "../src/h3/report.js"
import { scoreTask } from "../src/judge.js"
import { writeFixtures, ALL_TASKS } from "../src/runner.js"
import type { BenchmarkTask } from "../src/types.js"

const task = (id: string): BenchmarkTask => H3_TASKS.find((t) => t.id === id)!
const NO_JUDGE = { judgeUrl: "http://127.0.0.1:1" }

async function accuracy(t: BenchmarkTask, output: string, files: Record<string, string>): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), "h3-test-"))
  try {
    writeFixtures(t, dir)
    for (const [p, c] of Object.entries(files)) writeFileSync(join(dir, p), c)
    const dims = await scoreTask(output, t, dir, 0, 0, NO_JUDGE)
    return dims.find((d) => d.dimension === "accuracy")?.score ?? -1
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe("H3 freeze", () => {
  it("has 12 unique tasks", () => {
    expect(H3_TASKS.length).toBe(12)
    expect(new Set(H3_TASKS.map((t) => t.id)).size).toBe(12)
  })

  it("matches the committed manifest (any task edit must be a deliberate re-freeze)", () => {
    const m = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as { suiteHash: string; tasks: Record<string, string> }
    expect(h3Hashes()).toEqual(m.tasks)
    expect(h3SuiteHash()).toBe(m.suiteHash)
  })

  it("every task has a deterministic grader and no judge dependency", () => {
    for (const t of H3_TASKS) {
      expect(t.dimensionRubrics ?? []).toEqual([])
      const c = t.successCriteria
      const deterministic = t.abstainExpected === true || (c !== undefined && c.type !== "llm-judge")
      expect({ id: t.id, deterministic }).toEqual({ id: t.id, deterministic: true })
    }
  })
})

describe("H3 graders", () => {
  it("h3-plan-only: correct files = 1.0, plan text only = <1", async () => {
    const t = task("h3-plan-only")
    const rows = t.fixtures![0]!.content.split("\n").slice(1).map((l) => l.split(","))
    const low = rows.filter(([, q]) => Number(q) < 10).map(([s]) => s!).sort()
    const total = rows.reduce((a, [, q]) => a + Number(q), 0)
    const good = { "low-stock.txt": low.join("\n"), "totals.json": JSON.stringify({ totalUnits: total, skuCount: rows.length }), "summary.md": "## Reorder\nbuy" }
    expect(await accuracy(t, "done", good)).toBe(1)
    expect(await accuracy(t, "Here is my plan: read, compute, write.", {})).toBeLessThan(1)
  })

  it("h3-todo-heavy: all six doubles = 1.0, none = <1", async () => {
    const t = task("h3-todo-heavy")
    const files: Record<string, string> = {}
    for (const f of t.fixtures!) files[f.path.replace("notes", "out")] = String(Number(f.content) * 2)
    expect(await accuracy(t, "done", files)).toBe(1)
    expect(await accuracy(t, "done", {})).toBeLessThan(1)
  })

  it("h3-required-tools: correct mean = 1.0, wrong mean = <1", async () => {
    const t = task("h3-required-tools")
    const temps = t.fixtures![0]!.content.split("\n").slice(1).map((l) => Number(l.split(",")[1]))
    const mean = temps.reduce((a, b) => a + b, 0) / temps.length
    expect(await accuracy(t, "ok", { "mean.txt": mean.toFixed(2) })).toBe(1)
    expect(await accuracy(t, "ok", { "mean.txt": "99.00" })).toBeLessThan(1)
  })

  it("h3-continuation: right code passes; continuation text and decoy fail", async () => {
    const t = task("h3-continuation")
    expect(await accuracy(t, "The releaseCode is RC-7392-QZ.", {})).toBe(1)
    expect(await accuracy(t, "Let me read the file first.", {})).toBe(0)
    expect(await accuracy(t, "RC-7392-QZ (legacy was RC-0001-AA)", {})).toBe(0)
  })

  it("h3-exact-value: 1343 passes, partial sums fail", async () => {
    const t = task("h3-exact-value")
    expect(await accuracy(t, "The sum is 1343.", {})).toBe(1)
    expect(await accuracy(t, "The sum is 1,343", {})).toBe(1)
    expect(await accuracy(t, "412", {})).toBe(0)
    expect(await accuracy(t, "13430", {})).toBe(0)
  })
})

describe("H3 stats", () => {
  it("wilson matches known values", () => {
    const z = wilson(0, 5)
    expect(z.lo).toBe(0)
    expect(z.hi).toBeCloseTo(0.434, 2)
    const f = wilson(5, 5)
    expect(f.lo).toBeCloseTo(0.566, 2)
    expect(f.hi).toBe(1)
    expect(wilson(0, 0)).toEqual({ lo: 0, hi: 1 })
  })

  it("passHatK follows C(c,k)/C(n,k)", () => {
    expect(passHatK(5, 5, 5)).toBe(1)
    expect(passHatK(5, 4, 5)).toBe(0)
    expect(passHatK(10, 8, 2)).toBeCloseTo((8 * 7) / (10 * 9), 10)
    expect(passHatK(3, 3, 5)).toBeUndefined()
  })

  it("a 20pp gap at n=5 is NOT resolvable (no claim); 0/5 vs 5/5 is", () => {
    expect(intervalsDisjoint(wilson(2, 5), wilson(3, 5))).toBe(false)
    expect(intervalsDisjoint(wilson(0, 5), wilson(5, 5))).toBe(true)
  })

  it("summary lines are greppable and exclude inconclusive cells from n", () => {
    const base = { taskId: "t", variant: "ra-default", tier: "m", accuracy: 1, status: "pass", tokens: 100, billedTokens: 90, durationMs: 1000, iterations: 3, terminatedBy: "end_turn", causeLabel: "none", causeAuthority: "model-final", toolSurface: [], traceFile: null, traceDir: "/x", failureModes: [], honestyLabel: null }
    const cells = [
      { ...base, cellId: "a", run: 0, solved: true, inconclusive: false },
      { ...base, cellId: "b", run: 1, solved: false, inconclusive: false, causeLabel: "stall" },
      { ...base, cellId: "c", run: 2, solved: false, inconclusive: true },
    ]
    const [line] = summaryLines(statsFor(cells))
    expect(line).toContain("H3|m|t|ra-default|n=2|inconclusive=1|solved=1|rate=0.50")
    expect(line).toContain("causes=none:1,stall:1")
  })
})

describe("H3 runner plumbing", () => {
  it("H3 tasks keep the rw-9 id the dispatcher keys on and never touch the global registry", () => {
    expect(H3_TASKS.filter((t) => t.id === "rw-9").length).toBe(1)
    expect((H3_TASKS.find((t) => t.id === "rw-9")!.dimensionRubrics ?? []).length).toBe(0)
    expect(H3_TASKS.some((t) => t.id === "h3-plan-only")).toBe(true)
    expect(ALL_TASKS.some((t) => t.id === "h3-plan-only")).toBe(false)
  })

  it("cell ids distinguish the meta arm and resume skips recorded cells", async () => {
    expect(cellIdOf("m", "t", "ra-default", 2)).toBe("m|t|2")
    expect(cellIdOf("m", "t", "ra-default+meta", 2)).toBe("m|t@ra-default+meta|2")
    expect((await runH3({ out: "rel.json", traceRoot: "/tmp/x", tiers: ["qwen3:4b"], k: 1, budgetSec: 0, cellTimeoutSec: 1 })).error).toMatch(/ABSOLUTE/)
    expect((await runH3({ out: "/tmp/x.json", traceRoot: "/tmp/x", tiers: ["nope:1b"], k: 1, budgetSec: 0, cellTimeoutSec: 1 })).error).toMatch(/unknown tier/)
    const dir = mkdtempSync(join(tmpdir(), "h3-resume-"))
    try {
      const r = await runH3({ out: join(dir, "r.json"), traceRoot: join(dir, "t"), tiers: ["qwen3:4b"], k: 1, budgetSec: 0, cellTimeoutSec: 1, taskFilter: ["h3-exact-value"] })
      expect(r.ran).toBe(0)
      expect(r.remaining).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("H3 measurement policy", () => {
  it("counts execution-timeout as an unsolved measured run; other inconclusives leave the denominator", async () => {
    const { isMeasured } = await import("../src/h3/report.js")
    const base = { cellId: "x", taskId: "t", variant: "ra-default", tier: "m", run: 0, accuracy: null, solved: false, status: "error", tokens: 0, billedTokens: null, durationMs: 1, iterations: null, terminatedBy: null, causeLabel: "no-trace", causeAuthority: null, toolSurface: [], traceFile: null, traceDir: "/x", failureModes: [], honestyLabel: null }
    expect(isMeasured({ ...base, inconclusive: true, error: "execution-timeout" })).toBe(true)
    expect(isMeasured({ ...base, inconclusive: true, error: "capability fallback" })).toBe(false)
    expect(isMeasured({ ...base, inconclusive: false })).toBe(true)
  })
})
