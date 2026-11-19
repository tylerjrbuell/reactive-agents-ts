import { describe, test, expect } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { BENCHMARK_TASKS } from "../src/task-registry.js"
import { gradeQuickRun, hasAccuracyGrader } from "../src/quick-grade.js"
import type { BenchmarkTask } from "../src/types.js"

const HIDDEN_CHECK_IDS = ["s1-fibonacci", "s2-palindrome-bug", "m1-merge-intervals", "m4-remove-duplicates", "c3-test-suite"]
const byId = (id: string): BenchmarkTask => {
  const t = BENCHMARK_TASKS.find((x) => x.id === id)
  if (!t) throw new Error(`missing task ${id}`)
  return t
}
const withDir = async <T>(f: (d: string) => Promise<T>): Promise<T> => {
  const d = mkdtempSync(join(tmpdir(), "quick-grade-"))
  try { return await f(d) } finally { rmSync(d, { recursive: true, force: true }) }
}

describe("quick-mode grading", () => {
  test("hidden-check tasks (no `expected`) are NOT auto-passed on empty work", async () => {
    for (const id of HIDDEN_CHECK_IDS) {
      const task = byId(id)
      expect(task.expected).toBeUndefined()
      expect(hasAccuracyGrader(task)).toBe(true)
      const passed = await withDir((d) => gradeQuickRun(task, "I did it, honest", d, 0, 0))
      expect(passed).toBe(false)
    }
  })

  test("s1 passes only when solution.ts actually computes fibonacci", async () => {
    const task = byId("s1-fibonacci")
    const good = await withDir(async (d) => {
      writeFileSync(join(d, "solution.ts"), "export function fibonacci(n: number): number { let a = 0, b = 1; for (let i = 0; i < n; i++) [a, b] = [b, a + b]; return a }\n")
      return gradeQuickRun(task, "done", d, 0, 0)
    })
    const bad = await withDir(async (d) => {
      writeFileSync(join(d, "solution.ts"), "export function fibonacci(n: number): number { return n }\n")
      return gradeQuickRun(task, "fibonacci done", d, 0, 0)
    })
    expect(good).toBe(true)
    expect(bad).toBe(false)
  })

  test("a task with no grader at all cannot pass vacuously", async () => {
    const t = { id: "x", tier: "simple", name: "x", prompt: "p" } as unknown as BenchmarkTask
    expect(hasAccuracyGrader(t)).toBe(false)
    expect(await withDir((d) => gradeQuickRun(t, "anything", d, 0, 0))).toBe(false)
  })

  test("keyword tasks still grade by `expected`", async () => {
    const t = { id: "k", tier: "simple", name: "k", prompt: "p", expected: "O\\(n\\)|linear" } as unknown as BenchmarkTask
    expect(await withDir((d) => gradeQuickRun(t, "It is linear", d, 0, 0))).toBe(true)
    expect(await withDir((d) => gradeQuickRun(t, "constant", d, 0, 0))).toBe(false)
  })
})
