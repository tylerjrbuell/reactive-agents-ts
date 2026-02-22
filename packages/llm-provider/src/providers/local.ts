import { Effect, Layer, Stream, Schema } from "effect";
import { LLMService } from "../llm-service.js";
import { LLMConfig } from "../llm-config.js";
import { LLMError, LLMTimeoutError, LLMParseError } from "../errors.js";
import type { LLMErrors } from "../errors.js";
import type {
  CompletionResponse,
  StreamEvent,
  LLMMessage,
  ToolDefinition,
  ToolCall,
} from "../types.js";
import { estimateTokenCount } from "../token-counter.js";
import { retryPolicy } from "../retry.js";

// ─── Ollama SDK types (from the `ollama` npm package) ───

type OllamaTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type OllamaMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

// ─── Conversion Helpers ───

const toOllamaMessages = (
  messages: readonly LLMMessage[],
): OllamaMessage[] =>
  messages
    .filter((m) => m.role !== "tool") // Ollama doesn't support tool messages — filter them
    .map((m) => ({
      role: m.role as "system" | "user" | "assistant",
      content:
        typeof m.content === "string"
          ? m.content
          : (m.content as readonly { type: string; text?: string }[])
              .filter(
                (b): b is { type: "text"; text: string } => b.type === "text",
              )
              .map((b) => b.text)
              .join(""),
    }));

const toOllamaTools = (
  tools?: readonly ToolDefinition[],
): OllamaTool[] | undefined => {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as Record<string, unknown>,
    },
  }));
};

const parseToolCalls = (
  toolCalls?: Array<{
    function: { name: string; arguments: unknown };
  }>,
): ToolCall[] | undefined => {
  if (!toolCalls || toolCalls.length === 0) return undefined;
  return toolCalls.map((tc, i) => ({
    id: `ollama-tc-${Date.now()}-${i}`,
    name: tc.function.name,
    input: tc.function.arguments,
  }));
};

// ─── Ollama / Local Provider Layer ───

export const LocalProviderLive = Layer.effect(
  LLMService,
  Effect.gen(function* () {
    const config = yield* LLMConfig;
    const endpoint = config.ollamaEndpoint ?? "http://localhost:11434";
    const defaultModel = config.defaultModel.startsWith("claude") ||
      config.defaultModel.startsWith("gpt")
      ? "llama3"
      : config.defaultModel;

    // Lazy-import the ollama SDK (same pattern as Gemini provider)
    const getClient = async () => {
      const { Ollama } = await import("ollama");
      return new Ollama({ host: endpoint });
    };

    return LLMService.of({
      complete: (request) =>
        Effect.gen(function* () {
          const model = typeof request.model === 'string'
            ? request.model
            : request.model?.model ?? defaultModel;

          const response = yield* Effect.tryPromise({
            try: async () => {
              const client = await getClient();

              const msgs = toOllamaMessages(request.messages);
              if (request.systemPrompt) {
                msgs.unshift({ role: "system", content: request.systemPrompt });
              }

              return client.chat({
                model,
                messages: msgs,
                tools: toOllamaTools(request.tools),
                stream: false,
                keep_alive: "5m",
                options: {
                  temperature:
                    request.temperature ?? config.defaultTemperature,
                  num_predict:
                    request.maxTokens ?? config.defaultMaxTokens,
                  stop: request.stopSequences
                    ? [...request.stopSequences]
                    : undefined,
                },
              });
            },
            catch: (error) =>
              new LLMError({
                message: `Ollama request failed: ${error}`,
                provider: "ollama",
                cause: error,
              }),
          });

          const content = response.message?.content ?? "";
          const inputTokens = response.prompt_eval_count ?? 0;
          const outputTokens = response.eval_count ?? 0;
          const toolCalls = parseToolCalls(
            response.message?.tool_calls as Array<{
              function: { name: string; arguments: unknown };
            }> | undefined,
          );

          const hasToolCalls = toolCalls && toolCalls.length > 0;

          return {
            content,
            stopReason: hasToolCalls
              ? ("tool_use" as const)
              : response.done_reason === "stop"
                ? ("end_turn" as const)
                : response.done_reason === "length"
                  ? ("max_tokens" as const)
                  : ("end_turn" as const),
            usage: {
              inputTokens,
              outputTokens,
              totalTokens: inputTokens + outputTokens,
              estimatedCost: 0, // Local models are free
            },
            model: response.model ?? model,
            toolCalls,
          } satisfies CompletionResponse;
        }).pipe(
          Effect.retry(retryPolicy),
          Effect.timeout("120 seconds"),
          Effect.catchTag("TimeoutException", () =>
            Effect.fail(
              new LLMTimeoutError({
                message: "Local LLM request timed out",
                provider: "ollama",
                timeoutMs: 120_000,
              }),
            ),
          ),
        ),

      stream: (request) =>
        Effect.gen(function* () {
          const model = typeof request.model === 'string'
            ? request.model
            : request.model?.model ?? defaultModel;

          return Stream.async<StreamEvent, LLMErrors>((emit) => {
            const doStream = async () => {
              try {
                const client = await getClient();

                const msgs = toOllamaMessages(request.messages);
                if (request.systemPrompt) {
                  msgs.unshift({ role: "system", content: request.systemPrompt });
                }

                const stream = await client.chat({
                  model,
                  messages: msgs,
                  tools: toOllamaTools(request.tools),
                  stream: true,
                  keep_alive: "5m",
                  options: {
                    temperature:
                      request.temperature ?? config.defaultTemperature,
                    num_predict:
                      request.maxTokens ?? config.defaultMaxTokens,
                  },
                });

                let fullContent = "";

                for await (const chunk of stream) {
                  if (chunk.message?.content) {
                    fullContent += chunk.message.content;
                    emit.single({
                      type: "text_delta",
                      text: chunk.message.content,
                    });
                  }

                  if (chunk.done) {
                    emit.single({
                      type: "content_complete",
                      content: fullContent,
                    });
                    emit.single({
                      type: "usage",
                      usage: {
                        inputTokens: chunk.prompt_eval_count ?? 0,
                        outputTokens: chunk.eval_count ?? 0,
                        totalTokens:
                          (chunk.prompt_eval_count ?? 0) +
                          (chunk.eval_count ?? 0),
                        estimatedCost: 0,
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
                    provider: "ollama",
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

          const model = typeof request.model === 'string'
            ? request.model
            : request.model?.model ?? defaultModel;

          let lastError: unknown = null;
          const maxRetries = request.maxParseRetries ?? 2;

          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const msgs = toOllamaMessages(
              attempt === 0
                ? [
                    ...request.messages,
                    {
                      role: "user" as const,
                      content: `\nRespond with ONLY valid JSON matching this schema:\n${schemaStr}\n\nNo markdown, no code fences, just raw JSON.`,
                    },
                  ]
                : [
                    ...request.messages,
                    {
                      role: "user" as const,
                      content: `\nRespond with ONLY valid JSON matching this schema:\n${schemaStr}\n\nNo markdown, no code fences, just raw JSON.`,
                    },
                    {
                      role: "assistant" as const,
                      content: String(lastError),
                    },
                    {
                      role: "user" as const,
                      content: `That response was not valid JSON. The parse error was: ${String(lastError)}. Please try again with valid JSON only.`,
                    },
                  ],
            );

            if (request.systemPrompt) {
              msgs.unshift({ role: "system", content: request.systemPrompt });
            }

            const response = yield* Effect.tryPromise({
              try: async () => {
                const client = await getClient();
                return client.chat({
                  model,
                  messages: msgs,
                  stream: false,
                  format: "json",
                  keep_alive: "5m",
                  options: {
                    temperature:
                      request.temperature ?? config.defaultTemperature,
                    num_predict:
                      request.maxTokens ?? config.defaultMaxTokens,
                  },
                });
              },
              catch: (error) =>
                new LLMError({
                  message: `Ollama request failed: ${error}`,
                  provider: "ollama",
                  cause: error,
                }),
            });

            const content = response.message?.content ?? "";

            try {
              const parsed = JSON.parse(content);
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
            const client = await getClient();
            const embeddingModel =
              model ?? config.embeddingConfig.model ?? "nomic-embed-text";

            const response = await client.embed({
              model: embeddingModel,
              input: [...texts],
            });

            return response.embeddings;
          },
          catch: (error) =>
            new LLMError({
              message: `Embedding failed: ${error}`,
              provider: "ollama",
              cause: error,
            }),
        }),

      countTokens: (messages) =>
        Effect.gen(function* () {
          return yield* estimateTokenCount(messages);
        }),

      getModelConfig: () =>
        Effect.succeed({
          provider: "ollama" as const,
          model: defaultModel,
        }),
    });
  }),
);
