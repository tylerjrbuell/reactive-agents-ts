// Adapter: H3 results (default + noswitch arms) -> SessionReport for `rax eval gate`.
// usage: bun to-session.ts <out.json> <default-a.json,...> <noswitch-a.json,...>
// Token means use MEASURED cells only: a timed-out cell records 0 tokens, and
// counting it would deflate the arm with more timeouts.
import { readFileSync, writeFileSync } from "node:fs"

type Cell = {
  taskId: string; variant: string; tier: string; run: number; accuracy: number | null
  solved: boolean; status: string; inconclusive: boolean; tokens: number; billedTokens: number | null; durationMs: number
}
type Res = { gitSha: string; cells: Cell[] }

const [out, defFiles, nsFiles] = process.argv.slice(2)
const load = (fs: string): Res[] => fs.split(",").map((f) => JSON.parse(readFileSync(f, "utf8")) as Res)
const all = [...load(defFiles), ...load(nsFiles)]
const shas = new Set(all.map((r) => r.gitSha))
if (shas.size !== 1) { console.error(`SHA mismatch: ${[...shas].join(",")}`); process.exit(2) }
const cells = all.flatMap((r) => r.cells)

const groups = new Map<string, Cell[]>()
for (const c of cells) {
  const key = `${c.tier}\u0000${c.taskId}\u0000${c.variant}`
  groups.set(key, [...(groups.get(key) ?? []), c])
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const taskReports = [...groups.values()].map((cs) => {
  const runs = cs.map((c) => ({
    runIndex: c.run,
    dimensions: [{
      dimension: "accuracy",
      score: c.accuracy ?? 0,
      ...(c.inconclusive || c.accuracy === null ? { scoreState: "inconclusive" } : {}),
    }],
    tokensUsed: c.tokens,
    ...(c.billedTokens !== null ? { billedTokens: c.billedTokens } : {}),
    durationMs: c.durationMs,
    status: c.status === "pass" ? "pass" : c.status === "error" ? "error" : "fail",
    output: "",
  }))
  const measured = cs.filter((c) => !c.inconclusive && c.accuracy !== null)
  return {
    taskId: cs[0].taskId, modelVariantId: cs[0].tier, variantId: cs[0].variant, variantLabel: cs[0].variant,
    runs,
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

writeFileSync(out, JSON.stringify({
  sessionId: "h3-ablate-switch", sessionVersion: "h3-adapter", gitSha: [...shas][0],
  taskReports, reproducibility: {}, runs: [], models: [],
}, null, 2))
console.log(`wrote ${taskReports.length} task-variant cells, sha ${[...shas][0]}`)
