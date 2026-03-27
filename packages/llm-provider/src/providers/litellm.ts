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
  | { role: "system" | "user" | "assistant"; content: string }
  | { role: "tool"; tool_call_id: string; content: string };

const toLiteLLMMessages = (
  messages: readonly LLMMessage[],
): LiteLLMMessage[] =>
  messages.map((m) => {
    if (m.role === "tool") {
      return {
        role: "tool" as const,
        tool_call_id: m.toolCallId,
        content: m.content,
      };
    }
    return {
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
    };
  });

const toEffectError = (error: unknown): LLMErrors => {
  const err = error as { status?: number; message?: string };
  if (err.status === 429) {
    return new LLMRateLimitError({
      message: err.message ?? "Rate limit exceeded",
      provider: "litellm",
      retryAfterMs: 60_000,
    });
  }
  return new LLMError({
    message: err.message ?? String(error),
    provider: "litellm",
    cause: error,
  });
};

const toLiteLLMTool = (tool: ToolDefinition) => ({
  type: "function" as const,
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
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
): Promise<unknown> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
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
      (config as unknown as { litellmBaseUrl?: string }).litellmBaseUrl ??
      process.env.LITELLM_BASE_URL ??
      "http://localhost:4000";
    const apiKey =
      (config as unknown as { litellmApiKey?: string }).litellmApiKey ??
      process.env.LITELLM_API_KEY ??
      undefined;

    const defaultModel = config.defaultModel;

    return LLMService.of({
      complete: (request) =>
        Effect.gen(function* () {
          const model =
            typeof request.model === "string"
              ? request.model
              : request.model?.model ?? defaultModel;

          const messages = toLiteLLMMessages(request.messages);
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
            requestBody.tools = request.tools.map(toLiteLLMTool);
          }

          const response = yield* Effect.tryPromise({
            try: () =>
              liteLLMFetch(baseURL, "/chat/completions", requestBody, apiKey),
            catch: (error) => toEffectError(error),
          });

          return mapLiteLLMResponse(
            response as LiteLLMRawResponse,
            model,
            config.pricingRegistry,
          );
        }).pipe(
          Effect.retry(retryPolicy),
          Effect.timeout("30 seconds"),
          Effect.catchTag("TimeoutException", () =>
            Effect.fail(
              new LLMTimeoutError({
                message: "LLM request timed out",
                provider: "litellm",
                timeoutMs: 30_000,
              }),
            ),
          ),
        ),

      stream: (request) =>
        Effect.gen(function* () {
          const model =
            typeof request.model === "string"
              ? request.model
              : request.model?.model ?? defaultModel;

          return Stream.async<StreamEvent, LLMErrors>((emit) => {
            const doStream = async () => {
              try {
                const headers: Record<string, string> = {
                  "Content-Type": "application/json",
                };
                if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

                const messages = toLiteLLMMessages(request.messages);
                if (request.systemPrompt) {
                  messages.unshift({
                    role: "system",
                    content: request.systemPrompt,
                  });
                }

                const res = await fetch(`${baseURL}/chat/completions`, {
                  method: "POST",
                  headers,
                  body: JSON.stringify({
                    model,
                    max_tokens:
                      request.maxTokens ?? config.defaultMaxTokens,
                    temperature:
                      request.temperature ?? config.defaultTemperature,
                    messages,
                    stream: true,
                  }),
                });

                if (!res.ok || !res.body) {
                  throw new Error(`LiteLLM stream error: ${res.status}`);
                }

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";
                let fullContent = "";

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
                      emit.single({
                        type: "content_complete",
                        content: fullContent,
                      });
                      emit.end();
                      return;
                    }

                    try {
                      const chunk = JSON.parse(data) as {
                        choices: Array<{
                          delta: { content?: string };
                          finish_reason?: string;
                        }>;
                        usage?: {
                          prompt_tokens: number;
                          completion_tokens: number;
                        };
                      };

                      const delta = chunk.choices[0]?.delta?.content;
                      if (delta) {
                        fullContent += delta;
                        emit.single({ type: "text_delta", text: delta });
                      }

                      if (chunk.choices[0]?.finish_reason) {
                        const inputTokens =
                          chunk.usage?.prompt_tokens ?? 0;
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
                              undefined,
                              config.pricingRegistry,
                            ),
                          },
                        });
                      }
                    } catch {
                      // Skip invalid JSON chunks
                    }
                  }
                }
              } catch (error) {
                const err = error as { message?: string };
                emit.fail(
                  new LLMError({
                    message: err.message ?? String(error),
                    provider: "litellm",
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

            const model =
              typeof request.model === "string"
                ? request.model
                : request.model?.model ?? defaultModel;

            const completeResult = yield* Effect.tryPromise({
              try: () =>
                liteLLMFetch(
                  baseURL,
                  "/chat/completions",
                  {
                    model,
                    max_tokens:
                      request.maxTokens ?? config.defaultMaxTokens,
                    temperature:
                      request.temperature ?? config.defaultTemperature,
                    messages: toLiteLLMMessages(msgs),
                  },
                  apiKey,
                ),
              catch: (error) => toEffectError(error),
            });

            const response = mapLiteLLMResponse(
              completeResult as LiteLLMRawResponse,
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
        } satisfies ProviderCapabilities),
    });
  }),
);
