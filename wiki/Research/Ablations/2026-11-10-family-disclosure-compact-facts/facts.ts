// Per-run facts from the traces behind results files (arm = file-name prefix).
// Prints the turn-0 SHIPPED tool list (guard-fired wire-request toolsShipped) per
// (tier, task, arm) BEFORE any token reading, then outcome / cost / behaviour metrics
// and the verify-check audit rows (exit-gate unbacked-claim denials, terminal
// fabricated-measurement and unbacked-action-claim checks).
//   bun facts.ts [--lists] [--audit] [--json <out>] <results.json>...
import { existsSync, readFileSync, writeFileSync } from "node:fs"

type Ev = Record<string, unknown>
const argv = process.argv.slice(2)
const jsonOut = argv.includes("--json") ? argv[argv.indexOf("--json") + 1] : undefined
const files = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--json")
const showLists = argv.includes("--lists")
const showAudit = argv.includes("--audit")

// Write/delete-shaped tools: name contains one of these words.
const MUTATING = /(^|[_/-])(create|update|delete|reset|put|apply|send|post|open|close|file|refund|trigger|rollout|append|export|resolve|reply)([_/-]|$)/
// "Asked the user instead of acting": the answer ends on a question / menu AND no data tool ran
// beyond listing websites or discovery. Hand-checked against every grok-4 umami output.
const ASKED = /\?\s*$|\bwhat would you like\b|\bwhich (?:one|site|website|metric|of these|would you)\b|\blet me know\b|\bwould you like (?:me )?to\b|\bdo you want\b|\bplease (?:specify|tell|let)\b|\breply with\b|\byour preference\b/i

export interface RunFacts {
  tier: string; task: string; arm: string; run: number; acc: number | null; inconclusive: boolean; cellStatus: string
  ship0: string[]; ship0n: number; vis0n: number; iters: number; llmCalls: number; tokIn: number; tokOut: number; cacheRead: number
  llmMs: number[]; wallMs: number; called: string[]; invalidArgs: number; invalidSamples: string[]; mutatingCalled: string[]
  asked: boolean; status: string; authority: string; terminatedBy: string; output: string
  exitUnbacked: string[]; termUnbacked: Array<{ severity: string; reason: string }>; termMeasure: Array<{ severity: string; reason: string }>
  verified: boolean | null; traceFile: string
}

function factsOf(traceFile: string, c: Ev, arm: string): RunFacts {
  const f: RunFacts = { tier: String(c.tier), task: String(c.taskId), arm, run: Number(c.run), acc: (c.accuracy as number | null) ?? null,
    inconclusive: Boolean(c.inconclusive), cellStatus: String(c.status), ship0: [], ship0n: 0, vis0n: 0, iters: 0, llmCalls: 0, tokIn: 0, tokOut: 0,
    cacheRead: 0, llmMs: [], wallMs: Number(c.durationMs ?? 0), called: [], invalidArgs: 0, invalidSamples: [], mutatingCalled: [], asked: false,
    status: "?", authority: "?", terminatedBy: "?", output: String(c.output ?? ""), exitUnbacked: [], termUnbacked: [], termMeasure: [], verified: null, traceFile }
  let seenShip = false, seenVis = false
  const iters = new Set<unknown>()
  for (const l of readFileSync(traceFile, "utf8").split("\n")) {
    if (!l) continue
    const e = JSON.parse(l) as Ev
    if (e.kind === "tool-surface-resolved") { iters.add(e.iter); if (!seenVis) { f.vis0n = ((e.visible as string[]) ?? []).length; seenVis = true } }
    if (e.kind === "guard-fired" && e.guard === "wire-request" && !seenShip) {
      const ship = (((e.metadata as Ev).toolsShipped as Array<{ name: string }>) ?? []).map((t) => t.name)
      if (ship.length > 0) { f.ship0 = ship; f.ship0n = ship.length; seenShip = true }
    }
    if (e.kind === "guard-fired" && e.guard === "exit_gate") {
      const out = ((e.metadata as Ev | undefined)?.outstanding as string[] | undefined) ?? []
      for (const o of out) if (/never ran successfully: call it, or say plainly/.test(o)) f.exitUnbacked.push(o)
    }
    if (e.kind === "tool-call-end" && typeof e.toolName === "string") {
      f.called.push(e.toolName)
      if (MUTATING.test(e.toolName) && !f.mutatingCalled.includes(e.toolName)) f.mutatingCalled.push(e.toolName)
      const res = JSON.stringify(e.result ?? e.observation ?? e.error ?? "")
      if (e.success === false || /invalid|not a valid|must be one of|unknown (?:type|metric)|validation|expected/i.test(res.slice(0, 400)) && e.success !== true) {
        f.invalidArgs++
        if (f.invalidSamples.length < 2) f.invalidSamples.push(`${e.toolName}: ${res.slice(0, 140)}`)
      }
    }
    if (e.kind === "llm-exchange") {
      const r = e.response as Ev
      f.llmCalls++; f.tokIn += Number(r?.tokensIn ?? 0); f.tokOut += Number(r?.tokensOut ?? 0); f.cacheRead += Number(r?.cacheReadTokensIn ?? 0)
      if (typeof r?.durationMs === "number") f.llmMs.push(r.durationMs)
    }
    if (e.kind === "verifier-verdict" && e.terminal === true && e.source === "kernel") {
      f.verified = Boolean(e.verified)
      for (const ch of (e.checks as Array<Ev>) ?? []) {
        if (ch.passed !== false) continue
        const row = { severity: String(ch.severity ?? "?"), reason: String(ch.reason ?? "") }
        if (ch.name === "output-not-unbacked-action-claim") f.termUnbacked.push(row)
        if (ch.name === "output-not-fabricated-measurement") f.termMeasure.push(row)
      }
    }
    if (e.kind === "run-completed") {
      const o = (e.outcome as Ev) ?? {}
      f.status = String(e.status); f.terminatedBy = String(e.terminatedBy); f.authority = String(o.authority ?? "?")
    }
  }
  f.iters = iters.size
  const dataCalls = f.called.filter((t) => !["discover-tools", "recall", "final-answer", "umami_get_websites"].includes(t))
  f.asked = ASKED.test(f.output.trim()) && dataCalls.length === 0
  return f
}

const all: RunFacts[] = []
for (const file of files) {
  const arm = file.split("/").pop()!.split("-")[0]!
  const res = JSON.parse(readFileSync(file, "utf8")) as { cells: Array<Ev> }
  for (const c of res.cells) {
    const tf = c.traceFile as string | null
    if (!tf || !existsSync(tf)) { console.error(`no trace: ${String(c.cellId)}`); continue }
    all.push(factsOf(tf, c, arm))
  }
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(all, null, 2))

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const med = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]! }
const ARMS = ["base", "nofam", "nocon", "off"]
const keys = [...new Set(all.map((r) => `${r.tier}\u0000${r.task}`))].sort()

console.log("TURN-0 SHIPPED (wire-request toolsShipped; union over runs) tier | task | arm | n shipped (min-max) | vis0 | names")
for (const key of keys) {
  const [tier, task] = key.split("\u0000")
  for (const arm of ARMS) {
    const rs = all.filter((r) => r.tier === tier && r.task === task && r.arm === arm)
    if (!rs.length) continue
    const u = [...new Set(rs.flatMap((r) => r.ship0))]
    console.log(`${tier} | ${task} | ${arm} | ${Math.min(...rs.map((r) => r.ship0n))}-${Math.max(...rs.map((r) => r.ship0n))} | ${mean(rs.map((r) => r.vis0n)).toFixed(0)} | ${showLists ? u.join(",") : `${u.length} distinct`}`)
  }
}

console.log("\nOUTCOMES tier | task | arm | n(meas) | acc | asked | invalidArgs | mutating called | iters | tokIn+Out | llm med ms | wall s | status/authority")
for (const key of keys) {
  const [tier, task] = key.split("\u0000")
  for (const arm of ARMS) {
    const rs = all.filter((r) => r.tier === tier && r.task === task && r.arm === arm)
    if (!rs.length) continue
    const m = rs.filter((r) => !r.inconclusive)
    console.log([tier, task, arm, `${rs.length}(${m.length})`, mean(m.map((r) => r.acc ?? 0)).toFixed(2), rs.filter((r) => r.asked).length,
      rs.reduce((s, r) => s + r.invalidArgs, 0), [...new Set(rs.flatMap((r) => r.mutatingCalled))].join(",") || "-",
      mean(rs.map((r) => r.iters)).toFixed(1), mean(m.map((r) => r.tokIn + r.tokOut)).toFixed(0), med(rs.flatMap((r) => r.llmMs)).toFixed(0),
      (mean(rs.map((r) => r.wallMs)) / 1000).toFixed(1), rs.map((r) => `${r.status[0]}/${r.authority}`).join(" ")].join(" | "))
  }
}

if (showAudit) {
  console.log("\nAUDIT (runs where a claimed-action or measurement check fired)")
  for (const r of all) {
    if (!r.exitUnbacked.length && !r.termUnbacked.length && !r.termMeasure.length) continue
    console.log(`--- ${r.tier} ${r.task} ${r.arm} run${r.run} status=${r.status}/${r.authority} acc=${r.acc} called=${[...new Set(r.called)].join(",")}`)
    for (const o of r.exitUnbacked) console.log(`  exit-gate: ${o.slice(0, 220)}`)
    for (const o of r.termUnbacked) console.log(`  terminal unbacked [${o.severity}]: ${o.reason.slice(0, 220)}`)
    for (const o of r.termMeasure) console.log(`  terminal measurement [${o.severity}]: ${o.reason.slice(0, 260)}`)
    console.log(`  output: ${r.output.replace(/\s+/g, " ").slice(0, 500)}`)
  }
}
