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
} from "../types.js";
import { calculateCost, estimateTokenCount } from "../token-counter.js";
import { retryPolicy } from "../retry.js";

// ─── OpenAI Message Conversion ───

type OpenAIMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const toOpenAIMessages = (
  messages: readonly LLMMessage[],
): OpenAIMessage[] =>
  messages.map((m) => ({
    role: m.role,
    content:
      typeof m.content === "string"
        ? m.content
        : m.content
            .filter(
              (b): b is { type: "text"; text: string } => b.type === "text",
            )
            .map((b) => b.text)
            .join(""),
  }));

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

const toOpenAITool = (tool: ToolDefinition) => ({
  type: "function" as const,
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
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

          if (request.tools && request.tools.length > 0) {
            requestBody.tools = request.tools.map(toOpenAITool);
          }

          const response = yield* Effect.tryPromise({
            try: () =>
              (client as { chat: { completions: { create: (opts: unknown) => Promise<unknown> } } }).chat.completions.create(requestBody),
            catch: (error) => toEffectError(error, "openai"),
          });

          return mapOpenAIResponse(response as OpenAIRawResponse, model);
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
                  stream: true,
                });

                let fullContent = "";

                for await (const chunk of stream as AsyncIterable<{
                  choices: Array<{
                    delta: { content?: string };
                    finish_reason?: string;
                  }>;
                  usage?: { prompt_tokens: number; completion_tokens: number };
                }>) {
                  const delta = chunk.choices[0]?.delta?.content;
                  if (delta) {
                    fullContent += delta;
                    emit.single({ type: "text_delta", text: delta });
                  }

                  if (chunk.choices[0]?.finish_reason) {
                    emit.single({
                      type: "content_complete",
                      content: fullContent,
                    });

                    const inputTokens = chunk.usage?.prompt_tokens ?? 0;
                    const outputTokens =
                      chunk.usage?.completion_tokens ?? 0;
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
                        ),
                      },
                    });
                    emit.end();
                  }
                }
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
          const schemaStr = JSON.stringify(
            Schema.encodedSchema(request.outputSchema),
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

          let lastError: unknown = null;
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
                      content: `That response was not valid JSON. The parse error was: ${String(lastError)}. Please try again with valid JSON only.`,
                    },
                  ];

            const client = getClient();
            const completeResult = yield* Effect.tryPromise({
              try: () =>
                (client as { chat: { completions: { create: (opts: unknown) => Promise<unknown> } } }).chat.completions.create({
                  model: typeof request.model === 'string'
                    ? request.model
                    : request.model?.model ?? defaultModel,
                  max_tokens:
                    request.maxTokens ?? config.defaultMaxTokens,
                  temperature:
                    request.temperature ?? config.defaultTemperature,
                  messages: toOpenAIMessages(msgs),
                }),
              catch: (error) => toEffectError(error, "openai"),
            });

            const response = mapOpenAIResponse(
              completeResult as OpenAIRawResponse,
              typeof request.model === 'string'
                ? request.model
                : request.model?.model ?? defaultModel,
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
    });
  }),
);

// ─── OpenAI Response Mapping ───

type OpenAIToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type OpenAIRawResponse = {
  choices: Array<{
    message: {
      content: string | null;
      role: string;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: string;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  model: string;
};

const mapOpenAIResponse = (
  response: OpenAIRawResponse,
  model: string,
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
      ),
    },
    model: response.model ?? model,
    toolCalls,
  };
};
