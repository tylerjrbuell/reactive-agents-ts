import { Effect, Layer, Stream, Schema } from "effect";
import { LLMService } from "../llm-service.js";
import { LLMConfig } from "../llm-config.js";
import { LLMError, LLMTimeoutError, LLMParseError } from "../errors.js";
import type { LLMErrors } from "../errors.js";
import type {
  CompletionResponse,
  StreamEvent,
  LLMMessage,
} from "../types.js";
import { estimateTokenCount } from "../token-counter.js";
import { retryPolicy } from "../retry.js";

// ─── Ollama Message Conversion ───

type OllamaMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const toOllamaMessages = (
  messages: readonly LLMMessage[],
): OllamaMessage[] =>
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

    return LLMService.of({
      complete: (request) =>
        Effect.gen(function* () {
          const model = typeof request.model === 'string'
            ? request.model
            : request.model?.model ?? defaultModel;

          const response = yield* Effect.tryPromise({
            try: async () => {
              const res = await fetch(`${endpoint}/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  model,
                  messages: toOllamaMessages(request.messages),
                  stream: false,
                  options: {
                    temperature:
                      request.temperature ?? config.defaultTemperature,
                    num_predict:
                      request.maxTokens ?? config.defaultMaxTokens,
                    stop: request.stopSequences
                      ? [...request.stopSequences]
                      : undefined,
                  },
                }),
              });

              if (!res.ok) {
                throw new Error(
                  `Ollama request failed: ${res.status} ${res.statusText}`,
                );
              }

              return (await res.json()) as OllamaRawResponse;
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

          return {
            content,
            stopReason: response.done_reason === "stop"
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
          } satisfies CompletionResponse;
        }).pipe(
          Effect.retry(retryPolicy),
          Effect.timeout("60 seconds"),
          Effect.catchTag("TimeoutException", () =>
            Effect.fail(
              new LLMTimeoutError({
                message: "Local LLM request timed out",
                provider: "ollama",
                timeoutMs: 60_000,
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
                const res = await fetch(`${endpoint}/api/chat`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    model,
                    messages: toOllamaMessages(request.messages),
                    stream: true,
                    options: {
                      temperature:
                        request.temperature ?? config.defaultTemperature,
                      num_predict:
                        request.maxTokens ?? config.defaultMaxTokens,
                    },
                  }),
                });

                if (!res.ok || !res.body) {
                  throw new Error(`Ollama stream failed: ${res.status}`);
                }

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let fullContent = "";

                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;

                  const lines = decoder
                    .decode(value, { stream: true })
                    .split("\n")
                    .filter(Boolean);

                  for (const line of lines) {
                    const parsed = JSON.parse(line) as {
                      message?: { content: string };
                      done: boolean;
                      prompt_eval_count?: number;
                      eval_count?: number;
                    };

                    if (parsed.message?.content) {
                      fullContent += parsed.message.content;
                      emit.single({
                        type: "text_delta",
                        text: parsed.message.content,
                      });
                    }

                    if (parsed.done) {
                      emit.single({
                        type: "content_complete",
                        content: fullContent,
                      });
                      emit.single({
                        type: "usage",
                        usage: {
                          inputTokens: parsed.prompt_eval_count ?? 0,
                          outputTokens: parsed.eval_count ?? 0,
                          totalTokens:
                            (parsed.prompt_eval_count ?? 0) +
                            (parsed.eval_count ?? 0),
                          estimatedCost: 0,
                        },
                      });
                      emit.end();
                    }
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

          const messagesWithFormat: LLMMessage[] = [
            ...request.messages,
            {
              role: "user" as const,
              content: `\nRespond with ONLY valid JSON matching this schema:\n${schemaStr}\n\nNo markdown, no code fences, just raw JSON.`,
            },
          ];

          let lastError: unknown = null;
          const maxRetries = request.maxParseRetries ?? 2;

          // Use self-reference via the service itself
          const llm: { complete: typeof LLMService.Service["complete"] } = {
            complete: (req) =>
              Effect.gen(function* () {
                const model = req.model?.model ?? defaultModel;
                const res = yield* Effect.tryPromise({
                  try: async () => {
                    const resp = await fetch(`${endpoint}/api/chat`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        model,
                        messages: toOllamaMessages(req.messages),
                        stream: false,
                        options: {
                          temperature:
                            req.temperature ?? config.defaultTemperature,
                          num_predict:
                            req.maxTokens ?? config.defaultMaxTokens,
                        },
                      }),
                    });
                    return (await resp.json()) as OllamaRawResponse;
                  },
                  catch: (error) =>
                    new LLMError({
                      message: `Ollama request failed: ${error}`,
                      provider: "ollama",
                      cause: error,
                    }),
                });
                const content = res.message?.content ?? "";
                const inputTokens = res.prompt_eval_count ?? 0;
                const outputTokens = res.eval_count ?? 0;
                return {
                  content,
                  stopReason: "end_turn" as const,
                  usage: {
                    inputTokens,
                    outputTokens,
                    totalTokens: inputTokens + outputTokens,
                    estimatedCost: 0,
                  },
                  model: res.model ?? model,
                } satisfies CompletionResponse;
              }),
          };

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

            const response = yield* llm.complete({
              ...request,
              messages: msgs,
            });

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
            const embeddingModel =
              model ?? config.embeddingConfig.model ?? "nomic-embed-text";
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

// ─── Ollama Raw Response ───

type OllamaRawResponse = {
  model: string;
  message?: { content: string; role: string };
  done: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
};
