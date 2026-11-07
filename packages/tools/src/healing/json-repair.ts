/**
 * json-repair.ts — the one JSON repair primitive in `@reactive-agents/tools`.
 *
 * Two repair strengths over one result type:
 *
 * - {@link repairJsonLenient}: tool-call ARGUMENTS read from assistant text.
 *   Drops trailing commas, converts single-quoted strings, closes truncated
 *   containers. Used by `tool-calling/lenient-json.ts`.
 * - {@link repairJsonQuotes}: a DELIVERABLE (file content). Only inserts
 *   backslashes before double quotes that sit inside a string value, and only
 *   when exactly one escape set makes the text parse. Nothing else changes.
 *
 * Live witness for the quote repair (leverage scan 2026-11-07, item 1): 45 of
 * 72 failed tool calls on the benchmark cohorts were file-write refusing a
 * `.json` content; 41 of 46 refused contents carried a quote copied from the
 * task text, e.g. `"question": "What is the "component model"?"`.
 *
 * Pure; never evaluates code.
 */
import { hasFileExtension } from "./path-resolver.js"

/** File extensions whose content must parse as JSON. Shared with file-write. */
export const JSON_FILE_EXTENSIONS: ReadonlySet<string> = new Set([".json", ".jsonl", ".ndjson", ".geojson"])

/** True when `filePath` ends in a {@link JSON_FILE_EXTENSIONS} extension (case-insensitive). */
export function isJsonFilePath(filePath: string): boolean {
  return hasFileExtension(filePath, JSON_FILE_EXTENSIONS)
}

/** One change a repair made. `at` is the index in the ORIGINAL text. */
export interface JsonRepairEdit {
  readonly kind: "escape-quote" | "drop-trailing-comma" | "single-quote" | "close-container"
  readonly at: number
}

/** Why a repair was refused. */
export type JsonRepairRefusal =
  /** No repair of this strength makes the text parse. */
  | "unrepairable"
  /** More than one escape set parses; the primitive does not guess. */
  | "ambiguous"
  /** The repaired keys differ from the keys a structural scan of the input sees. */
  | "keys-changed"
  /** Input too large for the bounded search. */
  | "too-large"

/** Result of a repair. A valid input comes back `ok` with zero edits. */
export type JsonRepairResult =
  | {
      readonly ok: true
      readonly value: unknown
      /** The text that parses (equal to the input when `edits` is empty). */
      readonly text: string
      readonly edits: readonly JsonRepairEdit[]
    }
  | { readonly ok: false; readonly reason: JsonRepairRefusal }

type Parsed = { readonly ok: true; readonly value: unknown } | { readonly ok: false }

function tryParse(text: string): Parsed {
  try {
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch {
    return { ok: false }
  }
}

// ── Lenient repair (tool-call arguments) ─────────────────────────────────────

/**
 * Lenient JSON repair: trailing commas, single-quoted strings, and truncation
 * (missing closers). Refuses when the repair would be ambiguous (truncated
 * inside a string, dangling `key:`, mismatched closers) or does not parse.
 */
export function repairJsonLenient(text: string): JsonRepairResult {
  const strict = tryParse(text)
  if (strict.ok) return { ok: true, value: strict.value, text, edits: [] }

  const edits: JsonRepairEdit[] = []
  let out = ""
  const stack: string[] = []
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (ch === '"' || ch === "'") {
      const q = ch
      const start = i
      let body = ""
      let closed = false
      for (i++; i < text.length; i++) {
        const c = text[i]!
        if (c === "\\") {
          const nx = text[i + 1]
          if (nx === undefined) return { ok: false, reason: "unrepairable" }
          body += nx === "'" ? "'" : c + nx
          i++
          continue
        }
        if (c === q) { closed = true; break }
        body += c === '"' && q === "'" ? '\\"' : c
      }
      if (!closed) return { ok: false, reason: "unrepairable" }
      if (q === "'") edits.push({ kind: "single-quote", at: start })
      out += `"${body}"`
      continue
    }
    if (ch === "{" || ch === "[") stack.push(ch)
    else if (ch === "}" || ch === "]") {
      const open = stack.pop()
      if ((ch === "}" && open !== "{") || (ch === "]" && open !== "[")) return { ok: false, reason: "unrepairable" }
    } else if (ch === ",") {
      const rest = text.slice(i + 1).match(/^\s*(.?)/)
      if (rest && (rest[1] === "}" || rest[1] === "]" || rest[1] === "")) {
        edits.push({ kind: "drop-trailing-comma", at: i })
        continue
      }
    }
    out += ch
  }
  out = out.replace(/[\s,]+$/, "")
  if (/:\s*$/.test(out)) return { ok: false, reason: "unrepairable" }
  for (let i = stack.length - 1; i >= 0; i--) {
    out += stack[i] === "{" ? "}" : "]"
    edits.push({ kind: "close-container", at: text.length })
  }
  const parsed = tryParse(out)
  if (!parsed.ok) return { ok: false, reason: "unrepairable" }
  return { ok: true, value: parsed.value, text: out, edits }
}

// ── Quote repair (deliverables) ──────────────────────────────────────────────

/** Bound on double-quote characters the search considers (recursion depth). */
const MAX_QUOTES = 4000

type Expect = "value" | "value-or-close" | "key" | "key-or-close" | "colon" | "comma-or-close" | "end"

const LITERAL_RE = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y
const VALID_ESCAPE = new Set(['"', "\\", "/", "b", "f", "n", "r", "t", "u"])

/**
 * Count the escape sets that make `text` a JSON document, capped at 2, by
 * walking a JSON pushdown automaton. Branching happens only at a `"` inside a
 * string: it either closes the string or is content (gets a backslash).
 * States are memoized, so the walk stays near-linear on real documents.
 */
function makeQuoteSearch(text: string) {
  const n = text.length
  const memo = new Map<string, number>()
  // Condition (3) applied per candidate, not after the fact: a quote that
  // delimits a key the structural scan sees is never escaped, and a key
  // string closes only where a scanned key closes. Otherwise a value string
  // could swallow `", "answer": "` and count as a second parse.
  const { forced, keyCloses } = scannedKeyQuotes(text)

  const after = (stack: string): Expect => (stack.length === 0 ? "end" : "comma-or-close")

  /** Next unescaped `"` at or after `j` inside a string; -1 when the string can never close. */
  const nextQuote = (j: number): number => {
    for (let k = j; k < n; k++) {
      const c = text.charCodeAt(k)
      if (c === 0x5c) {
        if (!VALID_ESCAPE.has(text[k + 1] ?? "")) return -1
        k++
        continue
      }
      if (c === 0x22) return k
      if (c < 0x20) return -1
    }
    return -1
  }

  const str = (j: number, isKey: boolean, stack: string, collect: number[] | null): number => {
    const q = nextQuote(j)
    return q < 0 ? 0 : quote(q, isKey, stack, collect)
  }

  /** A `"` at `q` inside a string: close it, or escape it as content. */
  const quote = (q: number, isKey: boolean, stack: string, collect: number[] | null): number => {
    const key = `${q}|${isKey ? 1 : 0}|${stack}`
    let total = memo.get(key)
    let close = -1
    if (total === undefined || collect) {
      close = isKey && !keyCloses.has(q) ? 0 : out(q + 1, isKey ? "colon" : after(stack), stack, null)
      const inner = close >= 2 || forced.has(q) ? 0 : str(q + 1, isKey, stack, null)
      total = Math.min(2, close + inner)
      memo.set(key, total)
    }
    if (collect && total === 1) {
      if (close > 0) out(q + 1, isKey ? "colon" : after(stack), stack, collect)
      else {
        collect.push(q)
        str(q + 1, isKey, stack, collect)
      }
    }
    return total
  }

  /** Deterministic walk outside strings until the next string or the end. */
  const out = (i0: number, expect0: Expect, stack0: string, collect: number[] | null): number => {
    let i = i0
    let expect = expect0
    let stack = stack0
    for (;;) {
      while (i < n && /\s/.test(text[i]!)) i++
      if (i >= n) return expect === "end" ? 1 : 0
      const ch = text[i]!
      const top = stack[stack.length - 1]
      switch (expect) {
        case "end":
          return 0
        case "colon":
          if (ch !== ":") return 0
          i++
          expect = "value"
          continue
        case "key":
        case "key-or-close":
          if (ch === "}" && expect === "key-or-close") {
            stack = stack.slice(0, -1)
            i++
            expect = after(stack)
            continue
          }
          return ch === '"' ? str(i + 1, true, stack, collect) : 0
        case "comma-or-close":
          if (ch === ",") {
            i++
            expect = top === "{" ? "key" : "value"
            continue
          }
          if ((ch === "}" && top === "{") || (ch === "]" && top === "[")) {
            stack = stack.slice(0, -1)
            i++
            expect = after(stack)
            continue
          }
          return 0
        case "value":
        case "value-or-close": {
          if (ch === "]" && expect === "value-or-close") {
            stack = stack.slice(0, -1)
            i++
            expect = after(stack)
            continue
          }
          if (ch === '"') return str(i + 1, false, stack, collect)
          if (ch === "{" || ch === "[") {
            stack += ch
            i++
            expect = ch === "{" ? "key-or-close" : "value-or-close"
            continue
          }
          LITERAL_RE.lastIndex = i
          if (!LITERAL_RE.test(text)) return 0
          i = LITERAL_RE.lastIndex
          expect = after(stack)
          continue
        }
      }
    }
  }

  return { count: (collect: number[] | null) => out(0, "value", "", collect) }
}

/** A key the structural scan sees: a quoted token after `{` or `,` and before `:`. */
const SCANNED_KEY_RE = /[{,]\s*"((?:[^"\\]|\\.)*)"\s*:/g

/** Keys a structural scan of the input sees. */
function scannedKeys(text: string): Set<string> {
  const keys = new Set<string>()
  const re = new RegExp(SCANNED_KEY_RE.source, SCANNED_KEY_RE.flags)
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const decoded = tryParse(`"${m[1]}"`)
    keys.add(decoded.ok && typeof decoded.value === "string" ? decoded.value : m[1]!)
  }
  return keys
}

/** A visible value separator: a quote, a comma, a quote (`"a", "b"`). */
const SEPARATOR_RE = /"\s*,\s*"/g

/**
 * Quotes the structural scan treats as delimiters, never content (`forced`):
 * both quotes of every scanned key and of every visible `", "` separator.
 * `keyCloses`: the closing quotes of scanned keys. Without the separator
 * rule every string array (`["a", "b"]` also parses as `["a\", \"b"]`)
 * makes the whole document ambiguous.
 */
function scannedKeyQuotes(text: string): { forced: Set<number>; keyCloses: Set<number> } {
  const forced = new Set<number>()
  const keyCloses = new Set<number>()
  const re = new RegExp(SCANNED_KEY_RE.source, SCANNED_KEY_RE.flags)
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const open = text.indexOf('"', m.index)
    const close = open + 1 + m[1]!.length
    forced.add(open)
    forced.add(close)
    keyCloses.add(close)
  }
  const sep = new RegExp(SEPARATOR_RE.source, SEPARATOR_RE.flags)
  for (let m = sep.exec(text); m !== null; m = sep.exec(text)) {
    // Skip an escaped first quote (`\", "`): it is already content.
    if (text[m.index - 1] === "\\") { sep.lastIndex = m.index + 1; continue }
    forced.add(m.index)
    forced.add(m.index + m[0].length - 1)
    sep.lastIndex = m.index + m[0].length - 1
  }
  return { forced, keyCloses }
}

/** Every object key in a parsed value, recursively. */
function parsedKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) for (const v of value) parsedKeys(v, into)
  else if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      into.add(k)
      parsedKeys(v, into)
    }
  }
  return into
}

const sameSet = (a: Set<string>, b: Set<string>): boolean =>
  a.size === b.size && [...a].every((k) => b.has(k))

/**
 * Repair JSON whose only defect is unescaped double quotes inside strings.
 * Accepted only when (1) the result parses, (2) removing the inserted
 * backslashes reproduces the input exactly, (3) the parsed keys equal the
 * keys a structural scan of the input sees, and the escape set is the only
 * one that parses. Anything else is refused; a valid input is returned as-is.
 */
export function repairJsonQuotes(text: string): JsonRepairResult {
  const strict = tryParse(text)
  if (strict.ok) return { ok: true, value: strict.value, text, edits: [] }

  let quotes = 0
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 0x22) quotes++
  if (quotes > MAX_QUOTES) return { ok: false, reason: "too-large" }

  const search = makeQuoteSearch(text)
  const total = search.count(null)
  if (total === 0) return { ok: false, reason: "unrepairable" }
  if (total > 1) return { ok: false, reason: "ambiguous" }

  const escapes: number[] = []
  search.count(escapes)
  if (escapes.length === 0) return { ok: false, reason: "unrepairable" }
  const at = new Set(escapes)
  let repaired = ""
  for (let i = 0; i < text.length; i++) repaired += at.has(i) ? `\\${text[i]}` : text[i]

  // (1) parses.
  const parsed = tryParse(repaired)
  if (!parsed.ok) return { ok: false, reason: "unrepairable" }
  // (2) only backslashes inserted: drop them and the input comes back.
  let restored = ""
  let shift = 0
  for (let i = 0; i < repaired.length; i++) {
    if (at.has(i - shift) && repaired[i] === "\\" && repaired[i + 1] === '"') { shift++; continue }
    restored += repaired[i]
  }
  if (restored !== text) return { ok: false, reason: "unrepairable" }
  // (3) the keys are the ones the input visibly declares.
  if (!sameSet(parsedKeys(parsed.value), scannedKeys(text))) return { ok: false, reason: "keys-changed" }

  return {
    ok: true,
    value: parsed.value,
    text: repaired,
    edits: escapes.map((q) => ({ kind: "escape-quote", at: q })),
  }
}
