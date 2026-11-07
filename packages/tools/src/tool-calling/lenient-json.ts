/**
 * Lenient JSON reading for assistant-text tool calls: balanced-region
 * scanning, repair (trailing commas, single quotes, missing closers) and
 * unquoted identifier keys (`{ path: "x" }`). Pure; never evaluates code.
 * The repair itself is the healing-layer primitive (`healing/json-repair.ts`).
 */

import { repairJsonLenient } from "../healing/json-repair.js"

/** True for a non-null, non-array object. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** Region of balanced JSON-ish text starting at `start`; truncated when unclosed. */
export function scanRegion(src: string, start: number): { end: number; truncated: boolean } {
  const stack: string[] = []
  let inStr: string | null = null
  for (let i = start; i < src.length; i++) {
    const ch = src[i]!
    if (inStr) {
      if (ch === "\\") { i++; continue }
      if (ch === inStr) inStr = null
      continue
    }
    if (ch === '"' || ch === "'") { inStr = ch; continue }
    if (ch === "{" || ch === "[") stack.push(ch)
    else if (ch === "}" || ch === "]") {
      const open = stack.pop()
      if ((ch === "}" && open !== "{") || (ch === "]" && open !== "[")) {
        return { end: i + 1, truncated: false }
      }
      if (stack.length === 0) return { end: i + 1, truncated: false }
    }
  }
  return { end: src.length, truncated: true }
}

/**
 * Quote bare identifier keys outside strings: `{ path: "x" }` → `{ "path": "x" }`.
 * Only an identifier directly after `{` or `,` and directly before `:` is a key,
 * so a bare identifier VALUE (`content: total`) stays bare and fails to parse.
 */
export function quoteBareKeys(text: string): string {
  let out = ""
  let inStr: string | null = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (inStr) {
      out += ch
      if (ch === "\\") { out += text[i + 1] ?? ""; i++; continue }
      if (ch === inStr) inStr = null
      continue
    }
    if (ch === '"' || ch === "'") { inStr = ch; out += ch; continue }
    if (ch === "{" || ch === ",") {
      const m = /^(\s*)([A-Za-z_$][\w$]*)(\s*):/.exec(text.slice(i + 1))
      if (m) {
        out += `${ch}${m[1]}"${m[2]}"${m[3]}:`
        i += m[0].length
        continue
      }
    }
    out += ch
  }
  return out
}

/** Strict JSON, then lenient-repaired JSON. `undefined` when neither parses. */
export function parseLenient(text: string): unknown | undefined {
  const repaired = repairJsonLenient(text)
  return repaired.ok ? repaired.value : undefined
}
