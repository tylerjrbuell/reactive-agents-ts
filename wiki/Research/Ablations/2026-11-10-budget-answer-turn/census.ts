// Zero-token trigger census for the budget answer turn (kernel/loop/budget-answer-turn.ts).
// Scans EXISTING recorded traces (no model calls). For each run and each budget M, the
// mechanism can fire only if the run reaches its M-th think call (llm-exchange #M, 1-based)
// AND holds >=1 ok tool result before that call. This is an UPPER BOUND: the trace cannot
// show `contractOutstanding` (required tool / write target still open), which blocks it.
//   bun census.ts <traceRoot>...  [--budgets 4,6]
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const argv = process.argv.slice(2)
const bi = argv.indexOf("--budgets")
const budgets = (bi >= 0 ? argv[bi + 1]! : "4,6").split(",").map(Number)
const roots = argv.filter((a, i) => a !== "--budgets" && i !== bi + 1)

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => {
  const p = join(d, f)
  return statSync(p).isDirectory() ? walk(p) : p.endsWith(".jsonl") ? [p] : []
})

type Row = { task: string; file: string; thinks: number; firstOkSeqAfterThink: number; terminatedBy: string; status: string }
const rows: Row[] = []
for (const root of roots) for (const f of walk(root)) {
  const ev = readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>)
  const started = ev.find((e) => e.kind === "run-started")
  if (started && typeof started.depth === "number" && started.depth > 0) continue // root runs only
  const thinks = ev.filter((e) => e.kind === "llm-exchange").map((e) => e.seq as number).sort((a, b) => a - b)
  const okSeq = ev.filter((e) => e.kind === "tool-call-end" && e.ok === true).map((e) => e.seq as number).sort((a, b) => a - b)
  // Index (1-based) of the first think call made AFTER the first ok tool result.
  const firstOk = okSeq[0]
  const idx = firstOk === undefined ? Infinity : thinks.findIndex((s) => s > firstOk) + 1 || Infinity
  const done = ev.find((e) => e.kind === "run-completed")
  const parts = f.split("/")
  const task = parts.find((p) => p.startsWith("h3-") || p === "umami-explore" || p === "wide-metric") ?? parts.at(-3) ?? "?"
  rows.push({ task, file: f, thinks: thinks.length, firstOkSeqAfterThink: idx,
    terminatedBy: String(done?.terminatedBy ?? "none"), status: String(done?.status ?? "none") })
}

const byTask = new Map<string, Row[]>()
for (const r of rows) byTask.set(r.task, [...(byTask.get(r.task) ?? []), r])
console.log(`runs=${rows.length} budgets=${budgets.join(",")} (fires@M: reaches think #M with ok evidence before it; upper bound)`)
console.log(["task", "n", "median-thinks", ...budgets.map((m) => `fires@${m}`), "hit-cap-as-recorded"].join("\t"))
for (const [task, rs] of [...byTask].sort()) {
  const th = rs.map((r) => r.thinks).sort((a, b) => a - b)
  const fires = budgets.map((m) => rs.filter((r) => r.thinks >= m && r.firstOkSeqAfterThink <= m).length)
  const cap = rs.filter((r) => /max_iter/.test(r.terminatedBy)).length
  console.log([task, rs.length, th[Math.floor(th.length / 2)], ...fires, cap].join("\t"))
}
