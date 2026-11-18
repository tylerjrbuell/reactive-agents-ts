// Rescore saved H3 results with the new scorers (SCORER_VERSION 2), zero tokens.
//
//   bun wiki/Research/Harness-Reports/2026-11-18-rescore/rescore.ts
//
// Old = the accuracy each results file recorded (scorers v1). New = the same cell
// re-graded by `scoreTask` from its own trace: the workspace is rebuilt from the
// task fixtures plus every successful `file-write`, the hidden fixtures are written
// by `scoreTask`, and the tool provenance is read from the trace. Writes
// rescore.json and README.md beside this file. Never writes to a trace.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve, sep } from "node:path"
import { loadTrace, toolProvenanceOf, type TraceEvent } from "@reactive-agents/trace"
import { scoreTask } from "../../../../packages/benchmarks/src/judge.js"
import { writeFixtures } from "../../../../packages/benchmarks/src/runner.js"
import { H3_TASKS } from "../../../../packages/benchmarks/src/h3/tasks.js"
import { SCORER_VERSION, scorerVersionOf } from "../../../../packages/benchmarks/src/scorer-version.js"
import type { BenchmarkTask } from "../../../../packages/benchmarks/src/types.js"

const HERE = dirname(new URL(import.meta.url).pathname)
const REPORTS = resolve(HERE, "..")
const NO_JUDGE = { judgeUrl: "http://127.0.0.1:1" }
const EPS = 1e-9

/** Tasks whose scorer changed in v2: only these cells may legitimately move. */
const SCORER_CHANGED_TASKS = new Set(["rw-3"])
/** Trap tasks: the decline credit can move them. Any task can move when the run abstained (solvable path). */
const TRAP_TASKS = new Set(["ab-trap-1", "ab-trap-2", "ab-trap-3", "ab-trap-4", "ab-trap-5"])

interface ResultsCell {
  readonly cellId?: string
  readonly taskId: string
  readonly tier?: string
  readonly run?: number
  readonly accuracy: number | null
  readonly status?: string
  readonly inconclusive?: boolean
  readonly terminatedBy?: string
  readonly traceFile?: string | null
}
interface ResultsFile { readonly scorerVersion?: unknown; readonly cells: readonly ResultsCell[] }

type Outcome = "same" | "changed" | "reconstruction-mismatch" | "no-trace" | "not-measured" | "no-task"
interface Row {
  readonly file: string
  readonly taskId: string
  readonly tier: string
  readonly run: number
  readonly terminatedBy: string
  readonly old: number | null
  readonly next: number | null
  readonly outcome: Outcome
  readonly note: string
}

const workspaceRelative = (p: string): string => {
  const i = p.search(/\.bench-run-[^/]+\//)
  return i >= 0 ? p.slice(i).replace(/^\.bench-run-[^/]+\//, "") : p.replace(/^\.\//, "")
}

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
    if (dest !== root && !dest.startsWith(root + sep)) continue
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, content, "utf8")
  }
}

async function rescoreCell(task: BenchmarkTask, traceFile: string): Promise<{ score: number; checks: string }> {
  const trace = await loadTrace(traceFile)
  const done = trace.events.filter((e) => e.kind === "run-completed").at(-1)
  const output = done?.kind === "run-completed" ? (done.output ?? done.error ?? "") : ""
  const abstained = done?.kind === "run-completed" && (done.terminatedBy === "abstained" || done.outcome?.status === "abstained")
  const terminatedBy = abstained ? "abstained" : done?.kind === "run-completed" ? done.terminatedBy : undefined
  const dir = mkdtempSync(join(tmpdir(), "rescore-"))
  try {
    rebuildWorkspace(task, trace.events, dir)
    const dims = await scoreTask(output, task, dir, 0, 0, NO_JUDGE, terminatedBy, toolProvenanceOf(trace))
    const acc = dims.find((d) => d.dimension === "accuracy")
    if (acc === undefined) throw new Error("no accuracy dimension")
    return { score: acc.score, checks: (acc.checks ?? []).filter((c) => !c.passed).map((c) => c.name).join("; ") }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function resultsFiles(): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      if (statSync(p).isDirectory()) { if (/^2026-11-1\d-/.test(relative(REPORTS, p).split(sep)[0] ?? "") || p === REPORTS) walk(p); continue }
      if (!name.endsWith(".json") || /session|targets|gate-report|rescore|manifest/.test(name)) continue
      out.push(p)
    }
  }
  for (const d of readdirSync(REPORTS)) {
    const p = join(REPORTS, d)
    if (/^2026-11-1\d-/.test(d) && statSync(p).isDirectory() && d !== "2026-11-18-rescore") walk(p)
  }
  return out.sort()
}

const mean = (xs: readonly number[]): number => (xs.length === 0 ? Number.NaN : xs.reduce((a, b) => a + b, 0) / xs.length)
const fmt = (n: number): string => (Number.isNaN(n) ? "-" : n.toFixed(3))

async function main(): Promise<void> {
  const rows: Row[] = []
  const skippedFiles: string[] = []
  for (const file of resultsFiles()) {
    let parsed: unknown
    try { parsed = JSON.parse(readFileSync(file, "utf8")) } catch { continue }
    if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as ResultsFile).cells)) continue
    const res = parsed as ResultsFile
    const cells = res.cells.filter((c): c is ResultsCell => typeof c === "object" && c !== null && typeof c.taskId === "string")
    if (cells.length === 0 || !cells.some((c) => "accuracy" in c) || !cells.some((c) => H3_TASKS.some((t) => t.id === c.taskId))) { skippedFiles.push(relative(REPORTS, file)); continue }
    if (scorerVersionOf(res) === SCORER_VERSION) { skippedFiles.push(`${relative(REPORTS, file)} (already v${SCORER_VERSION})`); continue }
    for (const c of cells) {
      const base = { file: relative(REPORTS, file), taskId: c.taskId, tier: c.tier ?? "?", run: c.run ?? 0, terminatedBy: c.terminatedBy ?? "?", old: c.accuracy }
      const task = H3_TASKS.find((t) => t.id === c.taskId)
      if (task === undefined) { rows.push({ ...base, next: null, outcome: "no-task", note: "task not in H3_TASKS" }); continue }
      if (c.accuracy === null || c.inconclusive === true || c.status === "error") { rows.push({ ...base, next: null, outcome: "not-measured", note: c.status ?? "inconclusive" }); continue }
      if (!c.traceFile || !existsSync(c.traceFile)) { rows.push({ ...base, next: null, outcome: "no-trace", note: "trace not on disk" }); continue }
      try {
        const r = await rescoreCell(task, c.traceFile)
        const moved = Math.abs(r.score - c.accuracy) > EPS
        const mayMove = SCORER_CHANGED_TASKS.has(c.taskId) || TRAP_TASKS.has(c.taskId) || c.terminatedBy === "abstained"
        if (moved && !mayMove) rows.push({ ...base, next: c.accuracy, outcome: "reconstruction-mismatch", note: `regraded ${fmt(r.score)} != recorded ${fmt(c.accuracy)}; kept old` })
        else rows.push({ ...base, next: r.score, outcome: moved ? "changed" : "same", note: moved ? r.checks : "" })
      } catch (e) {
        rows.push({ ...base, next: null, outcome: "no-trace", note: `regrade failed: ${e instanceof Error ? e.message : String(e)}` })
      }
    }
  }
  writeFileSync(join(HERE, "rescore.json"), JSON.stringify({ scorerVersionOld: 1, scorerVersionNew: SCORER_VERSION, rows }, null, 2) + "\n")

  // Per (file, task) summary over the cells that were rescored.
  const L: string[] = []
  const files = [...new Set(rows.map((r) => r.file))]
  for (const f of files) {
    const fr = rows.filter((r) => r.file === f)
    const tasks = [...new Set(fr.map((r) => r.taskId))]
    const lines: string[] = []
    for (const t of tasks) {
      const tr = fr.filter((r) => r.taskId === t)
      const scored = tr.filter((r) => r.next !== null && r.old !== null)
      const changed = tr.filter((r) => r.outcome === "changed")
      const mism = tr.filter((r) => r.outcome === "reconstruction-mismatch").length
      const missing = tr.filter((r) => r.outcome === "no-trace" || r.outcome === "no-task").length
      if (changed.length === 0 && mism === 0 && missing === 0) continue
      const o = mean(scored.map((r) => r.old as number)), n = mean(scored.map((r) => r.next as number))
      lines.push(`| ${t} | ${tr[0]!.tier} | ${scored.length} | ${fmt(o)} | ${fmt(n)} | ${fmt(n - o)} | ${changed.length} | ${mism} | ${missing} |`)
    }
    const all = fr.filter((r) => r.next !== null && r.old !== null)
    L.push(`### ${f}\n`)
    L.push(`Cells ${fr.length}, rescored ${all.length}, changed ${fr.filter((r) => r.outcome === "changed").length}. Overall mean old ${fmt(mean(all.map((r) => r.old as number)))} -> new ${fmt(mean(all.map((r) => r.next as number)))}.\n`)
    if (lines.length > 0) {
      L.push("| task | tier | cells | old mean | new mean | delta | changed | recon-mismatch | not rescored |")
      L.push("|---|---|---|---|---|---|---|---|---|")
      L.push(...lines, "")
    } else L.push("No per-task change.\n")
  }
  const changedRows = rows.filter((r) => r.outcome === "changed")
  const cellLines = changedRows.map((r) => `| ${r.file} | ${r.taskId} | ${r.tier} | ${r.run} | ${r.terminatedBy} | ${fmt(r.old as number)} | ${fmt(r.next as number)} | ${r.note.replace(/\|/g, "/")} |`)
  const counts = (o: Outcome): number => rows.filter((r) => r.outcome === o).length
  const readme = `---
type: harness-report
status: complete
created: 2026-11-18
tags: [measurement-overhaul, scorer-version, rescore, h3]
---

# Rescore of saved H3 data: scorers v1 (old) vs v${SCORER_VERSION} (new)

Measurement overhaul items 0.5 and 0.6. Owner approved the comparability break: results carry \`scorerVersion\` (\`packages/benchmarks/src/scorer-version.ts\`, \`SCORER_VERSION = ${SCORER_VERSION}\`); files without it are v1. **Old** is the accuracy the file recorded; **new** is the same cell re-graded from its own trace (\`rescore.ts\`, zero tokens, no live run). Both are published; a v1 number and a v${SCORER_VERSION} number are not comparable cell-for-cell with files of the other version.

What changed in v${SCORER_VERSION}: (1) rw-3 groundedness, outlier and performance checks must be about Engineering (no stray "40%"); (2) abstention on a solvable task no longer zeroes accuracy (accuracy is the task's own check, premature abstention is a separate check); (3) a trap task credits an honest decline that ended \`dispatcher-early-stop\` by text + tool provenance, with the \`abstained\` rail kept as its own check.

Cells: ${rows.length} total; ${counts("same")} unchanged, ${counts("changed")} changed, ${counts("reconstruction-mismatch")} reconstruction mismatches (task scorer unchanged, regrade != recorded: old kept, excluded), ${counts("no-trace")} no trace on disk or regrade failed, ${counts("not-measured")} not measured (timeout or error), ${counts("no-task")} unknown task.

${L.join("\n")}
## Changed cells

${changedRows.length === 0 ? "None." : `| file | task | tier | run | terminatedBy | old | new | failed checks (new) |\n|---|---|---|---|---|---|---|---|\n${cellLines.join("\n")}`}

## Not rescored

- Files skipped (no per-cell accuracy, no H3 task, or already v${SCORER_VERSION}): ${skippedFiles.length === 0 ? "none" : skippedFiles.join(", ")}.
- The lft gemma ab-trap-5 cells named in audit 03 are not rescorable: their traces are not on disk (the lft trace dirs hold h3-exact-value only), so the honest-decline credit shows only on cells whose traces survive.
`
  writeFileSync(join(HERE, "README.md"), readme)
  console.log(`rows ${rows.length}: same ${counts("same")} changed ${counts("changed")} recon-mismatch ${counts("reconstruction-mismatch")} no-trace ${counts("no-trace")} not-measured ${counts("not-measured")}`)
}

await main()
