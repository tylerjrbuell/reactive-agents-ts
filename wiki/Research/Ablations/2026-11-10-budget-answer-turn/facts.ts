// Post-hoc mechanism facts over trace roots: one line per run, then per (arm, tier, task)
// totals. Path layout: traces-<arm>-<suite>/<tier>/[<variant>/]<task>/run<r>/<id>.jsonl
//   bun facts.ts <traceRoot>... [--rows]
import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { mechanismFacts } from "./facts-lib.ts"

const argv = process.argv.slice(2)
const rows = argv.includes("--rows")
const roots = argv.filter((a) => a !== "--rows")
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => {
  const p = join(d, f)
  return statSync(p).isDirectory() ? walk(p) : p.endsWith(".jsonl") ? [p] : []
})
type Agg = { n: number; fires: number; cap: number; status: Record<string, number>; lastTools: number; verifiedOnFire: number; fireRuns: number; tok: number }
const agg = new Map<string, Agg>()
for (const root of roots) for (const f of walk(root)) {
  const parts = f.split("/")
  const ti = parts.findIndex((p) => p.startsWith("traces-"))
  const [, arm, suite] = parts[ti]!.split("-")
  const tier = parts[ti + 1]!
  const task = parts.at(-3)!
  const suiteTag = suite?.startsWith("h3mi") ? `@mi${suite.slice(4)}` : ""
  const m = mechanismFacts(f)
  const key = `${arm}\t${tier}\t${task}${suiteTag}`
  const a = agg.get(key) ?? { n: 0, fires: 0, cap: 0, status: {}, lastTools: 0, verifiedOnFire: 0, fireRuns: 0, tok: 0 }
  a.n++; a.fires += m.batFires; a.tok += m.tokens
  if (m.batFires > 0) { a.fireRuns++; if (m.verified) a.verifiedOnFire++ }
  if (/max_iter/.test(m.terminatedBy ?? "")) a.cap++
  if (m.lastCallUsedTools) a.lastTools++
  a.status[m.runStatus ?? "none"] = (a.status[m.runStatus ?? "none"] ?? 0) + 1
  agg.set(key, a)
  if (rows) console.log([key, parts.at(-2), `calls=${m.llmCalls}`, `bat=${m.batFires}`, `lastShipped=${m.lastToolsShipped}`, `lastUsedTools=${m.lastCallUsedTools}`,
    `term=${m.terminatedBy}`, `status=${m.runStatus}/${m.outcomeStatus}`, `verified=${m.verified}`, `failed=${m.failedChecks.join(",")}`, `tok=${m.tokens}`].join("\t"))
}
console.log(["arm", "tier", "task", "n", "fireRuns", "verifiedOnFire", "capEnds", "lastCallUsedTools", "status", "meanTok"].join("\t"))
for (const [k, a] of [...agg].sort()) console.log([k, a.n, a.fireRuns, a.verifiedOnFire, a.cap, a.lastTools, JSON.stringify(a.status), Math.round(a.tok / a.n)].join("\t"))
