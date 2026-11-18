// Per tier x task x arm table from the run-ab.ts results files, plus lever firing
// counts read from each cell's trace.
//   turns   = H3 cell `iterations` (distinct tool-surface-resolved iters = kernel think turns;
//             a lean final turn still resolves a surface, so it is counted)
//   billed  = billedTokens, wall = durationMs; means over MEASURED cells (not inconclusive)
//   fired   = cells whose trace carries the lever's record
//             pth: harness-signal-injected origin=parallel-tool-hint
//             lft: guard-fired guard=lean_final_turn
//   batched = think turns that issued >= 2 tool calls (tool-call-start per iter)
//   bun analyze.ts <data-dir> [--md]
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

type Cell = { cellId: string; taskId: string; tier: string; run: number; accuracy: number | null; solved: boolean; status: string; inconclusive: boolean; billedTokens: number | null; tokens: number; durationMs: number; iterations: number | null; traceFile: string | null; causeLabel: string }
const dir = process.argv[2]!
const md = process.argv.includes("--md")
const files = readdirSync(dir).filter((f) => /^(off|pth|lft)-h3-.*\.json$/.test(f))
type Row = { tier: string; task: string; arm: string; n: number; solved: number; acc: number; turns: number; billed: number; wall: number; fired: number; batched: number; toolCalls: number; leanTurns: number; hints: number }
const rows: Row[] = []
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)

function traceFacts(f: string | null): { pth: number; lft: number; batched: number; toolCalls: number } {
  if (!f || !existsSync(f)) return { pth: 0, lft: 0, batched: 0, toolCalls: 0 }
  let pth = 0, lft = 0, toolCalls = 0
  const perIter = new Map<number, number>()
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (!line.trim()) continue
    let e: Record<string, unknown>
    try { e = JSON.parse(line) } catch { continue }
    if (e.kind === "harness-signal-injected" && e.origin === "parallel-tool-hint") pth++
    if (e.kind === "guard-fired" && e.guard === "lean_final_turn") lft++
    if (e.kind === "tool-call-start") { toolCalls++; const it = Number(e.iter); perIter.set(it, (perIter.get(it) ?? 0) + 1) }
  }
  return { pth, lft, toolCalls, batched: [...perIter.values()].filter((n) => n >= 2).length }
}

for (const f of files) {
  const arm = f.split("-")[0]!
  const r = JSON.parse(readFileSync(join(dir, f), "utf8")) as { cells: Cell[] }
  const byTask = new Map<string, Cell[]>()
  for (const c of r.cells) byTask.set(c.taskId, [...(byTask.get(c.taskId) ?? []), c])
  for (const [task, cs] of byTask) {
    const m = cs.filter((c) => !c.inconclusive && c.accuracy !== null)
    const facts = m.map((c) => traceFacts(c.traceFile))
    rows.push({
      tier: cs[0]!.tier, task, arm, n: m.length, solved: m.filter((c) => c.solved).length,
      acc: mean(m.map((c) => c.accuracy ?? 0)),
      turns: mean(m.map((c) => c.iterations ?? 0)), billed: mean(m.map((c) => c.billedTokens ?? c.tokens)), wall: mean(m.map((c) => c.durationMs / 1000)),
      fired: facts.filter((x) => (arm === "pth" ? x.pth : arm === "lft" ? x.lft : x.pth + x.lft) > 0).length,
      batched: facts.reduce((a, x) => a + x.batched, 0), toolCalls: mean(facts.map((x) => x.toolCalls)),
      leanTurns: facts.reduce((a, x) => a + x.lft, 0), hints: facts.reduce((a, x) => a + x.pth, 0),
    })
  }
}
const order = { off: 0, pth: 1, lft: 2 } as Record<string, number>
rows.sort((a, b) => a.tier.localeCompare(b.tier) || a.task.localeCompare(b.task) || order[a.arm]! - order[b.arm]!)
const fmt = (x: number, d = 1) => (Number.isNaN(x) ? "-" : x.toFixed(d))
const header = ["tier", "task", "arm", "n", "solved", "mean acc", "mean turns", "mean billed tok", "mean wall s", "tool calls/run", "multi-call turns", "fired runs"]
const line = (r: Row) => [r.tier, r.task, r.arm, r.n, `${r.solved}/${r.n}`, fmt(r.acc, 2), fmt(r.turns, 2), fmt(r.billed, 0), fmt(r.wall, 1), fmt(r.toolCalls, 1), r.batched, r.arm === "off" ? "-" : `${r.fired}/${r.n}`]
if (md) {
  console.log(`| ${header.join(" | ")} |`)
  console.log(`|${header.map(() => " --- ").join("|")}|`)
  for (const r of rows) console.log(`| ${line(r).join(" | ")} |`)
} else for (const r of rows) console.log(line(r).join("\t"))
// Pooled per tier x arm
console.log("")
const tiers = [...new Set(rows.map((r) => r.tier))]
const pooledHeader = ["tier", "arm", "n", "solved", "mean acc", "mean turns", "mean billed tok", "mean wall s", "fired runs"]
if (md) { console.log(`| ${pooledHeader.join(" | ")} |`); console.log(`|${pooledHeader.map(() => " --- ").join("|")}|`) }
for (const t of tiers) for (const arm of ["off", "pth", "lft"]) {
  const rs = rows.filter((r) => r.tier === t && r.arm === arm)
  if (!rs.length) continue
  const n = rs.reduce((a, r) => a + r.n, 0)
  const w = (k: "acc" | "turns" | "billed" | "wall") => rs.reduce((a, r) => a + r[k] * r.n, 0) / n
  const cells = [t, arm, n, `${rs.reduce((a, r) => a + r.solved, 0)}/${n}`, fmt(w("acc"), 3), fmt(w("turns"), 2), fmt(w("billed"), 0), fmt(w("wall"), 1), arm === "off" ? "-" : `${rs.reduce((a, r) => a + r.fired, 0)}/${n}`]
  console.log(md ? `| ${cells.join(" | ")} |` : cells.join("\t"))
}
