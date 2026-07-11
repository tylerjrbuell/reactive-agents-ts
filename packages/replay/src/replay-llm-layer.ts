import { Effect, Layer, Stream } from "effect"
import {
    LLMService,
    messageContentToString,
    type CompletionRequest,
    type CompletionResponse,
    type StopReason,
    type StreamEvent,
    type ToolCall,
} from "@reactive-agents/llm-provider"
import { exchangeKey, type LLMTable, type RecordedExchange, type RecordedExchangeResponse } from "./llm-table.js"

/**
 * EXACT-REPLAY ONLY. This layer dispenses recorded LLM responses keyed on a
 * hash of (systemPrompt, messages) — the byte-identical request that was
 * recorded. It is NOT a general deterministic re-execution engine: any
 * config change that alters the rendered prompt (model swap, prompt-template
 * edit, tool-schema change that feeds the system prompt, temperature-derived
 * prompt content, etc.) produces a different request key and MISSES by
 * design. A miss dies loudly (see {@link missError}) rather than silently
 * falling back to a live call, so replay runs never silently re-incur cost
 * or drift from the recording.
 */

const STOP_REASONS: readonly StopReason[] = ["end_turn", "max_tokens", "stop_sequence", "tool_use"]

function isStopReason(s: string): s is StopReason {
    return (STOP_REASONS as readonly string[]).includes(s)
}

function toStopReason(s: string | undefined): StopReason {
    return s !== undefined && isStopReason(s) ? s : "end_turn"
}

/**
 * Project a live CompletionRequest into the recorded-exchange key space using
 * the SAME flattening the record side applies (`messageContentToString` from
 * llm-provider's exchange-projection — ContentBlock[] → text blocks + tool
 * placeholders). Truncation to the record-side caps happens inside
 * `exchangeKey` itself, so a live untruncated prompt hashes identically to
 * its recorded (capped) counterpart.
 */
function requestKey(req: CompletionRequest): string {
    return exchangeKey(
        req.systemPrompt,
        req.messages.map((m) => ({ role: m.role, content: messageContentToString(m.content) })),
    )
}

function resolveModelLabel(req: CompletionRequest): string {
    if (typeof req.model === "string") return req.model
    if (req.model) return req.model.model
    return "replay"
}

function toToolCalls(resp: RecordedExchangeResponse): readonly ToolCall[] | undefined {
    if (!resp.toolCalls || resp.toolCalls.length === 0) return undefined
    return resp.toolCalls.map((tc, i) => ({ id: `replay_${i}`, name: tc.name, input: tc.arguments }))
}

function toStreamEvents(rec: RecordedExchange): readonly StreamEvent[] {
    const out: StreamEvent[] = []
    if (rec.response.content) out.push({ type: "text_delta", text: rec.response.content })
    for (const [i, tc] of (rec.response.toolCalls ?? []).entries()) {
        out.push({ type: "tool_use_start", id: `replay_${i}`, name: tc.name })
        if (tc.arguments !== undefined) out.push({ type: "tool_use_delta", input: JSON.stringify(tc.arguments) })
    }
    out.push({ type: "content_complete", content: rec.response.content })
    out.push({
        type: "usage",
        usage: {
            inputTokens: rec.response.tokensIn ?? 0,
            outputTokens: rec.response.tokensOut ?? 0,
            totalTokens: (rec.response.tokensIn ?? 0) + (rec.response.tokensOut ?? 0),
            estimatedCost: 0,
        },
    })
    return out
}

function missError(key: string): Error {
    return new Error(
        `replay: no recorded exchange for request key ${key} — exact-replay requires unchanged prompts/config; ` +
            "a config change that alters the rendered prompt (model swap, prompt template edit, tool-schema change, " +
            "etc.) produces a different key and MISSES by design. Re-record the run or revert the change.",
    )
}

export function makeReplayLLMLayer(table: LLMTable): Layer.Layer<LLMService> {
    return Layer.succeed(LLMService, {
        complete: (req: CompletionRequest) =>
            Effect.gen(function* () {
                const key = requestKey(req)
                const rec = table.next(key)
                if (!rec) return yield* Effect.die(missError(key))
                const response: CompletionResponse = {
                    content: rec.response.content,
                    stopReason: toStopReason(rec.response.stopReason),
                    usage: {
                        inputTokens: rec.response.tokensIn ?? 0,
                        outputTokens: rec.response.tokensOut ?? 0,
                        totalTokens: (rec.response.tokensIn ?? 0) + (rec.response.tokensOut ?? 0),
                        estimatedCost: 0,
                    },
                    model: resolveModelLabel(req),
                    toolCalls: toToolCalls(rec.response),
                }
                return response
            }),
        stream: (req: CompletionRequest) =>
            Effect.gen(function* () {
                const key = requestKey(req)
                const rec = table.next(key)
                if (!rec) return yield* Effect.die(missError(key))
                return Stream.fromIterable(toStreamEvents(rec))
            }),
        completeStructured: () =>
            Effect.die(
                new Error(
                    "replay: completeStructured not supported — exact-replay only dispenses recorded complete()/stream() exchanges",
                ),
            ),
        embed: () => Effect.die(new Error("replay: embed not supported during replay")),
        countTokens: () => Effect.succeed(0),
        getModelConfig: () => Effect.die(new Error("replay: getModelConfig not supported during replay")),
        // Same hot-path rationale as capabilities() below: the kernel probes
        // this on tool-using runs, and a `die` there is an uncatchable defect.
        // Values mirror the test provider the goldens are recorded on.
        getStructuredOutputCapabilities: () =>
            Effect.succeed({
                nativeJsonMode: true,
                jsonSchemaEnforcement: false,
                prefillSupport: false,
                grammarConstraints: false,
            }),
        // Recorded responses carry structured tool calls (native-FC shape), so
        // the replayed run must take the native-FC path — same capabilities the
        // test provider reports. Returned (not `die`d): the kernel reads this on
        // the hot path (runner.ts native-FC detection), and a defect there is
        // NOT caught by its `catchAll` (which only handles failures).
        capabilities: () =>
            Effect.succeed({
                supportsToolCalling: true,
                supportsStreaming: true,
                supportsStructuredOutput: false,
                supportsLogprobs: false,
            }),
    })
}
