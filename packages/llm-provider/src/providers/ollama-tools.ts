/**
 * Ollama tool wire: native tool conversion (moved verbatim out of local.ts,
 * 2026-11-06) and the constrained-decoding mapping for
 * `CompletionRequest.toolChoice: "required"`.
 *
 * Ollama has no `tool_choice`. A forced call is sent WITHOUT the `tools`
 * param and with `format` set to a JSON schema whose `anyOf` admits only
 * `{ tool, arguments }` for one of the offered tools, so the grammar cannot
 * produce anything else. The JSON content is then read back as a normal tool
 * call. Content that does not parse into a call to an offered tool is left
 * as a plain text response (never an error), so the caller's no-call
 * handling still applies.
 */
import { Effect, Stream } from 'effect'
import type { LLMService } from '../llm-service.js'
import type { CompletionResponse, StreamEvent } from '../types.js'
import { isToolCallRequired, type ToolCall, type ToolChoice, type ToolDefinition } from '../tool-protocol.js'
import { normalizeToolSchemaFor } from '../schema-utils.js'

// ─── Ollama SDK types (from the `ollama` npm package) ───

type OllamaTool = {
    type: 'function'
    function: {
        name: string
        description: string
        parameters: Record<string, unknown>
    }
}

// ─── Conversion Helpers ─── (messages: ./ollama-messages.ts)

export const toOllamaTools = (
    tools?: readonly ToolDefinition[]
): OllamaTool[] | undefined => {
    if (!tools || tools.length === 0) return undefined
    return tools.map((t) => ({
        type: 'function' as const,
        function: {
            name: t.name,
            description: t.description,
            parameters: normalizeToolSchemaFor(t.name, t.inputSchema) as Record<string, unknown>,
        },
    }))
}

export const parseToolCalls = (
    toolCalls?: Array<{
        function: { name: string; arguments: unknown }
    }>
): ToolCall[] | undefined => {
    if (!toolCalls || toolCalls.length === 0) return undefined
    return toolCalls.map((tc, i) => ({
        id: `ollama-tc-${Date.now()}-${i}`,
        name: tc.function.name,
        input: tc.function.arguments,
    }))
}

// ─── Forced tool call (toolChoice: "required") ───

/** The request fields the forced-call mapping reads. */
type ToolChoiceRequest = {
    readonly toolChoice?: ToolChoice
    readonly tools?: readonly ToolDefinition[]
}

/** One `anyOf` branch: a call to exactly one named tool. */
export type OllamaForcedToolBranch = {
    readonly type: 'object'
    readonly properties: {
        readonly tool: { readonly type: 'string'; readonly enum: readonly [string] }
        readonly arguments: Record<string, unknown>
    }
    readonly required: readonly ['tool', 'arguments']
}

/**
 * The `format` schema for a forced call: `anyOf` one branch per tool, each
 * pinning `tool` to that tool's name and `arguments` to its (normalized)
 * JSON parameters schema.
 */
export const ollamaForcedToolFormat = (
    tools: readonly ToolDefinition[]
): { readonly anyOf: readonly OllamaForcedToolBranch[] } => ({
    anyOf: tools.map((t) => ({
        type: 'object' as const,
        properties: {
            tool: { type: 'string' as const, enum: [t.name] as const },
            arguments: normalizeToolSchemaFor(t.name, t.inputSchema) as Record<string, unknown>,
        },
        required: ['tool', 'arguments'] as const,
    })),
})

/**
 * The tool fields of an Ollama chat request: `format` (and no `tools`) for a
 * forced call, otherwise the native `tools` param exactly as before.
 */
export const ollamaToolRequestFields = (
    request: ToolChoiceRequest
):
    | { readonly tools: OllamaTool[] | undefined }
    | { readonly format: { readonly anyOf: readonly OllamaForcedToolBranch[] } } =>
    isToolCallRequired(request)
        ? { format: ollamaForcedToolFormat(request.tools ?? []) }
        : { tools: toOllamaTools(request.tools) }

const parseJson = (text: string): unknown => {
    try {
        return JSON.parse(text)
    } catch {
        return undefined
    }
}

/**
 * Read the content of a forced call back as a tool call. Returns undefined
 * when the call was not forced, or the content is not JSON of the form
 * `{ tool, arguments }` naming an offered tool with object arguments.
 */
export const parseOllamaForcedToolCall = (
    request: ToolChoiceRequest,
    content: string | undefined
): ToolCall | undefined => {
    if (!isToolCallRequired(request) || !content) return undefined
    const parsed = parseJson(content)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const { tool, arguments: args } = parsed as { tool?: unknown; arguments?: unknown }
    if (typeof tool !== 'string' || !(request.tools ?? []).some((t) => t.name === tool)) return undefined
    if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined
    return { id: `ollama-tc-${Date.now()}-0`, name: tool, input: args }
}

/**
 * The stream events for a finished response, in the order the streaming
 * path emits them: thinking, text, each tool call (start + delta),
 * content_complete, logprobs, usage.
 */
export const completionToStreamEvents = (response: CompletionResponse): StreamEvent[] => [
    ...(response.thinking ? [{ type: 'thinking_delta' as const, thinking: response.thinking }] : []),
    ...(response.content ? [{ type: 'text_delta' as const, text: response.content }] : []),
    ...(response.toolCalls ?? []).flatMap((tc): StreamEvent[] => [
        { type: 'tool_use_start', id: tc.id, name: tc.name },
        { type: 'tool_use_delta', input: JSON.stringify(tc.input) },
    ]),
    {
        type: 'content_complete',
        content: response.content,
        ...(response.thinking ? { thinking: response.thinking } : {}),
        stopReason: response.stopReason,
    },
    ...(response.logprobs ? [{ type: 'logprobs' as const, logprobs: response.logprobs }] : []),
    {
        type: 'usage',
        usage: response.usage,
        ...(response.resolvedParams ? { resolvedParams: response.resolvedParams } : {}),
    },
]

/**
 * Route forced-call `stream()` requests through `complete()`: the
 * constrained JSON must be whole before it can be read as a call, so the
 * call runs non-streamed and its result is emitted as the usual stream
 * events. Every other request reaches the wrapped `stream()` unchanged.
 */
export const withOllamaForcedToolStream = (
    service: typeof LLMService.Service
): typeof LLMService.Service => ({
    ...service,
    stream: (request) =>
        isToolCallRequired(request)
            ? service.complete(request).pipe(
                  Effect.map((response) => Stream.fromIterable(completionToStreamEvents(response)))
              )
            : service.stream(request),
})
