// Regression compare: new default-arm run vs the v0.19-final cogito baseline (final + rerun pooled, n=10/task),
// both at scorerVersion 2. Baseline accuracy = recorded accuracy, replaced by the rescore.json "new" value for
// the 31 cells the v2 scorer changed. `solved` for baseline is accuracy >= 1 (v2 solved flags are not stored in
// rescore rows; every changed baseline cell here is a partial-credit move, so a changed cell is solved only if new>=1).
// bun regression-compare.ts <newRun.json>
import { readFileSync } from "node:fs"

const H = "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/wiki/Research/Harness-Reports"
interface Cell { taskId: string; run: number; accuracy: number | null; solved: boolean; billedTokens?: number; tokens: number; iterations: number; durationMs: number; causeLabel: string }
const load = (p: string): Cell[] => JSON.parse(readFileSync(p, "utf8")).cells
const rescore = JSON.parse(readFileSync(`${H}/2026-11-18-rescore/rescore.json`, "utf8")) as { rows: Array<Record<string, unknown>> }
const baseFiles = ["final-cogito-8b.json", "rerun-cogito-8b.json"]
const baseline: Array<Cell & { acc2: number; solved2: boolean }> = []
for (const f of baseFiles) {
  const rel = `2026-11-18-h3-v0.19-final/${f}`
  const changed = new Map<string, number>()
  for (const r of rescore.rows) {
    const file = String(r.file ?? r.path ?? "")
    if (file !== rel) continue
    if (r.outcome === "same") continue
    changed.set(`${r.taskId}|${r.run}`, Number(r.next))
  }
  for (const c of load(`${H}/${rel}`)) {
    const n = changed.get(`${c.taskId}|${c.run}`)
    const acc2 = n !== undefined && Number.isFinite(n) ? n : (c.accuracy ?? 0)
    baseline.push({ ...c, acc2, solved2: n !== undefined && Number.isFinite(n) ? n >= 1 : c.solved })
  }
}
const cur = load(process.argv[2]!)
const tasks = [...new Set([...baseline.map((c) => c.taskId), ...cur.map((c) => c.taskId)])]
const mean = (x: number[]): number => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN)
console.log(`baseline cells ${baseline.length} (rescored changed rows: ${rescore.rows.filter((r) => String(r.file ?? r.path ?? "").includes("v0.19-final/") && String(r.file ?? r.path ?? "").includes("cogito")).length}), new cells ${cur.length}`)
console.log("task | base solved (n) | base acc2 | new solved (n) | new acc | base tok/run | new tok/run | base turns | new turns | base s | new s")
let bs = 0, bn = 0, ns = 0, nn = 0, ba = 0, na = 0
for (const t of tasks) {
  const b = baseline.filter((c) => c.taskId === t)
  const n = cur.filter((c) => c.taskId === t)
  bs += b.filter((c) => c.solved2).length; bn += b.length; ns += n.filter((c) => c.solved).length; nn += n.length
  ba += b.reduce((s, c) => s + c.acc2, 0); na += n.reduce((s, c) => s + (c.accuracy ?? 0), 0)
  console.log(`${t} | ${b.filter((c) => c.solved2).length}/${b.length} | ${mean(b.map((c) => c.acc2)).toFixed(2)} | ${n.filter((c) => c.solved).length}/${n.length} | ${mean(n.map((c) => c.accuracy ?? 0)).toFixed(2)} | ${mean(b.map((c) => c.billedTokens ?? c.tokens)).toFixed(0)} | ${mean(n.map((c) => c.billedTokens ?? c.tokens)).toFixed(0)} | ${mean(b.map((c) => c.iterations)).toFixed(1)} | ${mean(n.map((c) => c.iterations)).toFixed(1)} | ${(mean(b.map((c) => c.durationMs)) / 1000).toFixed(0)} | ${(mean(n.map((c) => c.durationMs)) / 1000).toFixed(0)}`)
}
console.log(`ALL | ${bs}/${bn} | ${(ba / bn).toFixed(3)} | ${ns}/${nn} | ${(na / nn).toFixed(3)}`)
