/**
 * Phase-0 miner: failure -> recovery pairs from recorded traces. Read-only, zero LLM calls.
 * Usage: bun mine-pairs.ts <outDir> <traceDir...>
 * Rules (documented in the experiment report):
 *  - events: `tool-call-end` ordered by seq per run (carries toolName, ok, args, error).
 *  - failure episode: ok:false; consecutive identical (tool,args) failures collapse into one episode.
 *  - recovery within the same run, scanning forward <= WINDOW=6 tool calls:
 *      same-tool-changed-args : next ok call of the same tool with different args; shape = per-key change kinds
 *      same-tool-same-args    : next ok call same tool same args (transient retry, not a skill)
 *      different-tool         : first ok call of another tool (not meta tools todo/final-answer); shape = tool name
 *      none                   : no ok call found in window
 *  - error class: regex buckets over the error text, else normalised first line.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"

const [outDir, ...dirs] = process.argv.slice(2)
const WINDOW = 6
const META = new Set(["todo", "final-answer", "task-complete", "brief", "pulse", "recall", "scratchpad-write", "scratchpad-read"])

type Ev = Record<string, any>
const tierOf = (m: string, p: string): string => {
  if (p === "test") return "test-fixture"
  if (/gpt-4|gpt-5|gemini|grok|claude|sonnet|opus|haiku/.test(m) || p === "anthropic") return "frontier"
  if (/70b|72b|120b|27b|32b|gpt-oss-120/.test(m)) return "large"
  if (/14b|20b|8b|9b|7b|mimo|qwen3\.5|gemma4:latest|gemma4$/.test(m)) return "mid"
  return "local"
}
const ERR: Array<[RegExp, string]> = [
  [/Unknown action|Valid: /i, "unknown-action-enum"],
  [/Invalid UUID|validation error|Invalid arguments|invalid_type|Required|must be/i, "arg-validation"],
  [/missing|undefined|empty (args|arguments)|no (command|path|query)/i, "missing-arg"],
  [/ENOENT|no such file|not found|does not exist/i, "not-found"],
  [/EACCES|permission|denied|not allowed|blocked|outside/i, "denied"],
  [/timeout|timed out|ETIMEDOUT|ECONN|network|fetch failed|5\d\d\b|429|rate limit/i, "transient-network"],
  [/duplicate|already/i, "duplicate"],
  [/parse|JSON|syntax|unexpected token/i, "parse"],
]
const errClass = (e: string): string => {
  for (const [re, c] of ERR) if (re.test(e)) return c
  return "other:" + e.split("\n")[0].replace(/[0-9a-f-]{8,}|\d+/g, "N").slice(0, 50)
}
const taskType = (t: string): string => {
  const s = t.toLowerCase()
  if (/price|crypto|btc|xrp/.test(s)) return "crypto-price"
  if (/research|search|latest|news|trend/.test(s)) return "web-research"
  if (/file|write|read |\.ts|\.md|code|test|repo|refactor|bug/.test(s)) return "file-code"
  if (/shell|command|bash|run /.test(s)) return "shell"
  if (/calculat|math|compute|sum |\d+ ?[+*\/-] ?\d+/.test(s)) return "math"
  if (/analytics|umami|website|stats/.test(s)) return "analytics-mcp"
  return "other"
}
const canon = (a: unknown) => JSON.stringify(a, Object.keys((a as object) ?? {}).sort())
const kind = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v)
const argShape = (a: Ev = {}, b: Ev = {}): string => {
  const parts: string[] = []
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    if (!(k in a)) parts.push(`+${k}`)
    else if (!(k in b)) parts.push(`-${k}`)
    else if (canon(a[k]) !== canon(b[k])) parts.push(kind(a[k]) !== kind(b[k]) ? `~${k}:type` : `~${k}`)
  }
  return parts.join(",") || "none"
}

interface Pair { run: string; model: string; tier: string; task: string; ttype: string; tool: string; errClass: string; err: string; recovery: string; shape: string; failArgs: unknown; fixArgs: unknown; fixTool?: string; runStatus: string }
const pairs: Pair[] = []
let nTraces = 0, nReal = 0, nWithTools = 0, nWithFail = 0
const runMeta: Array<{ run: string; model: string; tier: string; real: boolean; toolCalls: number; fails: number }> = []

for (const dir of dirs) {
  if (!existsSync(dir)) continue
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".jsonl"))) {
    nTraces++
    const evs: Ev[] = []
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) { if (!line) continue; try { evs.push(JSON.parse(line)) } catch {} }
    const start = evs.find((e) => e.kind === "run-started")
    const done = evs.find((e) => e.kind === "run-completed")
    const model = start?.model ?? "?", provider = start?.provider ?? "?"
    const tier = tierOf(model, provider)
    const calls = evs.filter((e) => e.kind === "tool-call-end").sort((a, b) => a.seq - b.seq)
    const fails = calls.filter((c) => c.ok === false).length
    runMeta.push({ run: f, model, tier, real: tier !== "test-fixture", toolCalls: calls.length, fails })
    if (tier !== "test-fixture") nReal++
    if (calls.length) nWithTools++
    if (fails) nWithFail++
    const task = String(start?.task ?? "")
    const ttype = taskType(task.split("--- Conversation history ---").pop() ?? task)
    for (let i = 0; i < calls.length; i++) {
      const c = calls[i]
      if (c.ok !== false) continue
      const prev = calls[i - 1]
      if (prev && prev.ok === false && prev.toolName === c.toolName && canon(prev.args) === canon(c.args)) continue // collapse repeats
      let rec = "none", shape = "none", fixArgs: unknown, fixTool: string | undefined
      for (let j = i + 1; j < calls.length && j <= i + WINDOW; j++) {
        const n = calls[j]
        if (n.ok === false) continue
        if (n.toolName === c.toolName) {
          if (canon(n.args) === canon(c.args)) { rec = "same-tool-same-args"; shape = "retry" }
          else { rec = "same-tool-changed-args"; shape = argShape(c.args, n.args) }
          fixArgs = n.args; fixTool = n.toolName; break
        }
        if (!META.has(n.toolName) && !META.has(c.toolName)) { rec = "different-tool"; shape = "->" + n.toolName; fixArgs = n.args; fixTool = n.toolName; break }
      }
      pairs.push({ run: f.replace(".jsonl", ""), model, tier, task: task.slice(0, 160), ttype, tool: c.toolName, errClass: errClass(String(c.error ?? "")), err: String(c.error ?? "").slice(0, 300), recovery: rec, shape, failArgs: c.args, fixArgs, fixTool, runStatus: done?.status ?? "?" })
    }
  }
}

const real = pairs.filter((p) => p.tier !== "test-fixture")
const count = <T,>(xs: T[], k: (x: T) => string) => { const m = new Map<string, number>(); for (const x of xs) m.set(k(x), (m.get(k(x)) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1]) }
const recurrence = (ps: Pair[], keyf: (p: Pair) => string) => {
  const m = new Map<string, { runs: Set<string>; tasks: Set<string>; models: Set<string>; n: number }>()
  for (const p of ps) { const k = keyf(p); const e = m.get(k) ?? { runs: new Set(), tasks: new Set(), models: new Set(), n: 0 }; e.runs.add(p.run); e.tasks.add(p.task.slice(0, 60)); e.models.add(p.model); e.n++; m.set(k, e) }
  return [...m].map(([k, e]) => ({ key: k, runs: e.runs.size, tasks: e.tasks.size, models: e.models.size, n: e.n })).sort((a, b) => b.runs - a.runs)
}
const recov = real.filter((p) => p.recovery === "same-tool-changed-args" || p.recovery === "different-tool")
const strictKey = (p: Pair) => `${p.tool} | ${p.errClass} | ${p.recovery} ${p.shape}`
const out = {
  traces: nTraces, realModelTraces: nReal, testFixtureTraces: nTraces - nReal, tracesWithToolCalls: nWithTools, tracesWithFailure: nWithFail,
  realTracesWithFailure: runMeta.filter((r) => r.real && r.fails).length,
  failureEpisodesAll: pairs.length, failureEpisodesReal: real.length,
  recoveryAll: count(pairs, (p) => p.recovery), recoveryReal: count(real, (p) => p.recovery),
  byTierReal: count(real, (p) => p.tier), byTaskTypeReal: count(real, (p) => p.ttype), byToolReal: count(real, (p) => p.tool).slice(0, 25),
  byErrClassReal: count(real, (p) => p.errClass).slice(0, 25), byModelReal: count(real, (p) => p.model).slice(0, 15),
  usableRecoveries: recov.length,
  usableByTier: count(recov, (p) => p.tier), usableByTaskType: count(recov, (p) => p.ttype), usableByTool: count(recov, (p) => p.tool).slice(0, 20),
  recurStrict: recurrence(recov, strictKey).filter((r) => r.runs >= 3),
  recurLoose: recurrence(recov, (p) => `${p.tool} | ${p.errClass}`).filter((r) => r.runs >= 3),
  recurStrictCrossTask: recurrence(recov, strictKey).filter((r) => r.runs >= 3 && r.tasks >= 2),
}
writeFileSync(join(outDir, "results.json"), JSON.stringify(out, null, 1))
writeFileSync(join(outDir, "pairs.jsonl"), pairs.map((p) => JSON.stringify(p)).join("\n"))
console.log(JSON.stringify(out, null, 1).slice(0, 12000))
