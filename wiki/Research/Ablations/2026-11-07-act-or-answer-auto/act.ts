// Act-or-answer activation counts per results file, read from each cell's trace.
// The kernel tally (result.metadata.extensions.actOrAnswer) is NOT persisted by
// run-h3 or the trace, so counts are re-derived from trace events:
//   forced          = guard-fired {guard: act-or-answer} events (one per forced request)
//   forcedCalled    = of those, metadata.result === "called"
//   forcedAnswered  = metadata.result === "answered" (final-answer only)
//   forcedNoCall    = metadata.result === "no-call"
//   forcedCallOk    = called events whose named tools all have a successful tool-call-end later in the same iteration
//   noCallTurns     = think llm-exchange turns that offered a domain tool, returned no tool call, and were not the last think turn (stall proxy, every arm)
//   mode/source     = run-started.config.mechanisms.actOrAnswer / actOrAnswerSource
//   bun act.ts <results.json>...
import { readFileSync, existsSync } from "node:fs"

type Ev = Record<string, unknown> & { kind: string; seq: number; iter?: number }
type Cell = { cellId: string; tier: string; taskId: string; traceFile: string | null; accuracy: number | null; billedTokens: number | null; tokens: number; durationMs: number; solved: boolean; causeLabel: string }

for (const file of process.argv.slice(2)) {
  const res = JSON.parse(readFileSync(file, "utf8")) as { gitSha: string; cells: Cell[] }
  const tot = { runs: 0, withForce: 0, forced: 0, called: 0, answered: 0, noCall: 0, callOk: 0, noCallTurns: 0, offeredTurns: 0 }
  const modes = new Map<string, number>()
  for (const c of res.cells) {
    tot.runs++
    if (!c.traceFile || !existsSync(c.traceFile)) { modes.set("no-trace", (modes.get("no-trace") ?? 0) + 1); continue }
    const evs = readFileSync(c.traceFile, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Ev).sort((a, b) => a.seq - b.seq)
    const rs = evs.find((e) => e.kind === "run-started") as { config?: { mechanisms?: { actOrAnswer?: unknown; actOrAnswerSource?: unknown } } } | undefined
    const key = `${String(rs?.config?.mechanisms?.actOrAnswer)}/${String(rs?.config?.mechanisms?.actOrAnswerSource)}`
    modes.set(key, (modes.get(key) ?? 0) + 1)
    let f = 0
    evs.forEach((e, i) => {
      if (e.kind !== "guard-fired" || e.guard !== "act-or-answer") return
      f++
      const m = (e.metadata ?? {}) as { result?: string; tools?: string[] }
      if (m.result === "called") {
        tot.called++
        const tools = m.tools ?? []
        const later = evs.slice(i + 1).filter((x) => x.kind === "tool-call-end" && x.iter === e.iter)
        const ok = tools.length > 0 && tools.every((t) => later.some((x) => (x.toolName === t || x.tool === t || x.name === t) && x.ok !== false && x.success !== false && !x.error))
        if (ok) tot.callOk++
      } else if (m.result === "answered") tot.answered++
      else tot.noCall++
    })
    tot.forced += f
    if (f > 0) tot.withForce++
    const lx = evs.filter((e) => e.kind === "llm-exchange" && e.purpose === "think")
    lx.forEach((x, i) => {
      const offered = ((x.toolSchemaNames ?? []) as string[]).filter((n) => n !== "final-answer")
      if (offered.length === 0 || i === lx.length - 1) return
      tot.offeredTurns++
      if ((((x.response ?? {}) as { toolCalls?: unknown[] }).toolCalls?.length ?? 0) === 0) tot.noCallTurns++
    })
  }
  console.log(`${file.split("/").pop()} sha=${res.gitSha.slice(0, 9)} modes=${JSON.stringify(Object.fromEntries(modes))} ${JSON.stringify(tot)}`)
}
