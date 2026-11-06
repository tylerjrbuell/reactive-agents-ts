import { Effect, Layer, Stream, Schema, JSONSchema } from "effect";
import { LLMService } from "../llm-service.js";
import { LLMConfig } from "../llm-config.js";
import type { ProviderCapabilities } from "../capabilities.js";
import {
  LLMError,
  LLMTimeoutError,
} from "../errors.js";
import type { LLMErrors } from "../errors.js";
import { mapProviderError } from "../provider-error.js";
import { runStructuredParseWithRetry } from "../structured-parse-retry.js";
import type {
  CompletionResponse,
  StreamEvent,
  LLMMessage,
  ContentBlock,
  ToolDefinition,
  ToolCall,
} from "../types.js";
import {
  emitContentDegradations,
  joinText,
  resolveContentPolicy,
  resolveParts,
  type ContentPolicy,
  type DegradedPart,
} from "../content-parts.js";
import {
  OPENAI_IMAGE_RULES,
  OPENAI_INPUT_MODALITIES,
  toOpenAIUserContent,
  type OpenAIUserPart,
} from "./openai-messages.js";
import { calculateCost, estimateTokenCount } from "../token-counter.js";
import { retryStreamBeforeFirstEmission, withRetryAndTimeout } from "../retry.js";
import { selectAdapter } from "../adapter.js";
import { normalizeToolSchemaFor } from "../schema-utils.js";
import { createStreamToolCallAccumulator } from "../stream-tool-call-accumulator.js";
import { resolveCapability } from "../capability-resolver.js";
import { resolveThinkingEnabled, reserveThinkingBudget } from "../thinking/index.js";
import { buildTemperatureField, buildTokenField } from "./openai.js";
import { chatToolsRequireResponsesError, warnChatToolsReasoningDisabledOnce } from "./chat-tools-rules.js";
import { isOpenAIMaxCompletionFamily } from "../capability.js";
import { resolveCloudTimeoutMs } from "../params/cloud-timeout.js";
import { mapStopReason } from "../params/stop-reason.js";

/**
 * Temperature field for the LiteLLM wire. Delegates to openai.ts
 * `buildTemperatureField`; additionally treats provider-prefixed OpenAI
 * reasoning ids (`openai/gpt-5-mini`, `azure/o3`) as the reasoning family,
 * since the litellm capability lookup does not apply the family rule.
 */
const litellmTemperatureField = (
  model: string,
  cap: { readonly requiresMaxCompletionTokens?: boolean },
  reserve: number | undefined,
  temperature: number,
): Record<string, unknown> =>
  buildTemperatureField(
    {
      requiresMaxCompletionTokens:
        cap.requiresMaxCompletionTokens === true ||
        isOpenAIMaxCompletionFamily(model.slice(model.lastIndexOf("/") + 1)),
    },
    reserve,
    temperature,
  );

/**
 * LiteLLM Provider — OpenAI-compatible adapter for LiteLLM proxy.
 *
 * LiteLLM is an enterprise model gateway that exposes 100+ LLM providers
 * (Anthropic, OpenAI, Azure, Bedrock, Vertex, etc.) via a single OpenAI-
 * compatible API endpoint.
 *
 * Configuration:
 *   LITELLM_BASE_URL=http://localhost:4000  (default)
 *   LITELLM_API_KEY=sk-...                  (optional, for auth)
 *
 * Model names use LiteLLM format: "provider/model"
 *   e.g. "anthropic/claude-3-5-sonnet-20241022", "openai/gpt-4o"
 */

// ─── Message Conversion (reuses OpenAI format) ───

type LiteLLMMessage =
  | { role: "system" | "assistant"; content: string }
  | { role: "user"; content: string | OpenAIUserPart[] }
  | { role: "tool"; tool_call_id: string; content: string };

/**
 * Convert messages to LiteLLM (OpenAI-format) wire messages. Images on user
 * messages ride `image_url` parts; any other image becomes a degradation stub.
 *
 * @internal Exported for testing only
 */
export const toLiteLLMMessages = (
  messages: readonly LLMMessage[],
  policy: ContentPolicy,
): { readonly messages: LiteLLMMessage[]; readonly degraded: readonly DegradedPart[] } => {
  const degraded: DegradedPart[] = [];
  const route = (blocks: readonly ContentBlock[], role: LLMMessage["role"]) => {
    const r = resolveParts(blocks, role, policy, OPENAI_IMAGE_RULES);
    degraded.push(...r.degraded);
    return r.parts;
  };
  const out = messages.map((m): LiteLLMMessage => {
    if (m.role === "tool") {
      return {
        role: "tool" as const,
        tool_call_id: m.toolCallId,
        content: typeof m.content === "string" ? m.content : joinText(route(m.content, "tool")),
      };
    }
    if (m.role === "user") {
      return {
        role: "user" as const,
        content: typeof m.content === "string" ? m.content : toOpenAIUserContent(route(m.content, "user")),
      };
    }
    return {
      role: m.role,
      content: typeof m.content === "string" ? m.content : joinText(route(m.content, m.role)),
    };
  });
  return { messages: out, degraded };
};

const toEffectError = (error: unknown): LLMErrors =>
  mapProviderError(error, "litellm");

/** @internal Exported for testing only */
export const toLiteLLMTool = (tool: ToolDefinition) => ({
  type: "function" as const,
  function: {
    name: tool.name,
    description: tool.description,
    parameters: normalizeToolSchemaFor(tool.name, tool.inputSchema),
  },
});

// ─── Response Types ───

type LiteLLMToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type LiteLLMRawResponse = {
  choices: Array<{
    message: {
      content: string | null;
      role: string;
      tool_calls?: LiteLLMToolCall[];
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    // Some LiteLLM proxies include cost directly
    input_cost?: number;
    output_cost?: number;
    // LiteLLM normalizes prompt-caching token counts to this OpenAI-shaped
    // field for providers that support it (LiteLLM docs).
    prompt_tokens_details?: { cached_tokens?: number };
  };
  model: string;
};

const mapLiteLLMResponse = (
  response: LiteLLMRawResponse,
  model: string,
  registry?: Record<string, { readonly input: number; readonly output: number }>,
): CompletionResponse => {
  const message = response.choices[0]?.message;
  const content = message?.content ?? "";
  const rawToolCalls = message?.tool_calls;
  const hasToolCalls = rawToolCalls && rawToolCalls.length > 0;

  // Shared table-driven mapping ("tool_calls" → tool_use lives in the table);
  // the hasToolCalls override preserves the original ladder's short-circuit.
  const stopReason = hasToolCalls
    ? ("tool_use" as const)
    : mapStopReason(response.choices[0]?.finish_reason, "litellm");

  // M12 Hook 1/7 — give the calibrated/tier ProviderAdapter first crack at
  // normalizing tool calls. LiteLLM proxies many providers; calibration is
  // looked up by `model` (e.g., "anthropic/claude-3-5-sonnet-..."), and
  // tier="unknown" since the proxied family is opaque from this layer.
  // Pattern mirrors local.ts:440-465.
  const { adapter: providerAdapter } = selectAdapter(
    { supportsToolCalling: true },
    "unknown",
    model,
  );
  const adapterParsed = hasToolCalls
    ? providerAdapter.parseToolCalls?.(response, model)
    : undefined;
  const toolCalls: ToolCall[] | undefined = adapterParsed
    ? adapterParsed.map((tc, i) => ({
        // Preserve original LiteLLM tool_call_id when present (kernel uses
        // it for tool_result correlation). Synthesize only when the adapter
        // introduced a tool call the raw response lacks at this index.
        id: rawToolCalls?.[i]?.id ?? `litellm-tc-${i}`,
        name: tc.name,
        input: tc.arguments,
      }))
    : hasToolCalls
    ? rawToolCalls.map((tc) => {
        let input: unknown;
        try {
          input = JSON.parse(tc.function.arguments);
        } catch {
          input = { raw: tc.function.arguments };
        }
        return { id: tc.id, name: tc.function.name, input };
      })
    : undefined;

  return {
    content,
    stopReason,
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
      estimatedCost: calculateCost(
        response.usage?.prompt_tokens ?? 0,
        response.usage?.completion_tokens ?? 0,
        model,
        undefined,
        registry,
        // Prioritize costs returned directly from the proxy if available
        response.usage?.input_cost !== undefined && response.usage?.output_cost !== undefined
          ? {
              input: (response.usage.input_cost / (response.usage.prompt_tokens || 1)) * 1_000_000,
              output: (response.usage.output_cost / (response.usage.completion_tokens || 1)) * 1_000_000,
            }
          : undefined,
      ),
      ...(typeof response.usage?.prompt_tokens_details?.cached_tokens === "number"
        ? { cacheReadInputTokens: response.usage.prompt_tokens_details.cached_tokens }
        : {}),
    },
    model: response.model ?? model,
    toolCalls,
  };
};

// ─── Fetch helper ───

const liteLLMFetch = async (
  baseURL: string,
  path: string,
  body: unknown,
  apiKey?: string,
  extraHeaders?: Record<string, string>,
): Promise<unknown> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const res = await fetch(`${baseURL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(
      new Error(`LiteLLM ${res.status}: ${text || res.statusText}`),
      { status: res.status },
    );
  }

  return res.json();
};

// ─── LiteLLM Provider Layer ───

export const LiteLLMProviderLive = Layer.effect(
  LLMService,
  Effect.gen(function* () {
    const config = yield* LLMConfig;

    const baseURL =
      config.providerConfig?.baseUrl ??
      config.litellmBaseUrl ??
      process.env.LITELLM_BASE_URL ??
      "http://localhost:4000";
    const apiKey =
      config.providerConfig?.apiKey ??
      config.litellmApiKey ??
      process.env.LITELLM_API_KEY ??
      undefined;
    const extraHeaders = config.providerConfig?.headers ?? config.litellmHeaders;

    const defaultModel = config.defaultModel;

    return LLMService.of({
      complete: (request) => {
        // F4: one resolved binding drives BOTH Effect.timeout and the
        // timeoutMs restated in the error — the two can never drift.
        const timeoutMs = resolveCloudTimeoutMs(request, config);
        return Effect.gen(function* () {
          const model =
            typeof request.model === "string"
              ? request.model
              : request.model?.model ?? defaultModel;

          // F6: thinking + capability parity with openai.ts — LiteLLM speaks
          // the OpenAI dialect, so enablement resolves through the shared
          // tri-state resolver (gated on capability.supportsThinkingMode) and
          // the token field/reasoning_effort encoding reuses buildTokenField.
          // Unknown proxied models resolve to the fallback capability
          // (supportsThinkingMode=false) → thinking stays off, body unchanged.
          const cap = resolveCapability("litellm", model);
          const { messages, degraded } = toLiteLLMMessages(
            request.messages,
            resolveContentPolicy(OPENAI_INPUT_MODALITIES, cap),
          );
          yield* emitContentDegradations("litellm", model, degraded);
          if (request.systemPrompt) {
            messages.unshift({ role: "system", content: request.systemPrompt });
          }
          const answerBudget = request.maxTokens ?? config.defaultMaxTokens;
          const thinkEnabled = resolveThinkingEnabled("litellm", model, config.thinking, cap.supportsThinkingMode, request.thinking);
          const reserve = reserveThinkingBudget(answerBudget, cap.supportsThinkingMode, {
            ...(config.thinkingOptions ?? {}),
            enabled: thinkEnabled,
          });
          const hasTools = request.tools !== undefined && request.tools.length > 0;
          // Parity with openai.ts: Responses-only proxied models fail before the
          // HTTP call, and tools-with-effort-none models get the same override.
          if (hasTools && cap.chatToolsRequireResponses === true) {
            return yield* Effect.fail(chatToolsRequireResponsesError("litellm", model));
          }
          if (hasTools && cap.chatToolsRequireNoReasoning === true && reserve !== undefined) {
            warnChatToolsReasoningDisabledOnce("litellm", model);
          }
          const tokenField = buildTokenField(cap, answerBudget, reserve, config.thinkingOptions?.effort ?? "medium", hasTools);

          const requestBody: Record<string, unknown> = {
            model,
            ...tokenField,
            // I1 parity (mirrors openai.ts): reasoning path (reserve set)
            // omits temperature; non-reasoning path keeps it.
            ...litellmTemperatureField(model, cap, reserve, request.temperature ?? config.defaultTemperature),
            messages,
            stop: request.stopSequences
              ? [...request.stopSequences]
              : undefined,
          };

          if (request.tools && request.tools.length > 0) {
            requestBody.tools = request.tools.map(toLiteLLMTool);
          }

          const response = yield* Effect.tryPromise({
            try: () =>
              liteLLMFetch(baseURL, "/chat/completions", requestBody, apiKey, extraHeaders),
            catch: (error) => toEffectError(error),
          });

          return mapLiteLLMResponse(
            response as LiteLLMRawResponse,
            model,
            config.pricingRegistry,
          );
        }).pipe((effect) =>
          // G2 default is 120s (thinking/reasoning models exceed 30s); F4
          // makes it request/config-resolvable — see resolveCloudTimeoutMs.
          withRetryAndTimeout(effect, {
            timeoutMs,
            onTimeout: () =>
              new LLMTimeoutError({
                message: "LLM request timed out",
                provider: "litellm",
                timeoutMs,
              }),
          }),
        );
      },

      stream: (request) =>
        Effect.gen(function* () {
          const model =
            typeof request.model === "string"
              ? request.model
              : request.model?.model ?? defaultModel;

          // F6: thinking + capability parity — mirrors complete() above.
          const streamCap = resolveCapability("litellm", model);
          const streamAnswerBudget = request.maxTokens ?? config.defaultMaxTokens;
          const streamThinkEnabled = resolveThinkingEnabled("litellm", model, config.thinking, streamCap.supportsThinkingMode, request.thinking);
          const streamReserve = reserveThinkingBudget(streamAnswerBudget, streamCap.supportsThinkingMode, {
            ...(config.thinkingOptions ?? {}),
            enabled: streamThinkEnabled,
          });
          const streamHasTools = request.tools !== undefined && request.tools.length > 0;
          // Parity with openai.ts stream(): fail before returning the stream.
          if (streamHasTools && streamCap.chatToolsRequireResponses === true) {
            return yield* Effect.fail(chatToolsRequireResponsesError("litellm", model));
          }
          if (streamHasTools && streamCap.chatToolsRequireNoReasoning === true && streamReserve !== undefined) {
            warnChatToolsReasoningDisabledOnce("litellm", model);
          }
          const streamTokenField = buildTokenField(streamCap, streamAnswerBudget, streamReserve, config.thinkingOptions?.effort ?? "medium", streamHasTools);
          const streamMapped = toLiteLLMMessages(
            request.messages,
            resolveContentPolicy(OPENAI_INPUT_MODALITIES, streamCap),
          );
          yield* emitContentDegradations("litellm", model, streamMapped.degraded);

          // Adapter selection up-front for tool_calls normalization. When
          // the adapter supplies parseToolCalls we SUPPRESS per-chunk
          // tool_use_* emissions and synthesize them at finish_reason from
          // the accumulated tool-call map. Pattern mirrors openai.ts
          // stream() — LiteLLM proxies OpenAI-compat dialect so the chunk
          // shape and lifecycle are identical. Tier="unknown" because the
          // proxied family is opaque from this layer; calibration lookup
          // happens by model name.
          const { adapter: streamAdapter } = selectAdapter(
            { supportsToolCalling: true },
            "unknown",
            model,
          );
          const useAdapterNormalization =
            typeof streamAdapter.parseToolCalls === "function";

          return retryStreamBeforeFirstEmission(Stream.async<StreamEvent, LLMErrors>((emit) => {
            const doStream = async () => {
              try {
                const headers: Record<string, string> = {
                  "Content-Type": "application/json",
                  ...extraHeaders,
                };
                if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

                const messages = [...streamMapped.messages];
                if (request.systemPrompt) {
                  messages.unshift({
                    role: "system",
                    content: request.systemPrompt,
                  });
                }

                const streamBody: Record<string, unknown> = {
                  model,
                  ...streamTokenField,
                  // I1 parity: omit temperature on the reasoning path.
                  ...litellmTemperatureField(model, streamCap, streamReserve, request.temperature ?? config.defaultTemperature),
                  messages,
                  stream: true,
                  // OpenAI-compat: request usage on the final chunk so we
                  // can emit cost without a second roundtrip.
                  stream_options: { include_usage: true },
                };
                if (request.tools && request.tools.length > 0) {
                  streamBody.tools = request.tools.map(toLiteLLMTool);
                }

                const res = await fetch(`${baseURL}/chat/completions`, {
                  method: "POST",
                  headers,
                  body: JSON.stringify(streamBody),
                });

                if (!res.ok || !res.body) {
                  throw new Error(`LiteLLM stream error: ${res.status}`);
                }

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";
                let fullContent = "";
                // Shared streamed tool-call accumulator (per-index map +
                // adapter-normalized finish synthesis, single-shot guard
                // included). See stream-tool-call-accumulator.ts.
                const streamToolCalls = createStreamToolCallAccumulator({
                  emit,
                  useAdapterNormalization,
                  parseToolCalls: streamAdapter.parseToolCalls,
                  model,
                  providerShortId: "litellm",
                  getTextContent: () => fullContent,
                });
                let finalUsage:
                  | {
                      prompt_tokens: number;
                      completion_tokens: number;
                      prompt_tokens_details?: { cached_tokens?: number };
                    }
                  | undefined;

                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;

                  buffer += decoder.decode(value, { stream: true });
                  const lines = buffer.split("\n");
                  buffer = lines.pop() ?? "";

                  for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith("data:")) continue;
                    const data = trimmed.slice(5).trim();
                    if (data === "[DONE]") {
                      // Some proxies emit [DONE] without first sending a
                      // chunk with finish_reason. Synthesize tool calls
                      // defensively before closing (idempotent).
                      streamToolCalls.synthesize("stop");
                      emit.single({
                        type: "content_complete",
                        content: fullContent,
                      });
                      const inputTokens = finalUsage?.prompt_tokens ?? 0;
                      const outputTokens = finalUsage?.completion_tokens ?? 0;
                      emit.single({
                        type: "usage",
                        usage: {
                          inputTokens,
                          outputTokens,
                          totalTokens: inputTokens + outputTokens,
                          estimatedCost: calculateCost(
                            inputTokens,
                            outputTokens,
                            model,
                            undefined,
                            config.pricingRegistry,
                          ),
                          ...(typeof finalUsage?.prompt_tokens_details?.cached_tokens === "number"
                            ? { cacheReadInputTokens: finalUsage.prompt_tokens_details.cached_tokens }
                            : {}),
                        },
                      });
                      emit.end();
                      return;
                    }

                    try {
                      const chunk = JSON.parse(data) as {
                        choices: Array<{
                          delta: {
                            content?: string;
                            tool_calls?: Array<{
                              index: number;
                              id?: string;
                              function?: {
                                name?: string;
                                arguments?: string;
                              };
                            }>;
                          };
                          finish_reason?: string;
                        }>;
                        usage?: {
                          prompt_tokens: number;
                          completion_tokens: number;
                          prompt_tokens_details?: { cached_tokens?: number };
                        };
                      };

                      const delta = chunk.choices[0]?.delta?.content;
                      if (delta) {
                        fullContent += delta;
                        emit.single({ type: "text_delta", text: delta });
                      }

                      // Accumulate tool call deltas. When adapter
                      // normalization is active we still accumulate (so we
                      // can synthesize at finish_reason) but the accumulator
                      // suppresses per-chunk emissions.
                      streamToolCalls.accumulate(
                        chunk.choices[0]?.delta?.tool_calls,
                      );

                      if (chunk.usage) {
                        finalUsage = chunk.usage;
                      }

                      if (chunk.choices[0]?.finish_reason) {
                        streamToolCalls.synthesize(
                          chunk.choices[0].finish_reason,
                        );
                      }
                    } catch {
                      // Skip invalid JSON chunks
                    }
                  }
                }
              } catch (error) {
                // Hotfix 0.5-5: normalize stream errors (parity with complete()).
                emit.fail(mapProviderError(error, "litellm", model));
              }
            };
            void doStream();
          }));
        }),

      completeStructured: (request) =>
        Effect.gen(function* () {
          const schemaStr = JSON.stringify(
            JSONSchema.make(request.outputSchema),
            null,
            2,
          );

          const messagesWithFormat: LLMMessage[] = [
            ...request.messages,
            {
              role: "user" as const,
              content: `\nRespond with ONLY valid JSON matching this schema:\n${schemaStr}\n\nNo markdown, no code fences, just raw JSON.`,
            },
          ];

          // Loop-invariant: model + F6 thinking/capability chain (mirrors
          // complete() above) resolve once, not per parse attempt.
          const model =
            typeof request.model === "string"
              ? request.model
              : request.model?.model ?? defaultModel;
          const structuredCap = resolveCapability("litellm", model);
          const structuredAnswerBudget = request.maxTokens ?? config.defaultMaxTokens;
          const structuredThinkEnabled = resolveThinkingEnabled("litellm", model, config.thinking, structuredCap.supportsThinkingMode, request.thinking);
          const structuredReserve = reserveThinkingBudget(structuredAnswerBudget, structuredCap.supportsThinkingMode, {
            ...(config.thinkingOptions ?? {}),
            enabled: structuredThinkEnabled,
          });
          const structuredTokenField = buildTokenField(structuredCap, structuredAnswerBudget, structuredReserve, config.thinkingOptions?.effort ?? "medium");

          return yield* runStructuredParseWithRetry({
            outputSchema: request.outputSchema,
            schemaStr,
            maxRetries: request.maxParseRetries ?? 2,
            runAttempt: ({ attempt, lastError }) =>
              Effect.gen(function* () {
                const msgs =
                  attempt === 0
                    ? messagesWithFormat
                    : [
                        ...messagesWithFormat,
                        {
                          role: "assistant" as const,
                          content: String(lastError),
                        },
                        {
                          role: "user" as const,
                          content: `That response was not valid JSON. The parse error was: ${String(lastError)}. Please try again with valid JSON only.`,
                        },
                      ];

                const wire = toLiteLLMMessages(msgs, resolveContentPolicy(OPENAI_INPUT_MODALITIES, structuredCap));
                yield* emitContentDegradations("litellm", model, wire.degraded);
                const completeResult = yield* Effect.tryPromise({
                  try: () =>
                    liteLLMFetch(
                      baseURL,
                      "/chat/completions",
                      {
                        model,
                        ...structuredTokenField,
                        // I1 parity: omit temperature on the reasoning path.
                        ...litellmTemperatureField(model, structuredCap, structuredReserve, request.temperature ?? config.defaultTemperature),
                        messages: wire.messages,
                      },
                      apiKey,
                      extraHeaders,
                    ),
                  catch: (error) => toEffectError(error),
                });

                const mapped = mapLiteLLMResponse(
                  completeResult as LiteLLMRawResponse,
                  model,
                  config.pricingRegistry,
                );
                return { content: mapped.content, usage: mapped.usage };
              }),
          });
        }),

      embed: (texts, model) =>
        Effect.tryPromise({
          try: async () => {
            const embeddingModel =
              model ?? config.embeddingConfig.model;
            const batchSize = config.embeddingConfig.batchSize ?? 100;
            const results: number[][] = [];

            for (let i = 0; i < texts.length; i += batchSize) {
              const batch = texts.slice(i, i + batchSize);
              const response = (await liteLLMFetch(
                baseURL,
                "/embeddings",
                {
                  model: embeddingModel,
                  input: [...batch],
                  dimensions: config.embeddingConfig.dimensions,
                },
                apiKey,
                extraHeaders,
              )) as { data: Array<{ embedding: number[] }> };

              results.push(
                ...response.data.map((d) => d.embedding),
              );
            }

            return results;
          },
          catch: (error) =>
            new LLMError({
              message: `Embedding failed: ${error}`,
              provider: "litellm",
              cause: error,
            }),
        }),

      countTokens: (messages) =>
        Effect.gen(function* () {
          return yield* estimateTokenCount(messages);
        }),

      getModelConfig: () =>
        Effect.succeed({
          provider: "litellm" as const,
          model: defaultModel,
        }),

      getStructuredOutputCapabilities: () =>
        Effect.succeed({
          nativeJsonMode: false,
          jsonSchemaEnforcement: false,
          prefillSupport: false,
          grammarConstraints: false,
        }),

      capabilities: () =>
        Effect.succeed({
          supportsToolCalling: true,
          supportsStreaming: true,
          supportsStructuredOutput: true,
          supportsLogprobs: false,
          inputModalities: OPENAI_INPUT_MODALITIES,
        } satisfies ProviderCapabilities),
    });
  }),
);
