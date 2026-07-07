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
  messageContentToString,
  type CompletionRequest,
  type StructuredCompletionRequest,
  type LLMMessage,
  type StreamEvent,
  type StopReason,
} from "@reactive-agents/llm-provider";
import { emitLLMExchange, emitContextPressure } from "./utils/diagnostics.js";
import { FiberRef } from "effect";
import { CurrentRunContext } from "@reactive-agents/core";

// Placeholder correlation values. The wrapper sits below the kernel/strategy
// layer so it cannot see taskId/iteration directly. Callers that CAN correlate
// (the kernel think-loop) snapshot taskId/iteration into the request via the
// optional `request.traceContext` field at build time — emitForRequest reads
// it when present (FiberRef-free, immune to stream-context inheritance issues).
// Calls outside the kernel loop (reflexion/ToT/plan-execute sub-calls) leave
// traceContext unset and correctly fall back to these placeholders.
const PLACEHOLDER_TASK_ID = "llm-direct";
const PLACEHOLDER_ITERATION = 0;

// Message-content flattening lives in @reactive-agents/llm-provider
// (exchange-projection.ts) so the exact-replay layer can apply the IDENTICAL
// projection when hashing live requests — record and replay must never drift.

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
  /**
   * Effective parameters the provider resolved for this call (transparency).
   * `contextWindow` is the EXACT num_ctx the provider received (honors user
   * numCtx overrides) — the denominator for the ContextPressure gauge.
   */
  readonly resolvedParams?: {
    readonly contextWindow?: number;
  };
};

function emitForRequest(
  request: CompletionRequest,
  responseContent: string,
  durationMs: number,
  kind: "complete" | "stream" | "completeStructured",
  fullResponse?: PartialCompletion,
): Effect.Effect<void, never> {
  // Adaptive-harness wave 1 (2026-07-07): ambient fallback for correlation.
  // request.traceContext stays authoritative (record/replay hashes the request
  // shape); the FiberRef catches call sites that never threaded it. On a fiber
  // hop (streams) the ref reads null and we degrade to the old placeholder —
  // never a wrong attribution.
  return FiberRef.get(CurrentRunContext).pipe(
    Effect.flatMap((ambient) =>
      emitForRequestWith(request, responseContent, durationMs, kind, fullResponse, ambient?.taskId),
    ),
  );
}

function emitForRequestWith(
  request: CompletionRequest,
  responseContent: string,
  durationMs: number,
  kind: "complete" | "stream" | "completeStructured",
  fullResponse: PartialCompletion | undefined,
  ambientTaskId: string | undefined,
): Effect.Effect<void, never> {
  // Uniform ContextPressure: emit from this single chokepoint (all strategy
  // paths flow through here, including eventBus-less plan-execute/reflexion
  // sub-kernels) when the call is correlated to a real run (traceContext.taskId
  // present — filters out aux calls like the intent classifier), the provider
  // reported prompt tokens, AND surfaced the exact resolved context window.
  // Gated strictly on resolvedParams.contextWindow > 0 (no capability fallback):
  // the gauge must reflect the real provider window, not the model's assumed max.
  const taskId = request.traceContext?.taskId ?? ambientTaskId;
  const tokensUsed = fullResponse?.usage?.inputTokens ?? 0;
  const contextWindow = fullResponse?.resolvedParams?.contextWindow ?? 0;
  const contextPressure =
    taskId !== undefined && taskId.length > 0 && tokensUsed > 0 && contextWindow > 0
      ? emitContextPressure({ taskId, tokensUsed, contextWindow })
      : Effect.void;

  return emitLLMExchange({
    taskId: request.traceContext?.taskId ?? ambientTaskId ?? PLACEHOLDER_TASK_ID,
    iteration: request.traceContext?.iteration ?? PLACEHOLDER_ITERATION,
    provider: typeof request.model === "string" ? (fullResponse?.model ?? "unknown") : (request.model?.provider ?? fullResponse?.model ?? "unknown"),
    model: typeof request.model === "string" ? request.model : (request.model?.model ?? fullResponse?.model ?? "unknown"),
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
  }).pipe(Effect.zipRight(contextPressure));
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
              toolCalls: { name: string; id: string; argsJson: string }[];
              usage?: PartialCompletion["usage"];
              resolvedParams?: PartialCompletion["resolvedParams"];
              stopReason?: StopReason;
            }>({ content: "", toolCalls: [] });
            const innerStream = yield* inner.stream(request);
            return innerStream.pipe(
              Stream.tap((event: StreamEvent) =>
                Ref.update(accum, (s) => {
                  switch (event.type) {
                    case "text_delta":
                      return { ...s, content: s.content + event.text };
                    case "content_complete": {
                      // Prefer the provider's authoritative accumulated text
                      // when it arrives — text_delta sums may diverge for
                      // providers that emit normalized completes. Also capture
                      // the stop reason it carries (B4): without this, traces
                      // recorded "end_turn" for max_tokens truncations and
                      // masked thinking-token starvation during diagnosis.
                      return {
                        ...s,
                        content: event.content,
                        ...(event.stopReason !== undefined && s.stopReason === undefined
                          ? { stopReason: event.stopReason }
                          : {}),
                      };
                    }
                    case "tool_use_start":
                      return {
                        ...s,
                        toolCalls: [...s.toolCalls, { name: event.name, id: event.id, argsJson: "" }],
                        stopReason: "tool_use" as StopReason,
                      };
                    case "tool_use_delta": {
                      // Deltas attach to the most recently started call
                      // (provider sequencing contract: tool_use_start always
                      // precedes its tool_use_delta chunks, and providers
                      // don't interleave deltas across concurrent calls).
                      if (s.toolCalls.length === 0) return s;
                      const last = s.toolCalls[s.toolCalls.length - 1]!;
                      return {
                        ...s,
                        toolCalls: [
                          ...s.toolCalls.slice(0, -1),
                          { ...last, argsJson: last.argsJson + event.input },
                        ],
                      };
                    }
                    case "usage":
                      return {
                        ...s,
                        // Capture the exact provider-resolved context window
                        // (transparency) so the chokepoint can drive the
                        // ContextPressure gauge off the real num_ctx.
                        ...(typeof event.resolvedParams?.contextWindow === "number"
                          ? { resolvedParams: { contextWindow: event.resolvedParams.contextWindow } }
                          : {}),
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
                  // Parse each call's accumulated JSON argument chunks.
                  // Unparseable JSON (or no deltas at all) never throws from
                  // the observability path — falls back to the raw string,
                  // or omits `arguments` entirely when nothing was captured.
                  const toolCalls =
                    s.toolCalls.length > 0
                      ? s.toolCalls.map((tc) => {
                          let args: unknown;
                          try {
                            args = tc.argsJson ? JSON.parse(tc.argsJson) : undefined;
                          } catch {
                            args = tc.argsJson;
                          }
                          return { name: tc.name, ...(args !== undefined ? { arguments: args } : {}) };
                        })
                      : undefined;
                  yield* emitForRequest(
                    request,
                    s.content,
                    Date.now() - start,
                    "stream",
                    {
                      stopReason: s.stopReason ?? ("end_turn" as StopReason),
                      toolCalls,
                      usage: s.usage,
                      ...(s.resolvedParams ? { resolvedParams: s.resolvedParams } : {}),
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
