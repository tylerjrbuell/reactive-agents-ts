// Zero-token trigger census for the calibration-v3 priors ablation.
// The live field that moves for both gate tiers is optimalToolResultChars
// (2000 -> 8000), read as ContextProfile.toolResultMaxChars (the tool-result
// compression budget). It only changes behavior on a tool result longer than
// 2000 chars. This counts, per model, how many recorded non-meta tool results
// are <=2000, 2001..8000, >8000 chars, and how many runs saw one >2000.
//   bun census.ts [traceDir=~/.reactive-agents/traces] [models=qwen3:4b,cogito:8b]
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const dir = process.argv[2] ?? join(process.env.HOME ?? "", ".reactive-agents/traces")
const models = new Set((process.argv[3] ?? "qwen3:4b,cogito:8b").split(","))
const META = new Set(["recall", "final-answer", "find", "brief", "pulse", "checkpoint", "activate-skill", "get-skill-section", "todo"])

type Row = { runs: number; runsOver2k: number; le2k: number; mid: number; gt8k: number; maxLen: number; capped: number; tools: Map<string, number> }
const rows = new Map<string, Row>()
for (const f of readdirSync(dir)) {
  if (!f.endsWith(".jsonl")) continue
  let model: string | undefined
  let over = false
  const lens: number[] = []
  let capped = 0
  const tools: string[] = []
  for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
    if (!line.startsWith("{")) continue
    let e: Record<string, unknown>
    try { e = JSON.parse(line) as Record<string, unknown> } catch { continue }
    if (e.kind === "run-started" && model === undefined && typeof e.model === "string") model = e.model
    if (e.kind === "tool-call-end" && e.ok !== false && typeof e.toolName === "string" && !META.has(e.toolName) && typeof e.result === "string") {
      lens.push(e.result.length)
      if (e.resultTruncated === true) capped++
      if (e.result.length > 2000) { over = true; tools.push(e.toolName) }
    }
  }
  if (model === undefined || !models.has(model)) continue
  const r = rows.get(model) ?? { runs: 0, runsOver2k: 0, le2k: 0, mid: 0, gt8k: 0, maxLen: 0, capped: 0, tools: new Map() }
  r.runs++
  if (over) r.runsOver2k++
  for (const n of lens) {
    if (n <= 2000) r.le2k++
    else if (n <= 8000) r.mid++
    else r.gt8k++
    r.maxLen = Math.max(r.maxLen, n)
  }
  r.capped += capped
  for (const t of tools) r.tools.set(t, (r.tools.get(t) ?? 0) + 1)
  rows.set(model, r)
}
for (const [m, r] of rows) {
  console.log(`${m}: runs=${r.runs} runs-with-result>2000=${r.runsOver2k} results<=2000=${r.le2k} 2001..8000=${r.mid} >8000=${r.gt8k} maxLen=${r.maxLen} traceCapped=${r.capped}`)
  console.log(`  tools with >2000-char results: ${[...r.tools].map(([t, n]) => `${t}:${n}`).join(" ") || "none"}`)
}
