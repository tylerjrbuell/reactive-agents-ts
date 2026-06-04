/**
 * Observable LLM wrapper — emits `LLMExchangeEmitted` events to EventBus on
 * every `complete()`, `stream()`, and `completeStructured()` call so observers
 * (the reasoning-stream-logger when `logModelIO` is on, the trace layer, the
 * diagnose CLI) can see EVERY direct LLM call across all 4 providers
 * (Anthropic / OpenAI / Google / Ollama) from a single chokepoint — including
 * calls outside the kernel main loop that the kernel's own `[model-io]`
 * capture misses (plan-execute analysis, reflexion critique/refine, ToT BFS).
 *
 * `emitLLMExchange` already publishes the event with truncation + EventBus
 * service-option guard; this wrapper just calls it consistently. Inner
 * LLMService remains untouched.
 *
 * Stream wrapping note: the wrapper transforms the returned `Stream` with
 * `Stream.tap` (per-event accumulation into a Ref) and `Stream.ensuring`
 * (exactly-once emission at finalization — success, failure, or interrupt).
 * The Stream's element and error types are unchanged, so callers see
 * identical events in identical order with no consumption-once issues.
 *
 * Not a double-emit with `ReasoningStepCompleted`: that's a kernel-side
 * post-processed *step* event (carries observation + entropy); this is a
 * *raw exchange* event with the system prompt, message thread, and decoded
 * response. Different schemas, different consumers, no conflict.
 *
 * Note: stream emission fires only when the caller actually consumes the
 * Stream (Stream.ensuring runs at finalization). A bound-but-never-run
 * Stream produces no event — that is correct behavior, not a bug.
 */
import { Effect, Layer, Ref, Stream } from "effect";
import type { Context } from "effect";
import {
  LLMService,
  type CompletionRequest,
  type StructuredCompletionRequest,
  type LLMMessage,
  type StreamEvent,
  type StopReason,
} from "@reactive-agents/llm-provider";
import { emitLLMExchange } from "./utils/diagnostics.js";

// Placeholder correlation values. The wrapper sits below the kernel/strategy
// layer so it cannot see taskId/iteration directly. Callers that CAN correlate
// (the kernel think-loop) snapshot taskId/iteration into the request via the
// optional `request.traceContext` field at build time — emitForRequest reads
// it when present (FiberRef-free, immune to stream-context inheritance issues).
// Calls outside the kernel loop (reflexion/ToT/plan-execute sub-calls) leave
// traceContext unset and correctly fall back to these placeholders.
const PLACEHOLDER_TASK_ID = "llm-direct";
const PLACEHOLDER_ITERATION = 0;

function messageContentToString(content: LLMMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b === "string") return b;
        if (b && typeof b === "object") {
          const blk = b as { type?: string; text?: string; name?: string };
          if (blk.type === "text" && typeof blk.text === "string") return blk.text;
          if (blk.type === "tool_use") return `[tool_use:${blk.name ?? "?"}]`;
          if (blk.type === "tool_result") return `[tool_result]`;
        }
        return "";
      })
      .join("");
  }
  return "";
}

type ExchangeRole = "system" | "user" | "assistant" | "tool";

function toExchangeMessages(
  messages: readonly LLMMessage[],
): readonly { readonly role: ExchangeRole; readonly content: string }[] {
  return messages.map((m) => {
    const raw = m.role as string;
    const role: ExchangeRole =
      raw === "system" || raw === "user" || raw === "assistant" || raw === "tool"
        ? (raw as ExchangeRole)
        : "user";
    return { role, content: messageContentToString(m.content) };
  });
}

// Structural subset of CompletionResponse — every field optional so both
// `complete` (full response) and `stream` (accumulated partial) can pass
// shape-compatible objects without unsafe casts. emitForRequest reads each
// field with optional-chaining anyway.
type PartialCompletion = {
  readonly model?: string;
  readonly stopReason?: StopReason;
  readonly toolCalls?: readonly { readonly name: string; readonly arguments?: unknown }[];
  readonly usage?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly estimatedCost?: number;
    /** Anthropic prompt-caching: tokens that wrote new cache entries (Lever 1). */
    readonly cacheCreationInputTokens?: number;
    /** Anthropic prompt-caching: tokens served from cache hits. */
    readonly cacheReadInputTokens?: number;
  };
};

function emitForRequest(
  request: CompletionRequest,
  responseContent: string,
  durationMs: number,
  kind: "complete" | "stream" | "completeStructured",
  fullResponse?: PartialCompletion,
): Effect.Effect<void, never> {
  return emitLLMExchange({
    taskId: request.traceContext?.taskId ?? PLACEHOLDER_TASK_ID,
    iteration: request.traceContext?.iteration ?? PLACEHOLDER_ITERATION,
    provider: request.model?.provider ?? fullResponse?.model ?? "unknown",
    model: request.model?.model ?? fullResponse?.model ?? "unknown",
    requestKind: kind,
    systemPrompt: request.systemPrompt,
    messages: toExchangeMessages(request.messages),
    toolSchemaNames: request.tools?.map((t) => t.name),
    temperature: request.temperature,
    maxTokens: request.maxTokens,
    response: {
      content: responseContent,
      toolCalls: fullResponse?.toolCalls?.map((tc) => ({
        name: tc.name,
        arguments: tc.arguments,
      })),
      stopReason: fullResponse?.stopReason,
      tokensIn: fullResponse?.usage?.inputTokens,
      tokensOut: fullResponse?.usage?.outputTokens,
      // Lever 1 observability — surface Anthropic prompt-cache stats into the
      // trace so multi-iter cache hit rates are inspectable via `rax:diagnose`.
      ...(typeof fullResponse?.usage?.cacheCreationInputTokens === "number"
        ? { cacheCreationTokensIn: fullResponse.usage.cacheCreationInputTokens }
        : {}),
      ...(typeof fullResponse?.usage?.cacheReadInputTokens === "number"
        ? { cacheReadTokensIn: fullResponse.usage.cacheReadInputTokens }
        : {}),
      costUsd: fullResponse?.usage?.estimatedCost,
      durationMs,
    },
  });
}

/**
 * Layer that wraps an upstream LLMService to emit `LLMExchangeEmitted` on
 * every complete/completeStructured call. Apply after rate limiting; the
 * order is: provider → rate-limited → observable.
 */
export const makeObservableLLM = (): Layer.Layer<LLMService, never, LLMService> =>
  Layer.effect(
    LLMService,
    Effect.gen(function* () {
      const inner = yield* LLMService;
      return {
        complete: (request) =>
          Effect.gen(function* () {
            const start = Date.now();
            const response = yield* inner.complete(request);
            yield* emitForRequest(request, response.content, Date.now() - start, "complete", response);
            return response;
          }),
        completeStructured: <A>(request: StructuredCompletionRequest<A>) =>
          Effect.gen(function* () {
            const start = Date.now();
            const result = yield* inner.completeStructured(request);
            // Structured result is the parsed value, not a CompletionResponse —
            // stringify for observability. The trace + diagnose layers will
            // see a JSON-ish content payload tagged completeStructured.
            const json = (() => {
              try { return JSON.stringify(result); } catch { return String(result); }
            })();
            yield* emitForRequest(request, json, Date.now() - start, "completeStructured");
            return result;
          }),
        stream: (request) =>
          Effect.gen(function* () {
            const start = Date.now();
            const accum = yield* Ref.make<{
              content: string;
              toolCalls: { name: string; id: string }[];
              usage?: PartialCompletion["usage"];
              stopReason?: StopReason;
            }>({ content: "", toolCalls: [] });
            const innerStream = yield* inner.stream(request);
            return innerStream.pipe(
              Stream.tap((event: StreamEvent) =>
                Ref.update(accum, (s) => {
                  switch (event.type) {
                    case "text_delta":
                      return { ...s, content: s.content + event.text };
                    case "content_complete":
                      // Prefer the provider's authoritative accumulated text
                      // when it arrives — text_delta sums may diverge for
                      // providers that emit normalized completes.
                      return { ...s, content: event.content };
                    case "tool_use_start":
                      return {
                        ...s,
                        toolCalls: [...s.toolCalls, { name: event.name, id: event.id }],
                        stopReason: "tool_use" as StopReason,
                      };
                    case "usage":
                      return {
                        ...s,
                        usage: {
                          inputTokens: event.usage.inputTokens,
                          outputTokens: event.usage.outputTokens,
                          estimatedCost: event.usage.estimatedCost,
                          // Lever 1: carry Anthropic prompt-cache stats off the
                          // usage event so emitForRequest can surface them on the
                          // streamed exchange (the complete() path already does).
                          ...(typeof event.usage.cacheCreationInputTokens === "number"
                            ? { cacheCreationInputTokens: event.usage.cacheCreationInputTokens }
                            : {}),
                          ...(typeof event.usage.cacheReadInputTokens === "number"
                            ? { cacheReadInputTokens: event.usage.cacheReadInputTokens }
                            : {}),
                        },
                      };
                    default:
                      return s;
                  }
                }),
              ),
              Stream.ensuring(
                Effect.gen(function* () {
                  const s = yield* Ref.get(accum);
                  yield* emitForRequest(
                    request,
                    s.content,
                    Date.now() - start,
                    "stream",
                    {
                      stopReason: s.stopReason ?? ("end_turn" as StopReason),
                      toolCalls: s.toolCalls.length > 0 ? s.toolCalls : undefined,
                      usage: s.usage,
                    },
                  );
                }),
              ),
            );
          }),
        embed: inner.embed,
        countTokens: inner.countTokens,
        getModelConfig: inner.getModelConfig,
        getStructuredOutputCapabilities: inner.getStructuredOutputCapabilities,
        capabilities: inner.capabilities,
      } as Context.Tag.Service<LLMService>;
    }),
  );
