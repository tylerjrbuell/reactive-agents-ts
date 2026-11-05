// Per-arm/tier/task metrics from H3 results + traces.
// usage: bun metrics.ts <results.json> [more.json...]
import { readFileSync, existsSync } from "node:fs"

type Cell = {
  taskId: string; variant: string; tier: string; run: number; accuracy: number | null; solved: boolean
  inconclusive: boolean; billedTokens: number | null; tokens: number; causeLabel: string; traceFile: string | null
}
type Ev = { kind?: string; seq?: number }

const rows: Array<Record<string, unknown>> = []
for (const f of process.argv.slice(2)) {
  const r = JSON.parse(readFileSync(f, "utf8")) as { cells: Cell[] }
  for (const c of r.cells) {
    let llm: number | null = null, sw = 0, llmAfter = 0, toolsAfter = 0, runConfig = ""
    if (c.traceFile && existsSync(c.traceFile)) {
      const evs: Ev[] = readFileSync(c.traceFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Ev)
      llm = evs.filter((e) => e.kind === "llm-exchange").length
      const sws = evs.filter((e) => e.kind === "strategy-switched")
      sw = sws.length
      if (sws.length) {
        const s0 = sws[0].seq ?? 0
        llmAfter = evs.filter((e) => e.kind === "llm-exchange" && (e.seq ?? 0) > s0).length
        toolsAfter = evs.filter((e) => e.kind === "tool-call-start" && (e.seq ?? 0) > s0).length
      }
      const rs = evs.find((e) => e.kind === "run-started") as (Ev & { config?: Record<string, unknown> }) | undefined
      runConfig = JSON.stringify(rs?.config ?? {}).match(/"[^"]*[Ss]witch[^"]*":[^,}]*/g)?.join(";") ?? ""
    }
    rows.push({ tier: c.tier, arm: c.variant, task: c.taskId, run: c.run, acc: c.accuracy, solved: c.solved,
      inc: c.inconclusive, billed: c.billedTokens ?? c.tokens, llm, sw, llmAfter, toolsAfter, cause: c.causeLabel, runConfig })
  }
}
console.log(JSON.stringify(rows))
