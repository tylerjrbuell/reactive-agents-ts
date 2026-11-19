// Addendum 7 scan: per run, solved/acc/iterations, per-iteration file-read/file-write sequence with written values,
// guard-fired histogram (refusal_refund counted), code-execute engagement. bun a7-classify.ts <results.json> [--calls]
import { readFileSync } from "node:fs"
interface Cell { run: number; taskId: string; solved: boolean; accuracy: number | null; billedTokens?: number; tokens: number; iterations: number; durationMs: number; terminatedBy: string; traceFile?: string; causeLabel: string }
interface Ev { kind: string; seq: number; iter?: number; toolName?: string; ok?: boolean; result?: unknown; error?: unknown; args?: { path?: string; content?: string; code?: string }; guard?: string; outcome?: string; reason?: string }
const file = process.argv[2]!
const showCalls = process.argv.includes("--calls")
const cells = (JSON.parse(readFileSync(file, "utf8")) as { cells: Cell[] }).cells
const base = (p?: string) => (p ?? "").split("/").pop() ?? ""
let solved = 0, refundRuns = 0, refunds = 0, engaged = 0, tok = 0
for (const c of cells) {
  const evs: Ev[] = c.traceFile ? readFileSync(c.traceFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Ev) : []
  const guards: Record<string, number> = {}
  let rf = 0
  for (const e of evs) if (e.kind === "guard-fired" && e.outcome !== "pass") { const k = `${e.guard}:${e.outcome}`; guards[k] = (guards[k] ?? 0) + 1 }
  for (const e of evs) if (e.kind === "guard-fired" && e.guard === "refusal_refund") rf++
  const starts = evs.filter((e) => e.kind === "tool-call-start")
  const perIter: Record<number, string[]> = {}
  for (const e of starts) {
    const n = base(e.args?.path)
    const tag = e.toolName === "file-read" ? `R:${n.replace(/\D/g, "") || n}` : e.toolName === "file-write" ? `W:${n.replace(/\D/g, "") || n}=${e.args?.content}` : `${e.toolName}`
    ;(perIter[e.iter ?? 0] ??= []).push(tag)
  }
  const firstWrite = starts.find((e) => e.toolName === "file-write")?.seq ?? Infinity
  const ce = starts.filter((e) => e.toolName === "code-execute")
  const eng = ce.some((e) => e.seq < firstWrite)
  const ceEnds = evs.filter((e) => e.kind === "tool-call-end" && e.toolName === "code-execute")
  if (eng) engaged++
  if (c.solved) solved++
  if (rf > 0) refundRuns++
  refunds += rf
  tok += c.billedTokens ?? c.tokens
  const refusedWrites = evs.filter((e) => e.kind === "tool-call-end" && e.toolName === "file-write" && e.ok === false).length
  const refusedReads = evs.filter((e) => e.kind === "tool-call-end" && e.toolName === "file-read" && e.ok === false).length
  const last: Record<string, string> = {}
  for (const e of evs) if (e.kind === "tool-call-end" && e.toolName === "file-write" && e.ok === true) last[base(e.args?.path)] = String(e.args?.content)
  const EXP = [34, 84, 16, 126, 58, 108]
  const finals = c.taskId === "h3-todo-heavy" ? ` final=[${EXP.map((v, i) => { const w = last[`out-${i + 1}.txt`]; return w === undefined ? "-" : w === String(v) ? "ok" : w }).join(",")}]` : ""
  console.log(`${c.taskId} run${c.run}${finals} refusedWrites=${refusedWrites} refusedReads=${refusedReads} solved=${c.solved} acc=${(c.accuracy ?? 0).toFixed(2)} it=${c.iterations} tok=${c.billedTokens ?? c.tokens} ${Math.round(c.durationMs / 1000)}s term=${c.terminatedBy} cause=${c.causeLabel} refunds=${rf} codeExec=${ce.length}(beforeWrite=${eng};ok=${ceEnds.filter((e) => e.ok).length}) guards=${JSON.stringify(guards)}`)
  if (showCalls) {
    for (const [it, calls] of Object.entries(perIter)) console.log(`   it${it}: ${calls.join(" ")}`)
    for (const e of ceEnds) console.log(`   code-execute -> ok=${e.ok} ${JSON.stringify(e.result ?? e.error).slice(0, 160)}`)
  }
}
console.log(`n=${cells.length} solved=${solved} refundRuns=${refundRuns} refundsGranted=${refunds} codeExecEngaged=${engaged} tok/run=${(tok / cells.length).toFixed(0)}`)
