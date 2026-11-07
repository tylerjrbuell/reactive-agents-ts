// Adapter: H3 results files (<arm>-<suite>-<tier>.json) -> SessionReport for the lift gate.
// Variant id = arm (off / auto / on), pooled across suites per tier.
// Token means use MEASURED cells only (a timed-out cell records 0 tokens).
//   bun to-session.ts <out.json> <results.json>...
import { readFileSync, writeFileSync } from "node:fs"
type Cell = { taskId: string; tier: string; run: number; accuracy: number | null; solved: boolean; status: string; inconclusive: boolean; tokens: number; billedTokens: number | null; durationMs: number }
type Res = { gitSha: string; cells: Cell[] }
const [out, ...files] = process.argv.slice(2)
const loaded = files.map((f) => ({ arm: f.split("/").pop()!.split("-")[0]!, r: JSON.parse(readFileSync(f, "utf8")) as Res }))
const shas = new Set(loaded.map((x) => x.r.gitSha))
if (shas.size !== 1) { console.error(`SHA mismatch: ${[...shas].join(",")}`); process.exit(2) }
const groups = new Map<string, { arm: string; cells: Cell[] }>()
for (const { arm, r } of loaded) for (const c of r.cells) {
  const key = `${c.tier}\u0000${c.taskId}\u0000${arm}`
  const g = groups.get(key) ?? { arm, cells: [] }
  g.cells.push(c); groups.set(key, g)
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const taskReports = [...groups.values()].map(({ arm, cells: cs }) => {
  const measured = cs.filter((c) => !c.inconclusive && c.accuracy !== null)
  return {
    taskId: cs[0]!.taskId, modelVariantId: cs[0]!.tier, variantId: arm, variantLabel: arm,
    runs: cs.map((c) => ({
      runIndex: c.run,
      dimensions: [{ dimension: "accuracy", score: c.accuracy ?? 0, ...(c.inconclusive || c.accuracy === null ? { scoreState: "inconclusive" } : {}) }],
      tokensUsed: c.tokens, ...(c.billedTokens !== null ? { billedTokens: c.billedTokens } : {}),
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
writeFileSync(out, JSON.stringify({ sessionId: "h3-ablate-act-or-answer-auto", sessionVersion: "h3-adapter", gitSha: [...shas][0], taskReports, reproducibility: {}, runs: [], models: [] }, null, 2))
console.log(`wrote ${taskReports.length} task-arm cells, sha ${[...shas][0]}`)
