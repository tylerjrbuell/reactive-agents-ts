// Outcome mix per (tier, arm): kernel outcome status (completed / partial / failed), caller-visible
// success, non-empty answer, budget-answer-turn fires, and on fired runs: verified, and whether the
// answer turn still produced tool calls (the model ignored "no tools on this turn").
// Reads the results JSONs (custom rows carry facts; H3 rows are re-read from their traces).
//   bun outcomes.ts <results.json>...
import { readFileSync } from "node:fs"
import { mechanismFacts } from "./facts-lib.ts"

type Row = { tier: string; arm: string; task: string; outcome: string; success: boolean; answered: boolean; fired: boolean; verified: boolean | null; lastUsedTools: boolean | null; tokens: number }
const rows: Row[] = []
for (const f of process.argv.slice(2)) {
  const name = f.split("/").pop()!
  const [arm, suite] = name.split("-")
  const tag = suite?.startsWith("h3mi") ? `@mi${suite.slice(4)}` : ""
  const r = JSON.parse(readFileSync(f, "utf8")) as { cells: Array<Record<string, unknown>> }
  for (const c of r.cells) {
    const m = mechanismFacts((c.traceFile as string | null) ?? null)
    const ev = c.traceFile ? readFileSync(c.traceFile as string, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>) : []
    const done = ev.find((e) => e.kind === "run-completed")
    const out = String(done?.output ?? c.output ?? "")
    rows.push({ tier: String(c.tier), arm: arm!, task: `${c.taskId}${tag}`, outcome: m.outcomeStatus ?? "none", success: m.runStatus === "success",
      answered: out.trim().length > 0, fired: m.batFires > 0, verified: m.verified, lastUsedTools: m.lastCallUsedTools, tokens: m.tokens })
  }
}
const key = (r: Row) => `${r.tier}\t${r.arm}`
const groups = new Map<string, Row[]>()
for (const r of rows) groups.set(key(r), [...(groups.get(key(r)) ?? []), r])
console.log(["tier", "arm", "n", "completed", "partial", "failed", "other", "callerSuccess", "nonEmptyAnswer", "fired", "firedVerified", "firedAnswerTurnCalledTools"].join("\t"))
for (const [k, rs] of [...groups].sort()) {
  const cnt = (p: (r: Row) => boolean) => rs.filter(p).length
  const fired = rs.filter((r) => r.fired)
  console.log([k, rs.length, cnt((r) => r.outcome === "completed"), cnt((r) => r.outcome === "partial"), cnt((r) => r.outcome === "failed"),
    cnt((r) => !["completed", "partial", "failed"].includes(r.outcome)), cnt((r) => r.success), cnt((r) => r.answered),
    fired.length, fired.filter((r) => r.verified === true).length, fired.filter((r) => r.lastUsedTools === true).length].join("\t"))
}
