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
  ContentBlock,
} from "../types.js";
import { calculateCost, estimateTokenCount } from "../token-counter.js";
import { retryPolicy } from "../retry.js";
import { emitToolCallComplete } from "../streaming-helpers.js";
import { selectAdapter } from "../adapter.js";

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

    // Handle tool result messages
    if (msg.role === "tool") {
      result.push({
        role: "user",
        parts: [{
          functionResponse: {
            name: msg.toolName ?? "unknown_tool",
            response: { content: msg.content },
          },
        }],
      });
      continue;
    }

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
              name: (block as { name?: string }).name ?? "unknown_tool",
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
  cachedContentTokenCount?: number;
};

type GeminiFunctionCall = { name: string; args: unknown };

type GeminiRawResponse = {
  text: string;
  functionCalls?: GeminiFunctionCall[];
  usageMetadata?: GeminiUsage;
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string; thought?: boolean; functionCall?: GeminiFunctionCall }> };
  }>;
};

const NON_OK_FINISH_REASONS = new Set([
  "MAX_TOKENS",
  "SAFETY",
  "RECITATION",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "LANGUAGE",
  "MALFORMED_FUNCTION_CALL",
  "UNEXPECTED_TOOL_CALL",
  "OTHER",
]);

const explainGeminiFinishReason = (reason: string): string => {
  switch (reason) {
    case "UNEXPECTED_TOOL_CALL":
      return "The model attempted to call a tool but no tools were declared in the request.";
    case "MALFORMED_FUNCTION_CALL":
      return "The model produced a malformed tool call.";
    case "MAX_TOKENS":
      return "The output token budget was exhausted before any visible text was emitted (likely consumed by thinking-mode reasoning). Increase maxTokens or set thinkingConfig.thinkingBudget.";
    case "SAFETY":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
    case "SPII":
    case "RECITATION":
      return "The response was blocked by Gemini content filters.";
    case "LANGUAGE":
      return "Gemini blocked the response due to an unsupported language.";
    default:
      return "Unexpected stream termination.";
  }
};

// ─── Response Mapper ───

const mapGeminiResponse = (
  response: GeminiRawResponse,
  model: string,
  registry?: Record<string, { readonly input: number; readonly output: number }>,
): CompletionResponse => {
  // M12 Hook 1/7 — give the calibrated/tier ProviderAdapter first crack at
  // normalizing tool calls (e.g., Gemini args-as-string variants). When the
  // adapter returns undefined or no calibration is registered for `model`,
  // fall through to the default Gemini-shaped extraction. Pattern mirrors
  // local.ts:440-465.
  const { adapter: providerAdapter } = selectAdapter(
    { supportsToolCalling: true },
    "frontier",
    model,
  );
  const adapterParsed = providerAdapter.parseToolCalls?.(response, model);
  const toolCalls = adapterParsed
    ? adapterParsed.map((tc, i) => ({
        // Gemini synthesizes ids (`call_${i}`) — no original id to preserve.
        id: `call_${i}`,
        name: tc.name,
        input: tc.arguments,
      }))
    : response.functionCalls?.map((fc, i) => ({
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
      estimatedCost: calculateCost(
        inputTokens,
        outputTokens,
        model,
        {
          cached_content_token_count: response.usageMetadata?.cachedContentTokenCount,
        },
        registry,
      ),
    },
    model,
    toolCalls: toolCalls?.length ? toolCalls : undefined,
  };
};

// ─── Gemini Provider Layer ───

const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";

export const GeminiProviderLive = Layer.effect(
  LLMService,
  Effect.gen(function* () {
    const config = yield* LLMConfig;

    // ─── Lazy-load the SDK via dynamic import (interceptable by mock.module) ───

    type GeminiStreamChunk = {
      text: string;
      usageMetadata?: GeminiUsage;
      candidates?: Array<{
        finishReason?: string;
        content?: { parts?: Array<{ text?: string; thought?: boolean; functionCall?: GeminiFunctionCall }> };
      }>;
      functionCalls?: GeminiFunctionCall[];
    };

    type GoogleGenAIClient = {
      models: {
        generateContent: (opts: unknown) => Promise<GeminiRawResponse>;
        generateContentStream: (opts: unknown) => Promise<AsyncIterable<GeminiStreamChunk>>;
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
      responseMimeType?: string;
      responseSchema?: Record<string, unknown>;
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
      if (opts.responseMimeType) cfg.responseMimeType = opts.responseMimeType;
      if (opts.responseSchema) cfg.responseSchema = opts.responseSchema;
      return cfg;
    };

    return LLMService.of({
      complete: (request) =>
        Effect.gen(function* () {
          const client = yield* Effect.promise(() => getClient());
          let model = typeof request.model === 'string' 
            ? request.model 
            : request.model?.model ?? config.defaultModel;
          // If using non-Gemini default (e.g., Anthropic), fall back to Gemini default
          if (!model || model.startsWith("claude") || model.startsWith("gpt-")) {
            model = GEMINI_DEFAULT_MODEL;
          }
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

          // Mirror the streaming path: don't paper over non-OK finishReasons.
          // Without this guard, Gemini returns success+empty content when the
          // model wanted a tool but no tools were declared, or when the
          // safety filter trips, etc.
          const finishReason = response.candidates?.[0]?.finishReason;
          const hasContent = (response.text?.length ?? 0) > 0 || (response.functionCalls?.length ?? 0) > 0;
          if (finishReason && NON_OK_FINISH_REASONS.has(finishReason) && !hasContent) {
            return yield* Effect.fail(
              new LLMError({
                provider: "gemini",
                message: `Gemini response ended with finishReason=${finishReason} and no content. ${explainGeminiFinishReason(finishReason)}`,
              }),
            );
          }

          return mapGeminiResponse(response, model, config.pricingRegistry);
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
          let model = typeof request.model === 'string'
            ? request.model
            : request.model?.model ?? config.defaultModel;
          // If using non-Gemini default (e.g., Anthropic), fall back to Gemini default
          if (!model || model.startsWith("claude") || model.startsWith("gpt-")) {
            model = GEMINI_DEFAULT_MODEL;
          }
          const contents = toGeminiContents(request.messages);
          const systemPrompt =
            extractSystemPrompt(request.messages) ?? request.systemPrompt;

          // M12 Hook 1/7 — adapter selection decided up-front. When the
          // adapter supplies parseToolCalls we SUPPRESS per-chunk
          // emitToolCallComplete and synthesize start+delta pairs after the
          // for-await loop, once the adapter has normalized the accumulated
          // tool calls. See anthropic.ts stream() for the canonical comment.
          const { adapter: streamAdapter } = selectAdapter(
            { supportsToolCalling: true },
            "frontier",
            model,
          );
          const useAdapterNormalization =
            typeof streamAdapter.parseToolCalls === "function";

          return Stream.async<StreamEvent, LLMErrors>((emit) => {
            void (async () => {
              try {
                const client = await getClient();
                const cfg = buildGeminiConfig({
                  maxTokens: request.maxTokens,
                  temperature: request.temperature,
                  systemPrompt,
                  tools: request.tools,
                });
                if (process.env.RA_GEMINI_DEBUG === "1") {
                  process.stderr.write(`[gemini-debug] req model=${model} contents=${JSON.stringify(contents).slice(0,300)} sysLen=${(cfg as any).systemInstruction ? String((cfg as any).systemInstruction).length : 0} maxOut=${(cfg as any).maxOutputTokens} hasTools=${!!(cfg as any).tools?.length}\n`);
                }
                const stream = await client.models.generateContentStream({
                  model,
                  contents,
                  config: cfg,
                });

                let fullContent = "";
                let inputTokens = 0;
                let outputTokens = 0;
                let cachedContentTokens = 0;
                let lastFinishReason: string | undefined;
                const accumulatedToolCalls: { id: string; name: string; input: unknown }[] = [];
                // Raw functionCalls captured for adapter normalization at
                // end-of-stream. Populated only when useAdapterNormalization.
                const rawFunctionCalls: GeminiFunctionCall[] = [];

                for await (const chunk of stream) {
                  // Walk parts directly when present — Gemini-2.5-pro emits
                  // text + functionCall + thought parts mixed, and `chunk.text`
                  // strips function-call parts (logging a noisy SDK warning),
                  // while the legacy `chunk.functionCalls` accessor doesn't
                  // expose thought parts. Fall back to `chunk.text` +
                  // `chunk.functionCalls` when the SDK doesn't surface
                  // candidates (older SDK versions, lightweight mocks).
                  const parts = chunk.candidates?.[0]?.content?.parts ?? [];
                  const finishReason = chunk.candidates?.[0]?.finishReason;
                  if (finishReason) lastFinishReason = finishReason;

                  if (process.env.RA_GEMINI_DEBUG === "1") {
                    const u = chunk.usageMetadata as { candidatesTokenCount?: number; thoughtsTokenCount?: number } | undefined;
                    process.stderr.write(`[gemini-debug] chunk parts=${parts.length} cand=${u?.candidatesTokenCount ?? "-"} thoughts=${u?.thoughtsTokenCount ?? "-"} finish=${finishReason ?? "-"}\n`);
                    for (const [pi, p] of parts.entries()) {
                      const tag = (p as { thought?: boolean }).thought ? "thought" : (p as { functionCall?: unknown }).functionCall ? "functionCall" : "text";
                      process.stderr.write(`[gemini-debug]   part[${pi}] kind=${tag} text_len=${(p.text ?? "").length} preview="${(p.text ?? "").slice(0,80)}"\n`);
                    }
                  }

                  if (parts.length > 0) {
                    for (const part of parts) {
                      // Skip thought parts — they're not visible content.
                      if ((part as { thought?: boolean }).thought) continue;
                      // Visible text
                      if (typeof part.text === "string" && part.text.length > 0) {
                        emit.single({ type: "text_delta", text: part.text });
                        fullContent += part.text;
                      }
                      // Tool call
                      const fc = (part as { functionCall?: GeminiFunctionCall }).functionCall;
                      if (fc && typeof fc.name === "string") {
                        const tcId = `gemini-tc-${Date.now()}-${accumulatedToolCalls.length}`;
                        accumulatedToolCalls.push({ id: tcId, name: fc.name, input: fc.args });
                        if (useAdapterNormalization) {
                          rawFunctionCalls.push(fc);
                        } else {
                          emitToolCallComplete(emit, tcId, fc.name, fc.args);
                        }
                      }
                    }
                  } else {
                    // Fallback for chunks without candidates (older SDK or test mocks).
                    if (chunk.text && chunk.text.length > 0) {
                      emit.single({ type: "text_delta", text: chunk.text });
                      fullContent += chunk.text;
                    }
                    const fcs = chunk.functionCalls;
                    if (fcs && fcs.length > 0) {
                      for (const fc of fcs) {
                        const tcId = `gemini-tc-${Date.now()}-${accumulatedToolCalls.length}`;
                        accumulatedToolCalls.push({ id: tcId, name: fc.name, input: fc.args });
                        if (useAdapterNormalization) {
                          rawFunctionCalls.push(fc);
                        } else {
                          emitToolCallComplete(emit, tcId, fc.name, fc.args);
                        }
                      }
                    }
                  }

                  if (chunk.usageMetadata) {
                    inputTokens = chunk.usageMetadata.promptTokenCount ?? 0;
                    outputTokens =
                      chunk.usageMetadata.candidatesTokenCount ?? 0;
                    cachedContentTokens = (chunk.usageMetadata as { cachedContentTokenCount?: number }).cachedContentTokenCount ?? 0;
                  }
                }

                // Adapter-normalized end-of-stream tool-call synthesis. Build
                // a synthetic Gemini response shape so the adapter sees the
                // same shape it sees in complete(), then replace
                // accumulatedToolCalls with the normalized list and emit
                // start+delta pairs.
                if (useAdapterNormalization && rawFunctionCalls.length > 0) {
                  const syntheticResponse: GeminiRawResponse = {
                    text: fullContent,
                    functionCalls: rawFunctionCalls,
                  };
                  const normalized = streamAdapter.parseToolCalls?.(
                    syntheticResponse,
                    model,
                  );
                  if (normalized && normalized.length > 0) {
                    // Reset accumulatedToolCalls to the normalized projection
                    // so content_complete reflects post-adapter shape.
                    accumulatedToolCalls.length = 0;
                    for (let i = 0; i < normalized.length; i++) {
                      const tc = normalized[i]!;
                      const tcId = `gemini-tc-${Date.now()}-${i}`;
                      accumulatedToolCalls.push({
                        id: tcId,
                        name: tc.name,
                        input: tc.arguments,
                      });
                      emitToolCallComplete(emit, tcId, tc.name, tc.arguments);
                    }
                  } else {
                    // Adapter declined despite advertising parseToolCalls —
                    // fall back to raw events using the buffered functionCalls.
                    for (let i = 0; i < rawFunctionCalls.length; i++) {
                      const fc = rawFunctionCalls[i]!;
                      const tc = accumulatedToolCalls[i];
                      if (tc) {
                        emitToolCallComplete(emit, tc.id, fc.name, fc.args);
                      }
                    }
                  }
                }

                // Surface non-OK finishReasons explicitly. Without this, Gemini
                // returns success+empty when the model wanted a tool but no
                // tools were available (UNEXPECTED_TOOL_CALL), or when the
                // safety filter trips, or when the budget is exhausted before
                // any visible text is emitted.
                if (
                  lastFinishReason &&
                  NON_OK_FINISH_REASONS.has(lastFinishReason) &&
                  accumulatedToolCalls.length === 0 &&
                  fullContent.length === 0
                ) {
                  emit.single({
                    type: "error",
                    error: `Gemini stream ended with finishReason=${lastFinishReason} and no content. ${explainGeminiFinishReason(lastFinishReason)}`,
                  } as StreamEvent);
                  return;
                }

                const hasToolCalls = accumulatedToolCalls.length > 0;
                emit.single({
                  type: "content_complete",
                  content: fullContent,
                  ...(hasToolCalls ? { stopReason: "tool_use", toolCalls: accumulatedToolCalls } : {}),
                } as StreamEvent);
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
                      {
                        cached_content_token_count: cachedContentTokens || undefined,
                      },
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
          const jsonSchema = Schema.encodedSchema(request.outputSchema);
          const schemaObj = JSON.parse(JSON.stringify(jsonSchema));
          const schemaStr = JSON.stringify(schemaObj, null, 2);

          const client = yield* Effect.promise(() => getClient());
          let model = typeof request.model === 'string'
            ? request.model
            : request.model?.model ?? config.defaultModel;
          if (!model || model.startsWith("claude") || model.startsWith("gpt-")) {
            model = GEMINI_DEFAULT_MODEL;
          }

          const messagesWithFormat: LLMMessage[] = [
            ...request.messages,
            {
              role: "user" as const,
              content: `Respond with JSON matching this schema:\n${schemaStr}`,
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
                      content: `That response did not match the schema. Error: ${String(lastError)}. Please try again.`,
                    },
                  ];

            const response = yield* Effect.tryPromise({
              try: () =>
                client.models.generateContent({
                  model,
                  contents: toGeminiContents(msgs),
                  config: buildGeminiConfig({
                    maxTokens: request.maxTokens,
                    temperature: request.temperature,
                    systemPrompt: request.systemPrompt,
                    responseMimeType: "application/json",
                    responseSchema: schemaObj,
                  }),
                }),
              catch: toEffectError,
            });

            const mapped = mapGeminiResponse(response, model, config.pricingRegistry);

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

      getStructuredOutputCapabilities: () =>
        Effect.succeed({
          nativeJsonMode: true,
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
