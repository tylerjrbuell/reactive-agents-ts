// umami-explore call facts from ledger-entry tool-invocation args (deduped by toolCallId):
// umami_get_metrics calls, how many carry a `type` outside the documented set, and any
// write/delete-shaped umami call (create_/update_/delete_/reset_), all unasked by this prompt.
//   bun umami-args.ts <results.json>...
import { existsSync, readFileSync } from "node:fs"

type Ev = Record<string, unknown>
const VALID = new Set(["url", "referrer", "browser", "os", "device", "country", "event"])
const WRITE = /^umami_(create|update|delete|reset)_/
const rows = new Map<string, { runs: number; metricsCalls: number; invalid: number; runsInvalid: number; runsAnyValid: number; writes: string[]; badTypes: Map<string, number> }>()
for (const file of process.argv.slice(2)) {
  const arm = file.split("/").pop()!.split("-")[0]!
  for (const c of (JSON.parse(readFileSync(file, "utf8")) as { cells: Ev[] }).cells) {
    if (c.taskId !== "umami-explore") continue
    const tf = c.traceFile as string | null
    if (!tf || !existsSync(tf)) continue
    const key = `${String(c.tier)} | ${arm}`
    const r = rows.get(key) ?? { runs: 0, metricsCalls: 0, invalid: 0, runsInvalid: 0, runsAnyValid: 0, writes: [], badTypes: new Map() }
    r.runs++
    const seen = new Set<string>()
    let inv = 0, valid = 0
    for (const l of readFileSync(tf, "utf8").split("\n")) {
      if (!l.includes("\"ledger-entry\"")) continue
      for (const en of ((JSON.parse(l) as Ev).entries as Ev[]) ?? []) {
        if (en.kind !== "tool-invocation") continue
        const id = String(en.toolCallId ?? `${String(en.toolName)}:${JSON.stringify(en.args)}`)
        if (seen.has(id)) continue
        seen.add(id)
        const name = String(en.toolName)
        if (WRITE.test(name)) r.writes.push(`${String(c.run)}:${name}`)
        if (name !== "umami_get_metrics") continue
        r.metricsCalls++
        const t = String((en.args as Ev | undefined)?.type ?? "")
        if (VALID.has(t)) valid++; else { inv++; r.badTypes.set(t, (r.badTypes.get(t) ?? 0) + 1) }
      }
    }
    r.invalid += inv; if (inv > 0) r.runsInvalid++; if (valid > 0) r.runsAnyValid++
    rows.set(key, r)
  }
}
console.log("tier | arm | runs | get_metrics calls | invalid type calls | runs with >=1 invalid | runs with >=1 valid type | invalid values | write/delete calls")
for (const [k, r] of [...rows].sort()) console.log([k, r.runs, r.metricsCalls, r.invalid, r.runsInvalid, r.runsAnyValid, [...r.badTypes].map(([t, n]) => `${t}x${n}`).join(",") || "-", r.writes.join(",") || "none"].join(" | "))
