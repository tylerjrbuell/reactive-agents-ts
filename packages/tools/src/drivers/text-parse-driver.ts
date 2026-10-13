import type { ExtractedCall, ToolCallingDriver, ToolCallDialectClaim, ToolSchema } from "./tool-calling-driver.js"
import { extractRationale, parseRationaleBlocks } from "./rationale-parser.js"

export class TextParseDriver implements ToolCallingDriver {
  readonly mode = "text-parse" as const
  /** Provenance claim that informed this selection (undefined = no claim). */
  readonly dialectClaim: ToolCallDialectClaim | undefined

  constructor(dialectClaim?: ToolCallDialectClaim) {
    this.dialectClaim = dialectClaim
  }

  buildPromptInstructions(tools: readonly ToolSchema[]): string {
    const toolList = tools
      .map((t) => {
        const params = t.parameters
          .map((p) => `  ${p.name}: <${p.type}>${p.required ? " (required)" : ""}`)
          .join("\n")
        return `Tool: ${t.name}\nDescription: ${t.description}\nParams:\n${params}`
      })
      .join("\n\n")

    return [
      "## Available Tools\n",
      toolList,
      "\n## How to Call a Tool",
      "Use this exact format — one tool call per block:",
      "<tool_call>",
      "tool: <tool-name>",
      "<param-name>: <value>",
      "</tool_call>",
      "\nUse relative paths for file operations (e.g., `src/main.ts` not `/absolute/path`).",
      "Wait for the tool result before calling the next tool.",
    ].join("\n")
  }

  extractCalls(textOutput: string, _tools: readonly ToolSchema[]): ExtractedCall[] {
    // Tier 1 — structured XML format
    const tier1 = this.parseTier1(textOutput)
    if (tier1.length > 0) return this.attachExternalRationale(tier1, textOutput)

    // Tier 2 — JSON object in prose
    const tier2 = this.parseTier2(textOutput)
    if (tier2.length > 0) return this.attachExternalRationale(tier2, textOutput)

    // Tier 3 — relaxed FC JSON array
    const tier3 = this.parseTier3(textOutput)
    if (tier3.length > 0) return this.attachExternalRationale(tier3, textOutput)

    return []
  }

  /** Fill missing rationale on parsed calls from `<rationale call="N">{...}</rationale>` blocks. */
  private attachExternalRationale(calls: ExtractedCall[], text: string): ExtractedCall[] {
    const blocks = parseRationaleBlocks(text)
    if (blocks.size === 0) return calls
    return calls.map((c, i) => {
      if (c.rationale) return c
      const r = blocks.get(i + 1)
      return r ? { ...c, rationale: r } : c
    })
  }

  /**
   * Structured tier-1. First the taught WRAPPED form
   * (`<tool_call>…</tool_call>`, the highest-fidelity shape); if it yields
   * nothing, the wrapper-tolerant BARE form: the SAME taught `tool: <name>` +
   * `<param>: <value>` grammar minus the surrounding tags. The wrapper is
   * tolerated; the grammar is not loosened.
   */
  private parseTier1(text: string): ExtractedCall[] {
    const wrapped = this.parseWrappedTier1(text)
    if (wrapped.length > 0) return wrapped
    return parseUnwrappedBlocks(text)
  }

  private parseWrappedTier1(text: string): ExtractedCall[] {
    const blockRe = /<tool_call>([\s\S]*?)<\/tool_call>/g
    const calls: ExtractedCall[] = []
    let match: RegExpExecArray | null
    while ((match = blockRe.exec(text)) !== null) {
      const block = match[1]!.trim()
      const lines = block
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
      const toolLine = lines.find((l) => l.startsWith("tool:"))
      if (!toolLine) continue
      const name = toolLine.replace(/^tool:\s*/, "").trim()
      const args: Record<string, unknown> = {}
      for (const line of lines) {
        if (line.startsWith("tool:")) continue
        const colonIdx = line.indexOf(":")
        if (colonIdx === -1) continue
        const key = line.slice(0, colonIdx).trim()
        const value = line.slice(colonIdx + 1).trim()
        args[key] = value
      }
      calls.push({ name, arguments: args, parseMode: "tier-1", confidence: 0.95 })
    }
    return calls
  }

  private parseTier2(text: string): ExtractedCall[] {
    const jsonRe = /\{[^{}]*(?:"tool"|"name")[^{}]*\}/g
    const calls: ExtractedCall[] = []
    let match: RegExpExecArray | null
    while ((match = jsonRe.exec(text)) !== null) {
      try {
        const obj = JSON.parse(match[0]) as Record<string, unknown>
        const name = (obj["tool"] ?? obj["name"]) as string | undefined
        if (typeof name !== "string") continue
        const rationale = extractRationale(obj)
        const { tool: _t, name: _n, rationale: _r, ...rest } = obj
        calls.push({
          name,
          arguments: rest,
          parseMode: "tier-2",
          confidence: 0.75,
          ...(rationale ? { rationale } : {}),
        })
      } catch {
        /* skip malformed */
      }
    }
    return calls
  }

  private parseTier3(text: string): ExtractedCall[] {
    // Balanced bracket scan — handles nested arrays/objects inside the FC array
    // (e.g. `rationale.alternatives: [...]`). Returns each top-level [...] candidate.
    const candidates = findBalancedArrays(text)
    for (const candidate of candidates) {
      try {
        const arr = JSON.parse(candidate) as unknown[]
        if (!Array.isArray(arr)) continue
        const calls: ExtractedCall[] = []
        for (const item of arr) {
          if (typeof item !== "object" || item === null) continue
          const obj = item as Record<string, unknown>
          const name = (obj["name"] ?? obj["tool_name"] ?? obj["tool"]) as string | undefined
          if (typeof name !== "string") continue
          const args = (obj["arguments"] ?? obj["parameters"] ?? obj["input"] ?? {}) as Record<
            string,
            unknown
          >
          const rationale = extractRationale(obj)
          calls.push({
            name,
            arguments: args,
            parseMode: "tier-3",
            confidence: 0.55,
            ...(rationale ? { rationale } : {}),
          })
        }
        if (calls.length > 0) return calls
      } catch {
        /* skip */
      }
    }
    return []
  }

  formatToolResult(toolName: string, result: unknown, isError: boolean): string {
    const content = typeof result === "string" ? result : JSON.stringify(result, null, 2)
    return isError ? `[${toolName} error] ${content}` : `[${toolName} result]\n${content}`
  }
}

/**
 * Scan `text` for top-level `[...]` substrings using balanced bracket counting.
 * String literals are respected so brackets inside quoted text don't perturb depth.
 */
function findBalancedArrays(text: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < text.length) {
    if (text[i] !== "[") {
      i++
      continue
    }
    const start = i
    let depth = 0
    let inStr = false
    let strCh = ""
    let esc = false
    for (; i < text.length; i++) {
      const ch = text[i]!
      if (inStr) {
        if (esc) { esc = false; continue }
        if (ch === "\\") { esc = true; continue }
        if (ch === strCh) { inStr = false }
        continue
      }
      if (ch === '"' || ch === "'") { inStr = true; strCh = ch; continue }
      if (ch === "[") depth++
      else if (ch === "]") {
        depth--
        if (depth === 0) {
          out.push(text.slice(start, i + 1))
          i++
          break
        }
      }
    }
    if (depth !== 0) break  // unterminated — give up
  }
  return out
}

// ── Wrapper-tolerant tier-1: bare `tool:` param-line blocks ──────────────────
//
// W3c measured motivation (fixtures/post-w3): qwen2.5-coder:14b, routed
// text-parse by a MEASURED dialect-none prior, emits the taught tool/param
// lines but drops BOTH `<tool_call>` wrapper tags at temp 0. The wrapped-only
// tier parsed 0 calls (shadow would-have-executed 0/5; act 0/5 executed). These
// helpers accept the bare block: the SAME grammar the builder teaches, minus
// the wrapper. A block still MUST open with a `tool: <name>` line, so this is
// tolerant of the wrapper, not of the grammar (GH #243: no guessed format).

/** A taught tool line: `tool: <name>` - one name token, nothing else. */
const TOOL_LINE_RE = /^([ \t]*)tool:[ \t]*(\S+)[ \t]*$/
/**
 * A taught param line: `<key>: <value>` (identifier or `<placeholder>`),
 * optionally indented. Indentation is captured so it can be normalized and so a
 * block scalar can tell its continuations from a following param (indent
 * symmetry with the tool line - an indented block must find its params).
 */
const PARAM_LINE_RE = /^([ \t]*)(<[^>\s]+>|[A-Za-z_][\w.-]*)[ \t]*:[ \t]*(.*)$/
/** YAML block-scalar header: literal `|` or folded `>`, optional chomp `-`/`+`. */
const BLOCK_SCALAR_HEADER_RE = /^([|>])([+-]?)$/

/**
 * Scan `text` for BARE `tool: <name>` blocks (the taught grammar without the
 * `<tool_call>` wrapper) and extract one call per block.
 *
 * Tolerance is scoped BETWEEN blocks, not within a param list:
 *  - BETWEEN blocks: prose, `---` rules, code fences and a leading prose line
 *    are skipped; a block ends at a blank line, the next `tool:` opener, or the
 *    first non-param line.
 *  - WITHIN a block: a contiguous run of `<key>: <value>` params (indentation
 *    normalized, symmetric with the tool line) plus YAML block-scalar values
 *    (`|`, `>`, with `-`/`+` chomping).
 *  - A bare block MUST carry at least one param to be a call; a lone
 *    `tool: <name>` line in prose is NOT emitted, so it can never dispatch an
 *    empty-args call to a no-required-param tool.
 *
 * Deliberate truncation (NOT a silent in-list prose skipper): mid-param prose
 * ends the param list, so a later `content:` after an interleaved sentence is
 * dropped. Genuine in-list prose tolerance was rejected: real no-FC emissions
 * embed data-sample lines (`ProductA: 100`, `Product B: 1500`) in the prose
 * BETWEEN blocks (measured: post-w3 runs 01M4TYKSSY/01M4TYM336/01M4V2WYQF), so a
 * skip-until-next-opener would attach those as wrong args - a worse, harder to
 * detect corruption than a documented missing trailing param, which the
 * downstream required-param validation surfaces loudly.
 */
function parseUnwrappedBlocks(text: string): ExtractedCall[] {
  const lines = text.split("\n")
  const calls: ExtractedCall[] = []
  let i = 0
  while (i < lines.length) {
    const toolMatch = TOOL_LINE_RE.exec(lines[i]!)
    if (!toolMatch) {
      i++
      continue
    }
    const name = toolMatch[2]!
    i++
    const args: Record<string, unknown> = {}
    let paramCount = 0
    while (i < lines.length) {
      const raw = lines[i]!
      // A blank line, a fresh call, or any non-param line ends the block.
      if (raw.trim() === "") break
      if (TOOL_LINE_RE.test(raw)) break
      const paramMatch = PARAM_LINE_RE.exec(raw)
      if (!paramMatch) break
      const indent = paramMatch[1]!.length
      const key = paramMatch[2]!
      const value = paramMatch[3] ?? ""
      i++
      const header = BLOCK_SCALAR_HEADER_RE.exec(value.trim())
      if (header) {
        const scalar = readBlockScalar(lines, i, indent)
        args[key] = renderBlockScalar(
          scalar.body,
          scalar.trailingBlanks,
          header[1] as "|" | ">",
          (header[2] ?? "") as "" | "-" | "+",
        )
        i = scalar.next
      } else {
        args[key] = value
      }
      paramCount++
    }
    if (paramCount > 0) {
      // Confidence is a hair below the wrapped path (0.95): same tier, weaker
      // framing. Parse mode stays `tier-1` - no new vocabulary, no new consumer.
      calls.push({ name, arguments: args, parseMode: "tier-1", confidence: 0.9 })
    }
  }
  return calls
}

/**
 * Consume the indented (and blank) lines of a YAML block scalar starting at
 * `start`. A non-blank line continues the scalar only while its indentation
 * exceeds `baseIndent` (the header param's own indentation), so a following
 * param at the block indent is NOT swallowed. Returns the raw body lines
 * (indentation intact), the count of trailing blank lines (for `+` chomping),
 * and the index of the next line.
 */
function readBlockScalar(
  lines: readonly string[],
  start: number,
  baseIndent: number,
): { readonly body: readonly string[]; readonly trailingBlanks: number; readonly next: number } {
  const collected: string[] = []
  let i = start
  while (i < lines.length) {
    const line = lines[i]!
    if (line.trim() === "") {
      collected.push("")
      i++
      continue
    }
    const indent = line.length - line.trimStart().length
    if (indent > baseIndent) {
      collected.push(line)
      i++
      continue
    }
    break
  }
  let end = collected.length
  while (end > 0 && collected[end - 1]!.trim() === "") end--
  return { body: collected.slice(0, end), trailingBlanks: collected.length - end, next: i }
}

/**
 * Render a block scalar per its style + chomping:
 *  - `|` literal keeps line breaks; `>` folds single breaks to spaces and blank
 *    lines to paragraph breaks.
 *  - chomping: `-` strips the trailing break, `+` keeps every trailing blank
 *    line, the default clips to exactly one trailing break (YAML semantics).
 */
function renderBlockScalar(
  body: readonly string[],
  trailingBlanks: number,
  style: "|" | ">",
  chomp: "" | "-" | "+",
): string {
  if (body.length === 0) return chomp === "+" ? "\n".repeat(trailingBlanks) : ""
  const dedented = dedentLines(body)
  const joined = style === ">" ? foldLines(dedented) : dedented.join("\n")
  if (joined === "") return ""
  const breaks = chomp === "-" ? "" : chomp === "+" ? "\n".repeat(1 + trailingBlanks) : "\n"
  return joined + breaks
}

/** Strip the common leading indentation from a block-scalar body. */
function dedentLines(lines: readonly string[]): string[] {
  let min = Number.POSITIVE_INFINITY
  for (const line of lines) {
    if (line.trim() === "") continue
    const indent = line.length - line.trimStart().length
    if (indent < min) min = indent
  }
  if (!Number.isFinite(min)) min = 0
  return lines.map((line) => (line.trim() === "" ? "" : line.slice(min)))
}

/** Fold a `>` block-scalar body: single breaks to spaces, blank lines kept. */
function foldLines(lines: readonly string[]): string {
  let out = ""
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line === "") {
      out += "\n"
      continue
    }
    if (i > 0 && lines[i - 1] !== "") out += " "
    out += line
  }
  return out
}
