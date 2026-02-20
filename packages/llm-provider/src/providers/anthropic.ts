import { Effect, Layer, Stream, Schema } from "effect";
import { LLMService } from "../llm-service.js";
import { LLMConfig } from "../llm-config.js";
import {
  LLMError,
  LLMTimeoutError,
  LLMParseError,
  LLMRateLimitError,
} from "../errors.js";
import type {
  LLMErrors } from "../errors.js";
import type {
  CompletionResponse,
  StreamEvent,
  LLMMessage,
  ContentBlock,
} from "../types.js";
import { calculateCost, estimateTokenCount } from "../token-counter.js";
import { retryPolicy } from "../retry.js";

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
): AnthropicMessage[] =>
  messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as AnthropicRole,
      content:
        typeof m.content === "string"
          ? m.content
          : (m.content as readonly ContentBlock[]).map(
              (b) => b as unknown as AnthropicContentBlock,
            ),
    }));

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

// ─── Anthropic Provider Layer ───

export const AnthropicProviderLive = Layer.effect(
  LLMService,
  Effect.gen(function* () {
    const config = yield* LLMConfig;

    // Lazy-load the SDK to avoid hard dependency if not using Anthropic
    const createClient = () => {
      // Dynamic import is handled in Effect.tryPromise
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Anthropic = require("@anthropic-ai/sdk").default;
      return new Anthropic({ apiKey: config.anthropicApiKey });
    };

    let _client: ReturnType<typeof createClient> | null = null;
    const getClient = () => {
      if (!_client) _client = createClient();
      return _client;
    };

    return LLMService.of({
      complete: (request) =>
        Effect.gen(function* () {
          const client = getClient();
          const model = typeof request.model === 'string'
            ? request.model
            : request.model?.model ?? config.defaultModel;

          const response = yield* Effect.tryPromise({
            try: () =>
              (client as { messages: { create: (opts: unknown) => Promise<unknown> } }).messages.create({
                model,
                max_tokens: request.maxTokens ?? config.defaultMaxTokens,
                temperature: request.temperature ?? config.defaultTemperature,
                system: request.systemPrompt,
                messages: toAnthropicMessages(request.messages),
                stop_sequences: request.stopSequences
                  ? [...request.stopSequences]
                  : undefined,
                tools: request.tools?.map(toAnthropicTool),
              }),
            catch: (error) => toEffectError(error, "anthropic"),
          });

          return mapAnthropicResponse(response as AnthropicRawResponse, model);
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
          const client = getClient();
          const model = typeof request.model === 'string'
            ? request.model
            : request.model?.model ?? config.defaultModel;

          return Stream.async<StreamEvent, LLMErrors>((emit) => {
            const stream = (client as { messages: { stream: (opts: unknown) => { on: (event: string, cb: (...args: unknown[]) => void) => void } } }).messages.stream({
              model,
              max_tokens: request.maxTokens ?? config.defaultMaxTokens,
              temperature: request.temperature ?? config.defaultTemperature,
              system: request.systemPrompt,
              messages: toAnthropicMessages(request.messages),
            });

            stream.on("text", (text: unknown) => {
              emit.single({ type: "text_delta", text: text as string });
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
                  ),
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

            const completeResult = yield* Effect.tryPromise({
              try: () => {
                const client = getClient();
                return (client as { messages: { create: (opts: unknown) => Promise<unknown> } }).messages.create({
                  model: typeof request.model === 'string'
                    ? request.model
                    : request.model?.model ?? config.defaultModel,
                  max_tokens:
                    request.maxTokens ?? config.defaultMaxTokens,
                  temperature: request.temperature ?? config.defaultTemperature,
                  system: request.systemPrompt,
                  messages: toAnthropicMessages(msgs),
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
  usage: { input_tokens: number; output_tokens: number };
  model: string;
};

const mapAnthropicResponse = (
  response: AnthropicRawResponse,
  model: string,
): CompletionResponse => {
  const textContent = response.content
    .filter(
      (b): b is { type: "text"; text: string } => b.type === "text",
    )
    .map((b) => b.text)
    .join("");

  const toolCalls = response.content
    .filter(
      (
        b,
      ): b is {
        type: "tool_use";
        id: string;
        name: string;
        input: unknown;
      } => b.type === "tool_use",
    )
    .map((b) => ({
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
      ),
    },
    model: response.model ?? model,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
};
