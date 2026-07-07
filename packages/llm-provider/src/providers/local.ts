import { Effect, Layer, Stream, Schema, Duration } from 'effect'
import { LLMService } from '../llm-service.js'
import { LLMConfig } from '../llm-config.js'
import type { ProviderCapabilities } from '../capabilities.js'
import { LLMTimeoutError, LLMParseError } from '../errors.js'
import type { LLMErrors, ParseAttemptError } from '../errors.js'
import { mapProviderError } from '../provider-error.js'
import type {
    CompletionResponse,
    StreamEvent,
    LLMMessage,
    ToolDefinition,
    ToolCall,
    TokenLogprob,
} from '../types.js'
import { estimateTokenCount } from '../token-counter.js'
import { retryPolicy } from '../retry.js'
import { getProviderDefaultModel } from '../provider-defaults.js'
import { resolveCapability, registerProbedCapability } from '../capability-resolver.js'
import { probeOllamaCapability } from './local-probe.js'
import { warnCapabilityFallback } from '../capability-resolver.js'
import type { Capability } from '../capability.js'
import { emitToolCallComplete } from '../streaming-helpers.js'
import { selectAdapter } from '../adapter.js'
import { deepClone } from '../schema-utils.js'
import { resolveThinkingEnabled } from '../thinking/index.js'
import { mapStopReason } from '../params/stop-reason.js'

// Module-scope cache so the inline probe runs at most once per (baseUrl, model)
// per process. CalibrationStore write-through (cross-process) lands in S2.4.
const inlineProbeCache = new Map<string, Capability>()

/**
 * Resolve Capability for an Ollama model with probe-on-first-use.
 *
 * Order of attempts (each takes the first hit):
 *   1. In-process cache (this Map) — instant, no I/O
 *   2. Static-table entry via resolveCapability — instant, no I/O
 *   3. Live probe of /api/show — ~50-100ms first time per model
 *   4. Conservative fallback via resolveCapability — emits warning
 *
 * Step 3 is the scaling win: any model the user has pulled gets accurate
 * capabilities without anyone editing the static table.
 */
async function resolveOllamaCapability(
    model: string,
    baseUrl: string,
    apiKey?: string
): Promise<Capability> {
    const key = `${baseUrl}::${model}`
    const cached = inlineProbeCache.get(key)
    if (cached) return cached

    // Static-table fast path — avoids the probe round-trip for hand-curated models
    const staticOrFallback = resolveCapability('ollama', model)
    if (staticOrFallback.source === 'static-table') {
        inlineProbeCache.set(key, staticOrFallback)
        return staticOrFallback
    }

    // Static path missed; try probe before settling for fallback
    const probed = await probeOllamaCapability(model, baseUrl, apiKey)
    if (probed) {
        inlineProbeCache.set(key, probed)
        // Write through to the process-wide registry so the synchronous,
        // cache-less `resolveCapability` calls elsewhere (ContextPressure
        // denominator, context budget, snapshot) see the real probed numCtx
        // instead of the 2048 fallback.
        registerProbedCapability(probed)
        return probed
    }

    // Probe failed (model not pulled, Ollama down, malformed response) — accept
    // fallback. NOW emit the one-shot warning since neither static-table nor
    // probe yielded a real capability. Without the probe-failure gate, the
    // warning misleads users when the probe later succeeds (it almost always
    // does for any model the user has actually pulled via Ollama).
    warnCapabilityFallback('ollama', model)
    inlineProbeCache.set(key, staticOrFallback)
    return staticOrFallback
}

/**
 * Resolve the exact `num_ctx` Ollama will use for a call, by precedence:
 * per-request override → explicit config override (.withModel/run) → capability
 * recommendation → config default floor. Single source of truth — used both to
 * set `options.num_ctx` on the wire AND to surface `resolvedParams.contextWindow`
 * back to callers (provider-transparency), so the two never drift.
 */
function resolveOllamaNumCtx(
    request: { readonly numCtx?: number },
    config: { readonly explicitNumCtx?: number; readonly defaultNumCtx?: number },
    capability: { readonly recommendedNumCtx?: number },
): number | undefined {
    return (
        request.numCtx ??
        config.explicitNumCtx ??
        capability.recommendedNumCtx ??
        config.defaultNumCtx
    )
}

// ─── Ollama SDK types (from the `ollama` npm package) ───

type OllamaTool = {
    type: 'function'
    function: {
        name: string
        description: string
        parameters: Record<string, unknown>
    }
}

type OllamaMessage = {
    role: 'system' | 'user' | 'assistant' | 'tool'
    content: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tool_calls?: Array<{
        function: { name: string; arguments: Record<string, any> }
    }>
}

// ─── Conversion Helpers ───

const toOllamaMessages = (messages: readonly LLMMessage[]): OllamaMessage[] =>
    messages.map((m) => {
        // Tool result messages — pass through directly (Ollama supports role:"tool")
        if (m.role === 'tool') {
            return { role: 'tool' as const, content: m.content }
        }
        // Assistant messages — extract text and convert tool_use blocks to tool_calls
        if (m.role === 'assistant') {
            const textContent =
                typeof m.content === 'string'
                    ? m.content
                    : (m.content as readonly { type: string; text?: string }[])
                          .filter(
                              (b): b is { type: 'text'; text: string } =>
                                  b.type === 'text'
                          )
                          .map((b) => b.text)
                          .join('')
            const toolUseBlocks =
                typeof m.content !== 'string'
                    ? (
                          m.content as readonly {
                              type: string
                              name?: string
                              input?: unknown
                          }[]
                      ).filter(
                          (
                              b
                          ): b is {
                              type: 'tool_use'
                              name: string
                              input: unknown
                          } => b.type === 'tool_use'
                      )
                    : []
            return {
                role: 'assistant' as const,
                content: textContent,
                ...(toolUseBlocks.length > 0
                    ? {
                          tool_calls: toolUseBlocks.map((tc) => ({
                              function: {
                                  name: tc.name,
                                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                  arguments: (tc.input ?? {}) as Record<
                                      string,
                                      any
                                  >,
                              },
                          })),
                      }
                    : {}),
            }
        }
        // system, user
        return {
            role: m.role as 'system' | 'user',
            content:
                typeof m.content === 'string'
                    ? m.content
                    : (m.content as readonly { type: string; text?: string }[])
                          .filter(
                              (b): b is { type: 'text'; text: string } =>
                                  b.type === 'text'
                          )
                          .map((b) => b.text)
                          .join(''),
        }
    })

const toOllamaTools = (
    tools?: readonly ToolDefinition[]
): OllamaTool[] | undefined => {
    if (!tools || tools.length === 0) return undefined
    return tools.map((t) => ({
        type: 'function' as const,
        function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema as Record<string, unknown>,
        },
    }))
}

const parseToolCalls = (
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

// ─── Thinking Auto-Detect ───

/** Cache for model thinking capability checks (avoids repeated /api/show calls) */
const thinkingCapabilityCache = new Map<string, boolean>()

/**
 * Check if an Ollama model supports thinking mode via /api/show.
 *
 * Uses the canonical `capabilities` array which Ollama populates from the
 * model card. The previous template-string heuristic (checking for the word
 * "think") false-positived on models that mention "think" generically in
 * their chat template — granite3.3 is the smoking-gun case: the template
 * contains "think" but the model lacks the thinking capability, and sending
 * `think: true` causes "does not support thinking" errors that abort the
 * whole agent run.
 */
async function supportsThinking(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: { show: (opts: { model: string }) => Promise<any> },
    model: string
): Promise<boolean> {
    const cached = thinkingCapabilityCache.get(model)
    if (cached !== undefined) return cached

    try {
        const info = await client.show({ model })
        const capabilities = (info.capabilities ?? []) as readonly string[]
        const result = capabilities.includes('thinking')
        thinkingCapabilityCache.set(model, result)
        return result
    } catch {
        thinkingCapabilityCache.set(model, false)
        return false
    }
}

/**
 * Resolve the `think` parameter for Ollama chat calls.
 *
 * Delegates the tri-state opt-in decision to the shared `resolveThinkingEnabled`
 * resolver so all providers share one decision contract. The Ollama-specific
 * `/api/show` capability probe is preserved as the capability source.
 *
 * Return contract (boolean | undefined):
 *   - true     → pass `think: true` to ollama client
 *   - undefined → omit the `think` param entirely
 *
 * @internal exported for unit testing only.
 */
export async function resolveThinking(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: { show: (opts: { model: string }) => Promise<any> },
    model: string,
    configThinking: boolean | undefined
): Promise<boolean | undefined> {
    if (configThinking !== true) return undefined // undefined/false → off (opt-in)
    const capable = await supportsThinking(client, model)
    // Shared resolver applies the identical opt-in + warn-once discipline.
    return resolveThinkingEnabled('ollama', model, true, capable) ? true : undefined
}

// ─── Thinking-Aware Output Budget ───

/**
 * Extra num_predict headroom for thinking models (B2/P1, 2026-07-07).
 *
 * Ollama counts thinking tokens against num_predict, and thinking-capable
 * models (qwen3 family) think BY DEFAULT even when the `think` param is
 * omitted. A flat caller budget (2048–4096 across kernel/strategy call sites)
 * is routinely consumed entirely inside <think>, yielding an empty-content
 * `done_reason: length` turn that the caller retries with the same dead
 * budget — the qwen3:14b bench measured 54 such exchanges (113k wasted output
 * tokens, 37 min). num_predict is a cap, not a target: widening costs nothing
 * on non-rambling turns and un-starves the visible answer on thinking turns.
 *
 * @internal exported for unit testing only.
 */
export const THINKING_NUM_PREDICT_ALLOWANCE = 6000

/**
 * Widen a resolved num_predict when thinking will consume part of it: either
 * thinking was explicitly enabled (`think === true`), or the param is omitted
 * and the model's capability says it runs a thinking mode by default.
 *
 * @internal exported for unit testing only.
 */
export function widenNumPredictForThinking(
    numPredict: number | undefined,
    think: boolean | undefined,
    capability: { readonly supportsThinkingMode?: boolean },
): number | undefined {
    if (numPredict === undefined) return undefined
    const thinkingActive =
        think === true ||
        (think === undefined && capability.supportsThinkingMode === true)
    return thinkingActive
        ? numPredict + THINKING_NUM_PREDICT_ALLOWANCE
        : numPredict
}

// ─── Error Helpers ───

/**
 * Map an Ollama SDK error to a clean, tagged LLM error.
 *
 * Delegates to the shared {@link mapProviderError} normalizer so a model-name
 * typo yields a single actionable line (`Model "X" not found locally. Run:
 * ollama pull X`) with a one-line string `cause` — never the raw SDK object,
 * whose inspection would re-print the JSON body and leak an internal stack.
 */
function ollamaError(error: unknown, model?: string): LLMErrors {
    return mapProviderError(error, 'ollama', model)
}

// ─── Timeout Resolution ───

/**
 * Cold-load-tolerant default ceiling (ms) for a single local generation.
 *
 * Deliberately far above a hosted call: a cold model load or a GPU swap under
 * contention can push one Ollama generation past two minutes (observed 2m31s
 * on a dev box, 2026-07-01, where the OLD hardcoded 120s literal killed the run
 * mid-generation). 300s gives cold/contended calls room to finish.
 */
const DEFAULT_LOCAL_TIMEOUT_MS = 300_000

/**
 * Resolve the per-call timeout (ms) for the local provider by precedence:
 * per-request override → provider config → cold-load default.
 *
 *   request.timeoutMs      — caller-supplied per-call override
 *   config.ollamaTimeoutMs — provider-wide override (OLLAMA_TIMEOUT_MS env)
 *   DEFAULT_LOCAL_TIMEOUT_MS — cold-load-tolerant floor
 *
 * NOTE (denied-by-authority follow-up for runtime-warden): the builder's
 * `.withTimeout()` maps to the execution-engine whole-run timeout, NOT to
 * `LLMConfig.ollamaTimeoutMs`. Threading `.withTimeout()` (or a dedicated
 * `.withLlmTimeout()`) into this field is a runtime/builder change outside
 * llm-provider's authority. Until then the value is reachable via
 * `request.timeoutMs` or `OLLAMA_TIMEOUT_MS`.
 */
function resolveLocalTimeoutMs(
    request: { readonly timeoutMs?: number },
    config: { readonly ollamaTimeoutMs?: number },
): number {
    return request.timeoutMs ?? config.ollamaTimeoutMs ?? DEFAULT_LOCAL_TIMEOUT_MS
}

// ─── Ollama / Local Provider Layer ───

export const LocalProviderLive = Layer.effect(
    LLMService,
    Effect.gen(function* () {
        const config = yield* LLMConfig
        const endpoint = config.ollamaEndpoint ?? 'http://localhost:11434'
        const defaultModel =
            config.defaultModel.startsWith('claude') ||
            config.defaultModel.startsWith('gpt')
                ? getProviderDefaultModel('ollama') ?? 'cogito:14b'
                : config.defaultModel

        // Lazy-import the ollama SDK (same pattern as Gemini provider).
        //
        // When an AbortSignal is supplied, inject a fetch that forwards it into
        // every underlying request. On client-side timeout (Effect interruption
        // fires the signal) the in-flight HTTP request is aborted so the Ollama
        // server stops generating instead of burning GPU on a response the
        // client already abandoned (root cause of the 2026-07-01 audit finding).
        const getClient = async (signal?: AbortSignal) => {
            const { Ollama } = await import('ollama')
            // ollama's `Config.fetch` is typed as the full global `fetch`
            // (including its `preconnect` member), so preserve it via
            // Object.assign rather than a bare arrow (which lacks `preconnect`).
            const fetchWithSignal: typeof fetch = Object.assign(
                (
                    input: Parameters<typeof fetch>[0],
                    init?: Parameters<typeof fetch>[1],
                ): Promise<Response> => fetch(input, { ...init, signal }),
                { preconnect: fetch.preconnect },
            )
            return new Ollama({
                host: endpoint,
                ...(signal ? { fetch: fetchWithSignal } : {}),
                ...(config.ollamaApiKey
                    ? {
                          headers: {
                              Authorization: `Bearer ${config.ollamaApiKey}`,
                          },
                      }
                    : {}),
            })
        }

        return LLMService.of({
            complete: (request) =>
                // Effect.suspend so `startedAt` is captured at RUN time (not at
                // Effect-construction time), giving an accurate elapsed figure
                // for the timeout error.
                Effect.suspend(() => {
                    const model =
                        typeof request.model === 'string'
                            ? request.model
                            : request.model?.model ?? defaultModel
                    const timeoutMs = resolveLocalTimeoutMs(request, config)
                    const startedAt = Date.now()

                    return Effect.gen(function* () {
                    // Resolve capability up-front so we can use its tier for
                    // adapter selection (M12 Hook 1/7) and num_ctx wiring.
                    const capability = yield* Effect.tryPromise({
                        try: () =>
                            resolveOllamaCapability(
                                model,
                                endpoint,
                                config.ollamaApiKey
                            ),
                        catch: () =>
                            new Error('capability resolution failed'),
                    }).pipe(
                        Effect.catchAll(() =>
                            Effect.succeed(resolveCapability('ollama', model))
                        )
                    )

                    // F7: bind num_ctx ONCE per call — used for the wire
                    // `options.num_ctx` AND `resolvedParams.contextWindow`
                    // below, so the two can never drift.
                    // Precedence: request.numCtx → config.explicitNumCtx
                    // (user override via .withModel/run) →
                    // capability.recommendedNumCtx → config.defaultNumCtx
                    // (unknown-model floor).
                    const numCtx = resolveOllamaNumCtx(request, config, capability)

                    const response = yield* Effect.tryPromise({
                        // `signal` fires when the fiber is interrupted (e.g. by
                        // the timeout below) — forwarding it to getClient aborts
                        // the in-flight Ollama HTTP request so the server stops
                        // generating instead of finishing a response the client
                        // has abandoned.
                        try: async (signal) => {
                            const client = await getClient(signal)

                            const msgs = toOllamaMessages(request.messages)
                            if (request.systemPrompt) {
                                msgs.unshift({
                                    role: 'system',
                                    content: request.systemPrompt,
                                })
                            }

                            const think = await resolveThinking(
                                client,
                                model,
                                config.thinking
                            )

                            return client.chat({
                                model,
                                messages: msgs,
                                tools: toOllamaTools(request.tools),
                                stream: false,
                                ...(think !== undefined ? { think } : {}),
                                keep_alive: '5m',
                                options: {
                                    temperature:
                                        request.temperature ??
                                        config.defaultTemperature,
                                    num_predict: widenNumPredictForThinking(
                                        request.maxTokens ??
                                            config.defaultMaxTokens,
                                        think,
                                        capability,
                                    ),
                                    stop: request.stopSequences
                                        ? [...request.stopSequences]
                                        : undefined,
                                    ...(numCtx !== undefined
                                        ? { num_ctx: numCtx }
                                        : {}),
                                    ...(request.logprobs
                                        ? { logprobs: true }
                                        : {}),
                                    ...(request.topLogprobs != null
                                        ? { top_logprobs: request.topLogprobs }
                                        : {}),
                                },
                            })
                        },
                        catch: (error) => ollamaError(error, model),
                    })

                    const content = response.message?.content ?? ''
                    // Extract thinking from Ollama response (available in SDK v0.6+ for thinking models)
                    const thinkingContent =
                        (response.message as { thinking?: string } | undefined)
                            ?.thinking || undefined
                    const inputTokens = response.prompt_eval_count ?? 0
                    const outputTokens = response.eval_count ?? 0

                    // M12 Hook 1/7 — give the provider adapter first crack at
                    // normalizing tool_calls from the raw response (e.g., qwen3
                    // stringified arguments). When the adapter declines or no
                    // calibration is registered, fall back to the default
                    // Ollama-shaped parser. Adapter selection is per-request
                    // because (model, tier) varies per CompletionRequest.
                    const { adapter: providerAdapter } = selectAdapter(
                        { supportsToolCalling: true },
                        capability.tier,
                        model
                    )
                    const adapterParsed = providerAdapter.parseToolCalls?.(
                        response,
                        model
                    )
                    const toolCalls = adapterParsed
                        ? adapterParsed.map((tc, i) => ({
                              id: `ollama-tc-${Date.now()}-${i}`,
                              name: tc.name,
                              input: tc.arguments,
                          }))
                        : parseToolCalls(
                              response.message?.tool_calls as
                                  | Array<{
                                        function: {
                                            name: string
                                            arguments: unknown
                                        }
                                    }>
                                  | undefined
                          )

                    const hasToolCalls = toolCalls && toolCalls.length > 0

                    // Extract logprobs from Ollama response if present
                    const rawLogprobs = (
                        response as {
                            logprobs?: Array<{
                                token: string
                                logprob: number
                                top_logprobs?: Array<{
                                    token: string
                                    logprob: number
                                }>
                            }>
                        }
                    ).logprobs
                    const logprobs: TokenLogprob[] | undefined = rawLogprobs
                        ? rawLogprobs.map((lp) => ({
                              token: lp.token,
                              logprob: lp.logprob,
                              ...(lp.top_logprobs
                                  ? {
                                        topLogprobs: lp.top_logprobs.map(
                                            (tlp) => ({
                                                token: tlp.token,
                                                logprob: tlp.logprob,
                                            })
                                        ),
                                    }
                                  : {}),
                          }))
                        : undefined

                    return {
                        content,
                        // Shared table-driven done_reason mapping; the
                        // hasToolCalls override preserves the original
                        // ladder's short-circuit.
                        stopReason: hasToolCalls
                            ? ('tool_use' as const)
                            : mapStopReason(response.done_reason, 'ollama'),
                        usage: {
                            inputTokens,
                            outputTokens,
                            totalTokens: inputTokens + outputTokens,
                            estimatedCost: 0, // Local models are free
                        },
                        model: response.model ?? model,
                        toolCalls,
                        ...(thinkingContent
                            ? { thinking: thinkingContent }
                            : {}),
                        ...(logprobs ? { logprobs } : {}),
                        // Provider transparency: surface the exact context window used.
                        ...(numCtx !== undefined
                            ? { resolvedParams: { contextWindow: numCtx } }
                            : {}),
                    } satisfies CompletionResponse
                }).pipe(
                    Effect.retry(retryPolicy),
                    Effect.timeout(Duration.millis(timeoutMs)),
                    Effect.catchTag('TimeoutException', () => {
                        const elapsedMs = Date.now() - startedAt
                        return Effect.fail(
                            new LLMTimeoutError({
                                message:
                                    `Local LLM request for model "${model}" timed out after ` +
                                    `${elapsedMs}ms (limit ${timeoutMs}ms). The model may be ` +
                                    `cold-loading or the GPU is contended — warm it first (a ` +
                                    `single call to load it), raise the timeout via ` +
                                    `request.timeoutMs / OLLAMA_TIMEOUT_MS, or reduce contention.`,
                                provider: 'ollama',
                                timeoutMs,
                                model,
                                elapsedMs,
                            })
                        )
                    })
                )
                }),

            stream: (request) =>
                Effect.gen(function* () {
                    const model =
                        typeof request.model === 'string'
                            ? request.model
                            : request.model?.model ?? defaultModel

                    return Stream.async<StreamEvent, LLMErrors>((emit) => {
                        // Track the abortable iterator so stream interruption
                        // (consumer cancels / scope closes) tears down the
                        // in-flight Ollama request instead of leaving the server
                        // generating. `aborted` suppresses the post-abort
                        // AbortError from surfacing as a spurious stream failure.
                        let ollamaStream: { abort: () => void } | undefined
                        let aborted = false
                        const doStream = async () => {
                            try {
                                const client = await getClient()

                                const msgs = toOllamaMessages(request.messages)
                                if (request.systemPrompt) {
                                    msgs.unshift({
                                        role: 'system',
                                        content: request.systemPrompt,
                                    })
                                }

                                const think = await resolveThinking(
                                    client,
                                    model,
                                    config.thinking
                                )

                                const wantLogprobs = request.logprobs ?? false
                                // Phase 1 S2.4 — probe-aware capability (see complete() path)
                                const capability =
                                    await resolveOllamaCapability(
                                        model,
                                        endpoint,
                                        config.ollamaApiKey
                                    )
                                const numCtx = resolveOllamaNumCtx(request, config, capability)

                                // M12 Hook 1/7 — adapter selection for the
                                // streaming tool-call normalization site.
                                const { adapter: streamAdapter } =
                                    selectAdapter(
                                        { supportsToolCalling: true },
                                        capability.tier,
                                        model
                                    )

                                const stream = await client.chat({
                                    model,
                                    messages: msgs,
                                    tools: toOllamaTools(request.tools),
                                    stream: true,
                                    ...(think !== undefined ? { think } : {}),
                                    keep_alive: '5m',
                                    options: {
                                        temperature:
                                            request.temperature ??
                                            config.defaultTemperature,
                                        num_predict:
                                            widenNumPredictForThinking(
                                                request.maxTokens ??
                                                    config.defaultMaxTokens,
                                                think,
                                                capability,
                                            ),
                                        ...(numCtx !== undefined
                                            ? { num_ctx: numCtx }
                                            : {}),
                                        ...(wantLogprobs
                                            ? { logprobs: true }
                                            : {}),
                                    },
                                })
                                ollamaStream = stream

                                let fullContent = ''
                                const accumulatedLogprobs: TokenLogprob[] = []
                                const accumulatedToolCalls: ToolCall[] = []

                                for await (const chunk of stream) {
                                    if (chunk.message?.content) {
                                        fullContent += chunk.message.content
                                        emit.single({
                                            type: 'text_delta',
                                            text: chunk.message.content,
                                        })
                                    }

                                    // Handle tool calls in stream chunks (native function calling).
                                    // M12 Hook 1/7 — give the adapter first
                                    // crack at normalization (e.g., qwen3
                                    // stringified args). When the adapter
                                    // declines, fall through to default Ollama
                                    // shape extraction.
                                    if (
                                        chunk.message?.tool_calls &&
                                        Array.isArray(chunk.message.tool_calls)
                                    ) {
                                        const rawToolCalls = chunk.message
                                            .tool_calls as Array<{
                                            function: {
                                                name: string
                                                arguments: unknown
                                            }
                                        }>
                                        // Synthesize a response-shaped wrapper
                                        // so the adapter sees the same shape it
                                        // sees in complete().
                                        const adapterNormalized =
                                            streamAdapter.parseToolCalls?.(
                                                { message: chunk.message },
                                                model
                                            )
                                        if (adapterNormalized) {
                                            for (const tc of adapterNormalized) {
                                                const toolCall: ToolCall = {
                                                    id: `ollama-tc-${Date.now()}-${
                                                        accumulatedToolCalls.length
                                                    }`,
                                                    name: tc.name,
                                                    input: tc.arguments,
                                                }
                                                accumulatedToolCalls.push(
                                                    toolCall
                                                )
                                                emitToolCallComplete(
                                                    emit,
                                                    toolCall.id,
                                                    toolCall.name,
                                                    tc.arguments
                                                )
                                            }
                                        } else {
                                            for (const tc of rawToolCalls) {
                                                const toolCall: ToolCall = {
                                                    id: `ollama-tc-${Date.now()}-${
                                                        accumulatedToolCalls.length
                                                    }`,
                                                    name: tc.function.name,
                                                    input: tc.function.arguments,
                                                }
                                                accumulatedToolCalls.push(
                                                    toolCall
                                                )
                                                emitToolCallComplete(
                                                    emit,
                                                    toolCall.id,
                                                    toolCall.name,
                                                    tc.function.arguments
                                                )
                                            }
                                        }
                                    }

                                    // Accumulate per-chunk logprobs when available
                                    if (wantLogprobs) {
                                        const chunkLp = (chunk as any).logprobs
                                        if (Array.isArray(chunkLp)) {
                                            for (const lp of chunkLp) {
                                                accumulatedLogprobs.push({
                                                    token: lp.token,
                                                    logprob: lp.logprob,
                                                    ...(lp.top_logprobs
                                                        ? {
                                                              topLogprobs:
                                                                  lp.top_logprobs.map(
                                                                      (
                                                                          t: any
                                                                      ) => ({
                                                                          token: t.token,
                                                                          logprob:
                                                                              t.logprob,
                                                                      })
                                                                  ),
                                                          }
                                                        : {}),
                                                })
                                            }
                                        }
                                    }

                                    if (chunk.done) {
                                        const hasToolCalls =
                                            accumulatedToolCalls.length > 0
                                        const doneReason = (chunk as any)
                                            .done_reason as string | undefined
                                        emit.single({
                                            type: 'content_complete',
                                            content: fullContent,
                                            // Shared table-driven done_reason
                                            // mapping (mirrors complete()).
                                            ...(hasToolCalls
                                                ? { stopReason: 'tool_use' }
                                                : {
                                                      stopReason: mapStopReason(
                                                          doneReason,
                                                          'ollama',
                                                      ),
                                                  }),
                                        } as any)
                                        if (accumulatedLogprobs.length > 0) {
                                            emit.single({
                                                type: 'logprobs',
                                                logprobs: accumulatedLogprobs,
                                            })
                                        }
                                        emit.single({
                                            type: 'usage',
                                            usage: {
                                                inputTokens:
                                                    chunk.prompt_eval_count ??
                                                    0,
                                                outputTokens:
                                                    chunk.eval_count ?? 0,
                                                totalTokens:
                                                    (chunk.prompt_eval_count ??
                                                        0) +
                                                    (chunk.eval_count ?? 0),
                                                estimatedCost: 0,
                                            },
                                            // Provider transparency: exact context window used this call.
                                            // F7: reuses the single numCtx binding from stream setup.
                                            ...(numCtx !== undefined
                                                ? { resolvedParams: { contextWindow: numCtx } }
                                                : {}),
                                        })
                                        emit.end()
                                    }
                                }
                            } catch (error) {
                                // Suppress the AbortError that `abort()` raises
                                // on interruption — it is not a real failure.
                                if (!aborted) {
                                    emit.fail(ollamaError(error, model))
                                }
                            }
                        }
                        void doStream()
                        // Finalizer: run on stream interruption/scope close.
                        return Effect.sync(() => {
                            aborted = true
                            ollamaStream?.abort()
                        })
                    })
                }),

            completeStructured: (request) =>
                Effect.gen(function* () {
                    const encodedSchema = Schema.encodedSchema(
                        request.outputSchema
                    )
                    const schemaObj = deepClone<Record<string, unknown>>(encodedSchema)
                    const schemaStr = JSON.stringify(schemaObj, null, 2)

                    // Build Ollama-native format constraint.
                    // Ollama SDK ≥0.5 supports format: { type: "object", properties: ... }
                    // for schema-enforced JSON output (GBNF grammar under the hood).
                    // Fall back to format: "json" if the schema doesn't have properties.
                    const ollamaFormat: 'json' | Record<string, unknown> =
                        schemaObj &&
                        typeof schemaObj === 'object' &&
                        schemaObj.properties
                            ? (schemaObj as Record<string, unknown>)
                            : 'json'

                    const model =
                        typeof request.model === 'string'
                            ? request.model
                            : request.model?.model ?? defaultModel

                    let lastError: unknown = null
                    const parseAttempts: ParseAttemptError[] = []
                    const maxRetries = request.maxParseRetries ?? 2

                    for (let attempt = 0; attempt <= maxRetries; attempt++) {
                        const msgs = toOllamaMessages(
                            attempt === 0
                                ? [
                                      ...request.messages,
                                      {
                                          role: 'user' as const,
                                          content: `\nRespond with ONLY valid JSON matching this schema:\n${schemaStr}\n\nNo markdown, no code fences, just raw JSON.`,
                                      },
                                  ]
                                : [
                                      ...request.messages,
                                      {
                                          role: 'user' as const,
                                          content: `\nRespond with ONLY valid JSON matching this schema:\n${schemaStr}\n\nNo markdown, no code fences, just raw JSON.`,
                                      },
                                      {
                                          role: 'assistant' as const,
                                          content: String(lastError),
                                      },
                                      {
                                          role: 'user' as const,
                                          content: `That response was not valid JSON. The parse error was: ${String(
                                              lastError
                                          )}. Please try again with valid JSON only.`,
                                      },
                                  ]
                        )

                        if (request.systemPrompt) {
                            msgs.unshift({
                                role: 'system',
                                content: request.systemPrompt,
                            })
                        }

                        // Phase 1 S2.4 — probe-aware capability (see complete() path)
                        const capability = yield* Effect.tryPromise({
                            try: () => resolveOllamaCapability(model, endpoint),
                            catch: () =>
                                new Error('capability resolution failed'),
                        }).pipe(
                            Effect.catchAll(() =>
                                Effect.succeed(
                                    resolveCapability('ollama', model)
                                )
                            )
                        )
                        const numCtx = resolveOllamaNumCtx(request, config, capability)

                        const response = yield* Effect.tryPromise({
                            try: async () => {
                                const client = await getClient()
                                return client.chat({
                                    model,
                                    messages: msgs,
                                    stream: false,
                                    format: ollamaFormat,
                                    keep_alive: '5m',
                                    options: {
                                        temperature:
                                            request.temperature ??
                                            config.defaultTemperature,
                                        // No `think` param on the structured-output
                                        // path — default-thinking models (qwen3)
                                        // still think under `format`, which is how
                                        // flat structured-output budgets starved
                                        // (A2: infer-required-tools dead exchanges).
                                        num_predict:
                                            widenNumPredictForThinking(
                                                request.maxTokens ??
                                                    config.defaultMaxTokens,
                                                undefined,
                                                capability,
                                            ),
                                        ...(numCtx !== undefined
                                            ? { num_ctx: numCtx }
                                            : {}),
                                    },
                                })
                            },
                            catch: (error) => ollamaError(error, model),
                        })

                        const content = response.message?.content ?? ''

                        try {
                            const parsed = JSON.parse(content)
                            const decoded = Schema.decodeUnknownEither(
                                request.outputSchema
                            )(parsed)

                            if (decoded._tag === 'Right') {
                                return decoded.right
                            }
                            lastError = decoded.left
                            parseAttempts.push({ attempt, error: decoded.left })
                        } catch (e) {
                            lastError = e
                            parseAttempts.push({ attempt, error: e })
                        }
                    }

                    return yield* Effect.fail(
                        new LLMParseError({
                            message: `Failed to parse structured output after ${
                                maxRetries + 1
                            } attempts`,
                            rawOutput: String(lastError),
                            expectedSchema: schemaStr,
                            attempts: parseAttempts,
                        })
                    )
                }),

            embed: (texts, model) =>
                Effect.tryPromise({
                    try: async () => {
                        const client = await getClient()
                        const embeddingModel =
                            model ??
                            config.embeddingConfig.model ??
                            'nomic-embed-text'

                        const response = await client.embed({
                            model: embeddingModel,
                            input: [...texts],
                        })

                        return response.embeddings
                    },
                    catch: (error) =>
                        ollamaError(
                            error,
                            model ??
                                config.embeddingConfig.model ??
                                'nomic-embed-text'
                        ),
                }),

            countTokens: (messages) =>
                Effect.gen(function* () {
                    return yield* estimateTokenCount(messages)
                }),

            getModelConfig: () =>
                Effect.succeed({
                    provider: 'ollama' as const,
                    model: defaultModel,
                }),

            getStructuredOutputCapabilities: () =>
                Effect.succeed({
                    nativeJsonMode: true,
                    jsonSchemaEnforcement: true,
                    prefillSupport: false,
                    grammarConstraints: true,
                }),

            capabilities: () =>
                Effect.succeed({
                    supportsToolCalling: true,
                    supportsStreaming: true,
                    supportsStructuredOutput: true,
                    supportsLogprobs: false,
                } satisfies ProviderCapabilities),
        })
    })
)
