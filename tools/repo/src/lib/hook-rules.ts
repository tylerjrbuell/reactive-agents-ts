import { readManifest } from "./manifest.ts"

/** Text regions a rule's `match.command` must not look inside. */
export type NotInside = "quotes" | "heredoc-to-file"

/** One PreToolUse Bash rule, loaded from `tools/repo/rules.json`. */
export interface HookRule {
  id: string
  /** `command` is a regex source applied to the command after `notInside` regions are stripped. */
  match: { command: string; notInside?: readonly NotInside[] }
  reason: string
  /** Shown after `reason`; `{name}` is replaced by the regex's named group `name` (else `<name>`). */
  alternative: string
  owner: string
  /** ISO date; see `manifest-expiry`. */
  reviewBy: string
  examples: { allow: readonly string[]; deny: readonly string[] }
}

/** Verdict for one Bash command. An allow may carry the overrides that made it so (for logging). */
export type HookDecision =
  | { decision: "allow"; overrides?: readonly { ruleId: string; reason: string }[] }
  | { decision: "deny"; ruleId: string; reason: string }

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

interface Parsed {
  raw: string
  stripped: string
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
  let q = ""
  let lineStart = 0
  const pending: { delim: string; dash: boolean }[] = []
  const bodies: { text: string; exec: boolean }[] = []
  let i = 0
  while (i < command.length) {
    const c = command[i] as string
    if (q === "'") {
      raw += c
      if (c === "'") (q = ""), (stripped += c)
      i++
      continue
    }
    if (q === '"') {
      if (c === "$" && command[i + 1] === "(") {
        const end = skipSubshell(command, i + 1)
        raw += command.slice(i, end)
        i = end
        continue
      }
      raw += c
      if (c === "\\" && i + 1 < command.length) raw += command[++i] as string
      else if (c === '"') (q = ""), (stripped += c)
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
      i += 2
      continue
    }
    if (c === "'" || c === '"') {
      q = c
      raw += c
      stripped += c
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
    i++
  }
  return { raw, stripped, bodies }
}

/** The text `rule.match.command` is applied to, per its `notInside`. */
function target(p: Parsed, notInside: readonly NotInside[]): string {
  let t = notInside.includes("quotes") ? p.stripped : p.raw
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

function denyText(rule: HookRule, m: RegExpExecArray): string {
  const alt = `${fill(rule.alternative, m.groups)} (override: REPO_ALLOW=${rule.id} REPO_ALLOW_REASON="<why>")`
  return `${rule.reason}\n${alt}\n[source: tools/repo/rules.json#${rule.id}]`
}

/** The match of `rule` against an already-parsed command, or null. */
function matchRule(rule: HookRule, p: Parsed): RegExpExecArray | null {
  return compile(rule.match.command).exec(target(p, rule.match.notInside ?? []))
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
): HookDecision {
  const { env: prefix, rest } = leadingAssignments(command)
  const allowed = (prefix.REPO_ALLOW ?? env.REPO_ALLOW ?? "").split(/[\s,]+/).filter((s) => s.length > 0)
  const why = (prefix.REPO_ALLOW_REASON ?? env.REPO_ALLOW_REASON ?? "").trim()
  const parsed = parse(rest)
  const overrides: { ruleId: string; reason: string }[] = []
  for (const rule of rules) {
    const m = matchRule(rule, parsed)
    if (!m) continue
    if (why.length > 0 && allowed.includes(rule.id)) overrides.push({ ruleId: rule.id, reason: why })
    else return { decision: "deny", ruleId: rule.id, reason: denyText(rule, m) }
  }
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
      if (n !== "quotes" && n !== "heredoc-to-file") throw new Error(`rules.json: ${id} has unknown notInside ${n}`)
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
      match: { command, notInside: notInside as NotInside[] },
      reason: str(o.reason, `${id}.reason`),
      alternative: str(o.alternative, `${id}.alternative`),
      owner: str(o.owner, `${id}.owner`),
      reviewBy,
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
    for (const d of r.examples.deny)
      if (classifyBash(d, [r], {}).decision !== "deny")
        out.push({ message: `${r.id}: deny example not denied: ${JSON.stringify(d)}`, next: `fix examples or match in ${at}` })
    for (const a of r.examples.allow) {
      const v = classifyBash(a, rules, {})
      if (v.decision === "deny")
        out.push({ message: `${r.id}: allow example denied by ${v.ruleId}: ${JSON.stringify(a)}`, next: `fix examples or match in ${at}` })
    }
  }
  return out
}
