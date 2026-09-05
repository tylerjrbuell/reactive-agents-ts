import { Effect, Layer, Stream, Schema } from "effect";
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
} from "../types.js";
import { calculateCost, estimateTokenCount } from "../token-counter.js";
import { retryStreamBeforeFirstEmission, withRetryAndTimeout } from "../retry.js";
import { emitToolUseDelta, emitToolUseStart } from "../streaming-helpers.js";
import { selectAdapter } from "../adapter.js";
import { resolveCapability } from "../capability-resolver.js";
import {
  resolveThinkingEnabled,
  reserveThinkingBudget,
  buildAnthropicThinkingBody,
} from "../thinking/index.js";
import { clampOutputBudget } from "../params/output-budget.js";
import { resolveCloudTimeoutMs } from "../params/cloud-timeout.js";
import { mapStopReason } from "../params/stop-reason.js";

/**
 * The TRUE prompt size for an Anthropic response: base input plus both cache
 * pools.
 *
 * Anthropic's `usage.input_tokens` counts only the UNCACHED remainder — the
 * cached prefix is reported separately as `cache_read_input_tokens` /
 * `cache_creation_input_tokens`. Reporting the remainder as `inputTokens` meant
 * that the better a run cached, the cheaper it appeared, and by an enormous
 * margin: a measured haiku run showed `in=6` on calls that carried ten tool
 * schemas and a full conversation, against `in=3746` on the same call shape
 * before the cache warmed.
 *
 * That is not a rounding error, it is a confound. Cost was already computed off
 * the correct total (the call sites had re-added the pools locally), so only the
 * TOKEN COUNTS were wrong — which is exactly what every harness-overhead
 * ablation in this repo compares. Any two arms that cache differently were being
 * compared on incomparable numbers; an arm whose prompt prefix is stable enough
 * to cache would read as multiples cheaper than one that churns its tool block,
 * independent of how much work either did.
 *
 * Cache hit/creation counts remain available separately as
 * `cacheReadInputTokens` / `cacheCreationInputTokens`, so a caller that wants
 * "X input tok (Y cached)" still can — it is now an explicit breakdown rather
 * than a silent subtraction.
 */
export function totalInputTokens(usage: {
  readonly input_tokens: number;
  readonly cache_read_input_tokens?: number | null;
  readonly cache_creation_input_tokens?: number | null;
}): number {
  return (
    usage.input_tokens +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0)
  );
}


// ─── Anthropic Message Conversion Helpers ───

type AnthropicRole = "user" | "assistant";

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: string; media_type: string; data: string } }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

type AnthropicMessage = {
  role: AnthropicRole;
  content: string | AnthropicContentBlock[];
};

const toAnthropicMessages = (
  messages: readonly LLMMessage[],
): AnthropicMessage[] => {
  const filtered = messages.filter((m) => m.role !== "system");

  return filtered.map((m) => {
    if (m.role === "tool") {
      const block: Record<string, unknown> = {
        type: "tool_result" as const,
        tool_use_id: m.toolCallId,
        content: m.content,
      };
      return {
        role: "user" as AnthropicRole,
        content: [block] as unknown as AnthropicContentBlock[],
      };
    }
    return {
      role: m.role as AnthropicRole,
      content:
        typeof m.content === "string"
          ? m.content
          : (m.content as readonly ContentBlock[]).map(
              (b) => b as unknown as AnthropicContentBlock,
            ),
    };
  });
};

const toAnthropicTool = (tool: {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}) => ({
  name: tool.name,
  description: tool.description,
  input_schema: {
    type: "object" as const,
    ...tool.inputSchema,
  },
});

const toEffectError = (
  error: unknown,
  provider: "anthropic",
  model?: string,
): LLMErrors => mapProviderError(error, provider, model);

// ── Prompt caching (automatic) ───────────────────────────────────────────────
// Anthropic's automatic caching mode: a single top-level `cache_control: {
// type: "ephemeral" }` field on the request (a sibling of `model`/`system`/
// `messages`/`tools`, not nested inside any of them). The provider applies
// the cache breakpoint to the last cacheable block by itself, and moves it
// forward as the conversation grows — exactly the shape of RA's agentic
// loop, where `messages` grows by one assistant turn + tool results each
// kernel iteration.
//
// This replaces the three hand-placed breakpoints this file used to carry
// (last tool, system text block, last tool_result message). Per Anthropic's
// own docs the cache is hierarchical — tools, then system, then messages —
// and a change at any level invalidates that level and everything after it,
// regardless of which caching mode is used. The manual scheme only ever
// bought fine-grained *placement* control over where within that hierarchy
// the breakpoints sat; it never bought independent invalidation control
// between tools/system/messages, since the hierarchy invalidates downstream
// levels either way. RA never used the placement control for anything — the
// three breakpoints were always "cache as much of the prefix as possible" —
// so automatic caching gets the same effective caching with none of the
// index-tracking.
//
// Per-model minimum cacheable block still applies identically under
// automatic caching: Sonnet 1024 tok, Haiku 4096 tok. A request whose
// cacheable prefix is below the threshold simply doesn't cache — no error,
// no marker to condition on.

// ─── Anthropic Provider Layer ───

export const AnthropicProviderLive = Layer.effect(
  LLMService,
  Effect.gen(function* () {
    const config = yield* LLMConfig;

    // Lazy-load the SDK via dynamic import so Bun `mock.module(...)` can
    // intercept it during tests (CJS `require()` is not reliably interceptable
    // across module boundaries in Bun). Mirrors the Gemini/Local provider
    // loading pattern; functionally equivalent to the prior eager require()
    // for the production code path (the SDK module is cached after first
    // resolution).
    type AnthropicClient = {
      messages: {
        create: (opts: unknown) => Promise<unknown>;
        stream: (opts: unknown) => {
          on: (event: string, cb: (...args: unknown[]) => void) => void;
        };
      };
    };
    type AnthropicModule = {
      default: new (opts: { apiKey?: string }) => AnthropicClient;
    };

    let _clientPromise: Promise<AnthropicClient> | null = null;
    const getClient = (): Promise<AnthropicClient> => {
      if (!_clientPromise) {
        _clientPromise = (
          import("@anthropic-ai/sdk") as unknown as Promise<AnthropicModule>
        ).then(({ default: Anthropic }) => new Anthropic({ apiKey: config.anthropicApiKey }));
      }
      return _clientPromise;
    };

    return LLMService.of({
      complete: (request) => {
        // F4: one resolved binding drives BOTH Effect.timeout and the
        // timeoutMs restated in the error — the two can never drift.
        const timeoutMs = resolveCloudTimeoutMs(request, config);
        return Effect.gen(function* () {
          const client = yield* Effect.promise(() => getClient());
          const model = typeof request.model === 'string'
            ? request.model
            : request.model?.model ?? config.defaultModel;

          const answerBudget = request.maxTokens ?? config.defaultMaxTokens;
          const cap = resolveCapability("anthropic", model);
          const thinkEnabled = resolveThinkingEnabled(
            "anthropic",
            model,
            config.thinking,
            cap.supportsThinkingMode,
          );
          const reserve = reserveThinkingBudget(answerBudget, cap.supportsThinkingMode, {
            ...(config.thinkingOptions ?? {}),
            enabled: thinkEnabled,
          });

          const response = yield* Effect.tryPromise({
            try: () =>
              client.messages.create({
                model,
                // F1: clamp the final wire value (answer + thinking reserve)
                // against the model's authoritative output ceiling.
                max_tokens: clampOutputBudget(
                  reserve !== undefined ? answerBudget + reserve : answerBudget,
                  cap,
                ),
                // Automatic prompt caching — see the "Prompt caching
                // (automatic)" note above `toAnthropicMessages`.
                cache_control: { type: "ephemeral" },
                system: request.systemPrompt,
                messages: toAnthropicMessages(request.messages),
                stop_sequences: request.stopSequences
                  ? [...request.stopSequences]
                  : undefined,
                tools: request.tools?.map((t) => toAnthropicTool(t)),
                // Thinking-form + temperature: adaptive/enabled shape when
                // thinking is on (temperature omitted — API rejects ≠1);
                // plain temperature when off. See buildAnthropicThinkingBody.
                ...buildAnthropicThinkingBody(
                  model,
                  reserve,
                  config.thinkingOptions?.effort,
                  request.temperature ?? config.defaultTemperature,
                ),
              }),
            catch: (error) => toEffectError(error, "anthropic", model),
          });

          const mapped = mapAnthropicResponse(
            response as AnthropicRawResponse,
            model,
            config.pricingRegistry,
          );
          // Cluster B parity (mirrors gemini.ts): don't paper over a non-OK
          // stop with empty content. Anthropic otherwise returns success+empty
          // when the output budget is exhausted (max_tokens) or the model
          // refuses — indistinguishable to the agent from a clean finish.
          const rawStop = (response as AnthropicRawResponse).stop_reason;
          const hasContent =
            (mapped.content?.length ?? 0) > 0 || (mapped.toolCalls?.length ?? 0) > 0;
          if ((rawStop === "max_tokens" || rawStop === "refusal") && !hasContent) {
            return yield* Effect.fail(
              new LLMError({
                provider: "anthropic",
                message:
                  rawStop === "max_tokens"
                    ? "Anthropic response ended with stop_reason=max_tokens and no content. The output token budget was exhausted before any visible text was emitted — raise maxTokens."
                    : "Anthropic response ended with stop_reason=refusal and no content. The model declined to respond.",
              }),
            );
          }
          return mapped;
        }).pipe((effect) =>
          // G2 default is 120s (30s was too tight for thinking/reasoning
          // models); F4 makes it request/config-resolvable — see
          // resolveCloudTimeoutMs.
          withRetryAndTimeout(effect, {
            timeoutMs,
            onTimeout: () =>
              new LLMTimeoutError({
                message: "LLM request timed out",
                provider: "anthropic",
                timeoutMs,
              }),
          }),
        );
      },

      stream: (request) =>
        Effect.gen(function* () {
          const client = yield* Effect.promise(() => getClient());
          const model = typeof request.model === 'string'
            ? request.model
            : request.model?.model ?? config.defaultModel;

          // M12 Hook 1/7 — adapter selection for the streaming tool-call
          // normalization site. Decided UP-FRONT so we choose between
          // per-chunk emission (default) vs. buffered end-of-stream synthesis
          // (adapter-normalized) without ever retracting an already-emitted
          // event. Stream contract: emit.single is one-way.
          const { adapter: streamAdapter } = selectAdapter(
            { supportsToolCalling: true },
            "frontier",
            model,
          );
          const useAdapterNormalization =
            typeof streamAdapter.parseToolCalls === "function";

          const streamAnswerBudget = request.maxTokens ?? config.defaultMaxTokens;
          const streamCap = resolveCapability("anthropic", model);
          const streamThinkEnabled = resolveThinkingEnabled(
            "anthropic",
            model,
            config.thinking,
            streamCap.supportsThinkingMode,
          );
          const streamReserve = reserveThinkingBudget(
            streamAnswerBudget,
            streamCap.supportsThinkingMode,
            {
              ...(config.thinkingOptions ?? {}),
              enabled: streamThinkEnabled,
            },
          );

          return retryStreamBeforeFirstEmission(Stream.async<StreamEvent, LLMErrors>((emit) => {
            const stream = client.messages.stream({
              model,
              // F1: clamp the final wire value — mirrors complete().
              max_tokens: clampOutputBudget(
                streamReserve !== undefined
                  ? streamAnswerBudget + streamReserve
                  : streamAnswerBudget,
                streamCap,
              ),
              // Automatic prompt caching — see the "Prompt caching
              // (automatic)" note above `toAnthropicMessages`.
              cache_control: { type: "ephemeral" },
              system: request.systemPrompt,
              messages: toAnthropicMessages(request.messages),
              tools: request.tools?.map((t) => toAnthropicTool(t)),
              ...buildAnthropicThinkingBody(
                model,
                streamReserve,
                config.thinkingOptions?.effort,
                request.temperature ?? config.defaultTemperature,
              ),
            });

            // Use raw streamEvent for correct ordering of tool_use events.
            // The helper events (contentBlock, inputJson) fire out of order —
            // inputJson (delta) can arrive before contentBlock (start), causing
            // the kernel to miss accumulating tool call arguments.
            //
            // When `useAdapterNormalization` is true we SUPPRESS per-chunk
            // tool_use_* emissions and synthesize them in `finalMessage` once
            // the adapter has normalized the complete response.
            stream.on("streamEvent", (event: unknown) => {
              const e = event as { type: string; delta?: { type: string; text?: string; partial_json?: string }; content_block?: { type: string; id?: string; name?: string }; index?: number };
              if (e.type === "content_block_delta") {
                if (e.delta?.type === "text_delta" && e.delta.text) {
                  emit.single({ type: "text_delta", text: e.delta.text });
                } else if (
                  !useAdapterNormalization &&
                  e.delta?.type === "input_json_delta" &&
                  e.delta.partial_json
                ) {
                  emitToolUseDelta(emit, e.delta.partial_json);
                }
              } else if (e.type === "content_block_start") {
                if (
                  !useAdapterNormalization &&
                  e.content_block?.type === "tool_use" &&
                  e.content_block.id &&
                  e.content_block.name
                ) {
                  emitToolUseStart(emit, e.content_block.id, e.content_block.name);
                }
              }
            });

            stream.on("finalMessage", (message: unknown) => {
              const msg = message as AnthropicRawResponse;
              const content = msg.content
                .filter(
                  (b: { type: string }): b is { type: "text"; text: string } =>
                    b.type === "text",
                )
                .map((b: { text: string }) => b.text)
                .join("");

              // Adapter-normalized end-of-stream tool-call synthesis. Mirrors
              // the complete() path id-fallback policy: prefer the original
              // tool_use id from the raw response, synthesize only when absent.
              if (useAdapterNormalization) {
                const rawToolUseBlocks = msg.content.filter(
                  (
                    b,
                  ): b is { type: "tool_use"; id: string; name: string; input: unknown } =>
                    b.type === "tool_use",
                );
                const normalized = streamAdapter.parseToolCalls?.(msg, model);
                if (normalized && normalized.length > 0) {
                  for (let i = 0; i < normalized.length; i++) {
                    const tc = normalized[i]!;
                    const id = rawToolUseBlocks[i]?.id ?? `anthropic-tc-${i}`;
                    emitToolUseStart(emit, id, tc.name);
                    emitToolUseDelta(emit, JSON.stringify(tc.arguments));
                  }
                }
              }

              // Cluster B parity (mirrors gemini.ts stream guard): a non-OK
              // stop with no content must surface as a failure, not a silent
              // empty content_complete the kernel reads as a clean finish.
              const hasToolUse = msg.content.some(
                (b: { type: string }) => b.type === "tool_use",
              );
              if (
                (msg.stop_reason === "max_tokens" || msg.stop_reason === "refusal") &&
                content.length === 0 &&
                !hasToolUse
              ) {
                emit.fail(
                  new LLMError({
                    provider: "anthropic",
                    message:
                      msg.stop_reason === "max_tokens"
                        ? "Anthropic stream ended with stop_reason=max_tokens and no content. The output token budget was exhausted before any visible text was emitted — raise maxTokens."
                        : "Anthropic stream ended with stop_reason=refusal and no content. The model declined to respond.",
                  }),
                );
                return;
              }

              emit.single({ type: "content_complete", content });
              emit.single({
                type: "usage",
                usage: {
                  // TRUE prompt size, cache pools INCLUDED. See the note on the
                  // complete() path below — reporting the uncached remainder
                  // here made a caching run look ~600x cheaper per call than it
                  // was, and silently confounded every token ablation.
                  inputTokens: totalInputTokens(msg.usage),
                  outputTokens: msg.usage.output_tokens,
                  totalTokens: totalInputTokens(msg.usage) + msg.usage.output_tokens,
                  estimatedCost: calculateCost(
                    // Same total; calculateCost subtracts the cache pools back
                    // out to price base / read / creation at their own rates.
                    totalInputTokens(msg.usage),
                    msg.usage.output_tokens,
                    model,
                    {
                      cache_creation_input_tokens: msg.usage.cache_creation_input_tokens,
                      cache_read_input_tokens: msg.usage.cache_read_input_tokens,
                    },
                    config.pricingRegistry,
                  ),
                  // Lever 1 prompt-caching observability — mirrors complete() path.
                  ...(typeof msg.usage.cache_creation_input_tokens === "number"
                    ? { cacheCreationInputTokens: msg.usage.cache_creation_input_tokens }
                    : {}),
                  ...(typeof msg.usage.cache_read_input_tokens === "number"
                    ? { cacheReadInputTokens: msg.usage.cache_read_input_tokens }
                    : {}),
                },
              });
              emit.end();
            });

            stream.on("error", (error: unknown) => {
              // Hotfix 0.5-5 (2026-07-07): route stream errors through the
              // shared normalizer (one-line cause, no stack/JSON leak) — the
              // complete() path already does; streams regressed to the raw
              // err.message shape provider-error.ts was built to kill.
              emit.fail(mapProviderError(error, "anthropic", model));
            });
          }));
        }),

      completeStructured: (request) =>
        Effect.gen(function* () {
          const jsonSchema = Schema.encodedSchema(request.outputSchema);
          const schemaStr = JSON.stringify(jsonSchema, null, 2);

          const messagesWithFormat: LLMMessage[] = [
            ...request.messages,
            {
              role: "user" as const,
              content: `Respond with ONLY valid JSON matching this schema:\n${schemaStr}\n\nNo markdown, no code fences, just raw JSON.`,
            },
          ];

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
                      content: `That response did not match the schema. Error: ${String(lastError)}. Please try again with valid JSON only.`,
                    },
                  ];

            // Convert + inject assistant prefill to bias toward JSON output
            const anthropicMsgs = toAnthropicMessages(msgs);
            anthropicMsgs.push({ role: "assistant", content: "{" });

            const structuredModel =
              typeof request.model === "string"
                ? request.model
                : (request.model?.model ?? config.defaultModel);
            const structuredAnswerBudget = request.maxTokens ?? config.defaultMaxTokens;
            const structuredCap = resolveCapability("anthropic", structuredModel);
            const structuredThinkEnabled = resolveThinkingEnabled(
              "anthropic",
              structuredModel,
              config.thinking,
              structuredCap.supportsThinkingMode,
            );
            const structuredReserve = reserveThinkingBudget(
              structuredAnswerBudget,
              structuredCap.supportsThinkingMode,
              {
                ...(config.thinkingOptions ?? {}),
                enabled: structuredThinkEnabled,
              },
            );

            const completeResult = yield* Effect.tryPromise({
              try: async () => {
                const client = await getClient();
                return client.messages.create({
                  model: structuredModel,
                  // F1: clamp the final wire value — mirrors complete().
                  max_tokens: clampOutputBudget(
                    structuredReserve !== undefined
                      ? structuredAnswerBudget + structuredReserve
                      : structuredAnswerBudget,
                    structuredCap,
                  ),
                  // Automatic prompt caching — see the "Prompt caching
                  // (automatic)" note above `toAnthropicMessages`.
                  cache_control: { type: "ephemeral" },
                  system: request.systemPrompt,
                  messages: anthropicMsgs,
                  ...buildAnthropicThinkingBody(
                    structuredModel,
                    structuredReserve,
                    config.thinkingOptions?.effort,
                    request.temperature ?? config.defaultTemperature,
                  ),
                });
              },
              catch: (error) => toEffectError(error, "anthropic", structuredModel),
            });

            const response = mapAnthropicResponse(
              completeResult as AnthropicRawResponse,
              typeof request.model === 'string'
                ? request.model
                : request.model?.model ?? config.defaultModel,
            );

            // Prepend the "{" prefill back to the response content
            return "{" + response.content;
              }),
          });
        }),

      embed: (texts, model) =>
        Effect.tryPromise({
          try: async () => {
            const embeddingModel = model ?? config.embeddingConfig.model;
            const embProvider = config.embeddingConfig.provider;

            if (embProvider === "openai") {
              const { default: OpenAI } = await import("openai");
              const openaiClient = new OpenAI({
                apiKey: config.openaiApiKey,
              });
              const batchSize = config.embeddingConfig.batchSize ?? 100;
              const results: number[][] = [];

              for (let i = 0; i < texts.length; i += batchSize) {
                const batch = texts.slice(i, i + batchSize);
                const response = await openaiClient.embeddings.create({
                  model: embeddingModel,
                  input: [...batch],
                  dimensions: config.embeddingConfig.dimensions,
                });
                results.push(
                  ...response.data.map(
                    (d: { embedding: number[] }) => d.embedding,
                  ),
                );
              }

              return results;
            }

            // Ollama embeddings
            const endpoint =
              config.ollamaEndpoint ?? "http://localhost:11434";
            return Promise.all(
              [...texts].map(async (text) => {
                const res = await fetch(`${endpoint}/api/embed`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    model: embeddingModel,
                    input: text,
                  }),
                });
                const data = (await res.json()) as {
                  embeddings: number[][];
                };
                return data.embeddings[0]!;
              }),
            );
          },
          catch: (error) =>
            new LLMError({
              message: `Embedding failed: ${error}`,
              provider: "anthropic",
              cause: error,
            }),
        }),

      countTokens: (messages) =>
        Effect.gen(function* () {
          return yield* estimateTokenCount(messages);
        }),

      getModelConfig: () =>
        Effect.succeed({
          provider: "anthropic" as const,
          model: config.defaultModel,
        }),

      getStructuredOutputCapabilities: () =>
        Effect.succeed({
          nativeJsonMode: false,
          jsonSchemaEnforcement: false,
          prefillSupport: true,
          grammarConstraints: false,
        }),

      capabilities: () =>
        Effect.succeed({
          supportsToolCalling: true,
          supportsStreaming: true,
          supportsStructuredOutput: true,
          supportsLogprobs: false,
        } satisfies ProviderCapabilities),
    });
  }),
);

// ─── Anthropic Response Mapping ───

type AnthropicRawResponse = {
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
  >;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  model: string;
};

const mapAnthropicResponse = (
  response: AnthropicRawResponse,
  model: string,
  registry?: Record<string, { readonly input: number; readonly output: number }>,
): CompletionResponse => {
  const textContent = response.content
    .filter(
      (b): b is { type: "text"; text: string } => b.type === "text",
    )
    .map((b) => b.text)
    .join("");

  // M12 Hook 1/7 — give the calibrated/tier ProviderAdapter first crack at
  // normalizing tool calls (e.g., stringified arguments, alternate field
  // names). When the adapter returns undefined or no calibration is
  // registered for `model`, fall through to the default Anthropic-shaped
  // extraction. Pattern mirrors local.ts:440-465.
  const { adapter: providerAdapter } = selectAdapter(
    { supportsToolCalling: true },
    "frontier",
    model,
  );
  const rawToolUseBlocks = response.content.filter(
    (
      b,
    ): b is {
      type: "tool_use";
      id: string;
      name: string;
      input: unknown;
    } => b.type === "tool_use",
  );
  const adapterParsed = providerAdapter.parseToolCalls?.(response, model);
  const toolCalls = adapterParsed
    ? adapterParsed.map((tc, i) => ({
        // Preserve the original Anthropic tool_use id when available — the
        // kernel uses it as a stable correlation key for tool_result echoing.
        // Only synthesize when the adapter introduced a tool call that the
        // raw response did not expose at the same index.
        id: rawToolUseBlocks[i]?.id ?? `anthropic-tc-${i}`,
        name: tc.name,
        input: tc.arguments,
      }))
    : rawToolUseBlocks.map((b) => ({
        id: b.id,
        name: b.name,
        input: b.input,
      }));

  // Shared table-driven mapping — the anthropic table passes the four
  // canonical stop_reason tokens through and degrades the rest to end_turn,
  // exactly like the original ladder (which had no hasToolCalls override).
  const stopReason = mapStopReason(response.stop_reason, "anthropic");

  return {
    content: textContent,
    stopReason,
    usage: {
      inputTokens: totalInputTokens(response.usage),
      outputTokens: response.usage.output_tokens,
      totalTokens: totalInputTokens(response.usage) + response.usage.output_tokens,
      estimatedCost: calculateCost(
        // Same total; calculateCost subtracts the cache pools back out to price
        // base / read / creation at their own rates.
        totalInputTokens(response.usage),
        response.usage.output_tokens,
        model,
        {
          cache_creation_input_tokens: response.usage.cache_creation_input_tokens,
          cache_read_input_tokens: response.usage.cache_read_input_tokens,
        },
        registry,
      ),
      // Lever 1 prompt-caching observability — surface cache hit/creation
      // counts up the stack so bench reports and runtime metrics can show
      // "X input tok (Y cached)" instead of just total input.
      ...(typeof response.usage.cache_creation_input_tokens === "number"
        ? { cacheCreationInputTokens: response.usage.cache_creation_input_tokens }
        : {}),
      ...(typeof response.usage.cache_read_input_tokens === "number"
        ? { cacheReadInputTokens: response.usage.cache_read_input_tokens }
        : {}),
    },
    model: response.model ?? model,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
};
