import { Effect } from 'effect'
import type {
    ToolCallResolver,
    ToolCallResult,
    ToolCallSpec,
    ResolverInput,
} from './types.js'

export class NativeFCStrategy implements ToolCallResolver {
    resolve(
        response: ResolverInput,
        availableTools: readonly { name: string }[]
    ): Effect.Effect<ToolCallResult, never> {
        return Effect.succeed(this.extract(response, availableTools))
    }

    private extract(
        response: ResolverInput,
        availableTools: readonly { name: string }[]
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
    availableTools: readonly { name: string }[]
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
            if (spec) results.push(spec)
        } catch {
            // Not valid JSON — skip
        }
    }

    return results
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
