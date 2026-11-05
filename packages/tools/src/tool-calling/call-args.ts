/**
 * THE argument grammar for assistant-text tool calls (canonical tool-call
 * extraction D1): every text tier — call form `name(args)`, dialect markers,
 * CLI positionals — reads argument values through here, so there is exactly
 * one notion of "a literal argument".
 *
 * Order: JSON → lenient JSON (incl. unquoted identifier keys) → `key: value` /
 * `key=value` pairs → a single positional, ONLY when the schema has exactly
 * one required param. A non-literal value (`roundedMean.toString()`, a bare
 * identifier, a `${}` template) makes the call `unparseable`; it is never
 * wrapped into a string (D4: the healer gets typed args or nothing).
 */
import type { ResolverToolHint } from "./types.js"
import { isRecord, parseLenient, quoteBareKeys } from "./lenient-json.js"

/**
 * Which grammar arm produced the args. `taught` / `xml` mark the two
 * dialects whose values are raw text by construction.
 */
export type ArgParse = "empty" | "json" | "lenient-json" | "key-value" | "positional" | "taught" | "xml"

/** Result of {@link parseCallArgs}. */
export type CallArgsParse =
  | { readonly _tag: "ok"; readonly args: Record<string, unknown>; readonly argParse: ArgParse }
  | { readonly _tag: "unparseable"; readonly reason: string }

/** Extracts the substring between a balanced `(` at `openIdx` and its matching `)`. */
export function extractBalancedArgs(source: string, openIdx: number): string | null {
  if (source[openIdx] !== "(") return null
  let depth = 0
  let inStr: string | null = null
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i]!
    if (inStr) {
      if (ch === "\\") { i++; continue }
      if (ch === inStr) inStr = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue }
    if (ch === "(") depth++
    else if (ch === ")") {
      depth--
      if (depth === 0) return source.slice(openIdx + 1, i)
    }
  }
  return null
}

/** Split on top-level commas (outside strings and brackets). */
function splitTopLevel(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let inStr: string | null = null
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (inStr) {
      if (ch === "\\") { i++; continue }
      if (ch === inStr) inStr = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue }
    if (ch === "(" || ch === "[" || ch === "{") depth++
    else if (ch === ")" || ch === "]" || ch === "}") depth--
    else if (ch === "," && depth === 0) {
      parts.push(s.slice(start, i))
      start = i + 1
    }
  }
  parts.push(s.slice(start))
  return parts.map((p) => p.trim()).filter((p) => p.length > 0)
}

const ESCAPES: Readonly<Record<string, string>> = { n: "\n", t: "\t", r: "\r", "0": "\0" }

/** A whole quoted string literal (`"…"`, `'…'`, or a `${}`-free template); undefined otherwise. */
function readQuoted(raw: string): string | undefined {
  const q = raw[0]
  if (q !== '"' && q !== "'" && q !== "`") return undefined
  let body = ""
  for (let i = 1; i < raw.length; i++) {
    const ch = raw[i]!
    if (ch === "\\") {
      const nx = raw[i + 1]
      if (nx === undefined) return undefined
      body += ESCAPES[nx] ?? nx
      i++
      continue
    }
    if (ch === q) return i === raw.length - 1 ? body : undefined
    if (q === "`" && ch === "$" && raw[i + 1] === "{") return undefined
    body += ch
  }
  return undefined
}

/** Parse one literal value; `{ ok: false }` for anything that would need evaluation. */
export function parseLiteral(raw: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  const t = raw.trim()
  if (t.length === 0) return { ok: false }
  const quoted = readQuoted(t)
  if (quoted !== undefined) return { ok: true, value: quoted }
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(t)) return { ok: true, value: Number(t) }
  if (t === "true" || t === "True") return { ok: true, value: true }
  if (t === "false" || t === "False") return { ok: true, value: false }
  if (t === "null" || t === "None") return { ok: true, value: null }
  if (t.startsWith("{") || t.startsWith("[")) {
    const v = parseStructured(t)
    if (v !== undefined) return { ok: true, value: v }
  }
  return { ok: false }
}

function parseStructured(t: string): unknown | undefined {
  try { return JSON.parse(t) as unknown } catch { /* lenient below */ }
  return parseLenient(quoteBareKeys(t))
}

const KV_RE = /^([A-Za-z_$][\w$-]*)\s*[:=]\s*([\s\S]+)$/

/**
 * The one parameter a lone positional may bind to: the schema's single
 * required param (when not already given by name). When the surface carries
 * no required-param facts, a tool with exactly one declared param qualifies.
 */
function positionalTarget(tool: ResolverToolHint, given: ReadonlySet<string>): string | undefined {
  if (tool.requiredParams !== undefined) {
    return tool.requiredParams.length === 1 && !given.has(tool.requiredParams[0]!)
      ? tool.requiredParams[0]
      : undefined
  }
  const names = tool.paramNames ?? []
  return names.length === 1 && !given.has(names[0]!) ? names[0] : undefined
}

/** Bind a lone positional literal to the schema's single required param. */
export function bindPositional(
  value: unknown,
  tool: ResolverToolHint,
  given: Record<string, unknown> = {},
): CallArgsParse {
  const target = positionalTarget(tool, new Set(Object.keys(given)))
  if (target === undefined) {
    return { _tag: "unparseable", reason: `a positional argument needs exactly one required param on ${tool.name}` }
  }
  return { _tag: "ok", args: { ...given, [target]: value }, argParse: "positional" }
}

/**
 * Parse the raw text between a call's parentheses (or a marker's braces)
 * into typed args for `tool`.
 *
 * @param raw  argument text, without the surrounding `(`/`)`
 * @param tool the resolved tool's surface hint (param facts anchor positionals)
 */
export function parseCallArgs(raw: string, tool: ResolverToolHint): CallArgsParse {
  const t = raw.trim()
  if (t.length === 0) return { _tag: "ok", args: {}, argParse: "empty" }

  if (t.startsWith("{")) {
    try {
      const strict = JSON.parse(t) as unknown
      if (isRecord(strict)) return { _tag: "ok", args: strict, argParse: "json" }
    } catch { /* lenient below */ }
    const lenient = parseLenient(quoteBareKeys(t))
    if (isRecord(lenient) && splitTopLevel(t).length === 1) {
      return { _tag: "ok", args: lenient, argParse: "lenient-json" }
    }
    if (splitTopLevel(t).length === 1) {
      return { _tag: "unparseable", reason: "argument object holds a non-literal value" }
    }
  }

  const args: Record<string, unknown> = {}
  const positionals: unknown[] = []
  for (const part of splitTopLevel(t)) {
    const kv = KV_RE.exec(part)
    const lit = parseLiteral(kv ? kv[2]! : part)
    if (!lit.ok) {
      return { _tag: "unparseable", reason: kv ? `non-literal value for "${kv[1]}"` : "non-literal argument" }
    }
    if (kv) args[kv[1]!] = lit.value
    else positionals.push(lit.value)
  }
  if (positionals.length > 1) return { _tag: "unparseable", reason: "more than one positional argument" }
  if (positionals.length === 1) return bindPositional(positionals[0], tool, args)
  return { _tag: "ok", args, argParse: "key-value" }
}
