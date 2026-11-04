// File: src/h3/regrade.ts
//
// Re-grade stored H3 cells from their traces and append the deterministic
// grader verdict (`eval-graded`, source `trace-regrade`) to each trace. Lets
// traces recorded before grader-in-trace existed feed `rax diagnose cause`
// without re-running any model.
//
//   bun run src/h3/regrade.ts --results <ABS results.json>[,<ABS results.json>] [--dry-run]
//
// The workspace is rebuilt from the trace: task fixtures, then every successful
// `file-write` the agent made (in trace order), then the hidden fixtures (inside
// `scoreTask`). Grading reuses `scoreTask` itself, so it is the runner's exact
// grader, not a copy.
//
// Safety rails:
//   - Idempotent: a trace that already holds an `eval-graded` event is skipped.
//   - Refuses to append when the re-graded score differs from the accuracy the
//     results file recorded: a reconstruction that disagrees with the live grade
//     would write a false verdict into the trace.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import { loadTrace, type TraceEvent } from "@reactive-agents/trace"
import { scoreTask } from "../judge.js"
import { writeFixtures } from "../runner.js"
import type { BenchmarkTask } from "../types.js"
import { appendEvalGraded, buildEvalGraded, type EvalGradedPayload } from "../eval-graded.js"
import { H3_TASKS } from "./tasks.js"
import { h3SuiteHash } from "./freeze.js"

/** H3 tasks carry no judge dimension; an unreachable URL guarantees no judge call is ever attempted. */
const NO_JUDGE = { judgeUrl: "http://127.0.0.1:1" }

/** Equality tolerance between a re-graded and a recorded score. */
const SCORE_EPSILON = 1e-9

/** Outcome of re-grading one cell. */
export type RegradeStatus =
  | "appended"
  | "would-append"
  | "already-graded"
  | "mismatch"
  | "no-recorded-accuracy"
  | "no-trace"
  | "no-grade"
  | "append-failed"

/** One re-graded cell. */
export interface RegradeOutcome {
  readonly traceFile: string | null
  readonly taskId: string
  readonly status: RegradeStatus
  readonly recorded: number | null
  readonly regraded?: number
  readonly grade?: EvalGradedPayload
  readonly reason?: string
}

/** Input for {@link regradeCell}. */
export interface RegradeCellInput {
  readonly task: BenchmarkTask
  readonly traceFile: string | null
  /** Accuracy the live run recorded; `null` = never measured (refused). */
  readonly recordedAccuracy: number | null
  readonly suiteHash?: string
  /** Compute and compare only; never write the trace. */
  readonly dryRun?: boolean
}

/** Map an agent's file-write path (absolute into a `.bench-run-*` dir, or relative) to a workspace-relative path. */
function workspaceRelative(p: string): string {
  const i = p.search(/\.bench-run-[^/]+\//)
  return i >= 0 ? p.slice(i).replace(/^\.bench-run-[^/]+\//, "") : p.replace(/^\.\//, "")
}

/** Rebuild the agent's working directory from fixtures + the trace's successful file-writes. */
function rebuildWorkspace(task: BenchmarkTask, events: readonly TraceEvent[], dir: string): void {
  writeFixtures(task, dir)
  const root = resolve(dir)
  for (const e of events) {
    if (e.kind !== "tool-call-end" || e.toolName !== "file-write" || e.ok === false) continue
    const args = e.args
    if (typeof args !== "object" || args === null) continue
    const { path, content } = args as { path?: unknown; content?: unknown }
    if (typeof path !== "string" || typeof content !== "string") continue
    const dest = resolve(root, workspaceRelative(path))
    // A path that escapes the workspace is not replayed (never write outside the temp dir).
    if (dest !== root && !dest.startsWith(root + sep)) continue
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, content, "utf8")
  }
}

/**
 * Re-grade one stored cell from its trace and (unless `dryRun`) append the
 * `eval-graded` event. Never throws for a per-cell problem: the outcome's
 * `status` names it.
 */
export async function regradeCell(input: RegradeCellInput): Promise<RegradeOutcome> {
  const { task, traceFile, recordedAccuracy } = input
  const head = { traceFile, taskId: task.id, recorded: recordedAccuracy }
  if (!traceFile || !existsSync(traceFile)) return { ...head, status: "no-trace" }
  const trace = await loadTrace(traceFile)
  if (trace.events.some((e) => e.kind === "eval-graded")) return { ...head, status: "already-graded" }
  if (recordedAccuracy === null) return { ...head, status: "no-recorded-accuracy" }

  const done = trace.events.filter((e) => e.kind === "run-completed").at(-1)
  const output = done?.kind === "run-completed" ? (done.output ?? done.error ?? "") : ""
  const abstained = done?.kind === "run-completed" &&
    (done.terminatedBy === "abstained" || done.outcome?.status === "abstained")
  const terminatedBy = abstained ? "abstained" : done?.kind === "run-completed" ? done.terminatedBy : undefined

  const dir = mkdtempSync(join(tmpdir(), "h3-regrade-"))
  let grade: EvalGradedPayload | undefined
  try {
    rebuildWorkspace(task, trace.events, dir)
    const dims = await scoreTask(output, task, dir, 0, 0, NO_JUDGE, terminatedBy)
    grade = buildEvalGraded(dims, {
      taskId: task.id, source: "trace-regrade",
      ...(input.suiteHash !== undefined ? { suiteHash: input.suiteHash } : {}),
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  if (grade === undefined) return { ...head, status: "no-grade" }
  if (Math.abs(grade.score - recordedAccuracy) > SCORE_EPSILON) {
    return { ...head, status: "mismatch", regraded: grade.score, grade, reason: `regraded ${grade.score} != recorded ${recordedAccuracy}` }
  }
  if (input.dryRun) return { ...head, status: "would-append", regraded: grade.score, grade }
  const r = appendEvalGraded(traceFile, grade)
  return r.appended
    ? { ...head, status: "appended", regraded: grade.score, grade }
    : { ...head, status: "append-failed", regraded: grade.score, grade, reason: r.reason }
}

/** The subset of an H3 results cell the re-grader reads. */
interface ResultsCell {
  readonly taskId: string
  readonly accuracy: number | null
  readonly traceFile: string | null
}

/**
 * Re-grade every cell of one or more H3 results files.
 *
 * @param resultsFiles Absolute paths to `results-<tier>.json` files written by `run-h3.ts`.
 * @param opts `dryRun` computes without writing.
 */
export async function regradeResults(
  resultsFiles: readonly string[],
  opts: { readonly dryRun?: boolean } = {},
): Promise<readonly RegradeOutcome[]> {
  const suiteHash = h3SuiteHash()
  const out: RegradeOutcome[] = []
  for (const file of resultsFiles) {
    const res = JSON.parse(readFileSync(file, "utf8")) as { readonly cells: readonly ResultsCell[] }
    for (const c of res.cells) {
      const task = H3_TASKS.find((t) => t.id === c.taskId)
      if (!task) {
        out.push({ traceFile: c.traceFile, taskId: c.taskId, status: "no-grade", recorded: c.accuracy, reason: "task not in H3_TASKS" })
        continue
      }
      out.push(await regradeCell({ task, traceFile: c.traceFile, recordedAccuracy: c.accuracy, suiteHash, dryRun: opts.dryRun }))
    }
  }
  return out
}

if (import.meta.main) {
  const i = process.argv.indexOf("--results")
  const files = i >= 0 ? (process.argv[i + 1] ?? "").split(",").filter((s) => s.length > 0) : []
  if (files.length === 0) {
    console.error("usage: --results <abs results.json>[,<abs results.json>] [--dry-run]")
    process.exit(2)
  }
  const outcomes = await regradeResults(files, { dryRun: process.argv.includes("--dry-run") })
  const counts: Record<string, number> = {}
  for (const o of outcomes) counts[o.status] = (counts[o.status] ?? 0) + 1
  for (const o of outcomes.filter((x) => x.status === "mismatch" || x.status === "append-failed")) {
    console.error(`[regrade] ${o.status} ${o.taskId} ${o.traceFile}: ${o.reason ?? ""}`)
  }
  console.log(JSON.stringify({ cells: outcomes.length, counts }, null, 2))
  process.exit(0)
}
