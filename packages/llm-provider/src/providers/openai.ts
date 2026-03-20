import { Effect, Layer, Stream, Schema } from "effect";
import { LLMService } from "../llm-service.js";
import { LLMConfig } from "../llm-config.js";
import {
  LLMError,
  LLMTimeoutError,
  LLMParseError,
  LLMRateLimitError,
} from "../errors.js";
import type { LLMErrors } from "../errors.js";
import type {
  CompletionResponse,
  StreamEvent,
  LLMMessage,
  ToolDefinition,
  ToolCall,
  TokenLogprob,
} from "../types.js";
import { calculateCost, estimateTokenCount } from "../token-counter.js";
import type { CacheUsage } from "../token-counter.js";
import { retryPolicy } from "../retry.js";

// ─── OpenAI Message Conversion ───

type OpenAIToolCallParam = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type OpenAIMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: OpenAIToolCallParam[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** @internal Exported for testing only */
export const toOpenAIMessages = (
  messages: readonly LLMMessage[],
): OpenAIMessage[] =>
  messages.map((m) => {
    if (m.role === "tool") {
      return {
        role: "tool" as const,
        tool_call_id: m.toolCallId,
        content: m.content,
      };
    }

    if (m.role === "assistant" && typeof m.content !== "string") {
      const blocks = m.content as readonly { type: string; text?: string; id?: string; name?: string; input?: unknown }[];
      const textParts = blocks
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("");
      const toolUseBlocks = blocks.filter(
        (b): b is { type: "tool_use"; id: string; name: string; input: unknown } =>
          b.type === "tool_use",
      );

      if (toolUseBlocks.length > 0) {
        return {
          role: "assistant" as const,
          content: textParts || "",
          tool_calls: toolUseBlocks.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: typeof tc.input === "string" ? tc.input : JSON.stringify(tc.input),
            },
          })),
        };
      }

      return { role: "assistant" as const, content: textParts };
    }

    return {
      role: m.role as "system" | "user",
      content:
        typeof m.content === "string"
          ? m.content
          : (m.content as readonly { type: string; text?: string }[])
              .filter(
                (b): b is { type: "text"; text: string } => b.type === "text",
              )
              .map((b) => b.text)
              .join(""),
    };
  });

const toEffectError = (error: unknown, provider: "openai"): LLMErrors => {
  const err = error as { status?: number; message?: string };
  if (err.status === 429) {
    return new LLMRateLimitError({
      message: err.message ?? "Rate limit exceeded",
      provider,
      retryAfterMs: 60_000,
    });
  }
  return new LLMError({
    message: err.message ?? String(error),
    provider,
    cause: error,
  });
};

// ─── OpenAI Tool Conversion ───

/**
 * Identify if a model supports Structured Tool Calling (Strict Mode).
 * Supported by gpt-4o-2024-08-06+, gpt-4o-mini, o1, o3-mini, and later models.
 */
/** @internal Exported for testing only */
export const isStrictToolCallingSupported = (model: string): boolean => {
  const m = model.toLowerCase();
  return (
    (m.includes("gpt-4o") && (m.includes("2024-08-06") || m.includes("2024-11-20") || !m.includes("2024-05-13"))) ||
    m.includes("gpt-4o-mini") ||
    m.startsWith("o1") ||
    m.startsWith("o3") ||
    m.startsWith("o4")
  );
};

/**
 * Transform a JSON Schema into an OpenAI-compatible "Strict" schema.
 * 1. Sets additionalProperties: false
 * 2. Moves all properties into the required array
 * 3. Removes 'default' values (not supported in strict mode)
 */
/** @internal Exported for testing only */
export const toStrictToolSchema = (schema: any): any => {
  if (!schema || typeof schema !== "object") return schema;
  const newSchema = JSON.parse(JSON.stringify(schema));

  if (newSchema.type === "object" && newSchema.properties) {
    const originalRequired = new Set<string>(newSchema.required ?? []);
    newSchema.additionalProperties = false;
    // OpenAI Strict Mode requires ALL properties to be listed in 'required'
    newSchema.required = Object.keys(newSchema.properties);

    for (const key of Object.keys(newSchema.properties)) {
      const prop = newSchema.properties[key];

      // Remove 'default' as it's not supported in OpenAI Strict Mode
      if (typeof prop === "object" && prop !== null) {
        delete prop.default;
      }

      // Properties that were NOT originally required become nullable so the
      // model can pass null instead of omitting them (strict mode forbids omission)
      if (!originalRequired.has(key) && prop && typeof prop === "object") {
        if (prop.type && prop.type !== "null" && !prop.anyOf) {
          prop.anyOf = [{ type: prop.type }, { type: "null" }];
          delete prop.type;
        }
      }

      // Recursively apply to nested objects
      if (prop.type === "object" || prop.anyOf?.some((s: any) => s.type === "object")) {
        newSchema.properties[key] = toStrictToolSchema(prop);
      } else if (prop.type === "array" && prop.items && prop.items.type === "object") {
        newSchema.properties[key].items = toStrictToolSchema(prop.items);
      }
    }
  }

  return newSchema;
};

/** @internal Exported for testing only */
export const toOpenAITool = (tool: ToolDefinition, strict: boolean) => ({
  type: "function" as const,
  function: {
    name: tool.name,
    description: tool.description,
    parameters: strict ? toStrictToolSchema(tool.inputSchema) : tool.inputSchema,
    strict: strict || undefined,
  },
});

// ─── OpenAI Provider Layer ───

export const OpenAIProviderLive = Layer.effect(
  LLMService,
  Effect.gen(function* () {
    const config = yield* LLMConfig;

    const createClient = () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const OpenAI = require("openai").default;
      return new OpenAI({ apiKey: config.openaiApiKey });
    };

    let _client: ReturnType<typeof createClient> | null = null;
    const getClient = () => {
      if (!_client) _client = createClient();
      return _client;
    };

    const defaultModel = config.defaultModel.startsWith("claude")
      ? "gpt-4o"
      : config.defaultModel;

    return LLMService.of({
      complete: (request) =>
        Effect.gen(function* () {
          const client = getClient();
          const model = typeof request.model === 'string'
            ? request.model
            : request.model?.model ?? defaultModel;

          const messages = toOpenAIMessages(request.messages);
          if (request.systemPrompt) {
            messages.unshift({ role: "system", content: request.systemPrompt });
          }

          const requestBody: Record<string, unknown> = {
                model,
                max_tokens: request.maxTokens ?? config.defaultMaxTokens,
                temperature: request.temperature ?? config.defaultTemperature,
                messages,
                stop: request.stopSequences
                  ? [...request.stopSequences]
                  : undefined,
          };

          if (request.logprobs) {
            requestBody.logprobs = true;
            if (request.topLogprobs != null) {
              requestBody.top_logprobs = request.topLogprobs;
            }
          }

          if (request.tools && request.tools.length > 0) {
            const strict = isStrictToolCallingSupported(model);
            requestBody.tools = request.tools.map((t) => toOpenAITool(t, strict));
          }

          const response = yield* Effect.tryPromise({
            try: () =>
              (client as { chat: { completions: { create: (opts: unknown) => Promise<unknown> } } }).chat.completions.create(requestBody),
            catch: (error) => toEffectError(error, "openai"),
          });

          return mapOpenAIResponse(response as OpenAIRawResponse, model, config.pricingRegistry);
        }).pipe(
          Effect.retry(retryPolicy),
          Effect.timeout("30 seconds"),
          Effect.catchTag("TimeoutException", () =>
            Effect.fail(
              new LLMTimeoutError({
                message: "LLM request timed out",
                provider: "openai",
                timeoutMs: 30_000,
              }),
            ),
          ),
        ),

      stream: (request) =>
        Effect.gen(function* () {
          const client = getClient();
          const model = typeof request.model === 'string'
            ? request.model
            : request.model?.model ?? defaultModel;

          return Stream.async<StreamEvent, LLMErrors>((emit) => {
            const doStream = async () => {
              try {
                const stream = await (client as { chat: { completions: { create: (opts: unknown) => Promise<AsyncIterable<unknown>> } } }).chat.completions.create({
                  model,
                  max_tokens:
                    request.maxTokens ?? config.defaultMaxTokens,
                  temperature:
                    request.temperature ?? config.defaultTemperature,
                  messages: (() => {
                    const msgs = toOpenAIMessages(request.messages);
                    if (request.systemPrompt) {
                      msgs.unshift({ role: "system", content: request.systemPrompt });
                    }
                    return msgs;
                  })(),
                  tools: request.tools && request.tools.length > 0
                    ? request.tools.map((t) => toOpenAITool(t, isStrictToolCallingSupported(model)))
                    : undefined,
                  stream: true,
                  stream_options: { include_usage: true },
                });

                let fullContent = "";
                // Accumulate streamed tool calls by index
                const toolCallAccum: Map<number, { id: string; name: string; arguments: string }> = new Map();
                let finalUsage: {
                  prompt_tokens: number;
                  completion_tokens: number;
                  prompt_tokens_details?: { cached_tokens?: number };
                } | undefined;

                for await (const chunk of stream as AsyncIterable<{
                  choices: Array<{
                    delta: {
                      content?: string;
                      tool_calls?: Array<{
                        index: number;
                        id?: string;
                        function?: { name?: string; arguments?: string };
                      }>;
                    };
                    finish_reason?: string;
                  }>;
                  usage?: {
                    prompt_tokens: number;
                    completion_tokens: number;
                    prompt_tokens_details?: { cached_tokens?: number };
                  };
                }>) {
                  const delta = chunk.choices[0]?.delta?.content;
                  if (delta) {
                    fullContent += delta;
                    emit.single({ type: "text_delta", text: delta });
                  }

                  // Accumulate tool call deltas
                  const toolDeltas = chunk.choices[0]?.delta?.tool_calls;
                  if (toolDeltas) {
                    for (const tc of toolDeltas) {
                      const existing = toolCallAccum.get(tc.index);
                      if (existing) {
                        if (tc.function?.arguments) existing.arguments += tc.function.arguments;
                      } else {
                        toolCallAccum.set(tc.index, {
                          id: tc.id ?? "",
                          name: tc.function?.name ?? "",
                          arguments: tc.function?.arguments ?? "",
                        });
                        // Emit tool_use_start on first chunk for this tool
                        if (tc.id && tc.function?.name) {
                          emit.single({ type: "tool_use_start", id: tc.id, name: tc.function.name });
                        }
                      }
                      // Emit argument deltas for progressive parsing
                      if (tc.function?.arguments) {
                        emit.single({ type: "tool_use_delta", input: tc.function.arguments });
                      }
                    }
                  }

                  // Capture final usage (reported after all content chunks when stream_options.include_usage is true)
                  if (chunk.usage) {
                    finalUsage = chunk.usage;
                  }

                  if (chunk.choices[0]?.finish_reason) {
                    emit.single({
                      type: "content_complete",
                      content: fullContent,
                    });
                  }
                }

                // Emit usage from the final chunk (or zeros if not available)
                const inputTokens = finalUsage?.prompt_tokens ?? 0;
                const outputTokens = finalUsage?.completion_tokens ?? 0;
                const cacheUsage: CacheUsage = {
                  cached_tokens: finalUsage?.prompt_tokens_details?.cached_tokens,
                };
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
                      cacheUsage,
                      config.pricingRegistry,
                    ),
                  },
                });
                emit.end();
              } catch (error) {
                const err = error as { message?: string };
                emit.fail(
                  new LLMError({
                    message: err.message ?? String(error),
                    provider: "openai",
                    cause: error,
                  }),
                );
              }
            };
            void doStream();
          });
        }),

      completeStructured: (request) =>
        Effect.gen(function* () {
          const jsonSchema = Schema.encodedSchema(request.outputSchema);
          const schemaObj = JSON.parse(JSON.stringify(jsonSchema));
          const schemaStr = JSON.stringify(schemaObj, null, 2);
          const model = typeof request.model === 'string'
            ? request.model
            : request.model?.model ?? defaultModel;
          const client = getClient();
          const maxRetries = request.maxParseRetries ?? 2;

          // ── Native JSON Schema mode (gpt-4o-2024-08-06+, o-series, gpt-4.1) ──
          // Use response_format with json_schema for strict enforcement.
          const requestBody: Record<string, unknown> = {
            model,
            max_tokens: request.maxTokens ?? config.defaultMaxTokens,
            temperature: request.temperature ?? config.defaultTemperature,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "structured_output",
                strict: true,
                schema: schemaObj,
              },
            },
          };

          const messages: LLMMessage[] = [
            ...request.messages,
            {
              role: "user" as const,
              content: `Respond with JSON matching this schema:\n${schemaStr}`,
            },
          ];

          let lastError: unknown = null;

          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const msgs =
              attempt === 0
                ? messages
                : [
                    ...messages,
                    {
                      role: "assistant" as const,
                      content: String(lastError),
                    },
                    {
                      role: "user" as const,
                      content: `That response did not match the schema. Error: ${String(lastError)}. Please try again.`,
                    },
                  ];

            const completeResult = yield* Effect.tryPromise({
              try: () =>
                (client as { chat: { completions: { create: (opts: unknown) => Promise<unknown> } } }).chat.completions.create({
                  ...requestBody,
                  messages: toOpenAIMessages(msgs),
                }),
              catch: (error) => toEffectError(error, "openai"),
            });

            const response = mapOpenAIResponse(
              completeResult as OpenAIRawResponse,
              model,
              config.pricingRegistry,
            );

            try {
              const parsed = JSON.parse(response.content);
              const decoded = Schema.decodeUnknownEither(
                request.outputSchema,
              )(parsed);

              if (decoded._tag === "Right") {
                return decoded.right;
              }
              lastError = decoded.left;
            } catch (e) {
              lastError = e;
            }
          }

          return yield* Effect.fail(
            new LLMParseError({
              message: `Failed to parse structured output after ${maxRetries + 1} attempts`,
              rawOutput: String(lastError),
              expectedSchema: schemaStr,
            }),
          );
        }),

      embed: (texts, model) =>
        Effect.tryPromise({
          try: async () => {
            const client = getClient();
            const embeddingModel =
              model ?? config.embeddingConfig.model;
            const batchSize = config.embeddingConfig.batchSize ?? 100;
            const results: number[][] = [];

            for (let i = 0; i < texts.length; i += batchSize) {
              const batch = texts.slice(i, i + batchSize);
              const response = await (client as { embeddings: { create: (opts: unknown) => Promise<{ data: Array<{ embedding: number[] }> }> } }).embeddings.create({
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
          },
          catch: (error) =>
            new LLMError({
              message: `Embedding failed: ${error}`,
              provider: "openai",
              cause: error,
            }),
        }),

      countTokens: (messages) =>
        Effect.gen(function* () {
          return yield* estimateTokenCount(messages);
        }),

      getModelConfig: () =>
        Effect.succeed({
          provider: "openai" as const,
          model: defaultModel,
        }),

      getStructuredOutputCapabilities: () =>
        Effect.succeed({
          nativeJsonMode: true,
          jsonSchemaEnforcement: true,
          prefillSupport: false,
          grammarConstraints: false,
        }),
    });
  }),
);

// ─── OpenAI Response Mapping ───

type OpenAIToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type OpenAILogprobContent = {
  token: string;
  logprob: number;
  top_logprobs?: Array<{ token: string; logprob: number }>;
};

type OpenAIRawResponse = {
  choices: Array<{
    message: {
      content: string | null;
      role: string;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: string;
    logprobs?: {
      content?: OpenAILogprobContent[];
    } | null;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
  };
  model: string;
};

const mapOpenAIResponse = (
  response: OpenAIRawResponse,
  model: string,
  registry?: Record<string, { readonly input: number; readonly output: number }>,
): CompletionResponse => {
  const message = response.choices[0]?.message;
  const content = message?.content ?? "";
  const rawToolCalls = message?.tool_calls;

  const hasToolCalls = rawToolCalls && rawToolCalls.length > 0;

  const stopReason =
    response.choices[0]?.finish_reason === "tool_calls" || hasToolCalls
      ? ("tool_use" as const)
      : response.choices[0]?.finish_reason === "stop"
        ? ("end_turn" as const)
        : response.choices[0]?.finish_reason === "length"
          ? ("max_tokens" as const)
          : ("end_turn" as const);

  const toolCalls: ToolCall[] | undefined = hasToolCalls
    ? rawToolCalls.map((tc) => {
        let input: unknown;
        try {
          input = JSON.parse(tc.function.arguments);
        } catch {
          input = { raw: tc.function.arguments };
        }
        return {
          id: tc.id,
          name: tc.function.name,
          input,
        };
      })
    : undefined;

  // Extract logprobs from OpenAI response if present
  const rawLogprobs = response.choices[0]?.logprobs?.content;
  const logprobs: TokenLogprob[] | undefined = rawLogprobs
    ? rawLogprobs.map((lp) => ({
        token: lp.token,
        logprob: lp.logprob,
        ...(lp.top_logprobs
          ? {
              topLogprobs: lp.top_logprobs.map((tlp) => ({
                token: tlp.token,
                logprob: tlp.logprob,
              })),
            }
          : {}),
      }))
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
        {
          cached_tokens: response.usage?.prompt_tokens_details?.cached_tokens,
        },
        registry,
      ),
    },
    model: response.model ?? model,
    toolCalls,
    ...(logprobs ? { logprobs } : {}),
  };
};
