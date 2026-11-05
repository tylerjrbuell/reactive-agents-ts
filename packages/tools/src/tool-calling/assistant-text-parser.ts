/**
 * THE assistant-text tool-call parser (canonical tool-call extraction D1:
 * wiki/Architecture/Design-Specs/2026-11-03-canonical-tool-call-extraction.md).
 *
 * `parseAssistantToolCalls(content, surface)` reads tool calls a model PRINTED
 * instead of emitting natively. Tiers run highest fidelity first; the first
 * tier that finds any candidate decides the turn:
 *
 *   1. taught markup   `<tool_use>` / legacy `<tool_call>` / bare `tool:` blocks
 *   2. dialect markers Gemma `<|tool_call>call:NAME{…}`, `<function=NAME>` XML
 *   3. JSON            objects / arrays / wrappers, lenient; nameless shape match
 *   4. call form       `name(args)` in a fence, or as the whole reply
 *   5. CLI form        `name key=v` / `--key v` / one positional, in shell fences
 *
 * Argument values go through ONE grammar (`parseCallArgs`). A candidate that
 * names a surface tool but cannot be read as literal args makes the whole turn
 * `unparseable` — it is never executed with guessed args (D4). A reply that
 * matches no tier but is still call-SHAPED is `unparseable` too, so it can
 * never become a final answer.
 *
 * SECURITY (D7): feed ONLY the assistant's own reply. Never tool results,
 * retrieved documents or other third-party text — executing calls found there
 * is a prompt-injection vector. Names resolve only against `surface`; a call
 * embedded in an expression executes only for `riskLevel: "low"` tools;
 * policy / approval gates still run downstream on every executed call.
 */
import type { CallExtraction, ResolverToolHint, TextCallTier, ToolCallSpec } from "./types.js"
import { normalizeArgumentsForResolvedTool, resolveToolName, resolveToolNameStrict } from "./name-resolution.js"
import {
  bindPositional,
  extractBalancedArgs,
  parseCallArgs,
  parseLiteral,
  type ArgParse,
  type CallArgsParse,
} from "./call-args.js"
import { isRecord, parseLenient, scanRegion } from "./lenient-json.js"
import { parseTaughtBlocks } from "./taught-markup.js"
import { detectToolCallShape } from "./tool-call-shape.js"

/** A tool call parsed from assistant text, with its provenance. */
export type ExtractedToolCall = ToolCallSpec & { readonly extraction: CallExtraction }

/** Result of {@link parseAssistantToolCalls}. */
export type TextCallParse =
  | { readonly _tag: "parsed"; readonly calls: readonly ExtractedToolCall[] }
  | { readonly _tag: "unparseable"; readonly names: readonly string[]; readonly reason: string }
  | { readonly _tag: "none" }

/** Upper bound on parsed content; longer replies are not scanned for calls. */
const MAX_CONTENT = 200_000

interface Ctx {
  readonly content: string
  readonly names: ReadonlySet<string>
  readonly byName: ReadonlyMap<string, ResolverToolHint>
  next: number
}

type Candidate =
  | { readonly _tag: "call"; readonly call: ExtractedToolCall }
  | { readonly _tag: "fail"; readonly name: string; readonly reason: string }

interface Located {
  readonly name: string
  readonly parsed: CallArgsParse
  readonly tier: TextCallTier
  readonly dialect: string
  readonly idPrefix: string
  readonly start: number
  readonly end: number
  readonly form: "standalone" | "embedded"
}

const fail = (name: string, reason: string): Candidate => ({ _tag: "fail", name, reason })

/** Turn a located call into a candidate, applying the embedded-form risk gate (D7c). */
function candidate(ctx: Ctx, loc: Located): Candidate {
  if (loc.parsed._tag === "unparseable") return fail(loc.name, loc.parsed.reason)
  const hint = ctx.byName.get(loc.name)
  if (loc.form === "embedded" && hint?.riskLevel !== "low") {
    return fail(loc.name, "the call is embedded in an expression; call it on its own")
  }
  return {
    _tag: "call",
    call: {
      id: `${loc.idPrefix}_${loc.name}_${ctx.next++}`,
      name: loc.name,
      arguments: normalizeArgumentsForResolvedTool(loc.name, loc.parsed.args),
      extraction: {
        source: "text",
        dialect: loc.dialect,
        tier: loc.tier,
        argParse: loc.parsed.argParse,
        span: { start: loc.start, end: loc.end },
        form: loc.form,
      },
    },
  }
}

const ok = (args: Record<string, unknown>, argParse: ArgParse): CallArgsParse => ({ _tag: "ok", args, argParse })

// ── Tier 1: taught markup ────────────────────────────────────────────────────

function taughtTier(ctx: Ctx): Candidate[] {
  const out: Candidate[] = []
  for (const block of parseTaughtBlocks(ctx.content)) {
    const name = resolveToolName(block.name, ctx.names)
    if (!name) {
      // A wrapped block is unambiguous intent; a bare `tool:` line in prose is not.
      if (block.wrapped) out.push(fail(block.name, "the tool is not available"))
      continue
    }
    out.push(candidate(ctx, {
      name, parsed: ok(block.args, "taught"), tier: "taught-markup", dialect: "taught",
      idPrefix: "taught", start: block.start, end: block.end, form: "standalone",
    }))
  }
  return out
}

// ── Tier 2: dialect markers ──────────────────────────────────────────────────

const GEMMA_MARKER_RE = /<\|?tool_call\|?>\s*call:\s*([\w.:/-]+)\s*\{([\s\S]*?)\}\s*<\|?tool_call\|?>/g
const FUNCTION_XML_RE = /<function=([\w.:/-]+)>([\s\S]*?)(?:<\/function>|$)/g

function markerTier(ctx: Ctx): Candidate[] {
  const out: Candidate[] = []
  for (const m of ctx.content.matchAll(GEMMA_MARKER_RE)) {
    const name = resolveToolName(m[1]!, ctx.names)
    if (!name) { out.push(fail(m[1]!, "the tool is not available")); continue }
    const start = m.index ?? 0
    out.push(candidate(ctx, {
      name, parsed: parseCallArgs(`{${m[2]!}}`, ctx.byName.get(name)!), tier: "dialect-marker",
      dialect: "gemma-marker", idPrefix: "marker", start, end: start + m[0].length, form: "standalone",
    }))
  }
  for (const m of ctx.content.matchAll(FUNCTION_XML_RE)) {
    const name = resolveToolName(m[1]!, ctx.names)
    if (!name) { out.push(fail(m[1]!, "the tool is not available")); continue }
    const args: Record<string, unknown> = {}
    for (const p of m[2]!.matchAll(/<parameter=([\w.-]+)>([\s\S]*?)<\/parameter>/g)) {
      // XML parameter bodies are raw text by design: a literal when one, else the text.
      const raw = p[2]!.trim()
      const lit = parseLiteral(raw)
      args[p[1]!] = lit.ok ? lit.value : raw
    }
    const start = m.index ?? 0
    out.push(candidate(ctx, {
      name, parsed: ok(args, "xml"), tier: "dialect-marker", dialect: "function-xml",
      idPrefix: "dialectxml", start, end: start + m[0].length, form: "standalone",
    }))
  }
  return out
}

// ── Tier 3: JSON ─────────────────────────────────────────────────────────────

/** Flatten a parsed JSON value into candidate call objects. */
function flattenCalls(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 2) return []
  if (Array.isArray(value)) return value.flatMap((v) => flattenCalls(v, depth + 1))
  if (!isRecord(value)) return []
  if (Array.isArray(value.tool_calls)) return flattenCalls(value.tool_calls, depth + 1)
  return [value]
}

function callFromObject(obj: Record<string, unknown>): { name: string; args: unknown } | null {
  const fn = obj.function
  if (isRecord(fn) && typeof fn.name === "string") {
    return { name: fn.name, args: fn.arguments ?? fn.parameters ?? fn.args ?? {} }
  }
  const name =
    typeof obj.name === "string" ? obj.name
    : typeof obj.tool === "string" ? obj.tool
    : typeof obj.tool_name === "string" ? obj.tool_name
    : typeof fn === "string" ? fn
    : null
  if (!name) return null
  return { name, args: obj.arguments ?? obj.parameters ?? obj.args ?? obj.input ?? {} }
}

/**
 * Nameless shape match: the object's keys are all declared params of EXACTLY
 * one surface tool (observed: cogito printing spawn-agent args in a ```json
 * block without naming the tool). Ambiguity stays unmatched.
 */
function shapeMatch(obj: Record<string, unknown>, ctx: Ctx): string | null {
  const keys = Object.keys(obj)
  if (keys.length === 0) return null
  const matches = [...ctx.byName.values()].filter((t) => {
    const params = new Set(t.paramNames ?? [])
    return params.size > 0 && keys.every((k) => params.has(k))
  })
  return matches.length === 1 ? matches[0]!.name : null
}

function jsonTier(ctx: Ctx): Candidate[] {
  const { content } = ctx
  const standalone = new Set<string>([content.trim(), ...fences(content).map((f) => f.body.trim())])
  const out: Candidate[] = []
  let i = 0
  while (i < content.length) {
    const ch = content[i]
    if (ch !== "{" && ch !== "[") { i++; continue }
    const { end } = scanRegion(content, i)
    const region = content.slice(i, end)
    const parsed = parseLenient(region)
    if (parsed === undefined) { i++; continue }
    let named = 0
    for (const obj of flattenCalls(parsed)) {
      const c = callFromObject(obj)
      const name = c ? resolveToolName(c.name, ctx.names) : null
      if (!c || !name) continue
      named++
      const args = typeof c.args === "string" ? (parseLenient(c.args) ?? c.args) : c.args
      out.push(candidate(ctx, {
        name, parsed: ok(isRecord(args) ? args : {}, "json"), tier: "json", dialect: "json",
        idPrefix: "dialectjson", start: i, end, form: "standalone",
      }))
    }
    if (named === 0 && standalone.has(region.trim()) && isRecord(parsed) && strictJson(region)) {
      const name = shapeMatch(parsed, ctx)
      if (name) {
        out.push(candidate(ctx, {
          name, parsed: ok(parsed, "json"), tier: "json", dialect: "nameless-shape",
          idPrefix: "shape", start: i, end, form: "standalone",
        }))
      }
    }
    i = end
  }
  return out
}

function strictJson(text: string): boolean {
  try { JSON.parse(text); return true } catch { return false }
}

// ── Fences ───────────────────────────────────────────────────────────────────

interface Fence { readonly lang: string; readonly body: string; readonly start: number }

function fences(content: string): Fence[] {
  const out: Fence[] = []
  for (const m of content.matchAll(/```([\w+#.-]*)[^\n`]*\n?([\s\S]*?)```/g)) {
    const body = m[2]!
    out.push({ lang: m[1]!.toLowerCase(), body, start: (m.index ?? 0) + m[0].length - 3 - body.length })
  }
  return out
}

// ── Tier 4: call form name(args) ─────────────────────────────────────────────

const CALL_START_RE = /(^|[^\w$.-])([A-Za-z_$][\w$.-]*)\s*\(/g

function callsInScope(ctx: Ctx, text: string, offset: number, requireWhole: boolean): Candidate[] {
  const out: Candidate[] = []
  CALL_START_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CALL_START_RE.exec(text)) !== null) {
    const name = resolveToolNameStrict(m[2]!, ctx.names)
    if (!name) continue
    const nameStart = m.index + m[1]!.length
    const open = CALL_START_RE.lastIndex - 1
    const raw = extractBalancedArgs(text, open)
    if (raw === null) { out.push(fail(name, "unbalanced parentheses")); break }
    const end = open + raw.length + 2
    const lineStart = text.lastIndexOf("\n", nameStart - 1) + 1
    const nl = text.indexOf("\n", end)
    const prefix = text.slice(lineStart, nameStart).trim()
    const suffix = text.slice(end, nl === -1 ? text.length : nl).trim()
    const standalone = (prefix === "" || prefix === "await") && (suffix === "" || suffix === ";")
    if (requireWhole && !standalone) return []
    out.push(candidate(ctx, {
      name, parsed: parseCallArgs(raw, ctx.byName.get(name)!), tier: "call-form", dialect: "call",
      idPrefix: "pseudo", start: offset + nameStart, end: offset + end,
      form: standalone ? "standalone" : "embedded",
    }))
    CALL_START_RE.lastIndex = end
  }
  return out
}

function callFormTier(ctx: Ctx): Candidate[] {
  const fs = fences(ctx.content)
  if (fs.length > 0) return fs.flatMap((f) => callsInScope(ctx, f.body, f.start, false))
  // Unfenced: only a reply that IS one call statement — never a call mid-prose.
  const trimmed = ctx.content.trim()
  if (trimmed.includes("\n")) return []
  return callsInScope(ctx, trimmed, ctx.content.indexOf(trimmed), true)
}

// ── Tier 5: CLI form in shell fences ─────────────────────────────────────────

const SHELL_LANGS = new Set(["", "bash", "sh", "shell", "zsh", "console", "terminal", "cmd", "powershell", "ps", "ps1"])
const SHELL_OPERATOR_RE = /\||&&|;|>|<|\$\(|`/

/** Shell-like split honoring quotes; null on an unclosed quote. */
function shellTokens(line: string): string[] | null {
  const out: string[] = []
  let cur = ""
  let has = false
  let q: string | null = null
  for (const ch of line) {
    if (q) {
      if (ch === q) q = null
      else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") { q = ch; has = true; continue }
    if (/\s/.test(ch)) {
      if (has || cur) out.push(cur)
      cur = ""
      has = false
      continue
    }
    cur += ch
  }
  if (q) return null
  if (has || cur) out.push(cur)
  return out
}

const normKey = (s: string): string => s.toLowerCase().replace(/[-_]/g, "")

/** Schema-anchored CLI args: every flag/key must be a declared param. */
function cliArgs(tokens: readonly string[], hint: ResolverToolHint): CallArgsParse {
  const params = new Map((hint.paramNames ?? []).map((p) => [normKey(p), p] as const))
  const args: Record<string, unknown> = {}
  const positionals: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!
    const flag = /^--?([A-Za-z][\w-]*)(?:=([\s\S]*))?$/.exec(tok)
    const kv = flag ? null : /^([A-Za-z_][\w-]*)=([\s\S]*)$/.exec(tok)
    if (flag || kv) {
      const key = params.get(normKey((flag ?? kv)![1]!))
      if (!key) return { _tag: "unparseable", reason: `"${tok}" is not a declared param of ${hint.name}` }
      let value = flag ? flag[2] : kv![2]
      if (value === undefined) {
        value = tokens[i + 1]
        if (value === undefined || value.startsWith("-")) {
          return { _tag: "unparseable", reason: `missing value for ${tok}` }
        }
        i++
      }
      args[key] = value
    } else positionals.push(tok)
  }
  if (positionals.length > 1) return { _tag: "unparseable", reason: "more than one positional argument" }
  if (positionals.length === 1) return bindPositional(positionals[0], hint, args)
  return { _tag: "ok", args, argParse: "key-value" }
}

function cliTier(ctx: Ctx): Candidate[] {
  const out: Candidate[] = []
  for (const f of fences(ctx.content)) {
    if (!SHELL_LANGS.has(f.lang)) continue
    let offset = f.start
    for (const rawLine of f.body.split("\n")) {
      const lineStart = offset
      offset += rawLine.length + 1
      const line = rawLine.trim().replace(/^[$>]\s+/, "")
      if (line === "" || line.startsWith("#")) continue
      const tokens = shellTokens(line)
      if (!tokens || tokens.length < 2) continue
      const name = resolveToolNameStrict(tokens[0]!, ctx.names)
      if (!name) continue
      const embedded = SHELL_OPERATOR_RE.test(line)
      out.push(candidate(ctx, {
        name, parsed: cliArgs(tokens.slice(1), ctx.byName.get(name)!), tier: "cli-form", dialect: "cli",
        idPrefix: "cli", start: lineStart, end: lineStart + rawLine.length,
        form: embedded ? "embedded" : "standalone",
      }))
    }
  }
  return out
}

// ── Entry point ──────────────────────────────────────────────────────────────

const TIERS: readonly ((ctx: Ctx) => Candidate[])[] = [taughtTier, markerTier, jsonTier, callFormTier, cliTier]

/**
 * Parse tool calls printed in the assistant's OWN reply against this turn's
 * callable surface.
 *
 * @param content the assistant's reply text (never tool output — see D7a)
 * @param surface this turn's callable tools; names resolve only against it
 * @returns `parsed` calls with provenance; `unparseable` when the reply is a
 *   tool call that cannot be read as literal args (reprompt, never execute);
 *   `none` for an ordinary reply
 */
export function parseAssistantToolCalls(
  content: string,
  surface: readonly ResolverToolHint[],
): TextCallParse {
  if (surface.length === 0 || content.trim().length === 0 || content.length > MAX_CONTENT) {
    return { _tag: "none" }
  }
  const ctx: Ctx = {
    content,
    names: new Set(surface.map((t) => t.name)),
    byName: new Map(surface.map((t) => [t.name, t] as const)),
    next: 0,
  }
  for (const tier of TIERS) {
    const found = tier(ctx)
    if (found.length === 0) continue
    const fails = found.filter((c): c is Extract<Candidate, { _tag: "fail" }> => c._tag === "fail")
    if (fails.length > 0) {
      return { _tag: "unparseable", names: [...new Set(fails.map((f) => f.name))], reason: fails[0]!.reason }
    }
    return {
      _tag: "parsed",
      calls: found.flatMap((c) => (c._tag === "call" ? [c.call] : [])),
    }
  }
  const shape = detectToolCallShape(content, ctx.names)
  return shape.shaped
    ? { _tag: "unparseable", names: shape.names, reason: "the reply is shaped like a tool call but did not parse" }
    : { _tag: "none" }
}
