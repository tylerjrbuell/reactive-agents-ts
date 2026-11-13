// Scratch converter v2: N H3 results files -> one SessionReport (variants named by label) for `rax eval gate`.
// Adds RunScore.endStatus (run-completed.status): from the cell if present, else read from the trace file.
//   bun run h3-to-session-v2.ts <out.json> <label>=<results.json> [<label>=<results.json> ...]
import { existsSync, readFileSync, writeFileSync } from "node:fs"

type Cell = { tier: string; taskId: string; accuracy: number | null; status: string; tokens: number; billedTokens: number | null; durationMs: number; inconclusive: boolean; solved: boolean; endStatus?: string | null; traceFile?: string | null }
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

function endStatusOf(c: Cell): string | undefined {
  if (typeof c.endStatus === "string") return c.endStatus
  if (!c.traceFile || !existsSync(c.traceFile)) return undefined
  for (const line of readFileSync(c.traceFile, "utf8").split("\n")) {
    if (!line.includes('"kind":"run-completed"')) continue
    try {
      const e = JSON.parse(line) as { status?: string }
      if (typeof e.status === "string") return e.status
    } catch { /* skip */ }
  }
  return undefined
}

const [outP, ...specs] = process.argv.slice(2)
const reports: unknown[] = []
for (const spec of specs) {
  const [variantId, p] = spec.split("=") as [string, string]
  const cells: Cell[] = JSON.parse(readFileSync(p, "utf8")).cells
  const by = new Map<string, Cell[]>()
  for (const c of cells) by.set(`${c.tier}|${c.taskId}`, [...(by.get(`${c.tier}|${c.taskId}`) ?? []), c])
  for (const [k, cs] of by) {
    const [tier, taskId] = k.split("|")
    const accs = cs.map((c) => c.accuracy ?? 0)
    const m = mean(accs)
    const v = mean(accs.map((a) => (a - m) ** 2))
    reports.push({
      taskId, modelVariantId: tier, variantId, variantLabel: variantId,
      runs: cs.map((c, i) => {
        const es = endStatusOf(c)
        return {
          runIndex: i,
          dimensions: [{ dimension: "accuracy", score: c.accuracy ?? 0, ...(c.inconclusive ? { scoreState: "inconclusive" } : {}) }],
          tokensUsed: c.tokens, billedTokens: c.billedTokens ?? c.tokens, durationMs: c.durationMs,
          status: c.status === "error" ? "error" : "pass", output: "",
          ...(es !== undefined ? { endStatus: es } : {}),
        }
      }),
      meanScores: [{ dimension: "accuracy", score: m }],
      variance: v,
      meanTokens: mean(cs.map((c) => c.tokens)),
      meanBilledTokens: mean(cs.map((c) => c.billedTokens ?? c.tokens)),
      meanDurationMs: mean(cs.map((c) => c.durationMs)),
      passRate: 1, solveRate: cs.filter((c) => c.solved).length / cs.length,
    })
  }
}
writeFileSync(outP!, JSON.stringify({ sessionId: "h3-ablation-fix", sessionVersion: "1", gitSha: "n/a", taskReports: reports, reproducibility: {} }, null, 2))
console.log("wrote", reports.length, "cells")
