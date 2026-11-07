// Tally rax-diagnose attribute reasons per (tier, arm) from attr.jsonl.
// Uses the 240 s set for rw-7 and cogito:8b / qwen3:14b lh-debug-green; the 480 s set (lt) for
// qwen3:4b lh-debug-green + lh-enumerate-audit and qwen3:14b lh-enumerate-audit (the gate's pairing).
//   bun attr-tally.ts attr.jsonl
import { readFileSync } from "node:fs"
type Row = { file: string; task: string; acc: number; attr: { reason?: string; alsoMatched?: Array<{ reason?: string } | string> } | null }
const LT = new Set(["qwen3-4b|lh-debug-green", "qwen3-4b|lh-enumerate-audit", "qwen3-14b|lh-enumerate-audit"])
const rows = readFileSync(process.argv[2]!, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Row)
const tally = new Map<string, Map<string, number>>()
const byTask = new Map<string, number>()
for (const r of rows) {
  const [arm, set, ...t] = r.file.split("-")
  const tier = t.join("-")
  const lt = LT.has(`${tier}|${r.task}`)
  if (lt !== (set === "lt")) continue
  if (r.acc >= 1) continue
  const k = `${tier} ${arm}`
  const m = tally.get(k) ?? new Map<string, number>(); tally.set(k, m)
  const reasons = [r.attr?.reason ?? "none", ...(r.attr?.alsoMatched ?? []).map((a) => (typeof a === "string" ? a : a.reason ?? "?"))]
  reasons.forEach((x, i) => m.set(i === 0 ? x : `${x} (also)`, (m.get(i === 0 ? x : `${x} (also)`) ?? 0) + 1))
  const p = `${arm}|${r.task}|${r.attr?.reason ?? "none"}`
  byTask.set(p, (byTask.get(p) ?? 0) + 1)
}
for (const [k, m] of [...tally.entries()].sort()) console.log(k, JSON.stringify([...m.entries()].sort((a, b) => b[1] - a[1])))
console.log("--- primary by arm|task")
for (const [k, n] of [...byTask.entries()].sort()) console.log(k, n)
