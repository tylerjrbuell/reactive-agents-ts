// Verify-check audit helper. For every run behind the results files:
//  (a) claimed-action: each exit-gate unbacked-claim denial, with whether the named tool had
//      ALREADY succeeded before the denial (false positive) or not (true positive), and
//      whether it ran after;
//  (b) measurement: every time/duration figure in the FULL final output (run-completed),
//      the terminal fabricated-measurement verdict, and the arithmetic truth against the
//      only time value the umami tools emit (totaltime 611400 s; visits 5207, visitors 3912,
//      pageviews 12480). Classification of each figure is done by hand from this print.
//   bun audit-scan.ts <results.json>...
import { existsSync, readFileSync } from "node:fs"

type Ev = Record<string, unknown>
const files = process.argv.slice(2)
const TOTAL = 611400
const DENOMS: Record<string, number> = { total: 1, visit: 5207, visitor: 3912, pageview: 12480 }
const UNIT_S: Record<string, number> = { s: 1, sec: 1, secs: 1, second: 1, seconds: 1, min: 60, mins: 60, minute: 60, minutes: 60, h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600, day: 86400, days: 86400 }
const FIG = /(\d[\d,]*(?:\.\d+)?)\s*(seconds|second|secs|sec|s|minutes|minute|mins|min|hours|hour|hrs|hr|h|days|day)\b/gi

for (const file of files) {
  const arm = file.split("/").pop()!.split("-")[0]!
  const res = JSON.parse(readFileSync(file, "utf8")) as { cells: Array<Ev> }
  for (const c of res.cells) {
    const tf = c.traceFile as string | null
    if (!tf || !existsSync(tf)) continue
    let output = ""; const denials: Array<{ ts: number; text: string }> = []; const ends: Array<{ ts: number; tool: string; ok: boolean }> = []
    let measure: string[] = []; let status = "?"
    for (const l of readFileSync(tf, "utf8").split("\n")) {
      if (!l) continue
      const e = JSON.parse(l) as Ev
      if (e.kind === "guard-fired" && e.guard === "exit_gate") for (const o of ((e.metadata as Ev)?.outstanding as string[] | undefined) ?? [])
        if (/never ran successfully/.test(o)) denials.push({ ts: Number(e.timestamp), text: o })
      if (e.kind === "tool-call-end" && typeof e.toolName === "string") ends.push({ ts: Number(e.timestamp), tool: e.toolName, ok: e.success !== false })
      if (e.kind === "verifier-verdict" && e.terminal === true && e.source === "kernel")
        measure = ((e.checks as Ev[]) ?? []).filter((x) => x.name === "output-not-fabricated-measurement" && x.passed === false).map((x) => `[${String(x.severity)}] ${String(x.reason)}`)
      if (e.kind === "run-completed") { output = String(e.output ?? ""); status = `${String(e.status)}/${String((e.outcome as Ev | undefined)?.authority ?? "?")}` }
    }
    const tag = `${String(c.tier)} ${String(c.taskId)} ${arm} run${String(c.run)} ${status}`
    for (const d of denials) {
      const tool = /`([^`]+)` never ran/.exec(d.text)?.[1] ?? "?"
      const before = ends.some((x) => x.tool === tool && x.ok && x.ts <= d.ts)
      const after = ends.some((x) => x.tool === tool && x.ok && x.ts > d.ts)
      console.log(`CLAIM | ${tag} | tool=${tool} succeeded-before-denial=${before} ran-after=${after}`)
    }
    if (c.taskId !== "umami-explore") continue
    const figs: string[] = []
    for (const m of output.matchAll(FIG)) {
      const v = Number(m[1]!.replace(/,/g, "")); const u = UNIT_S[m[2]!.toLowerCase()]
      if (u === undefined || v === 0) continue
      const secs = v * u
      const best = Object.entries(DENOMS).map(([k, d]) => ({ k, rel: Math.abs(secs - TOTAL / d) / (TOTAL / d) })).sort((a, b) => a.rel - b.rel)[0]!
      figs.push(`"${m[0]}" ~ ${best.k} (${(best.rel * 100).toFixed(2)}% off)`)
    }
    if (figs.length || measure.length) console.log(`MEAS | ${tag} | figures: ${figs.join("; ") || "-"} | verdict: ${measure.join("; ") || "pass"}`)
  }
}
