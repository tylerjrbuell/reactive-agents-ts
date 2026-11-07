// inputCoverage activation + coverage counts per results file, from each cell's trace.
//   compiled    = input-coverage requirements in contract-compiled (0 in the auto arm by design)
//   listed      = inputs the task lists, relative to the bench dir, from listed.json (extracted from
//                 the ic arm's compiled contract) so both arms are measured against the same set
//   readAtEnd   = listed inputs a non-write, non-meta tool call named in its args (ledger tool-invocation
//                 joined to a non-refused tool-result): the isInputRead rule, recomputed so both arms compare
//   underRead   = measured runs that finished with >=1 listed input unread (and how many of those failed)
//   gateDeny    = exit_gate guard-fired, gateDecision deny/deny-once, an outstanding item naming an input
//   aoaInput    = act-or-answer guard-fired whose outstanding names an input
//   forcedReads = distinct inputs first read AFTER a gate denial or act-or-answer force named them
// Inconclusive (aborted) cells are skipped.
//   bun ic-act.ts <results.json>...
import { readFileSync, existsSync } from "node:fs"

type Ev = Record<string, unknown> & { kind: string; seq: number; iter?: number }
type Cell = { taskId: string; traceFile: string | null; accuracy: number | null; inconclusive: boolean }
const LISTED = JSON.parse(readFileSync(new URL("./listed.json", import.meta.url), "utf8")) as Record<string, string[]>
const WRITE = new Set(["file-write", "file-edit", "file-append"])
const META = new Set(["final-answer", "brief", "pulse", "recall", "find", "checkpoint", "think", "task-complete", "get-skill-section"])

for (const file of process.argv.slice(2)) {
  const res = JSON.parse(readFileSync(file, "utf8")) as { cells: Cell[] }
  const byTask = new Map<string, { runs: number; compiled: number; listed: number; readAtEnd: number; underRead: number; underReadFailed: number; gateDeny: number; runsGateDeny: number; aoaInput: number; forcedReads: number; acc: number[] }>()
  for (const c of res.cells) {
    if (c.inconclusive || c.accuracy === null) continue
    const t = byTask.get(c.taskId) ?? { runs: 0, compiled: 0, listed: 0, readAtEnd: 0, underRead: 0, underReadFailed: 0, gateDeny: 0, runsGateDeny: 0, aoaInput: 0, forcedReads: 0, acc: [] }
    byTask.set(c.taskId, t)
    t.runs++
    t.acc.push(c.accuracy)
    if (!c.traceFile || !existsSync(c.traceFile)) continue
    const evs = readFileSync(c.traceFile, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Ev).sort((a, b) => a.seq - b.seq)
    const cc = evs.find((e) => e.kind === "contract-compiled") as { requirements?: Array<{ id: string; kind: string }> } | undefined
    t.compiled += (cc?.requirements ?? []).filter((r) => r.kind === "input-coverage").length
    const listed = LISTED[c.taskId] ?? []
    t.listed += listed.length
    const inv = new Map<string, { name: string; args: string }>()
    const readSeq = new Map<string, number>()
    for (const e of evs) {
      if (e.kind !== "ledger-entry") continue
      for (const x of (e.entries ?? []) as Array<Record<string, unknown>>) {
        if (x.kind === "tool-invocation" && typeof x.toolCallId === "string") inv.set(x.toolCallId, { name: String(x.toolName), args: JSON.stringify(x.args ?? {}) })
        if (x.kind === "tool-result" && typeof x.toolCallId === "string" && x.refused !== true) {
          const i = inv.get(x.toolCallId)
          if (!i || WRITE.has(i.name) || META.has(i.name)) continue
          for (const p of listed) if (i.args.includes(p) && !readSeq.has(p)) readSeq.set(p, e.seq)
        }
      }
    }
    t.readAtEnd += readSeq.size
    if (readSeq.size < listed.length) { t.underRead++; if (c.accuracy < 1) t.underReadFailed++ }
    const namedAt = new Map<string, number>()
    let denied = false
    for (const e of evs) {
      if (e.kind !== "guard-fired") continue
      const m = (e.metadata ?? {}) as { gateDecision?: string; outstanding?: unknown[] }
      const out = (m.outstanding ?? []).map((o) => (typeof o === "string" ? o : JSON.stringify(o)))
      const named = listed.filter((p) => out.some((o) => o.includes(p)))
      if (named.length === 0) continue
      if (e.guard === "exit_gate" && (m.gateDecision === "deny" || m.gateDecision === "deny-once")) { t.gateDeny++; denied = true }
      else if (e.guard === "act-or-answer") t.aoaInput++
      else continue
      for (const p of named) if (!namedAt.has(p)) namedAt.set(p, e.seq)
    }
    if (denied) t.runsGateDeny++
    for (const [p, s] of namedAt) { const r = readSeq.get(p); if (r !== undefined && r > s) t.forcedReads++ }
  }
  for (const [task, t] of byTask) {
    const meanAcc = t.acc.length ? (t.acc.reduce((a, b) => a + b, 0) / t.acc.length).toFixed(2) : "NaN"
    console.log(`${file.split("/").pop()} ${task} runs=${t.runs} acc=${meanAcc} compiled=${t.compiled} listed=${t.listed} readAtEnd=${t.readAtEnd} underReadRuns=${t.underRead} (failed ${t.underReadFailed}) gateDeny=${t.gateDeny} (runs ${t.runsGateDeny}) aoaInput=${t.aoaInput} forcedReads=${t.forcedReads}`)
  }
}
