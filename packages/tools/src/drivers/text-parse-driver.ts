import type { ExtractedCall, ToolCallingDriver, ToolCallDialectClaim, ToolSchema } from "./tool-calling-driver.js"
import { extractRationale, parseRationaleBlocks } from "./rationale-parser.js"
import { parseTaughtBlocks } from "../tool-calling/taught-markup.js"

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

    // W3c round 2: the taught delimiter is `<tool_use>`, NOT `<tool_call>`.
    // `<tool_call>` is the host runtime's OWN qwen tool-call trigger: when a
    // text-parse model emitted it, Ollama's qwen35.go/qwen3coder.go parsers
    // intercepted the output, failed to JSON-decode our `tool: <name>` body, and
    // poisoned the stream (journal: `qwen3.5 tool call parsing failed` /
    // `qwen tool call parsing failed` error=EOF) -> the framework saw EOF.
    // `<tool_use>` is absent from the Ollama binary's parser vocabulary
    // (measured: `<tool_call>` x15 / `</tool_call>` x14 / `<tool_use>` x0), so it
    // cannot be intercepted. The legacy `<tool_call>` form is still PARSED
    // (back-compat); only TEACHING moves. Keep it a lone `<name>` tag line: the
    // reasoning-side shape reader keys on that structure (GH #243 pin).
    return [
      "## Available Tools\n",
      toolList,
      "\n## How to Call a Tool",
      "Use this exact format — one tool call per block:",
      "<tool_use>",
      "tool: <tool-name>",
      "<param-name>: <value>",
      "</tool_use>",
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
   * Structured tier-1: the taught grammar, read by the ONE shared reader
   * (`tool-calling/taught-markup.ts`). Wrapped blocks score 0.95; the
   * wrapper-tolerant bare form a hair lower (0.9): same tier, weaker framing.
   */
  private parseTier1(text: string): ExtractedCall[] {
    return parseTaughtBlocks(text).map((b) => ({
      name: b.name,
      arguments: b.args,
      parseMode: "tier-1" as const,
      confidence: b.wrapped ? 0.95 : 0.9,
    }))
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
