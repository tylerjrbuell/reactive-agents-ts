// Per-arm tool-surface + answer-turn facts from the traces behind results files.
// Prints, per (tier, task, arm): the visible / callable / SHIPPED tool lists of the
// first iteration and the within-run change counts, BEFORE any token reading
// (feedback_tool_surface_confound). Then tokens, latency, refusals, answer turns.
//   bun surface.ts [--lists] <results.json>...      (arm = file-name prefix before the first "-")
import { existsSync, readFileSync } from "node:fs"

type Ev = Record<string, unknown>
const files = process.argv.slice(2).filter((a) => !a.startsWith("--"))
const showLists = process.argv.includes("--lists")

interface RunFacts {
  tier: string; task: string; arm: string; acc: number | null
  iters: number; vis0: string[]; call0: string[]; ship0: string[]
  visChanges: number; shipChanges: number; shipMax: number; shipMin: number
  headTrunc: number; notReady: number; recallMiss: number; discover: number
  llmCalls: number; llmMs: number[]; tokIn: number; tokOut: number; cacheRead: number
  answerTurns: number; status: string; authority: string; provenance: string; terminatedBy: string
  wallMs: number
}

const setEq = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))

function factsOf(traceFile: string, base: Omit<RunFacts, "iters" | "vis0" | "call0" | "ship0" | "visChanges" | "shipChanges" | "shipMax" | "shipMin" | "headTrunc" | "notReady" | "recallMiss" | "discover" | "llmCalls" | "llmMs" | "tokIn" | "tokOut" | "cacheRead" | "answerTurns" | "status" | "authority" | "provenance" | "terminatedBy">): RunFacts {
  const f: RunFacts = { ...base, iters: 0, vis0: [], call0: [], ship0: [], visChanges: 0, shipChanges: 0, shipMax: 0, shipMin: 1e9, headTrunc: 0, notReady: 0, recallMiss: 0, discover: 0,
    llmCalls: 0, llmMs: [], tokIn: 0, tokOut: 0, cacheRead: 0, answerTurns: 0, status: "?", authority: "?", provenance: "?", terminatedBy: "?" }
  let prevVis: string[] | undefined, prevShip: string[] | undefined
  const iters = new Set<unknown>()
  for (const l of readFileSync(traceFile, "utf8").split("\n")) {
    if (!l) continue
    const e = JSON.parse(l) as Ev
    if (e.kind === "tool-surface-resolved") {
      const vis = (e.visible as string[]) ?? []
      iters.add(e.iter)
      if (prevVis === undefined) { f.vis0 = vis; f.call0 = (e.callable as string[]) ?? [] } else if (!setEq(prevVis, vis)) f.visChanges++
      prevVis = vis
    }
    if (e.kind === "guard-fired" && e.guard === "wire-request") {
      const m = e.metadata as Ev
      const ship = ((m.toolsShipped as Array<{ name: string }>) ?? []).map((t) => t.name)
      if (m.headTruncationGuardFired === true) f.headTrunc++
      // An answer turn ships 0 tools by design; it is counted on its own, not as a list change.
      if (ship.length > 0) {
        if (prevShip === undefined) f.ship0 = ship; else if (!setEq(prevShip, ship)) f.shipChanges++
        prevShip = ship
        f.shipMax = Math.max(f.shipMax, ship.length); f.shipMin = Math.min(f.shipMin, ship.length)
      }
    }
    if (e.kind === "guard-fired" && (e.metadata as Ev | undefined)?.kind === "not-ready") f.notReady++
    if (e.kind === "harness-signal-injected" && e.origin === "exit-gate-answer-turn") f.answerTurns++
    if (e.kind === "tool-call-end") {
      if (e.toolName === "discover-tools") f.discover++
      if (e.toolName === "recall" && /found\\?"?:\s*false/.test(l)) f.recallMiss++
    }
    if (e.kind === "llm-exchange") {
      const r = e.response as Ev
      f.llmCalls++
      f.tokIn += Number(r?.tokensIn ?? 0); f.tokOut += Number(r?.tokensOut ?? 0)
      f.cacheRead += Number(r?.cacheReadTokensIn ?? 0)
      if (typeof r?.durationMs === "number") f.llmMs.push(r.durationMs)
    }
    if (e.kind === "run-completed") {
      const o = (e.outcome as Ev) ?? {}
      f.status = String(e.status); f.terminatedBy = String(e.terminatedBy)
      f.authority = String(o.authority ?? "?"); f.provenance = String(o.provenance ?? "?")
    }
  }
  f.iters = iters.size
  if (f.shipMin === 1e9) f.shipMin = 0
  return f
}

const all: RunFacts[] = []
for (const file of files) {
  const arm = file.split("/").pop()!.split("-")[0]!
  const res = JSON.parse(readFileSync(file, "utf8")) as { cells: Array<Record<string, unknown>> }
  for (const c of res.cells) {
    const tf = c.traceFile as string | null
    if (!tf || !existsSync(tf)) continue
    all.push(factsOf(tf, { tier: String(c.tier), task: String(c.taskId), arm, acc: (c.accuracy as number | null) ?? null, wallMs: Number(c.durationMs ?? 0) }))
  }
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const med = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]! }
const keys = [...new Set(all.map((r) => `${r.tier}\u0000${r.task}`))].sort()
console.log("tier | task | arm | n | acc | iters | vis0 | ship0 | shipMin-Max | visΔ/run | shipΔ/run | headTrunc | notReady | recallMiss | discover | tokIn | tokOut | cacheRead | llmMed ms | wall s | answerTurns | status")
for (const key of keys) {
  const [tier, task] = key.split("\u0000")
  for (const arm of ["base", "stl"]) {
    const rs = all.filter((r) => r.tier === tier && r.task === task && r.arm === arm)
    if (!rs.length) continue
    const statuses = rs.map((r) => `${r.status[0]}/${r.authority}`).join(" ")
    console.log([tier, task, arm, rs.length, mean(rs.map((r) => r.acc ?? 0)).toFixed(2), mean(rs.map((r) => r.iters)).toFixed(1),
      mean(rs.map((r) => r.vis0.length)).toFixed(0), mean(rs.map((r) => r.ship0.length)).toFixed(0),
      `${Math.min(...rs.map((r) => r.shipMin))}-${Math.max(...rs.map((r) => r.shipMax))}`,
      mean(rs.map((r) => r.visChanges)).toFixed(2), mean(rs.map((r) => r.shipChanges)).toFixed(2),
      rs.reduce((s, r) => s + r.headTrunc, 0), rs.reduce((s, r) => s + r.notReady, 0), rs.reduce((s, r) => s + r.recallMiss, 0), rs.reduce((s, r) => s + r.discover, 0),
      mean(rs.map((r) => r.tokIn)).toFixed(0), mean(rs.map((r) => r.tokOut)).toFixed(0), mean(rs.map((r) => r.cacheRead)).toFixed(0),
      med(rs.flatMap((r) => r.llmMs)).toFixed(0), (mean(rs.map((r) => r.wallMs)) / 1000).toFixed(1),
      rs.reduce((s, r) => s + r.answerTurns, 0), statuses].join(" | "))
    if (showLists) {
      const r0 = rs[0]!
      console.log(`    visible[0]=${r0.vis0.join(",")}\n    shipped[0]=${r0.ship0.join(",")}`)
    }
  }
}
// Turn-0 shipped list: which names the stl arm ships that base does not (and vice versa), per tier+task.
console.log("\nTURN-0 SHIPPED DIFF tier | task | stl-only | base-only (union over runs)")
for (const key of keys) {
  const [tier, task] = key.split("\u0000")
  const u = (arm: string) => new Set(all.filter((r) => r.tier === tier && r.task === task && r.arm === arm).flatMap((r) => r.ship0))
  const b = u("base"), s = u("stl")
  console.log([tier, task, [...s].filter((x) => !b.has(x)).join(",") || "-", [...b].filter((x) => !s.has(x)).join(",") || "-"].join(" | "))
}
// Arm totals per tier.
console.log("\nTOTALS tier | arm | runs | shipΔ total | runs with shipΔ>0 | visΔ total | notReady | answerTurns | tokIn+Out mean | llm median ms")
for (const tier of [...new Set(all.map((r) => r.tier))].sort()) for (const arm of ["base", "stl"]) {
  const rs = all.filter((r) => r.tier === tier && r.arm === arm)
  if (!rs.length) continue
  console.log([tier, arm, rs.length, rs.reduce((s, r) => s + r.shipChanges, 0), rs.filter((r) => r.shipChanges > 0).length, rs.reduce((s, r) => s + r.visChanges, 0),
    rs.reduce((s, r) => s + r.notReady, 0), rs.reduce((s, r) => s + r.answerTurns, 0), mean(rs.map((r) => r.tokIn + r.tokOut)).toFixed(0), med(rs.flatMap((r) => r.llmMs)).toFixed(0)].join(" | "))
}
// Answer-turn outcomes: runs that took >=1 answer turn, by final status/authority.
console.log("\nANSWER TURNS tier | arm | task | answerTurns | status | authority | provenance | terminatedBy | acc")
for (const r of all.filter((x) => x.answerTurns > 0)) console.log([r.tier, r.arm, r.task, r.answerTurns, r.status, r.authority, r.provenance, r.terminatedBy, r.acc].join(" | "))
