import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join } from "node:path"
import type { Command } from "../cli.ts"
import { flagValue, rejectUnknown } from "../lib/args.ts"
import { resolveRoot } from "../lib/root.ts"

/** Counts measured over Claude Code session transcripts (main + subagent JSONL). */
export interface SessionMetrics {
  sessions: number
  bunTestCalls: number
  pipedBunTest: number
  scriptedEdits: number
  editToolCalls: number
  agentSpawns: number
  subagentTurns: number
  mainTurns: number
  /** tool_results carrying the hook deny marker `[source: tools/repo/rules.json#`. */
  hookDenies: number
  /** Lines in `.repo-logs/overrides.jsonl` inside the window (filled by the command, not the parser). */
  overrides: number
  /** Grep + Glob tool calls plus Bash grep/rg/find/git grep/`repo find`. */
  searchCalls: number
  /** Bash recursive grep/rg/ag at command position: what rule no-shell-grep-repo targets. */
  shellGrepCalls: number
  /** Read calls with no limit/offset whose result exceeded 400 lines. */
  wholeFileReadsOver400Lines: number
  /** Transcript lines that were needle-matched but failed to parse. */
  skippedLines: number
}

const DENY_MARKER = "[source: tools/repo/rules.json#"
const WHOLE_FILE_LINES = 400
const MIN_SESSIONS = 3
const SCRIPTED_EDIT =
  /\bpython3?\s+-(?:\s|$)[\s\S]*\.replace\(|\bsed\s+(?:-\S+\s+)*(?:-[A-Za-z]*i|--in-place)|\bperl\s+(?:-\S+\s+)*-[A-Za-z]*i|\bg?awk\s+-i\s+inplace/
const BUN_TEST = /\bbun\s+test\b/
const PIPED_AFTER_BUN_TEST = /\bbun\s+test\b[^\n]*[^|\n]\|(?!\|)/
const SEARCH_CMD = /(?:^|[\s;&|(`])(?:u?grep|egrep|fgrep|rg|find)\s/
const SHELL_GREP_HEAD = /(?:^|[;&\n(]|\|\|)\s*(?:[A-Za-z_]\w*=\S*\s+)*(?:(?:sudo|time|command|nice)\s+)*(u?grep|egrep|fgrep|rg|ag)(?=\s)([^\n;&|]*)/g

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)

function blocks(content: unknown): Record<string, unknown>[] {
  return Array.isArray(content) ? content.filter(isRec) : []
}

/** Text of a tool_result `content`: a string or an array of `{type:"text", text}` blocks. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content
  return blocks(content)
    .map((b) => str(b.text) ?? "")
    .join("\n")
}

function isShellGrep(cmd: string): boolean {
  for (const m of cmd.matchAll(SHELL_GREP_HEAD)) {
    const tool = m[1] as string
    if (tool === "rg" || tool === "ag") return true
    if (/(?:^|\s)-(?:-recursive\b|[A-Za-z]*[rR])/.test(m[2] ?? "")) return true
  }
  return false
}

type Counts = Omit<SessionMetrics, "sessions" | "overrides">

function zero(): Counts {
  return {
    bunTestCalls: 0,
    pipedBunTest: 0,
    scriptedEdits: 0,
    editToolCalls: 0,
    agentSpawns: 0,
    subagentTurns: 0,
    mainTurns: 0,
    hookDenies: 0,
    searchCalls: 0,
    shellGrepCalls: 0,
    wholeFileReadsOver400Lines: 0,
    skippedLines: 0,
  }
}

function countBash(cmd: string, c: Counts): void {
  if (BUN_TEST.test(cmd)) {
    c.bunTestCalls++
    if (PIPED_AFTER_BUN_TEST.test(cmd)) c.pipedBunTest++
  }
  if (SCRIPTED_EDIT.test(cmd)) c.scriptedEdits++
  if (SEARCH_CMD.test(cmd) || /\bgit\s+grep\b/.test(cmd)) c.searchCalls++
  if (isShellGrep(cmd)) c.shellGrepCalls++
}

/** Parse one transcript file. Streaming-ish: only needle-matched lines are JSON-parsed; malformed ones are skipped. */
function measureFile(path: string, subagent: boolean, c: Counts): void {
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch {
    c.skippedLines++
    return
  }
  /** tool_use ids of Read calls without limit/offset. */
  const unlimitedReads = new Set<string>()
  for (const line of text.split("\n")) {
    const isUse = line.includes('"tool_use"') && line.includes('"assistant"')
    const isResult = line.includes('"tool_result"')
    const isTurn = line.includes('"type":"assistant"')
    if (!isUse && !isResult && !isTurn) continue
    let doc: unknown
    try {
      doc = JSON.parse(line)
    } catch {
      c.skippedLines++
      continue
    }
    if (!isRec(doc) || !isRec(doc.message)) continue
    const content = doc.message.content
    if (doc.type === "assistant") {
      if (subagent) c.subagentTurns++
      else c.mainTurns++
      for (const b of blocks(content)) {
        if (b.type !== "tool_use") continue
        const name = str(b.name)
        const input = isRec(b.input) ? b.input : {}
        if (name === "Bash") countBash(str(input.command) ?? "", c)
        else if (name === "Edit") c.editToolCalls++
        else if (name === "Agent" || name === "Task") c.agentSpawns++
        else if (name === "Grep" || name === "Glob") c.searchCalls++
        else if (name === "Read" && input.limit === undefined && input.offset === undefined) {
          const id = str(b.id)
          if (id !== undefined) unlimitedReads.add(id)
        }
      }
    } else if (doc.type === "user") {
      for (const b of blocks(content)) {
        if (b.type !== "tool_result") continue
        const body = resultText(b.content)
        if (body.includes(DENY_MARKER)) c.hookDenies++
        const id = str(b.tool_use_id)
        if (id !== undefined && unlimitedReads.delete(id) && body.split("\n").length > WHOLE_FILE_LINES) c.wholeFileReadsOver400Lines++
      }
    }
  }
}

/** Subagent transcript files belonging to a session: `<dir>/<session-id>/subagents/*.jsonl`. */
function subagentFiles(sessionPath: string): string[] {
  const dir = join(dirname(sessionPath), basename(sessionPath, ".jsonl"), "subagents")
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((n) => n.endsWith(".jsonl"))
    .sort()
    .map((n) => join(dir, n))
}

/**
 * Measure transcripts. Subagent turns/tool calls come from `<session>/subagents/*.jsonl`
 * (records there carry `isSidechain:true`); their tool calls count toward the shared totals.
 * `overrides` is 0 here; the command fills it from `.repo-logs/overrides.jsonl`.
 */
export function measureSessions(jsonlPaths: readonly string[]): SessionMetrics {
  const c = zero()
  for (const p of jsonlPaths) {
    measureFile(p, false, c)
    for (const s of subagentFiles(p)) measureFile(s, true, c)
  }
  return { sessions: jsonlPaths.length, overrides: 0, ...c }
}

/** Default transcript dir for a repo root: `~/.claude/projects/<cwd-slug>`. */
export function transcriptDir(root: string, home: string = homedir()): string {
  return join(home, ".claude", "projects", root.replace(/[^A-Za-z0-9]/g, "-"))
}

/** Top-level `*.jsonl` sessions in `dir` modified at or after `sinceMs`, sorted by name. */
export function listSessions(dir: string, sinceMs: number | undefined): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((n) => n.endsWith(".jsonl"))
    .sort()
    .map((n) => join(dir, n))
    .filter((p) => sinceMs === undefined || statSync(p).mtimeMs >= sinceMs)
}

/** Overrides logged at or after `sinceMs` (all when undefined). */
export function countOverrides(root: string, sinceMs: number | undefined): number {
  const p = join(root, ".repo-logs", "overrides.jsonl")
  if (!existsSync(p)) return 0
  let n = 0
  for (const l of readFileSync(p, "utf8").split("\n")) {
    if (l.trim().length === 0) continue
    try {
      const doc: unknown = JSON.parse(l)
      const ts = isRec(doc) ? str(doc.ts) : undefined
      if (sinceMs === undefined || (ts !== undefined && Date.parse(ts) >= sinceMs)) n++
    } catch {
      // torn line: ignore
    }
  }
  return n
}

/** Published 2026-11-03 baseline (see `baseline.json`). Optional fields are absent for old entries. */
export type Baseline = Partial<SessionMetrics>

/** One threshold evaluation. */
export interface Check {
  id: string
  ok: boolean
  value: number
  limit: number
  baseline: number | null
  note: string
}

const rate = (num: number, den: number): number => (den === 0 ? 0 : num / den)
const pct = (r: number): string => `${(r * 100).toFixed(1)}%`

/** Evaluate the four thresholds. Rates against zero denominators are 0. */
export function evaluate(m: SessionMetrics, b: Baseline): Check[] {
  const br = (n: keyof SessionMetrics, d: keyof SessionMetrics): number | null =>
    b[n] === undefined || b[d] === undefined ? null : rate(b[n] as number, b[d] as number)
  const perSession = m.overrides / Math.max(1, m.sessions)
  return [
    {
      id: "piped-bun-test",
      ok: rate(m.pipedBunTest, m.bunTestCalls) <= 0.05,
      value: rate(m.pipedBunTest, m.bunTestCalls),
      limit: 0.05,
      baseline: br("pipedBunTest", "bunTestCalls"),
      note: `${m.pipedBunTest}/${m.bunTestCalls} bun test calls piped (<=5%)`,
    },
    {
      id: "scripted-edits",
      ok: m.scriptedEdits <= m.editToolCalls,
      value: m.scriptedEdits,
      limit: m.editToolCalls,
      baseline: b.scriptedEdits ?? null,
      note: `${m.scriptedEdits} scripted edits vs ${m.editToolCalls} Edit calls (scripted <= Edit)`,
    },
    {
      id: "hook-overrides",
      ok: perSession <= 2,
      value: perSession,
      limit: 2,
      baseline: null,
      note: `${m.overrides} overrides / ${m.sessions} sessions (<=2 each)`,
    },
    {
      id: "shell-grep",
      ok: rate(m.shellGrepCalls, m.searchCalls) <= 0.05,
      value: rate(m.shellGrepCalls, m.searchCalls),
      limit: 0.05,
      baseline: br("shellGrepCalls", "searchCalls"),
      note: `${m.shellGrepCalls}/${m.searchCalls} searches via shell grep (<=5%)`,
    },
  ]
}

function loadBaseline(): Baseline {
  try {
    const doc: unknown = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "baseline.json"), "utf8"))
    if (!isRec(doc)) return {}
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(doc)) if (typeof v === "number") out[k] = v
    return out
  } catch {
    return {}
  }
}

const COUNT_KEYS = [
  "bunTestCalls",
  "pipedBunTest",
  "scriptedEdits",
  "editToolCalls",
  "agentSpawns",
  "subagentTurns",
  "mainTurns",
  "searchCalls",
  "shellGrepCalls",
  "wholeFileReadsOver400Lines",
  "hookDenies",
  "overrides",
] as const

/** `repo session-stats`: did the tool change habits? Measures transcripts against the 2026-11-03 baseline. */
export const sessionStatsCommand: Command = {
  name: "session-stats",
  summary: "Session transcripts vs baseline; exit 1 on a missed habit threshold",
  example: "bun run repo session-stats --since 2026-11-04",
  detail: [
    "--since <ISO>: sessions modified at/after it; thresholds apply only with it and >=3 sessions",
    "--dir <path>: transcript dir (default ~/.claude/projects/<cwd-slug>)",
  ],
  async run(args, io) {
    const bad = rejectUnknown(io, "session-stats", args, { values: ["--since", "--dir", "--root"] })
    if (bad !== undefined) return bad
    const root = resolveRoot(flagValue(args, "--root"))
    const sinceArg = flagValue(args, "--since")
    const sinceMs = sinceArg === undefined ? undefined : Date.parse(sinceArg)
    if (sinceMs !== undefined && Number.isNaN(sinceMs)) return io.usage(`invalid --since: ${sinceArg}`, "bun run repo session-stats --help")
    const dir = flagValue(args, "--dir") ?? transcriptDir(root)
    const paths = listSessions(dir, sinceMs)
    const m = { ...measureSessions(paths), overrides: countOverrides(root, sinceMs) }
    const baseline = loadBaseline()
    const evaluated = sinceMs !== undefined && m.sessions >= MIN_SESSIONS
    const checks = evaluated ? evaluate(m, baseline) : []
    io.data({ metrics: m, baseline, evaluated, checks })
    io.out(`sessions ${m.sessions} (baseline ${baseline.sessions ?? "n/a"}) in ${dir}`)
    for (const k of COUNT_KEYS) io.out(`  ${k}: ${m[k]}${baseline[k] === undefined ? "" : ` (baseline ${baseline[k]})`}`)
    if (m.skippedLines > 0) io.out(`  skippedLines: ${m.skippedLines}`)
    if (sinceMs === undefined) {
      io.result("metrics only (no --since: thresholds not evaluated)")
      return 0
    }
    if (!evaluated) {
      io.result(`insufficient sessions (${m.sessions}<${MIN_SESSIONS}); thresholds not evaluated`)
      return 0
    }
    for (const c of checks) {
      const base = c.baseline === null ? "" : ` | baseline ${c.id === "scripted-edits" ? c.baseline : pct(c.baseline)}`
      io.out(`${c.ok ? "ok  " : "FAIL"} ${c.id}: ${c.note}${base}`)
    }
    const failed = checks.filter((c) => !c.ok)
    if (failed.length > 0) return io.fail(`${failed.length} threshold(s) missed: ${failed.map((c) => c.id).join(", ")}`, "fix the offending rule or habit; see bun run repo status")
    io.result("all thresholds met")
    return 0
  },
}
