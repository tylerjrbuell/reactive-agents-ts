// Run: bun run repo test packages/benchmarks/tests/h3-suite-v2.test.ts
//
// H3 suite v2 (additive): rw-2-calc, rw-3-calc, h3-plan-only-calc. Pins that the frozen
// suite is untouched, each v2 task is its source modulo id+tools, the v2 manifest holds,
// the default run set excludes v2, and (zero-token, scripted `test` provider) that
// code-execute is VISIBLE on each calc task and NOT on its frozen source.
import { afterAll, describe, expect, it } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { H3_TASKS } from "../src/h3/tasks.js"
import { H3_V2_TASKS, H3_V2_DERIVATIONS, H3_SELECTABLE_TASKS } from "../src/h3/tasks-v2.js"
import { h3Hashes, h3SuiteHash, h3V2Hashes, h3V2SuiteHash, MANIFEST_PATH, V2_MANIFEST_PATH } from "../src/h3/freeze.js"
import { H3_VARIANT } from "../src/h3/run-h3.js"
import { computeGroundingSet, runSession } from "../src/runner.js"
import type { BenchmarkTask } from "../src/types.js"

type Manifest = { suiteHash: string; tasks: Record<string, string> }
const readManifest = (p: string): Manifest => JSON.parse(readFileSync(p, "utf8")) as Manifest

describe("H3 suite v2 freeze", () => {
  it("frozen suite hash and per-task hashes are unchanged", () => {
    const m = readManifest(MANIFEST_PATH)
    expect(h3SuiteHash()).toBe(m.suiteHash)
    expect(h3Hashes()).toEqual(m.tasks)
    expect(H3_TASKS.length).toBe(12)
  })

  it("v2 tasks match the committed v2 manifest", () => {
    const m = readManifest(V2_MANIFEST_PATH)
    expect(h3V2Hashes()).toEqual(m.tasks)
    expect(h3V2SuiteHash()).toBe(m.suiteHash)
    expect(H3_V2_TASKS.map((t) => t.id)).toEqual(["rw-2-calc", "rw-3-calc", "h3-plan-only-calc"])
  })

  it("v2 ids are not in the frozen default run set", () => {
    const frozen = new Set(H3_TASKS.map((t) => t.id))
    for (const t of H3_V2_TASKS) expect(frozen.has(t.id)).toBe(false)
    expect(H3_SELECTABLE_TASKS.length).toBe(15)
  })

  it("each calc task equals its source modulo id and tools", () => {
    for (const { from, id } of H3_V2_DERIVATIONS) {
      const src = H3_TASKS.find((t) => t.id === from)!
      const v2 = H3_V2_TASKS.find((t) => t.id === id)!
      const { id: _a, tools: _b, ...srcRest } = src
      const { id: _c, tools: _d, ...v2Rest } = v2
      expect(v2Rest).toEqual(srcRest)
    }
  })

  it("tools: required set is unchanged, code-execute is available, never required", () => {
    const req = (t: BenchmarkTask) => (t.tools ?? []).filter((x) => x.kind === "required").map((x) => x.name)
    const rw2 = H3_V2_TASKS.find((t) => t.id === "rw-2-calc")!
    expect(rw2.tools).toEqual([{ kind: "required", name: "file-read" }, { kind: "available", name: "code-execute" }])
    expect(computeGroundingSet(rw2, undefined, [])).toEqual(["file-read"])
    const plan = H3_V2_TASKS.find((t) => t.id === "h3-plan-only-calc")!
    expect(req(plan)).toEqual(["file-read", "file-write"])
    expect(plan.tools).toContainEqual({ kind: "available", name: "code-execute" })
  })
})

describe("H3 suite v2 tool-surface visibility (zero token)", () => {
  const roots: string[] = []
  afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }) })

  /** One scripted run; returns the `visible` list from the first tool-surface-resolved event. */
  async function visibleFor(source: BenchmarkTask): Promise<readonly string[]> {
    // The plan-execute strategy emits no tool-surface-resolved event under a one-line scripted
    // turn. Surface resolution depends on the task's tools/fixtures (run-internal builtins), not
    // on the strategy, so probe the same task on the default react path.
    const task: BenchmarkTask = { ...source, strategy: undefined }
    const traceDir = mkdtempSync(join(tmpdir(), "h3v2-vis-"))
    roots.push(traceDir)
    await runSession({
      id: "h3v2-vis",
      name: "h3 v2 visibility",
      version: "1.0.0",
      taskIds: [task.id],
      tasks: [task],
      models: [{ id: "scripted", provider: "test", model: "test", contextTier: "local", scenarios: { [task.id]: [{ text: "done" }] } }],
      harnessVariants: [H3_VARIANT],
      runs: 1,
      traceDir,
      concurrency: 1,
      timeoutMs: 60_000,
      logLevel: "silent",
    })
    for (const f of readdirSync(traceDir).filter((n) => n.endsWith(".jsonl"))) {
      for (const line of readFileSync(join(traceDir, f), "utf8").split("\n")) {
        if (!line.includes("tool-surface-resolved")) continue
        const e = JSON.parse(line) as { kind: string; visible?: readonly string[] }
        if (e.kind === "tool-surface-resolved") return e.visible ?? []
      }
    }
    return []
  }

  for (const { from, id } of H3_V2_DERIVATIONS) {
    it(`${id}: code-execute visible; ${from}: not`, async () => {
      const v2Vis = await visibleFor(H3_V2_TASKS.find((t) => t.id === id)!)
      const srcVis = await visibleFor(H3_TASKS.find((t) => t.id === from)!)
      console.log(`vis ${id}: ${JSON.stringify(v2Vis)}\nvis ${from}: ${JSON.stringify(srcVis)}`)
      expect(v2Vis).toContain("code-execute")
      expect(srcVis).not.toContain("code-execute")
    }, 120_000)
  }
})
