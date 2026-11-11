// Adapter: results files (<arm>-<suite>-<tier>.json; H3 rows and run-custom.ts rows) -> SessionReport
// for the lift gate. Copied from ../2026-11-10-family-disclosure-compact-facts/to-session.ts.
// Changes:
// - H3 budget-tight files (<arm>-h3mi<N>-...) tag the task id <task>@mi<N> (run-custom.ts rows
//   already carry it).
// - A provider failure (H3 causeLabel provider-error, or a trace that ended llm_error) is
//   INCONCLUSIVE, never a measured 0: it says nothing about the harness.
// - ABL_SNAPSHOT_SHA: every arm ran the frozen src snapshot (arm-plugin.ts), so a results
//   file's gitSha is only the live HEAD when the file was created. HEAD moved mid-run (other
//   wardens committed). With ABL_SNAPSHOT_SHA set, the session carries that SHA and the
//   observed file SHAs are printed instead of aborting.
// Variant id = arm (on / off), pooled across suites per tier.
// Token means use MEASURED cells only (a timed-out cell records 0 tokens).
//   [ABL_SNAPSHOT_SHA=<sha>] bun to-session.ts <out.json> <sessionId> <task,csv|-> <results.json>...
import { readFileSync, writeFileSync } from "node:fs"
type Cell = { taskId: string; tier: string; run: number; accuracy: number | null; solved: boolean; status: string; inconclusive: boolean; tokens: number; billedTokens: number | null; durationMs: number; causeLabel?: string; terminatedBy?: string | null }
type Res = { gitSha: string; cells: Cell[] }
const [out, sessionId, taskCsv, ...files] = process.argv.slice(2)
const taskSet = taskCsv && taskCsv !== "-" ? new Set(taskCsv.split(",")) : undefined
const loaded = files.map((f) => {
  const name = f.split("/").pop()!
  const [arm, suite] = name.split("-")
  const tag = suite?.startsWith("h3mi") ? `@mi${suite.slice(4)}` : ""
  return { arm: arm!, tag, r: JSON.parse(readFileSync(f, "utf8")) as Res }
})
const shas = new Set(loaded.map((x) => x.r.gitSha))
const pinned = process.env.ABL_SNAPSHOT_SHA
if (shas.size !== 1 && !pinned) { console.error(`SHA mismatch: ${[...shas].join(",")}`); process.exit(2) }
const sha = pinned ?? [...shas][0]!
if (pinned) console.log(`snapshot sha ${pinned}; results-file HEADs observed: ${[...shas].join(", ")}`)
const groups = new Map<string, { arm: string; taskId: string; cells: Cell[] }>()
let voided = 0
for (const { arm, tag, r } of loaded) for (const raw of r.cells) {
  const providerFault = raw.causeLabel === "provider-error" || raw.terminatedBy === "llm_error"
  if (providerFault) voided++
  const c: Cell = providerFault ? { ...raw, inconclusive: true } : raw
  const taskId = `${c.taskId}${tag}`
  if (taskSet && !taskSet.has(taskId)) continue
  const key = `${c.tier}\u0000${taskId}\u0000${arm}`
  const g = groups.get(key) ?? { arm, taskId, cells: [] }
  g.cells.push(c); groups.set(key, g)
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const taskReports = [...groups.values()].map(({ arm, taskId, cells: cs }) => {
  const measured = cs.filter((c) => !c.inconclusive && c.accuracy !== null)
  return {
    taskId, modelVariantId: cs[0]!.tier, variantId: arm, variantLabel: arm,
    runs: cs.map((c) => ({
      runIndex: c.run,
      dimensions: [{ dimension: "accuracy", score: c.accuracy ?? 0, ...(c.inconclusive || c.accuracy === null ? { scoreState: "inconclusive" } : {}) }],
      tokensUsed: c.tokens, ...(c.billedTokens !== null && c.billedTokens !== undefined ? { billedTokens: c.billedTokens } : {}),
      durationMs: c.durationMs, status: c.status === "pass" ? "pass" : c.status === "error" ? "error" : "fail", output: "",
    })),
    meanScores: [{ dimension: "accuracy", score: mean(measured.map((c) => c.accuracy ?? 0)) }],
    variance: 0,
    meanTokens: mean(measured.map((c) => c.tokens)),
    meanBilledTokens: mean(measured.map((c) => c.billedTokens ?? c.tokens)),
    meanCacheReadTokens: 0,
    meanDurationMs: mean(cs.map((c) => c.durationMs)),
    passRate: mean(cs.map((c) => (c.status === "pass" ? 1 : 0))),
    solveRate: mean(measured.map((c) => (c.solved ? 1 : 0))),
  }
})
writeFileSync(out, JSON.stringify({ sessionId, sessionVersion: "h3-adapter", gitSha: sha, taskReports, reproducibility: {}, runs: [], models: [] }, null, 2))
console.log(`wrote ${taskReports.length} task-arm cells, sha ${sha}, provider-fault cells voided: ${voided}`)
for (const t of [...taskReports].sort((a, b) => `${a.modelVariantId}${a.taskId}${a.variantId}`.localeCompare(`${b.modelVariantId}${b.taskId}${b.variantId}`)))
  console.log(`  ${t.modelVariantId}\t${t.taskId}\t${t.variantId}\tn=${t.runs.length}\tacc=${t.meanScores[0]!.score.toFixed(3)}\ttok=${Math.round(t.meanTokens)}`)
