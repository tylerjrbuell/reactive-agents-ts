import { budgetProblem, namesCommand, parseMode, type RuleMode } from "./friction.ts"
import { readManifest } from "./manifest.ts"

/** Text regions a rule's `match.command` must not look inside. */
export type NotInside = "quotes" | "quotes-opaque" | "heredoc-to-file"

/** Where the repo lives, for rules that must tell repo paths from outside paths. */
export interface HookCtx {
  /** Repo root; absolute operands under it count as repo paths. Default: `process.cwd()`. */
  root?: string
}

/** One PreToolUse Bash rule, loaded from `tools/repo/rules.json`. */
export interface HookRule {
  id: string
  /**
   * `command` is a regex source applied to the command after `notInside` regions are stripped
   * (`quotes-opaque` keeps quoted text but makes it a single inert word, so operands survive).
   * `check: "repo-search"` additionally requires the matched grep/rg command to search repo paths.
   */
  match: { command: string; notInside?: readonly NotInside[]; check?: "repo-search" }
  reason: string
  /** Shown after `reason`; `{name}` is replaced by the regex's named group `name` (else `<name>`). */
  alternative: string
  owner: string
  /** ISO date; see `manifest-expiry`. */
  reviewBy: string
  /** `deny` (default) blocks; `warn` allows and emits the same text as advice. */
  mode: RuleMode
  examples: { allow: readonly string[]; deny: readonly string[] }
}

/**
 * Verdict for one Bash command. An allow may carry the overrides that made it so (for logging).
 * `warn` means a `mode: "warn"` rule matched: the call proceeds, `reason` is advice.
 */
export type HookDecision =
  | { decision: "allow"; overrides?: readonly { ruleId: string; reason: string }[] }
  | { decision: "deny" | "warn"; ruleId: string; reason: string }

const ASSIGN = /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/
const ONE_ASSIGN = /([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S*)(?:\s+|$)/y
const HEREDOC = /^<<(-?)\s*(?:'([^']+)'|"([^"]+)"|\\?([A-Za-z_]\w*))/
/** An interpreter at a command boundary (not a filename like `f.sh`) reading stdin or a heredoc. */
const INTERPRETER =
  /(?:^|[;&|(`\n]|\$\()\s*(?:[A-Za-z_]\w*=\S*\s+)*(?:(?:sudo|time|timeout\s+\d+)\s+)*(?:python3?|node|bash|sh|zsh|perl|ruby)\b(?:\s+-(?=\s|$)|\s*<<)/

/** Index just past the `)` closing the `$(` at `i`, with its own quotes balanced independently. */
function skipSubshell(s: string, i: number): number {
  let depth = 0
  let q = ""
  for (let j = i; j < s.length; j++) {
    const c = s[j] as string
    if (q === "'") {
      if (c === "'") q = ""
    } else if (q === '"') {
      if (c === "\\") j++
      else if (c === '"') q = ""
    } else if (c === "'" || c === '"') q = c
    else if (c === "\\") j++
    else if (c === "(") depth++
    else if (c === ")" && --depth === 0) return j + 1
  }
  return s.length
}

/** Make quoted text one inert word: no whitespace or shell metacharacters survive. */
const neut = (s: string): string => s.replace(/[\s|;&()`#<>]/g, "\u0001")

interface Parsed {
  raw: string
  stripped: string
  /** Like `stripped` but quoted text is kept (neutralised) instead of dropped. */
  opaque: string
  bodies: readonly { text: string; exec: boolean }[]
}

/** Split off leading `VAR=value` tokens. They are not part of the command a rule inspects. */
function leadingAssignments(command: string): { env: Record<string, string>; rest: string } {
  const m = ASSIGN.exec(command)
  if (!m) return { env: {}, rest: command }
  const env: Record<string, string> = {}
  ONE_ASSIGN.lastIndex = 0
  const head = m[0]
  for (let a = ONE_ASSIGN.exec(head); a !== null; a = ONE_ASSIGN.exec(head)) {
    const v = a[2] as string
    env[a[1] as string] = /^(["']).*\1$/.test(v) ? v.slice(1, -1) : v
  }
  return { env, rest: command.slice(head.length) }
}

/** One pass: quote state decides what is a heredoc and what is quoted text. */
function parse(command: string): Parsed {
  let raw = ""
  let stripped = ""
  let opaque = ""
  let q = ""
  let lineStart = 0
  const pending: { delim: string; dash: boolean }[] = []
  const bodies: { text: string; exec: boolean }[] = []
  let i = 0
  while (i < command.length) {
    const c = command[i] as string
    if (q === "'") {
      raw += c
      if (c === "'") (q = ""), (stripped += c), (opaque += c)
      else opaque += neut(c)
      i++
      continue
    }
    if (q === '"') {
      if (c === "$" && command[i + 1] === "(") {
        const end = skipSubshell(command, i + 1)
        raw += command.slice(i, end)
        opaque += neut(command.slice(i, end))
        i = end
        continue
      }
      raw += c
      if (c === "\\" && i + 1 < command.length) {
        const n = command[++i] as string
        raw += n
        opaque += neut(c + n)
      } else if (c === '"') (q = ""), (stripped += c), (opaque += c)
      else opaque += neut(c)
      i++
      continue
    }
    if (c === "#" && (i === 0 || /\s/.test(command[i - 1] as string))) {
      while (i < command.length && command[i] !== "\n") i++
      continue
    }
    if (c === "\\" && i + 1 < command.length) {
      raw += c + (command[i + 1] as string)
      stripped += c + (command[i + 1] as string)
      opaque += c + (command[i + 1] as string)
      i += 2
      continue
    }
    if (c === "'" || c === '"') {
      q = c
      raw += c
      stripped += c
      opaque += c
      i++
      continue
    }
    if (c === "<" && command[i + 1] === "<" && command[i + 2] !== "<" && command[i - 1] !== "<") {
      const h = HEREDOC.exec(command.slice(i, i + 80))
      if (h) pending.push({ delim: (h[2] ?? h[3] ?? h[4]) as string, dash: h[1] === "-" })
    }
    if (c === "\n" && pending.length > 0) {
      const opener = command.slice(lineStart, i)
      const exec = INTERPRETER.test(opener)
      raw += "\n"
      stripped += "\n"
      opaque += "\n"
      i++
      for (const p of pending) {
        const lines: string[] = []
        while (i < command.length) {
          let end = command.indexOf("\n", i)
          if (end < 0) end = command.length
          const line = command.slice(i, end)
          i = Math.min(end + 1, command.length)
          if ((p.dash ? line.replace(/^\t+/, "") : line) === p.delim) break
          lines.push(line)
        }
        bodies.push({ text: lines.join("\n"), exec })
      }
      pending.length = 0
      lineStart = i
      continue
    }
    if (c === "\n") lineStart = i + 1
    raw += c
    stripped += c
    opaque += c
    i++
  }
  return { raw, stripped, opaque, bodies }
}

/** The text `rule.match.command` is applied to, per its `notInside`. */
function target(p: Parsed, notInside: readonly NotInside[]): string {
  let t = notInside.includes("quotes-opaque") ? p.opaque : notInside.includes("quotes") ? p.stripped : p.raw
  const dropBodies = notInside.includes("heredoc-to-file")
  for (const b of p.bodies) if (b.exec || !dropBodies) t += `\n${b.text}`
  return t
}

const regexCache = new Map<string, RegExp>()
function compile(source: string): RegExp {
  let re = regexCache.get(source)
  if (!re) regexCache.set(source, (re = new RegExp(source)))
  return re
}

function fill(template: string, groups: Record<string, string | undefined> | undefined): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => groups?.[name] ?? `<${name}>`)
}

function denyText(rule: HookRule, groups: Record<string, string | undefined> | undefined): string {
  // A warn already proceeded, so an override hint would be noise.
  const hint = rule.mode === "warn" ? "" : ` (override: REPO_ALLOW=${rule.id} REPO_ALLOW_REASON="<why>")`
  const alt = `${fill(rule.alternative, groups)}${hint}`
  return `${rule.reason}\n${alt}\n[source: tools/repo/rules.json#${rule.id}]`
}

/** The exact text the hook emits for `rule` (named groups unfilled), for the message budget. */
export function renderRuleText(rule: HookRule): string {
  return denyText(rule, undefined)
}

/** Short flags (last letter of a cluster) whose value is the next token. */
const VALUE_SHORT_GREP = "efmABCdD"
const VALUE_SHORT_RG = "efmABCgtTjMGpQr"
const VALUE_LONG = new Set([
  "include", "exclude", "exclude-dir", "regexp", "file", "max-count", "after-context", "before-context",
  "context", "glob", "iglob", "type", "type-not", "replace", "threads", "max-depth",
])

/** True when `op` (one command operand) is a repo path: relative, or absolute under `root`. */
function isRepoPath(op: string, root: string): boolean {
  const o = op.replace(/["'\u0001]/g, (ch) => (ch === "\u0001" ? " " : ""))
  if (o === "-" || o.startsWith("~") || o.startsWith("$")) return false
  if (/(?:^|[\s/])node_modules(?:\/|$)/.test(o)) return false
  if (o.startsWith("/")) return o === root || o.startsWith(`${root.replace(/\/$/, "")}/`)
  return true
}

/**
 * Does this grep/rg/ag invocation search the repo? `rest` is the text after the command word.
 * grep family: needs a recursive flag before `--`. rg/ag: always recursive. Repo search means at
 * least one path operand is a repo path, or there is none (implicit cwd). Operands that are all
 * outside the repo (absolute elsewhere, `~`, `$VAR`, `node_modules`) are not repo search.
 */
function searchesRepo(cmd: string, rest: string, root: string): boolean {
  const seg = rest.split(/\|\||\||;|\n|&&|\)|`/)[0] as string
  const toks = seg.split(/\s+/).filter((t) => t.length > 0)
  const rg = cmd === "rg" || cmd === "ag"
  const valueShort = rg ? VALUE_SHORT_RG : VALUE_SHORT_GREP
  let recursive = rg
  let hasPattern = false
  let pastDashes = false
  const positionals: string[] = []
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i] as string
    if (/^\d*(?:[<>]|&>)/.test(t)) {
      if (/^\d*>{1,2}$/.test(t) || t === "<") i++
      continue
    }
    if (pastDashes || t === "-" || !t.startsWith("-")) {
      positionals.push(t)
      continue
    }
    if (t === "--") {
      pastDashes = true
      continue
    }
    if (t.startsWith("--")) {
      const name = t.slice(2).split("=")[0] as string
      if (name === "version" || name === "help") return false
      if (name === "recursive" || name === "dereference-recursive") recursive = true
      if (name === "regexp" || name === "file") hasPattern = true
      if (VALUE_LONG.has(name) && !t.includes("=")) i++
      continue
    }
    if (rg && (t === "-V" || t === "-h")) return false
    if (!rg && /[rR]/.test(t)) recursive = true
    const last = t[t.length - 1] as string
    if (valueShort.includes(last)) {
      if (last === "e" || last === "f") hasPattern = true
      i++
    }
  }
  if (!recursive) return false
  if (!hasPattern) positionals.shift()
  return positionals.length === 0 || positionals.some((op) => isRepoPath(op, root))
}

/** The first match of `rule` against an already-parsed command, or null. */
function matchRule(rule: HookRule, p: Parsed, ctx: HookCtx): RegExpExecArray | null {
  const text = target(p, rule.match.notInside ?? [])
  if (rule.match.check === undefined) return compile(rule.match.command).exec(text)
  const root = ctx.root ?? process.cwd()
  for (const m of text.matchAll(new RegExp(rule.match.command, "g"))) {
    const cmd = m.groups?.cmd
    if (cmd === undefined || searchesRepo(cmd, text.slice(m.index + m[0].length), root)) return m
  }
  return null
}

/**
 * Classify a Bash command against `rules`. Generic engine: all policy lives in the rules.
 * Override: `REPO_ALLOW=<ruleId>[,<ruleId>]` plus a non-empty `REPO_ALLOW_REASON`, read from `env`
 * or from leading `VAR=value` tokens on the command (the prefix wins).
 */
export function classifyBash(
  command: string,
  rules: readonly HookRule[],
  env: Readonly<Record<string, string | undefined>>,
  ctx: HookCtx = {},
): HookDecision {
  const { env: prefix, rest } = leadingAssignments(command)
  const allowed = (prefix.REPO_ALLOW ?? env.REPO_ALLOW ?? "").split(/[\s,]+/).filter((s) => s.length > 0)
  const why = (prefix.REPO_ALLOW_REASON ?? env.REPO_ALLOW_REASON ?? "").trim()
  const parsed = parse(rest)
  const overrides: { ruleId: string; reason: string }[] = []
  let warned: HookDecision | undefined
  for (const rule of rules) {
    const m = matchRule(rule, parsed, ctx)
    if (!m) continue
    if (why.length > 0 && allowed.includes(rule.id)) overrides.push({ ruleId: rule.id, reason: why })
    else if (rule.mode === "warn") warned ??= { decision: "warn", ruleId: rule.id, reason: denyText(rule, m.groups) }
    else return { decision: "deny", ruleId: rule.id, reason: denyText(rule, m.groups) }
  }
  if (warned !== undefined) return warned
  return overrides.length > 0 ? { decision: "allow", overrides } : { decision: "allow" }
}

function str(v: unknown, what: string): string {
  if (typeof v !== "string" || v.length === 0) throw new Error(`rules.json: ${what} must be a non-empty string`)
  return v
}

function strs(v: unknown, what: string): readonly string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new Error(`rules.json: ${what} must be a string array`)
  return v as string[]
}

/** Load and shape-check `tools/repo/rules.json`. Throws naming the problem (callers fail open or closed). */
export function loadRules(root: string): readonly HookRule[] {
  const doc = readManifest(root, "rules.json")
  if (!Array.isArray(doc.rules)) throw new Error("rules.json: `rules` must be an array")
  return doc.rules.map((r: unknown, i) => {
    const o = (typeof r === "object" && r !== null ? r : {}) as Record<string, unknown>
    const id = str(o.id, `rules[${i}].id`)
    const m = (typeof o.match === "object" && o.match !== null ? o.match : {}) as Record<string, unknown>
    const ex = (typeof o.examples === "object" && o.examples !== null ? o.examples : {}) as Record<string, unknown>
    const notInside = m.notInside === undefined ? [] : strs(m.notInside, `${id}.match.notInside`)
    for (const n of notInside)
      if (n !== "quotes" && n !== "quotes-opaque" && n !== "heredoc-to-file") throw new Error(`rules.json: ${id} has unknown notInside ${n}`)
    const command = str(m.command, `${id}.match.command`)
    try {
      new RegExp(command)
    } catch {
      throw new Error(`rules.json: ${id}.match.command is not a valid regex`)
    }
    const reviewBy = str(o.reviewBy, `${id}.reviewBy`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewBy)) throw new Error(`rules.json: ${id}.reviewBy must be YYYY-MM-DD`)
    return {
      id,
      match: {
        command,
        notInside: notInside as NotInside[],
        ...(m.check === "repo-search" ? { check: "repo-search" as const } : {}),
      },
      reason: str(o.reason, `${id}.reason`),
      alternative: str(o.alternative, `${id}.alternative`),
      owner: str(o.owner, `${id}.owner`),
      reviewBy,
      mode: parseMode(o.mode, `rules.json: ${id}`),
      examples: { allow: strs(ex.allow, `${id}.examples.allow`), deny: strs(ex.deny, `${id}.examples.deny`) },
    }
  })
}

/** Self-check: unique ids, >=2 allow and >=2 deny examples per rule, and every example behaves as labelled. */
export function ruleProblems(rules: readonly HookRule[]): readonly { message: string; next: string }[] {
  const out: { message: string; next: string }[] = []
  const seen = new Set<string>()
  for (const r of rules) {
    const at = `tools/repo/rules.json#${r.id}`
    if (seen.has(r.id)) out.push({ message: `duplicate rule id ${r.id}`, next: `rename a duplicate ${at}` })
    seen.add(r.id)
    if (r.examples.allow.length < 2 || r.examples.deny.length < 2)
      out.push({ message: `${r.id}: needs >=2 allow and >=2 deny examples`, next: `add examples to ${at}` })
    const over = budgetProblem(renderRuleText(r))
    if (over !== undefined) out.push({ message: `${r.id}: rendered message is ${over}`, next: `shorten reason/alternative in ${at}` })
    if (!namesCommand(r.alternative))
      out.push({ message: `${r.id}: alternative must name a command or tool in backticks`, next: `put the fix in backticks in ${at}` })
    for (const d of r.examples.deny)
      if (classifyBash(d, [r], {}).decision === "allow")
        out.push({ message: `${r.id}: deny example not denied: ${JSON.stringify(d)}`, next: `fix examples or match in ${at}` })
    for (const a of r.examples.allow) {
      const v = classifyBash(a, rules, {})
      if (v.decision !== "allow")
        out.push({ message: `${r.id}: allow example denied by ${v.ruleId}: ${JSON.stringify(a)}`, next: `fix examples or match in ${at}` })
    }
  }
  return out
}
