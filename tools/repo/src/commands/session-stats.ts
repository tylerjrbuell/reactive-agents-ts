import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join } from "node:path"
import type { Command } from "../cli.ts"
import { flagValue, rejectUnknown } from "../lib/args.ts"
import { loadPlacement } from "../lib/placement.ts"
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
  /** `hookDenies` split by rule id (`unknown` when the marker carries no parseable id). */
  hookDeniesByRule: Record<string, number>
  /** Rules denied >=3 times within a single session: rule id -> the most denies of it in any one session. */
  repeatedDenies: Record<string, number>
  /** Warn-mode advisories (`mode: "warn"`) in `.repo-logs/denies.jsonl` inside the window (filled by the command). */
  warns: number
  /** Lines in `.repo-logs/overrides.jsonl` inside the window (filled by the command, not the parser). */
  overrides: number
  /** Approximation: Grep + Glob tool calls, `repo find`, `find` commands, and counted shell greps (see shellGrepCalls). */
  searchCalls: number
  /**
   * Approximation of what rule no-shell-grep-repo targets: grep/egrep/fgrep/ugrep with -r/-R, or rg/ag,
   * at a command boundary. Not pipe-fed (`x | grep y`), not `git grep`, not single-file operands,
   * not operands all outside the repo (~, $VAR, node_modules, absolute paths elsewhere).
   */
  shellGrepCalls: number
  /** Read calls with no limit/offset whose result exceeded 400 lines. */
  wholeFileReadsOver400Lines: number
  /** Transcript lines that were needle-matched but failed to parse. */
  skippedLines: number
}

const WHOLE_FILE_LINES = 400
const MIN_SESSIONS = 3
/** Friction thresholds (zero-friction law): per-session denies, and denies of one rule in one session. */
const MAX_DENIES_PER_SESSION = 5
const MAX_SAME_RULE_DENIES = 2
const REPEAT_AT = MAX_SAME_RULE_DENIES + 1
const SCRIPTED_EDIT =
  /\bpython3?\s+-(?:\s|$)[\s\S]*\.replace\(|\bsed\s+(?:-\S+\s+)*(?:-[A-Za-z]*i|--in-place)|\bperl\s+(?:-\S+\s+)*-[A-Za-z]*i|\bg?awk\s+-i\s+inplace/
const BUN_TEST = /\bbun\s+test\b/
const PIPED_AFTER_BUN_TEST = /\bbun\s+test\b[^\n]*[^|\n]\|(?!\|)/
const FIND_CMD = /(?:^|[;&\n(]|\|\|)\s*find\s|\brepo\s+find\b/
const DENY_RULE = /\[source: tools\/repo\/(?:rules|placement)\.json#([\w-]+)\]/g
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

const REPO_NAME = "reactive-agents-ts"

/** Operands (non-flag tokens after the pattern) of a grep-family invocation; quotes stripped. */
function operands(rest: string): string[] {
  const toks = rest.split(/\s+/).filter((t) => t.length > 0).map((t) => t.replace(/^["']|["']$/g, ""))
  return toks.filter((t) => !t.startsWith("-")).slice(1)
}

const outsideRepo = (o: string): boolean =>
  o.startsWith("~") || o.startsWith("$") || o.includes("node_modules") || (o.startsWith("/") && !o.includes(REPO_NAME))
const looksLikeFile = (o: string): boolean => !o.endsWith("/") && /\.\w{1,5}$/.test(o) && !/[*?]/.test(o)

function isShellGrep(cmd: string): boolean {
  for (const m of cmd.matchAll(SHELL_GREP_HEAD)) {
    const tool = m[1] as string
    const rest = m[2] ?? ""
    const recursive = tool === "rg" || tool === "ag" || /(?:^|\s)-(?:-recursive\b|[A-Za-z]*[rR])/.test(rest)
    if (!recursive) continue
    const ops = operands(rest)
    if (ops.length > 0 && ops.every((o) => outsideRepo(o) || looksLikeFile(o))) continue
    return true
  }
  return false
}

type Counts = Omit<SessionMetrics, "sessions" | "overrides" | "warns">

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
    hookDeniesByRule: {},
    repeatedDenies: {},
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
  const grep = isShellGrep(cmd)
  if (grep) c.shellGrepCalls++
  if (grep || FIND_CMD.test(cmd)) c.searchCalls++
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
        const ids = [...body.matchAll(DENY_RULE)].map((m) => m[1] as string)
        if (ids.length > 0 || body.includes("[source: tools/repo/rules.json#")) {
          c.hookDenies++
          for (const id of ids.length > 0 ? ids.slice(0, 1) : ["unknown"]) c.hookDeniesByRule[id] = (c.hookDeniesByRule[id] ?? 0) + 1
        }
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
    const before = { ...c.hookDeniesByRule }
    measureFile(p, false, c)
    for (const s of subagentFiles(p)) measureFile(s, true, c)
    for (const [id, total] of Object.entries(c.hookDeniesByRule)) {
      const inSession = total - (before[id] ?? 0)
      if (inSession >= REPEAT_AT) c.repeatedDenies[id] = Math.max(c.repeatedDenies[id] ?? 0, inSession)
    }
  }
  return { sessions: jsonlPaths.length, overrides: 0, warns: 0, ...c }
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

function logRecords(root: string, file: string, sinceMs: number | undefined): Record<string, unknown>[] {
  const p = join(root, ".repo-logs", file)
  if (!existsSync(p)) return []
  const out: Record<string, unknown>[] = []
  for (const l of readFileSync(p, "utf8").split("\n")) {
    if (l.trim().length === 0) continue
    try {
      const doc: unknown = JSON.parse(l)
      if (!isRec(doc)) continue
      const ts = str(doc.ts)
      if (sinceMs === undefined || (ts !== undefined && Date.parse(ts) >= sinceMs)) out.push(doc)
    } catch {
      // torn line: ignore
    }
  }
  return out
}

/** Overrides logged at or after `sinceMs` (all when undefined). */
export function countOverrides(root: string, sinceMs: number | undefined): number {
  return logRecords(root, "overrides.jsonl", sinceMs).length
}

/** Warn-mode advisories logged in `.repo-logs/denies.jsonl` at or after `sinceMs`. */
export function countWarns(root: string, sinceMs: number | undefined): number {
  return logRecords(root, "denies.jsonl", sinceMs).filter((r) => r.mode === "warn").length
}

/** Numeric baseline counts (`baseline.json#measured`): this tool's own numbers on the pre-rollout window. */
export type Baseline = Partial<Record<Exclude<keyof SessionMetrics, "hookDeniesByRule" | "repeatedDenies">, number>>

/** `baseline.json`: `published` is the 2026-11-03 analysis (provenance only); `measured` is what ratios compare against. */
export interface BaselineFile {
  measured: Baseline
  published: Record<string, number>
  window: string | null
}

const BASELINE_PATH = join(import.meta.dir, "..", "..", "baseline.json")

/**
 * Measure the pre-rollout window: every top-level transcript in `dir` modified before `beforeMs`.
 * Used to (re)generate `baseline.json#measured`; deterministic for a fixed file set.
 */
export function measureBefore(dir: string, beforeMs: number): { files: number; metrics: SessionMetrics } {
  const paths = listSessions(dir, undefined).filter((p) => statSync(p).mtimeMs < beforeMs)
  return { files: paths.length, metrics: measureSessions(paths) }
}

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
  const br = (n: keyof Baseline, d: keyof Baseline): number | null => {
    const num = b[n]
    const den = b[d]
    return num === undefined || den === undefined ? null : rate(num, den)
  }
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
      id: "hook-denies",
      ok: m.hookDenies / Math.max(1, m.sessions) <= MAX_DENIES_PER_SESSION,
      value: m.hookDenies / Math.max(1, m.sessions),
      limit: MAX_DENIES_PER_SESSION,
      baseline: null,
      note: `${m.hookDenies} hook denies / ${m.sessions} sessions (<=${MAX_DENIES_PER_SESSION} each)`,
    },
    {
      id: "repeated-denies",
      ok: Object.keys(m.repeatedDenies).length === 0,
      value: Math.max(0, ...Object.values(m.repeatedDenies)),
      limit: MAX_SAME_RULE_DENIES,
      baseline: null,
      note: `no rule denied >${MAX_SAME_RULE_DENIES}x in one session`,
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

function numbers(v: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (isRec(v)) for (const [k, n] of Object.entries(v)) if (typeof n === "number") out[k] = n
  return out
}

/** Read `baseline.json`; missing/malformed yields empty baselines (no ratios shown). */
export function loadBaseline(path: string = BASELINE_PATH): BaselineFile {
  try {
    const doc: unknown = JSON.parse(readFileSync(path, "utf8"))
    if (!isRec(doc)) return { measured: {}, published: {}, window: null }
    const m = isRec(doc.measured) ? doc.measured : {}
    return { measured: numbers(m), published: numbers(doc.published), window: str(m.window) ?? null }
  } catch {
    return { measured: {}, published: {}, window: null }
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
  "warns",
  "overrides",
] as const

/** Manifest file a rule id lives in (placement rules are `placement.json`; default `rules.json`). */
function manifestOf(root: string, id: string): string {
  try {
    return loadPlacement(root).rules.some((r) => r.id === id) ? "placement.json" : "rules.json"
  } catch {
    return "rules.json"
  }
}

/** `repo session-stats`: did the tool change habits? Measures transcripts against the 2026-11-03 baseline. */
export const sessionStatsCommand: Command = {
  name: "session-stats",
  summary: "Session transcripts vs baseline; exit 1 on a missed habit threshold",
  example: "bun run repo session-stats --since 2026-11-04",
  detail: [
    "--since <ISO>: sessions modified at/after it; thresholds apply only with it and >=3 sessions",
    "--dir <path>: transcript dir (default ~/.claude/projects/<cwd-slug>)",
    "baselines are this tool's own pre-rollout numbers (baseline.json#measured); --json adds the published ones",
    "searchCalls and shellGrepCalls are regex APPROXIMATIONS:",
    "  shellGrepCalls = grep -r/-R, egrep/fgrep/ugrep -r, or rg/ag at a command boundary; not `x | grep y`,",
    "    not `git grep`, not single-file operands, not operands all outside the repo (~, $VAR, node_modules, /elsewhere)",
    "  searchCalls = Grep + Glob tool calls + `repo find` + `find` commands + shellGrepCalls",
    "--json: hookDeniesByRule splits hookDenies per rule id; repeatedDenies = rules denied >=3x in one session",
    "friction thresholds (with --since): hook denies <=5/session, no rule denied >2x in a session, overrides <=2/session; warns = warn-mode advisories",
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
    const m = { ...measureSessions(paths), overrides: countOverrides(root, sinceMs), warns: countWarns(root, sinceMs) }
    const file = loadBaseline()
    const baseline = file.measured
    const evaluated = sinceMs !== undefined && m.sessions >= MIN_SESSIONS
    const checks = evaluated ? evaluate(m, baseline) : []
    io.data({ metrics: m, baseline, published: file.published, window: file.window, evaluated, checks })
    io.out(`sessions ${m.sessions} (baseline ${baseline.sessions ?? "n/a"}) in ${dir}`)
    for (const k of COUNT_KEYS) io.out(`  ${k}: ${m[k]}${baseline[k] === undefined ? "" : ` (baseline ${baseline[k]})`}`)
    if (m.skippedLines > 0) io.out(`  skippedLines: ${m.skippedLines}`)
    for (const [id, n] of Object.entries(m.repeatedDenies).sort(([a], [b]) => a.localeCompare(b)))
      io.out(`friction: rule ${id} denied ${n}× — fix or relax the rule (tools/repo/${manifestOf(root, id)}#${id})`)
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
