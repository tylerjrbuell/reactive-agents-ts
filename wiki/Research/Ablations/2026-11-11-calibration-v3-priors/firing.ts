// Firing check (pre-registered secondary): per tier, task and arm, how many runs had a
// tool result rendered as preview+ref (`result-truncated` ledger entries, FM-17: the
// model did NOT see it in full), and the largest non-meta tool result in the trace.
// The size change (toolResultMaxChars 2000 -> 8000) fires when the committed arm
// truncates and the candidate arm does not.
//   bun firing.ts [matrixDir=./results/matrix]
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs"
import { join } from "node:path"

const root = process.argv[2] ?? join(import.meta.dir, "results/matrix")
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".jsonl") ? [p] : [] })
type Agg = { runs: number; runsTrunc: number; truncEntries: number; maxResult: number }
const rows = new Map<string, Agg>()
for (const arm of ["committed", "candidate"]) {
  const dir = join(root, `traces-${arm}`)
  if (!existsSync(dir)) continue
  for (const f of walk(dir)) {
    // <dir>/<tier>/<variant>/<task>/run<r>/<id>.jsonl
    const parts = f.slice(dir.length + 1).split("/")
    const key = `${parts[0]}\t${parts[2]}\t${arm}`
    const a = rows.get(key) ?? { runs: 0, runsTrunc: 0, truncEntries: 0, maxResult: 0 }
    let trunc = 0
    for (const line of readFileSync(f, "utf8").split("\n")) {
      if (!line.startsWith("{")) continue
      let e: { kind?: string; entries?: Array<{ kind?: string }>; result?: unknown; toolName?: string }
      try { e = JSON.parse(line) } catch { continue }
      if (e.kind === "ledger-entry" && Array.isArray(e.entries)) trunc += e.entries.filter((x) => x.kind === "result-truncated").length
      if (e.kind === "tool-call-end" && typeof e.result === "string" && e.toolName !== "recall" && e.toolName !== "final-answer") a.maxResult = Math.max(a.maxResult, e.result.length)
    }
    a.runs++
    if (trunc > 0) a.runsTrunc++
    a.truncEntries += trunc
    rows.set(key, a)
  }
}
console.log("tier\ttask\tarm\truns\truns-with-truncation\ttruncated-entries\tmax-tool-result-chars")
for (const [k, a] of [...rows].sort()) console.log(`${k}\t${a.runs}\t${a.runsTrunc}\t${a.truncEntries}\t${a.maxResult}`)
