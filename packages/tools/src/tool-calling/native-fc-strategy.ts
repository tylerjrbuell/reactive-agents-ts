import { Effect } from 'effect'
import type {
    ToolCallResolver,
    ToolCallResult,
    ToolCallSpec,
    ResolverInput,
    ResolverToolHint,
} from './types.js'
import { resolveToolName, normalizeArgumentsForResolvedTool } from './name-resolution.js'
import { parseAssistantToolCalls, type ExtractedToolCall, type TextCallParse } from './assistant-text-parser.js'

/** Which extraction path produced a turn's result (consumed by the kernel's assistant-turn boundary). */
export type DialectObserved =
    | 'native-fc'
    | 'fenced-json'
    | 'pseudo-code'
    | 'nameless-shape'
    | 'none'

/**
 * Resolver for native-function-calling providers. Native `tool_calls` win;
 * the assistant's text is parsed ONLY when zero native calls resolve, and
 * only through the one assistant-text parser (`parseAssistantToolCalls`).
 */
export class NativeFCStrategy implements ToolCallResolver {
    resolve(
        response: ResolverInput,
        availableTools: readonly ResolverToolHint[]
    ): Effect.Effect<ToolCallResult, never> {
        return Effect.succeed(this.resolveTurn(response, availableTools).result)
    }

    resolveWithDialect(
        response: ResolverInput,
        availableTools: readonly ResolverToolHint[],
    ): Effect.Effect<{ result: ToolCallResult; dialect: DialectObserved }, never> {
        return Effect.succeed(this.resolveTurn(response, availableTools))
    }

    private resolveTurn(
        response: ResolverInput,
        availableTools: readonly ResolverToolHint[],
    ): { result: ToolCallResult; dialect: DialectObserved } {
        // Tier 0: native FC tool_calls. Resolved calls and abstain are terminal
        // for the turn; unresolved native names fall through to the text parse.
        const native = resolveNativeCalls(response, availableTools)
        if (native && native._tag !== 'thinking') {
            return { result: native, dialect: 'native-fc' }
        }

        const content = response.content ?? ''
        const parse: TextCallParse = parseAssistantToolCalls(content, availableTools)
        if (parse._tag === 'parsed') {
            return {
                result: { _tag: 'tool_calls', calls: parse.calls, thinking: undefined },
                dialect: dialectOf(parse.calls),
            }
        }
        // Unresolved native names: reprompt with the unavailable-name hint.
        if (native) return { result: native, dialect: 'none' }

        // Tool-call-shaped but unparseable: NEVER a final_answer. Reprompt
        // with a hint naming the tool and its params (D4).
        if (parse._tag === 'unparseable') {
            return {
                result: {
                    _tag: 'thinking',
                    content: [content, unparseableHint(parse, availableTools)]
                        .filter((p) => p.trim().length > 0)
                        .join('\n\n'),
                    reason: 'unresolved-tool-call',
                },
                dialect: 'none',
            }
        }

        // Only classify as final_answer when the model produced actual content.
        // An empty end_turn response means the model didn't know what to do —
        // treat it as thinking so the kernel reprompts with context.
        const hasContent = content.trim().length > 0
        if ((response.stopReason === 'end_turn' || response.stopReason === 'stop') && hasContent) {
            return { result: { _tag: 'final_answer', content }, dialect: 'none' }
        }
        return { result: { _tag: 'thinking', content }, dialect: 'none' }
    }
}

/**
 * Resolve provider-native tool calls against the surface. `null` when the
 * response carries none; `thinking` (with an unavailable-name hint) when
 * every native name is off the surface.
 */
function resolveNativeCalls(
    response: ResolverInput,
    availableTools: readonly ResolverToolHint[],
): ToolCallResult | null {
    const calls = response.toolCalls
    if (!calls || calls.length === 0) return null
    const toolNames = new Set(availableTools.map((t) => t.name))
    if (toolNames.size === 0) {
        const passthroughSpecs: ToolCallSpec[] = calls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: normalizeArgumentsForResolvedTool(tc.name, tc.input),
        }))
        return { _tag: 'tool_calls', calls: passthroughSpecs, thinking: response.content || undefined }
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
            arguments: normalizeArgumentsForResolvedTool(resolvedName, tc.input),
        })
    }

    if (specs.length > 0) {
        // O3: abstain is a terminal tool — intercept before bundling as tool_calls.
        const abstainSpec = specs.find((s) => s.name === 'abstain')
        if (abstainSpec) {
            // arguments is Record<string, unknown>; extract defensively
            // (no cast — keeps the `as unknown as` ceiling + validates at runtime).
            const rawArgs = abstainSpec.arguments
            const reason = typeof rawArgs.reason === 'string' ? rawArgs.reason : ''
            const missing = Array.isArray(rawArgs.missing)
                ? rawArgs.missing.filter((m): m is string => typeof m === 'string')
                : []
            return { _tag: 'abstained' as const, reason, missing }
        }
        return { _tag: 'tool_calls', calls: specs, thinking: response.content || undefined }
    }

    const content = [response.content ?? '', buildUnavailableToolHint(unresolvedNames, availableTools)]
        .filter((part) => part.trim().length > 0)
        .join('\n\n')
    return { _tag: 'thinking', content, reason: 'unresolved-tool-call' }
}

/** Legacy dialect label of a text-parsed turn (the union is consumed outside this package). */
function dialectOf(calls: readonly ExtractedToolCall[]): DialectObserved {
    if (calls.every((c) => c.extraction.tier === 'json')) {
        return calls.some((c) => c.extraction.dialect === 'nameless-shape') ? 'nameless-shape' : 'fenced-json'
    }
    return 'pseudo-code'
}

/** Reprompt hint for an unparseable printed call: name the tool(s) and their params. */
function unparseableHint(
    parse: Extract<TextCallParse, { _tag: 'unparseable' }>,
    availableTools: readonly ResolverToolHint[],
): string {
    const byName = new Map(availableTools.map((t) => [t.name, t] as const))
    const known = parse.names.filter((n) => byName.has(n))
    if (known.length > 0) {
        const signatures = known
            .map((n) => `${n}(${(byName.get(n)?.paramNames ?? []).join(', ')})`)
            .join(', ')
        return `Your tool call could not be parsed: ${parse.reason}. Call ${signatures} natively, as a standalone call with literal argument values, or answer in plain text.`
    }
    if (parse.names.length > 0) return buildUnavailableToolHint(parse.names, availableTools)
    return `Your reply looked like a tool call but could not be parsed. Call a listed tool natively (${availableTools
        .slice(0, 6)
        .map((t) => t.name)
        .join(', ')}) or answer in plain text.`
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
