import { Effect } from 'effect'
import type {
    ToolCallResolver,
    ToolCallResult,
    ToolCallSpec,
    ResolverInput,
    ResolverToolHint,
} from './types.js'

export type DialectObserved =
    | 'native-fc'
    | 'fenced-json'
    | 'pseudo-code'
    | 'nameless-shape'
    | 'none'

export class NativeFCStrategy implements ToolCallResolver {
    resolve(
        response: ResolverInput,
        availableTools: readonly ResolverToolHint[]
    ): Effect.Effect<ToolCallResult, never> {
        return Effect.succeed(this.extract(response, availableTools))
    }

    resolveWithDialect(
        response: ResolverInput,
        availableTools: readonly ResolverToolHint[],
    ): Effect.Effect<{ result: ToolCallResult; dialect: DialectObserved }, never> {
        return Effect.succeed(this.extractWithDialect(response, availableTools))
    }

    private extractWithDialect(
        response: ResolverInput,
        availableTools: readonly ResolverToolHint[],
    ): { result: ToolCallResult; dialect: DialectObserved } {
        const toolNames = new Set(availableTools.map((t) => t.name))
        const enforceToolNames = toolNames.size > 0

        // Tier 1: Native FC tool_calls
        const calls = response.toolCalls
        if (calls && calls.length > 0) {
            const result = this.extract(response, availableTools)
            if (result._tag === 'tool_calls') {
                return { result, dialect: 'native-fc' }
            }
            // Native calls present but all unresolved → fall through to text fallbacks
        }

        const content = response.content ?? ''
        if (content.trim().length > 0) {
            // Tier 2: Fenced JSON (with name field) or nameless-shape fallback —
            // both go through extractTextToolCalls; distinguish by spec.id prefix.
            const textSpecs = extractTextToolCalls(content, availableTools)
            if (textSpecs.length > 0) {
                const hasShapeMatch = textSpecs.some((s) =>
                    s.id.startsWith('shape_')
                )
                const dialect: DialectObserved = hasShapeMatch
                    ? 'nameless-shape'
                    : 'fenced-json'
                return {
                    result: {
                        _tag: 'tool_calls',
                        calls: textSpecs,
                        thinking: undefined,
                    },
                    dialect,
                }
            }

            // Tier 3: Pseudo-code tool-name(args) syntax
            const pseudo = extractPseudoCodeToolCalls(content, availableTools)
            if (pseudo.length > 0) {
                return {
                    result: {
                        _tag: 'tool_calls',
                        calls: pseudo,
                        thinking: undefined,
                    },
                    dialect: 'pseudo-code',
                }
            }
        }

        // No tool calls detected
        const baseResult = this.extract(response, availableTools)
        return { result: baseResult, dialect: 'none' }
    }

    private extract(
        response: ResolverInput,
        availableTools: readonly ResolverToolHint[]
    ): ToolCallResult {
        const toolNames = new Set(availableTools.map((t) => t.name))
        const enforceToolNames = toolNames.size > 0
        const calls = response.toolCalls
        if (calls && calls.length > 0) {
            if (!enforceToolNames) {
                const passthroughSpecs: ToolCallSpec[] = calls.map((tc) => ({
                    id: tc.id,
                    name: tc.name,
                    arguments: normalizeArgumentsForResolvedTool(
                        tc.name,
                        tc.input
                    ),
                }))
                return {
                    _tag: 'tool_calls',
                    calls: passthroughSpecs,
                    thinking: response.content || undefined,
                }
            }

            const specs: ToolCallSpec[] = []
            const unresolvedNames: string[] = []
            for (const tc of calls) {
                const resolvedName = resolveToolName(tc.name, toolNames)
                if (!resolvedName) {
                    unresolvedNames.push(tc.name)
                    continue
                }
                specs.push({
                    id: tc.id,
                    name: resolvedName,
                    arguments: normalizeArgumentsForResolvedTool(
                        resolvedName,
                        tc.input
                    ),
                })
            }

            if (specs.length > 0) {
                return {
                    _tag: 'tool_calls',
                    calls: specs,
                    thinking: response.content || undefined,
                }
            }

            if (unresolvedNames.length > 0) {
                const unavailableHint = buildUnavailableToolHint(
                    unresolvedNames,
                    availableTools
                )
                const content = [response.content ?? '', unavailableHint]
                    .filter((part) => part.trim().length > 0)
                    .join('\n\n')
                return { _tag: 'thinking', content }
            }
        }

        const content = response.content ?? ''
        const hasContent = content.trim().length > 0

        // Fallback: detect tool calls embedded in text content.
        // Some models (e.g. qwen2.5-coder, older llama variants) output valid tool call
        // JSON as text instead of native tool_use blocks when FC is active.
        // Parse these and convert to structured tool calls so the harness can execute them.
        if (hasContent) {
            const parsed = extractTextToolCalls(content, availableTools)
            if (parsed.length > 0) {
                return {
                    _tag: 'tool_calls',
                    calls: parsed,
                    thinking: undefined,
                }
            }

            // Second-tier fallback: detect pseudo-code call syntax inside fenced blocks.
            // Example (observed with cogito on Ollama):
            //   ```javascript
            //   web-search(query: "XRP price", maxResults: 1)
            //   ```
            // Only looks inside fenced blocks so narrative prose like
            // "I'll use web-search to..." doesn't false-positive.
            const pseudo = extractPseudoCodeToolCalls(content, availableTools)
            if (pseudo.length > 0) {
                return {
                    _tag: 'tool_calls',
                    calls: pseudo,
                    thinking: undefined,
                }
            }
        }

        // Only classify as final_answer when the model produced actual content.
        // An empty end_turn response means the model didn't know what to do —
        // treat it as thinking so the kernel reprompts with context.
        if (
            (response.stopReason === 'end_turn' ||
                response.stopReason === 'stop') &&
            hasContent
        ) {
            return { _tag: 'final_answer', content }
        }

        return { _tag: 'thinking', content }
    }
}

// ─── Text Tool Call Extraction ────────────────────────────────────────────────

/**
 * Extracts tool calls embedded as JSON in model text output.
 * Handles models that output tool calls as text instead of native FC blocks.
 *
 * Supported patterns:
 *   ```json\n{ "name": "tool", "arguments": {...} }\n```
 *   { "name": "tool", "arguments": {...} }  (bare JSON)
 *   { "tool": "tool", "parameters": {...} } (alternate schema)
 */
function extractTextToolCalls(
    content: string,
    availableTools: readonly ResolverToolHint[]
): ToolCallSpec[] {
    const toolNames = new Set(availableTools.map((t) => t.name))
    const results: ToolCallSpec[] = []

    // Extract all JSON blocks from content (code-fenced or bare)
    const jsonCandidates: string[] = []

    // ```json ... ``` blocks
    const fencedMatches = content.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/g)
    for (const m of fencedMatches) {
        if (m[1]) jsonCandidates.push(m[1].trim())
    }

    // If no fenced blocks, try the whole content as JSON
    if (jsonCandidates.length === 0) {
        const trimmed = content.trim()
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            jsonCandidates.push(trimmed)
        }
    }

    for (const candidate of jsonCandidates) {
        try {
            const parsed = JSON.parse(candidate) as unknown
            const spec = toToolCallSpec(parsed, toolNames)
            if (spec) {
                results.push(spec)
                continue
            }
            // Parameter-shape fallback: when the JSON has no `name`/`tool` field
            // but its keys uniquely match a single tool's declared parameters,
            // infer the tool call. Observed with cogito emitting spawn-agent args
            // inside ```json blocks without naming the tool.
            const shapeSpec = toToolCallSpecByShape(parsed, availableTools)
            if (shapeSpec) results.push(shapeSpec)
        } catch {
            // Not valid JSON — skip
        }
    }

    return results
}

/**
 * Attempt to identify the intended tool by matching the JSON object's keys
 * against each tool's declared parameter names. Returns a spec only when
 * exactly one tool's parameter set is a superset of the object's keys AND
 * at least one declared parameter name appears in the object (to avoid
 * matching every tool on a sub-empty object).
 */
function toToolCallSpecByShape(
    parsed: unknown,
    availableTools: readonly ResolverToolHint[]
): ToolCallSpec | null {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    const objKeys = Object.keys(parsed as Record<string, unknown>)
    if (objKeys.length === 0) return null

    const candidates: { tool: ResolverToolHint; overlap: number }[] = []
    for (const tool of availableTools) {
        if (!tool.paramNames || tool.paramNames.length === 0) continue
        const params = new Set(tool.paramNames)
        // Every object key must correspond to a declared parameter for this tool.
        const allKeysKnown = objKeys.every((k) => params.has(k))
        if (!allKeysKnown) continue
        // At least one real parameter match (not a fully empty overlap).
        const overlap = objKeys.filter((k) => params.has(k)).length
        if (overlap === 0) continue
        candidates.push({ tool, overlap })
    }

    // Require a unique winner — ambiguous matches stay as thinking to avoid
    // mis-routing when two tools have similar parameter shapes.
    if (candidates.length !== 1) return null

    const { tool } = candidates[0]!
    return {
        id: `shape_${tool.name}_0`,
        name: tool.name,
        arguments: normalizeArgumentsForResolvedTool(
            tool.name,
            parsed as Record<string, unknown>,
        ),
    }
}

/**
 * Extracts pseudo-code call syntax like `tool-name(key: value, ...)` from fenced
 * code blocks. Some weaker models (e.g. cogito on Ollama) narrate tool calls
 * this way instead of emitting native FC tokens.
 *
 * Only matches inside ``` blocks and only for tool names present in availableTools.
 * Narrative prose like "I'll use web-search to..." is deliberately ignored.
 */
function extractPseudoCodeToolCalls(
    content: string,
    availableTools: readonly ResolverToolHint[]
): ToolCallSpec[] {
    const toolNames = new Set(availableTools.map((t) => t.name))
    if (toolNames.size === 0) return []

    const results: ToolCallSpec[] = []
    const fenced = content.matchAll(/```(?:\w+)?\s*\n?([\s\S]*?)```/g)

    // Build a regex alternation of available tool names (escaped for regex).
    const nameAlt = [...toolNames]
        .map((n) => n.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&"))
        .join("|")
    if (nameAlt.length === 0) return []
    const callRe = new RegExp(`\\b(${nameAlt})\\s*\\(`, "g")

    let idCounter = 0
    for (const fm of fenced) {
        const block = fm[1] ?? ""
        let m: RegExpExecArray | null
        callRe.lastIndex = 0
        while ((m = callRe.exec(block)) !== null) {
            const name = m[1]!
            const openParenIdx = callRe.lastIndex - 1
            const argsRaw = extractBalancedArgs(block, openParenIdx)
            if (argsRaw === null) continue
            const args = parsePseudoArgs(argsRaw)
            results.push({
                id: `pseudo_${name}_${idCounter++}`,
                name,
                arguments: normalizeArgumentsForResolvedTool(name, args),
            })
        }
    }
    return results
}

/** Extracts the substring between a balanced `(` at `openIdx` and its matching `)`. */
function extractBalancedArgs(source: string, openIdx: number): string | null {
    if (source[openIdx] !== "(") return null
    let depth = 0
    let inStr: '"' | "'" | "`" | null = null
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

/**
 * Parses pseudo-arg strings into an object. Supports:
 *   - `key: value` and `key=value`
 *   - quoted strings (`"..."`, `'...'`, `` `...` ``)
 *   - numbers, booleans, null
 *   - bare positional values → stored under `input` key
 * Falls back to the raw trimmed text under `input` when no key/value found.
 */
function parsePseudoArgs(argsRaw: string): Record<string, unknown> {
    const trimmed = argsRaw.trim()
    if (trimmed.length === 0) return {}

    const pairs = splitTopLevelCommas(trimmed)
    const out: Record<string, unknown> = {}
    const positionals: unknown[] = []

    for (const pair of pairs) {
        const kvMatch = pair.match(/^\s*([a-zA-Z_$][\w$-]*)\s*[:=]\s*([\s\S]+)$/)
        if (kvMatch) {
            const key = kvMatch[1]!
            const rawValue = kvMatch[2]!.trim()
            out[key] = coercePseudoValue(rawValue)
        } else {
            positionals.push(coercePseudoValue(pair.trim()))
        }
    }

    if (Object.keys(out).length === 0 && positionals.length === 1) {
        return { input: positionals[0] }
    }
    if (positionals.length > 0 && !("input" in out)) {
        out["input"] = positionals.length === 1 ? positionals[0] : positionals
    }
    return out
}

function splitTopLevelCommas(s: string): string[] {
    const parts: string[] = []
    let depth = 0
    let inStr: '"' | "'" | "`" | null = null
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

function coercePseudoValue(raw: string): unknown {
    if (raw.length === 0) return raw
    const first = raw[0]
    const last = raw[raw.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'") || (first === "`" && last === "`")) {
        // Strip outer quotes; unescape common sequences
        return raw.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\'/g, "'")
    }
    if (raw === "true") return true
    if (raw === "false") return false
    if (raw === "null") return null
    if (/^-?\d+$/.test(raw)) return Number(raw)
    if (/^-?\d*\.\d+$/.test(raw)) return Number(raw)
    if (raw.startsWith("{") || raw.startsWith("[")) {
        try { return JSON.parse(raw) } catch { /* fallthrough */ }
    }
    return raw
}

function toToolCallSpec(
    parsed: unknown,
    toolNames: ReadonlySet<string>
): ToolCallSpec | null {
    if (typeof parsed !== 'object' || parsed === null) return null
    const obj = parsed as Record<string, unknown>

    // Pattern 1: { "name": "tool-name", "arguments": {...} }
    // Pattern 2: { "name": "tool-name", "parameters": {...} }
    const name =
        (obj.name as string | undefined) ??
        (obj.tool as string | undefined) ??
        (obj.tool_name as string | undefined)

    if (!name || typeof name !== 'string') return null

    const matchedName = resolveToolName(name, toolNames)
    if (!matchedName) return null

    return {
        id: `text-tc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: matchedName,
        arguments: normalizeArgumentsForResolvedTool(
            matchedName,
            obj.arguments ?? obj.parameters ?? obj.args ?? obj.input ?? {}
        ),
    }
}

function tokenizeToolName(name: string): readonly string[] {
    return name
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length > 0)
}

function resolveToolName(
    requestedName: string,
    toolNames: ReadonlySet<string>
): string | null {
    const directCandidates = [
        requestedName,
        requestedName.replace(/_/g, '-'),
        requestedName.replace(/:/g, '/'),
        requestedName.replace(/[:/]/g, '-'),
    ]
    for (const candidate of directCandidates) {
        if (toolNames.has(candidate)) return candidate
    }

    const requestedTokens = tokenizeToolName(requestedName)
    const requestedLast = requestedTokens[requestedTokens.length - 1]
    if (requestedLast) {
        const suffixMatches = [...toolNames].filter((candidate) => {
            const candidateTokens = tokenizeToolName(candidate)
            return candidateTokens[candidateTokens.length - 1] === requestedLast
        })
        if (suffixMatches.length === 1) {
            return suffixMatches[0]!
        }
    }

    const lowered = requestedName.toLowerCase()
    if (lowered.includes('search')) {
        if (toolNames.has('web-search')) return 'web-search'
        const searchMatches = [...toolNames].filter((candidate) =>
            candidate.includes('search')
        )
        if (searchMatches.length === 1) {
            return searchMatches[0]!
        }
    }
    if (
        lowered.includes('http') ||
        lowered.includes('fetch') ||
        lowered.endsWith('get')
    ) {
        if (toolNames.has('http-get')) return 'http-get'
    }

    return null
}

function normalizeArgumentsForResolvedTool(
    toolName: string,
    rawInput: unknown
): Record<string, unknown> {
    const args =
        typeof rawInput === 'object' && rawInput !== null
            ? { ...(rawInput as Record<string, unknown>) }
            : {}

    if (toolName === 'web-search') {
        if (typeof args.query !== 'string') {
            const queries = Array.isArray(args.queries)
                ? args.queries.filter(
                      (item): item is string =>
                          typeof item === 'string' && item.trim().length > 0
                  )
                : []
            if (queries.length > 0) {
                args.query = queries.join(' OR ')
            }
        }
        delete args.queries
    }

    if (toolName === 'http-get' && typeof args.url !== 'string') {
        const urls = Array.isArray(args.urls)
            ? args.urls.filter(
                  (item): item is string =>
                      typeof item === 'string' && item.trim().length > 0
              )
            : []
        if (urls.length > 0) {
            args.url = urls[0]!
        }
        delete args.urls
    }

    return args
}

function buildUnavailableToolHint(
    unresolvedNames: readonly string[],
    availableTools: readonly { name: string }[]
): string {
    const uniqueNames = [...new Set(unresolvedNames)].join(', ')
    const available = availableTools.map((tool) => tool.name)
    const searchLike = available.filter(
        (name) =>
            name.includes('search') ||
            name.includes('fetch') ||
            name.includes('get') ||
            name.includes('browse')
    )
    const suggestion =
        searchLike.length > 0
            ? `Use one of: ${searchLike.slice(0, 4).join(', ')}.`
            : `Available tools: ${available.slice(0, 6).join(', ')}.`
    return `Tool call used unavailable name(s): ${uniqueNames}. ${suggestion} Use exact tool names from Available Tools.`
}
