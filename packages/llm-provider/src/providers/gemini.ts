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
  ContentBlock,
} from "../types.js";
import { calculateCost, estimateTokenCount } from "../token-counter.js";
import { retryPolicy } from "../retry.js";

// ─── Gemini Message Conversion Helpers ───

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: unknown } }
  | { functionResponse: { name: string; response: unknown } };

type GeminiContent = {
  role: "user" | "model";
  parts: GeminiPart[];
};

const toGeminiContents = (messages: readonly LLMMessage[]): GeminiContent[] => {
  const result: GeminiContent[] = [];

  for (const msg of messages) {
    if (msg.role === "system") continue; // handled via config.systemInstruction

    const role = msg.role === "assistant" ? "model" : "user";

    if (typeof msg.content === "string") {
      result.push({ role, parts: [{ text: msg.content }] });
    } else {
      const parts: GeminiPart[] = [];
      for (const block of msg.content as readonly ContentBlock[]) {
        if (block.type === "text") {
          parts.push({ text: block.text });
        } else if (block.type === "tool_use") {
          parts.push({
            functionCall: { name: block.name, args: block.input },
          });
        } else if (block.type === "tool_result") {
          parts.push({
            functionResponse: {
              name: "tool",
              response: { content: block.content },
            },
          });
        }
        // images not converted — Gemini multimodal requires separate file URIs
      }
      if (parts.length > 0) {
        result.push({ role, parts });
      }
    }
  }

  return result;
};

const extractSystemPrompt = (
  messages: readonly LLMMessage[],
): string | undefined => {
  const sys = messages.find((m) => m.role === "system");
  if (!sys) return undefined;
  return typeof sys.content === "string" ? sys.content : undefined;
};

const toGeminiTools = (
  tools: { name: string; description: string; inputSchema: Record<string, unknown> }[],
) =>
  tools.length === 0
    ? undefined
    : [
        {
          functionDeclarations: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: { type: "object", ...t.inputSchema },
          })),
        },
      ];

const toEffectError = (error: unknown): LLMErrors => {
  const err = error as { status?: number; code?: number; message?: string };
  if (err.status === 429 || err.code === 429) {
    return new LLMRateLimitError({
      message: err.message ?? "Rate limit exceeded",
      provider: "gemini",
      retryAfterMs: 60_000,
    });
  }
  return new LLMError({
    message: err.message ?? String(error),
    provider: "gemini",
    cause: error,
  });
};

// ─── Gemini Response Types ───

type GeminiUsage = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
};

type GeminiFunctionCall = { name: string; args: unknown };

type GeminiRawResponse = {
  text: string;
  functionCalls?: GeminiFunctionCall[];
  usageMetadata?: GeminiUsage;
};

// ─── Response Mapper ───

const mapGeminiResponse = (
  response: GeminiRawResponse,
  model: string,
): CompletionResponse => {
  const toolCalls = response.functionCalls?.map((fc, i) => ({
    id: `call_${i}`,
    name: fc.name,
    input: fc.args,
  }));

  const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;

  return {
    content: response.text ?? "",
    stopReason: toolCalls?.length ? "tool_use" : "end_turn",
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      estimatedCost: calculateCost(inputTokens, outputTokens, model),
    },
    model,
    toolCalls: toolCalls?.length ? toolCalls : undefined,
  };
};

// ─── Gemini Provider Layer ───

export const GeminiProviderLive = Layer.effect(
  LLMService,
  Effect.gen(function* () {
    const config = yield* LLMConfig;

    // ─── Lazy-load the SDK via dynamic import (interceptable by mock.module) ───

    type GoogleGenAIClient = {
      models: {
        generateContent: (opts: unknown) => Promise<GeminiRawResponse>;
        generateContentStream: (opts: unknown) => Promise<
          AsyncIterable<{
            text: string;
            usageMetadata?: GeminiUsage;
          }>
        >;
        embedContent: (opts: unknown) => Promise<{
          embeddings: Array<{ values: number[] }>;
        }>;
      };
    };

    type GoogleGenAIModule = {
      GoogleGenAI: new (opts: { apiKey?: string }) => GoogleGenAIClient;
    };

    let _clientPromise: Promise<GoogleGenAIClient> | null = null;
    const getClient = (): Promise<GoogleGenAIClient> => {
      if (!_clientPromise) {
        _clientPromise = (
          import("@google/genai") as Promise<GoogleGenAIModule>
        ).then(({ GoogleGenAI }) => new GoogleGenAI({ apiKey: config.googleApiKey }));
      }
      return _clientPromise;
    };

    const buildGeminiConfig = (opts: {
      maxTokens?: number;
      temperature?: number;
      systemPrompt?: string;
      stopSequences?: readonly string[];
      tools?: readonly { name: string; description: string; inputSchema: Record<string, unknown> }[];
    }) => {
      const cfg: Record<string, unknown> = {
        maxOutputTokens: opts.maxTokens ?? config.defaultMaxTokens,
        temperature: opts.temperature ?? config.defaultTemperature,
      };
      const sys = opts.systemPrompt;
      if (sys) cfg.systemInstruction = sys;
      if (opts.stopSequences?.length) cfg.stopSequences = [...opts.stopSequences];
      if (opts.tools?.length) {
        cfg.tools = toGeminiTools([...opts.tools]);
      }
      return cfg;
    };

    return LLMService.of({
      complete: (request) =>
        Effect.gen(function* () {
          const client = yield* Effect.promise(() => getClient());
          const model = request.model?.model ?? config.defaultModel;
          const contents = toGeminiContents(request.messages);
          const systemPrompt =
            extractSystemPrompt(request.messages) ?? request.systemPrompt;

          const response = yield* Effect.tryPromise({
            try: () =>
              client.models.generateContent({
                model,
                contents,
                config: buildGeminiConfig({
                  maxTokens: request.maxTokens,
                  temperature: request.temperature,
                  systemPrompt,
                  stopSequences: request.stopSequences,
                  tools: request.tools,
                }),
              }),
            catch: toEffectError,
          });

          return mapGeminiResponse(response, model);
        }).pipe(
          Effect.retry(retryPolicy),
          Effect.timeout("30 seconds"),
          Effect.catchTag("TimeoutException", () =>
            Effect.fail(
              new LLMTimeoutError({
                message: "LLM request timed out",
                provider: "gemini",
                timeoutMs: 30_000,
              }),
            ),
          ),
        ),

      stream: (request) =>
        Effect.gen(function* () {
          const model = request.model?.model ?? config.defaultModel;
          const contents = toGeminiContents(request.messages);
          const systemPrompt =
            extractSystemPrompt(request.messages) ?? request.systemPrompt;

          return Stream.async<StreamEvent, LLMErrors>((emit) => {
            void (async () => {
              try {
                const client = await getClient();
                const stream = await client.models.generateContentStream({
                  model,
                  contents,
                  config: buildGeminiConfig({
                    maxTokens: request.maxTokens,
                    temperature: request.temperature,
                    systemPrompt,
                  }),
                });

                let fullContent = "";
                let inputTokens = 0;
                let outputTokens = 0;

                for await (const chunk of stream) {
                  if (chunk.text) {
                    emit.single({ type: "text_delta", text: chunk.text });
                    fullContent += chunk.text;
                  }
                  if (chunk.usageMetadata) {
                    inputTokens = chunk.usageMetadata.promptTokenCount ?? 0;
                    outputTokens =
                      chunk.usageMetadata.candidatesTokenCount ?? 0;
                  }
                }

                emit.single({ type: "content_complete", content: fullContent });
                emit.single({
                  type: "usage",
                  usage: {
                    inputTokens,
                    outputTokens,
                    totalTokens: inputTokens + outputTokens,
                    estimatedCost: calculateCost(inputTokens, outputTokens, model),
                  },
                });
                emit.end();
              } catch (error) {
                const err = error as { message?: string };
                emit.fail(
                  new LLMError({
                    message: err.message ?? String(error),
                    provider: "gemini",
                    cause: error,
                  }),
                );
              }
            })();
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

            const client = yield* Effect.promise(() => getClient());
            const model = request.model?.model ?? config.defaultModel;

            const response = yield* Effect.tryPromise({
              try: () =>
                client.models.generateContent({
                  model,
                  contents: toGeminiContents(msgs),
                  config: buildGeminiConfig({
                    maxTokens: request.maxTokens,
                    temperature: request.temperature,
                    systemPrompt: request.systemPrompt,
                  }),
                }),
              catch: toEffectError,
            });

            const mapped = mapGeminiResponse(response, model);

            try {
              const parsed = JSON.parse(mapped.content);
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
            const embeddingModel = model ?? "gemini-embedding-001";

            const result = await client.models.embedContent({
              model: embeddingModel,
              contents: [...texts],
              config: {
                outputDimensionality: config.embeddingConfig.dimensions,
              },
            });

            return result.embeddings.map((e) => e.values);
          },
          catch: (error) =>
            new LLMError({
              message: `Embedding failed: ${error}`,
              provider: "gemini",
              cause: error,
            }),
        }),

      countTokens: (messages) =>
        Effect.gen(function* () {
          return yield* estimateTokenCount(messages);
        }),

      getModelConfig: () =>
        Effect.succeed({
          provider: "gemini" as const,
          model: config.defaultModel,
        }),
    });
  }),
);
