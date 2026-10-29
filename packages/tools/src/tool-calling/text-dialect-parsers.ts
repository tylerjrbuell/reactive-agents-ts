import type { ResolverToolHint, ToolCallSpec } from "./types.js"
import { normalizeArgumentsForResolvedTool, resolveToolName } from "./name-resolution.js"
import { parsePseudoArgs, extractBalancedArgs } from "./pseudo-args.js"

/**
 * Text tool-call dialect parsers (F5). Each parser only emits a call when the
 * name RESOLVES (exact or healed) to a tool in `availableTools`; anything else
 * stays unresolved and is handled by the F1 reprompt path.
 *
 * SECURITY: these functions are only ever fed the assistant's OWN reply
 * content (`ResolverInput.content`). Never feed tool results, retrieved
 * documents or any third-party text — executing calls found there would be a
 * prompt-injection vector. Executed calls still go through the normal tool
 * policy / execution choke point downstream.
 *
 * Ids are prefixed `dialectjson_` / `dialectxml_` / `dialectcall_` so callers can
 * label the observed dialect.
 *
 * Covered: Hermes/Qwen `<tool_call>{json}</tool_call>`, `{"tool_calls":[...]}`,
 * OpenAI `function` wrapper, arrays, multiple unfenced objects, JSON after
 * prose, Mistral `[TOOL_CALLS]`, Llama `<|python_tag|>`, lenient JSON repair,
 * `<function=NAME><parameter=K>V</parameter></function>` XML, and a bare
 * `name(...)` for an exactly-known tool when it is the whole reply.
 */


/** Region of balanced JSON-ish text starting at `start`; truncated when unclosed. */
function scanRegion(src: string, start: number): { end: number; truncated: boolean } {
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
 * Lenient JSON repair: trailing commas, single-quoted strings, and truncation
 * (missing closers). Returns null when the repair would be ambiguous
 * (truncated inside a string, dangling `key:`, mismatched closers).
 */
export function repairJson(text: string): string | null {
  let out = ""
  const stack: string[] = []
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (ch === '"' || ch === "'") {
      const q = ch
      let body = ""
      let closed = false
      for (i++; i < text.length; i++) {
        const c = text[i]!
        if (c === "\\") {
          const nx = text[i + 1]
          if (nx === undefined) return null
          body += nx === "'" ? "'" : c + nx
          i++
          continue
        }
        if (c === q) { closed = true; break }
        body += c === '"' && q === "'" ? '\\"' : c
      }
      if (!closed) return null
      out += `"${body}"`
      continue
    }
    if (ch === "{" || ch === "[") stack.push(ch)
    else if (ch === "}" || ch === "]") {
      const open = stack.pop()
      if ((ch === "}" && open !== "{") || (ch === "]" && open !== "[")) return null
    } else if (ch === ",") {
      const rest = text.slice(i + 1).match(/^\s*(.?)/)
      if (rest && (rest[1] === "}" || rest[1] === "]" || rest[1] === "")) continue
    }
    out += ch
  }
  out = out.replace(/[\s,]+$/, "")
  if (/:\s*$/.test(out)) return null
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === "{" ? "}" : "]"
  return out
}

function parseLenient(text: string): unknown | undefined {
  try { return JSON.parse(text) as unknown } catch { /* repair below */ }
  const repaired = repairJson(text)
  if (repaired === null) return undefined
  try { return JSON.parse(repaired) as unknown } catch { return undefined }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

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

function jsonRegionCalls(content: string, toolNames: ReadonlySet<string>): ToolCallSpec[] {
  const specs: ToolCallSpec[] = []
  let i = 0
  while (i < content.length) {
    const ch = content[i]
    if (ch !== "{" && ch !== "[") { i++; continue }
    const { end } = scanRegion(content, i)
    const parsed = parseLenient(content.slice(i, end))
    if (parsed === undefined) { i++; continue }
    for (const obj of flattenCalls(parsed)) {
      const c = callFromObject(obj)
      if (!c) continue
      const name = resolveToolName(c.name, toolNames)
      if (!name) continue
      specs.push({
        id: `dialectjson_${name}_${specs.length}`,
        name,
        arguments: normalizeArgumentsForResolvedTool(name, c.args),
      })
    }
    i = end
  }
  return specs
}

function xmlFunctionCalls(content: string, toolNames: ReadonlySet<string>): ToolCallSpec[] {
  const specs: ToolCallSpec[] = []
  const re = /<function=([\w.:/-]+)>([\s\S]*?)(?:<\/function>|$)/g
  for (const m of content.matchAll(re)) {
    const name = resolveToolName(m[1]!, toolNames)
    if (!name) continue
    const args: Record<string, unknown> = {}
    for (const p of m[2]!.matchAll(/<parameter=([\w.-]+)>([\s\S]*?)<\/parameter>/g)) {
      const raw = p[2]!.trim()
      args[p[1]!] = parseLenient(raw) ?? raw
    }
    specs.push({
      id: `dialectxml_${name}_${specs.length}`,
      name,
      arguments: normalizeArgumentsForResolvedTool(name, args),
    })
  }
  return specs
}

function bareCall(content: string, toolNames: ReadonlySet<string>): ToolCallSpec[] {
  const text = content.trim()
  if (text.includes("\n")) return []
  const m = text.match(/^([\w.-]+)\(/)
  if (!m || !toolNames.has(m[1]!)) return []
  const open = m[0].length - 1
  const argsRaw = extractBalancedArgs(text, open)
  if (argsRaw === null || text.slice(open + argsRaw.length + 2).replace(/;/g, "").trim() !== "") return []
  const name = m[1]!
  const trimmed = argsRaw.trim()
  const parsed = trimmed.startsWith("{") ? parseLenient(trimmed) : undefined
  return [{
    id: `dialectcall_${name}_0`,
    name,
    arguments: normalizeArgumentsForResolvedTool(name, parsed ?? parsePseudoArgs(argsRaw)),
  }]
}

/**
 * Run every text-dialect parser over the assistant's own `content`.
 *
 * @returns calls whose names resolve to `availableTools`; empty when none do.
 */
export function extractDialectToolCalls(
  content: string,
  availableTools: readonly ResolverToolHint[],
): ToolCallSpec[] {
  const toolNames = new Set(availableTools.map((t) => t.name))
  // Bound work on pathological input.
  if (toolNames.size === 0 || content.trim().length === 0 || content.length > 65_536) return []
  const bare = bareCall(content, toolNames)
  if (bare.length > 0) return bare
  const xml = xmlFunctionCalls(content, toolNames)
  if (xml.length > 0) return xml
  return jsonRegionCalls(content, toolNames)
}

