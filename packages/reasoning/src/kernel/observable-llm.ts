/**
 * Observable LLM wrapper — emits `LLMExchangeEmitted` events to EventBus on
 * every `complete()` and `completeStructured()` call so observers (the
 * reasoning-stream-logger when `logModelIO` is on, the trace layer, the
 * diagnose CLI) can see EVERY direct LLM call — including the ones outside
 * the kernel main loop that the kernel's own `[model-io]` capture misses
 * (plan-execute analysis steps, reflexion critique/refine, ToT BFS, etc.).
 *
 * `emitLLMExchange` already publishes the event with truncation + EventBus
 * service-option guard; this wrapper just calls it consistently from a
 * single chokepoint. Inner LLMService remains untouched.
 *
 * `stream()` is passthrough — the kernel main loop already emits
 * `ReasoningStepCompleted` with the system prompt + thread when
 * `logModelIO` is on, so wrapping stream would double-emit.
 */
import { Effect, Layer } from "effect";
import type { Context } from "effect";
import {
  LLMService,
  type CompletionRequest,
  type CompletionResponse,
  type StructuredCompletionRequest,
  type LLMMessage,
} from "@reactive-agents/llm-provider";
import { emitLLMExchange } from "./utils/diagnostics.js";

// Placeholder correlation values. The wrapper sits below the kernel/strategy
// layer so it cannot see taskId/iteration directly. Callers that need
// correlation can extend the request type in a follow-up; visibility wins
// for v1.
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

function emitForRequest(
  request: CompletionRequest,
  responseContent: string,
  durationMs: number,
  kind: "complete" | "completeStructured",
  fullResponse?: CompletionResponse,
): Effect.Effect<void, never> {
  return emitLLMExchange({
    taskId: PLACEHOLDER_TASK_ID,
    iteration: PLACEHOLDER_ITERATION,
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
        arguments: (tc as { arguments?: unknown }).arguments,
      })),
      stopReason: fullResponse?.stopReason,
      tokensIn: fullResponse?.usage?.inputTokens,
      tokensOut: fullResponse?.usage?.outputTokens,
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
        stream: inner.stream,
        embed: inner.embed,
        countTokens: inner.countTokens,
        getModelConfig: inner.getModelConfig,
        getStructuredOutputCapabilities: inner.getStructuredOutputCapabilities,
        capabilities: inner.capabilities,
      } as Context.Tag.Service<LLMService>;
    }),
  );
