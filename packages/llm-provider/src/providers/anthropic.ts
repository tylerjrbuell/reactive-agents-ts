import { Effect, Layer, Stream, Schema } from "effect";
import { LLMService } from "../llm-service.js";
import { LLMConfig } from "../llm-config.js";
import type { ProviderCapabilities } from "../capabilities.js";
import {
  LLMError,
  LLMTimeoutError,
  LLMParseError,
  LLMRateLimitError,
} from "../errors.js";
import type {
  LLMErrors, ParseAttemptError } from "../errors.js";
import type {
  CompletionResponse,
  StreamEvent,
  LLMMessage,
  ContentBlock,
} from "../types.js";
import { calculateCost, estimateTokenCount } from "../token-counter.js";
import { retryPolicy } from "../retry.js";
import { emitToolUseDelta, emitToolUseStart } from "../streaming-helpers.js";
import { selectAdapter } from "../adapter.js";

// ─── Anthropic Message Conversion Helpers ───

type AnthropicRole = "user" | "assistant";

type AnthropicContentBlock =
  | { type: "text"; text: string; cache_control?: { type: "ephemeral" } }
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

  // Lever 1 prompt-caching — locate the last tool_result message and mark its
  // tool_result block with cache_control. On multi-iteration runs the provider
  // hits the cache on every message up to and including this breakpoint, so
  // subsequent iterations re-process only the NEW tail (new assistant turn +
  // user continuation). Combined with the system + tools breakpoints this
  // uses 3 of Anthropic's 4 cache-breakpoint budget per request.
  //
  // The cache_control marker is a no-op on cold caches and when the cached
  // prefix is below the per-model minimum (Sonnet: 1024 tok; Haiku: 2048 tok),
  // so adding it unconditionally is safe.
  let lastToolResultIdx = -1;
  for (let i = filtered.length - 1; i >= 0; i--) {
    if (filtered[i]?.role === "tool") {
      lastToolResultIdx = i;
      break;
    }
  }

  return filtered.map((m, idx) => {
    if (m.role === "tool") {
      const block: Record<string, unknown> = {
        type: "tool_result" as const,
        tool_use_id: m.toolCallId,
        content: m.content,
      };
      if (idx === lastToolResultIdx) {
        block.cache_control = { type: "ephemeral" as const };
      }
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
}, cached: boolean = false) => ({
  name: tool.name,
  description: tool.description,
  input_schema: {
    type: "object" as const,
    ...tool.inputSchema,
  },
  ...(cached ? { cache_control: { type: "ephemeral" as const } } : {}),
});

const toEffectError = (error: unknown, provider: "anthropic"): LLMErrors => {
  const err = error as { status?: number; message?: string; headers?: Record<string, string> };
  if (err.status === 429) {
    const retryAfter = err.headers?.["retry-after"];
    return new LLMRateLimitError({
      message: err.message ?? "Rate limit exceeded",
      provider,
      retryAfterMs: retryAfter ? Number(retryAfter) * 1000 : 60_000,
    });
  }
  return new LLMError({
    message: err.message ?? String(error),
    provider,
    cause: error,
  });
};

// ── System prompt caching ────────────────────────────────────────────────────
// Anthropic prompt caching: marking content with cache_control: { type:
// "ephemeral" } tells the provider "everything from the request start up to
// (and including) this block can be cached for 5 minutes". Subsequent calls
// with the same prefix get a 90% input-token discount on the cached portion.
//
// Per-model minimum cacheable block: Sonnet 1024 tok, Haiku 2048 tok. Marking
// a block below the threshold is a no-op (provider ignores the marker). So
// marking unconditionally is safe — the provider self-gates.
//
// Lever 1 spike (this PR): wrap the system parameter as a content block with
// cache_control on every call. Pairs with tool-list cache_control (already
// present, on last tool entry) and message-thread cache_control (added in
// `toAnthropicMessages` above, on last tool_result). Three breakpoints total,
// well under Anthropic's 4-breakpoint per-request limit.

type SystemParam =
  | string
  | Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;

/**
 * Build the Anthropic `system` parameter. Wraps in a cache-able content block
 * unconditionally — the provider auto-skips cache_control on blocks below the
 * per-model minimum cacheable size (Sonnet: 1024 tok, Haiku: 2048 tok), so
 * always marking is safe and lets longer scaffolds (real-world RA agents with
 * multiple built-in tools + full ContextManager output) get cache benefit on
 * iteration 1+ without any per-call decision logic.
 */
const buildSystemParam = (systemPrompt: string | undefined): SystemParam | undefined => {
  if (!systemPrompt) return undefined;
  return [{
    type: "text",
    text: systemPrompt,
    cache_control: { type: "ephemeral" },
  }];
};

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
      complete: (request) =>
        Effect.gen(function* () {
          const client = yield* Effect.promise(() => getClient());
          const model = typeof request.model === 'string'
            ? request.model
            : request.model?.model ?? config.defaultModel;

          const response = yield* Effect.tryPromise({
            try: () =>
              client.messages.create({
                model,
                max_tokens: request.maxTokens ?? config.defaultMaxTokens,
                temperature: request.temperature ?? config.defaultTemperature,
                system: buildSystemParam(request.systemPrompt),
                messages: toAnthropicMessages(request.messages),
                stop_sequences: request.stopSequences
                  ? [...request.stopSequences]
                  : undefined,
                tools: request.tools?.map((t, i) =>
                  toAnthropicTool(t, i === (request.tools?.length ?? 0) - 1),
                ),
              }),
            catch: (error) => toEffectError(error, "anthropic"),
          });

          return mapAnthropicResponse(response as AnthropicRawResponse, model, config.pricingRegistry);
        }).pipe(
          Effect.retry(retryPolicy),
          Effect.timeout("30 seconds"),
          Effect.catchTag("TimeoutException", () =>
            Effect.fail(
              new LLMTimeoutError({
                message: "LLM request timed out",
                provider: "anthropic",
                timeoutMs: 30_000,
              }),
            ),
          ),
        ),

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

          return Stream.async<StreamEvent, LLMErrors>((emit) => {
            const stream = client.messages.stream({
              model,
              max_tokens: request.maxTokens ?? config.defaultMaxTokens,
              temperature: request.temperature ?? config.defaultTemperature,
              system: buildSystemParam(request.systemPrompt),
              messages: toAnthropicMessages(request.messages),
              tools: request.tools?.map((t, i) =>
                toAnthropicTool(t, i === (request.tools?.length ?? 0) - 1),
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

              emit.single({ type: "content_complete", content });
              emit.single({
                type: "usage",
                usage: {
                  inputTokens: msg.usage.input_tokens,
                  outputTokens: msg.usage.output_tokens,
                  totalTokens:
                    msg.usage.input_tokens + msg.usage.output_tokens,
                  estimatedCost: calculateCost(
                    msg.usage.input_tokens,
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
              const err = error as { message?: string };
              emit.fail(
                new LLMError({
                  message: err.message ?? String(error),
                  provider: "anthropic",
                  cause: error,
                }),
              );
            });
          });
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

          let lastError: unknown = null;
          const parseAttempts: ParseAttemptError[] = [];
          const maxRetries = request.maxParseRetries ?? 2;

          for (let attempt = 0; attempt <= maxRetries; attempt++) {
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

            const completeResult = yield* Effect.tryPromise({
              try: async () => {
                const client = await getClient();
                return client.messages.create({
                  model: typeof request.model === 'string'
                    ? request.model
                    : request.model?.model ?? config.defaultModel,
                  max_tokens:
                    request.maxTokens ?? config.defaultMaxTokens,
                  temperature: request.temperature ?? config.defaultTemperature,
                  system: buildSystemParam(request.systemPrompt),
                  messages: anthropicMsgs,
                });
              },
              catch: (error) => toEffectError(error, "anthropic"),
            });

            const response = mapAnthropicResponse(
              completeResult as AnthropicRawResponse,
              typeof request.model === 'string'
                ? request.model
                : request.model?.model ?? config.defaultModel,
            );

            // Prepend the "{" prefill back to the response content
            const fullContent = "{" + response.content;

            try {
              const parsed = JSON.parse(fullContent);
              const decoded = Schema.decodeUnknownEither(
                request.outputSchema,
              )(parsed);

              if (decoded._tag === "Right") {
                return decoded.right;
              }
              lastError = decoded.left;
              parseAttempts.push({ attempt, error: decoded.left });
            } catch (e) {
              lastError = e;
              parseAttempts.push({ attempt, error: e });
            }
          }

          return yield* Effect.fail(
            new LLMParseError({
              message: `Failed to parse structured output after ${maxRetries + 1} attempts`,
              rawOutput: String(lastError),
              expectedSchema: schemaStr,
              attempts: parseAttempts,
            }),
          );
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

  const stopReason =
    response.stop_reason === "end_turn"
      ? ("end_turn" as const)
      : response.stop_reason === "max_tokens"
        ? ("max_tokens" as const)
        : response.stop_reason === "stop_sequence"
          ? ("stop_sequence" as const)
          : response.stop_reason === "tool_use"
            ? ("tool_use" as const)
            : ("end_turn" as const);

  return {
    content: textContent,
    stopReason,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      totalTokens:
        response.usage.input_tokens + response.usage.output_tokens,
      estimatedCost: calculateCost(
        response.usage.input_tokens,
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
