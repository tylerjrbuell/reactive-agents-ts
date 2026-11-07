// Per (tier, task, arm) cell table from results files named <arm>-<suite>-<tier>.json.
//   bun summary.ts <results.json>...
import { readFileSync } from "node:fs"
type Cell = { tier: string; taskId: string; accuracy: number | null; solved: boolean; inconclusive: boolean; tokens: number; billedTokens: number | null; durationMs: number; causeLabel: string }
const rows = new Map<string, { accs: number[]; solved: number; inc: number; tok: number[]; billed: number[]; ms: number[]; causes: string[] }>()
for (const f of process.argv.slice(2)) {
  const arm = f.split("/").pop()!.split("-")[0]
  const r = JSON.parse(readFileSync(f, "utf8")) as { cells: Cell[] }
  for (const c of r.cells) {
    const k = `${c.tier}|${c.taskId}|${arm}`
    const row = rows.get(k) ?? { accs: [], solved: 0, inc: 0, tok: [], billed: [], ms: [], causes: [] }
    if (c.inconclusive || c.accuracy === null) row.inc++
    else { row.accs.push(c.accuracy); row.tok.push(c.tokens); row.billed.push(c.billedTokens ?? c.tokens); row.ms.push(c.durationMs) }
    if (c.solved) row.solved++
    row.causes.push(c.causeLabel)
    rows.set(k, row)
  }
}
const mean = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN)
console.log("tier|task|arm|n|inc|meanAcc|accs|solved|meanTok|meanBilled|meanSec|causes")
for (const [k, r] of [...rows.entries()].sort()) {
  console.log(`${k}|${r.accs.length}|${r.inc}|${mean(r.accs).toFixed(2)}|${r.accs.map((a) => a.toFixed(2)).join(",")}|${r.solved}|${Math.round(mean(r.tok))}|${Math.round(mean(r.billed))}|${(mean(r.ms) / 1000).toFixed(0)}|${r.causes.join(",")}`)
}
