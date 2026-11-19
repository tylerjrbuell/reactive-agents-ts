// File: src/quick-grade.ts
/**
 * Quick-mode (`runBenchmarks`) pass/fail grading.
 *
 * Before 2026-11-19 quick mode called `matchesExpected(output, task.expected)`,
 * which returns true when `expected` is absent. The five tasks graded by a
 * hidden-check (s1, s2, m1, m4, c3) carry no `expected`, so they auto-passed
 * regardless of output. Session mode grades them through `scoreTask`; quick
 * mode now routes through the same function.
 */
import type { BenchmarkTask } from "./types.js"
import { scoreTask } from "./judge.js"
import { matchesExpected, writeFixtures } from "./run-internal.js"
import { benchRunDirPrefix } from "./bench-dirs.js"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { withFileRoot } from "@reactive-agents/tools"

/** True when the task has some deterministic or judged way to grade accuracy. */
export const hasAccuracyGrader = (task: BenchmarkTask): boolean =>
  task.successCriteria !== undefined || Boolean(task.expected) || task.abstainExpected === true

/**
 * Grade one quick-mode run. Passes only when the accuracy score is a measured
 * 1.0. A task with no grader at all cannot pass (it used to pass vacuously).
 * `tmpDir` must be the directory the agent wrote into.
 */
export const gradeQuickRun = async (
  task: BenchmarkTask,
  output: string,
  tmpDir: string,
  tokensUsed: number,
  iterations: number,
): Promise<boolean> => {
  if (!hasAccuracyGrader(task)) return false
  // Pure keyword tasks need no tmpDir, judge, or fixtures.
  if (task.successCriteria === undefined && task.abstainExpected !== true) {
    return matchesExpected(output, task.expected)
  }
  const dims = await scoreTask(output, task, tmpDir, tokensUsed, iterations)
  const acc = dims.find((d) => d.dimension === "accuracy")
  return acc !== undefined && acc.scoreState !== "inconclusive" && acc.score >= 1
}

/** Per-task sandbox for quick mode: file-write root, fixtures, grading, cleanup. */
export interface QuickSandbox {
  /** Run `fn` with file-write rooted in the sandbox dir. */
  readonly run: <T>(fn: () => Promise<T>) => Promise<T>
  /** Grade the run against the sandbox (hidden checks read files from it). */
  readonly grade: (output: string, tokensUsed: number, iterations: number) => Promise<boolean>
  /** Remove the sandbox dir. */
  readonly dispose: () => void
}

/** Create the sandbox, materializing the task's fixtures, as session mode does. */
export const openQuickSandbox = (task: BenchmarkTask): QuickSandbox => {
  const dir = mkdtempSync(join(process.cwd(), benchRunDirPrefix()))
  writeFixtures(task, dir)
  return {
    run: (fn) => withFileRoot(dir, fn),
    grade: (output, tokensUsed, iterations) => gradeQuickRun(task, output, dir, tokensUsed, iterations),
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  }
}
