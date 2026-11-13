// Scratch converter: two H3 results files -> one SessionReport (variants base/head) for `rax eval gate`.
import { readFileSync, writeFileSync } from "node:fs"

const [baseP, headP, outP] = process.argv.slice(2)
type Cell = { tier: string; taskId: string; accuracy: number | null; status: string; tokens: number; billedTokens: number | null; durationMs: number; inconclusive: boolean; solved: boolean }
const load = (p: string): Cell[] => JSON.parse(readFileSync(p!, "utf8")).cells
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

const reports: unknown[] = []
for (const [variantId, p] of [["base", baseP], ["head", headP]] as const) {
  const by = new Map<string, Cell[]>()
  for (const c of load(p!)) {
    const k = `${c.tier}|${c.taskId}`
    by.set(k, [...(by.get(k) ?? []), c])
  }
  for (const [k, cs] of by) {
    const [tier, taskId] = k.split("|")
    const accs = cs.map((c) => c.accuracy ?? 0)
    const m = mean(accs)
    const v = mean(accs.map((a) => (a - m) ** 2))
    reports.push({
      taskId, modelVariantId: tier, variantId, variantLabel: variantId,
      runs: cs.map((c, i) => ({
        runIndex: i,
        dimensions: [{ dimension: "accuracy", score: c.accuracy ?? 0, ...(c.inconclusive ? { scoreState: "inconclusive" } : {}) }],
        tokensUsed: c.tokens, billedTokens: c.billedTokens ?? c.tokens, durationMs: c.durationMs,
        status: c.status === "error" ? "error" : "pass", output: "",
      })),
      meanScores: [{ dimension: "accuracy", score: m }],
      variance: v,
      meanTokens: mean(cs.map((c) => c.tokens)),
      meanBilledTokens: mean(cs.map((c) => c.billedTokens ?? c.tokens)),
      meanDurationMs: mean(cs.map((c) => c.durationMs)),
      passRate: 1, solveRate: cs.filter((c) => c.solved).length / cs.length,
    })
  }
}
writeFileSync(outP!, JSON.stringify({ sessionId: "h3-ablation", sessionVersion: "1", gitSha: "n/a", taskReports: reports, reproducibility: {} }, null, 2))
console.log("wrote", reports.length, "cells")
