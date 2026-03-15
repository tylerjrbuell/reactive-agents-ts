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
  TokenLogprob,
} from "../types.js";
import { estimateTokenCount } from "../token-counter.js";
import { retryPolicy } from "../retry.js";
import { getProviderDefaultModel } from "../provider-defaults.js";

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
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool_calls?: Array<{
    function: { name: string; arguments: Record<string, any> };
  }>;
};

// ─── Conversion Helpers ───

const toOllamaMessages = (messages: readonly LLMMessage[]): OllamaMessage[] =>
  messages.map((m) => {
    // Tool result messages — pass through directly (Ollama supports role:"tool")
    if (m.role === "tool") {
      return { role: "tool" as const, content: m.content };
    }
    // Assistant messages — extract text and convert tool_use blocks to tool_calls
    if (m.role === "assistant") {
      const textContent =
        typeof m.content === "string"
          ? m.content
          : (m.content as readonly { type: string; text?: string }[])
              .filter(
                (b): b is { type: "text"; text: string } => b.type === "text",
              )
              .map((b) => b.text)
              .join("");
      const toolUseBlocks =
        typeof m.content !== "string"
          ? (
              m.content as readonly {
                type: string;
                name?: string;
                input?: unknown;
              }[]
            ).filter(
              (b): b is { type: "tool_use"; name: string; input: unknown } =>
                b.type === "tool_use",
            )
          : [];
      return {
        role: "assistant" as const,
        content: textContent,
        ...(toolUseBlocks.length > 0
          ? {
              tool_calls: toolUseBlocks.map((tc) => ({
                function: {
                  name: tc.name,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  arguments: (tc.input ?? {}) as Record<string, any>,
                },
              })),
            }
          : {}),
      };
    }
    // system, user
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

// ─── Thinking Auto-Detect ───

/** Cache for model thinking capability checks (avoids repeated /api/show calls) */
const thinkingCapabilityCache = new Map<string, boolean>();

/**
 * Check if an Ollama model supports thinking mode via /api/show.
 * Results are cached per model name.
 */
async function supportsThinking(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: { show: (opts: { model: string }) => Promise<any> },
  model: string,
): Promise<boolean> {
  const cached = thinkingCapabilityCache.get(model);
  if (cached !== undefined) return cached;

  try {
    const info = await client.show({ model });
    const template = (info.template ?? "") as string;
    const result =
      template.includes("think") || template.includes("<|thinking|>");
    thinkingCapabilityCache.set(model, result);
    return result;
  } catch {
    thinkingCapabilityCache.set(model, false);
    return false;
  }
}

/**
 * Resolve the `think` parameter for Ollama chat calls.
 * - config.thinking === true  → always enable
 * - config.thinking === false → always disable (omit param)
 * - config.thinking === undefined → auto-detect via /api/show
 */
async function resolveThinking(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: { show: (opts: { model: string }) => Promise<any> },
  model: string,
  configThinking: boolean | undefined,
): Promise<boolean | undefined> {
  if (configThinking === false) return undefined; // omit think param entirely
  if (configThinking === true) return true;
  // Auto-detect
  const capable = await supportsThinking(client, model);
  return capable ? true : undefined;
}

// ─── Error Helpers ───

/**
 * Detect Ollama "model not found" errors and produce an actionable message.
 * Ollama returns ResponseError with status 404 and message "model 'X' not found".
 */
function ollamaError(error: unknown, model?: string): LLMError {
  const msg = (error as { message?: string })?.message ?? String(error);
  const status =
    (error as { status_code?: number; statusCode?: number })?.status_code ??
    (error as { status_code?: number; statusCode?: number })?.statusCode;

  // Model not found — give the user a clear fix command
  if (status === 404 || /model\s+['"]?\S+['"]?\s+not found/i.test(msg)) {
    const modelName =
      model ??
      msg.match(/model\s+['"]?(\S+?)['"]?\s+not found/i)?.[1] ??
      "unknown";
    return new LLMError({
      message: `Model "${modelName}" not found locally. Run: ollama pull ${modelName}`,
      provider: "ollama",
      cause: error,
    });
  }

  return new LLMError({
    message: `Ollama request failed: ${msg}`,
    provider: "ollama",
    cause: error,
  });
}
// ─── Ollama / Local Provider Layer ───

export const LocalProviderLive = Layer.effect(
  LLMService,
  Effect.gen(function* () {
    const config = yield* LLMConfig;
    const endpoint = config.ollamaEndpoint ?? "http://localhost:11434";
    const defaultModel =
      config.defaultModel.startsWith("claude") ||
      config.defaultModel.startsWith("gpt")
        ? (getProviderDefaultModel("ollama") ?? "cogito:14b")
        : config.defaultModel;

    // Lazy-import the ollama SDK (same pattern as Gemini provider)
    const getClient = async () => {
      const { Ollama } = await import("ollama");
      return new Ollama({ host: endpoint });
    };

    return LLMService.of({
      complete: (request) =>
        Effect.gen(function* () {
          const model =
            typeof request.model === "string"
              ? request.model
              : (request.model?.model ?? defaultModel);

          const response = yield* Effect.tryPromise({
            try: async () => {
              const client = await getClient();

              const msgs = toOllamaMessages(request.messages);
              if (request.systemPrompt) {
                msgs.unshift({ role: "system", content: request.systemPrompt });
              }

              const think = await resolveThinking(
                client,
                model,
                config.thinking,
              );

              return client.chat({
                model,
                messages: msgs,
                tools: toOllamaTools(request.tools),
                stream: false,
                ...(think !== undefined ? { think } : {}),
                keep_alive: "5m",
                options: {
                  temperature: request.temperature ?? config.defaultTemperature,
                  num_predict: request.maxTokens ?? config.defaultMaxTokens,
                  stop: request.stopSequences
                    ? [...request.stopSequences]
                    : undefined,
                  ...(request.logprobs ? { logprobs: true } : {}),
                  ...(request.topLogprobs != null
                    ? { top_logprobs: request.topLogprobs }
                    : {}),
                },
              });
            },
            catch: (error) => ollamaError(error, model),
          });

          const content = response.message?.content ?? "";
          // Extract thinking from Ollama response (available in SDK v0.6+ for thinking models)
          const thinkingContent =
            (response.message as { thinking?: string } | undefined)?.thinking ||
            undefined;
          const inputTokens = response.prompt_eval_count ?? 0;
          const outputTokens = response.eval_count ?? 0;
          const toolCalls = parseToolCalls(
            response.message?.tool_calls as
              | Array<{
                  function: { name: string; arguments: unknown };
                }>
              | undefined,
          );

          const hasToolCalls = toolCalls && toolCalls.length > 0;

          // Extract logprobs from Ollama response if present
          const rawLogprobs = (
            response as {
              logprobs?: Array<{
                token: string;
                logprob: number;
                top_logprobs?: Array<{ token: string; logprob: number }>;
              }>;
            }
          ).logprobs;
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
            ...(thinkingContent ? { thinking: thinkingContent } : {}),
            ...(logprobs ? { logprobs } : {}),
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
          const model =
            typeof request.model === "string"
              ? request.model
              : (request.model?.model ?? defaultModel);

          return Stream.async<StreamEvent, LLMErrors>((emit) => {
            const doStream = async () => {
              try {
                const client = await getClient();

                const msgs = toOllamaMessages(request.messages);
                if (request.systemPrompt) {
                  msgs.unshift({
                    role: "system",
                    content: request.systemPrompt,
                  });
                }

                const think = await resolveThinking(
                  client,
                  model,
                  config.thinking,
                );

                const wantLogprobs = request.logprobs ?? false;
                const stream = await client.chat({
                  model,
                  messages: msgs,
                  tools: toOllamaTools(request.tools),
                  stream: true,
                  ...(think !== undefined ? { think } : {}),
                  keep_alive: "5m",
                  options: {
                    temperature:
                      request.temperature ?? config.defaultTemperature,
                    num_predict: request.maxTokens ?? config.defaultMaxTokens,
                    ...(wantLogprobs ? { logprobs: true } : {}),
                  },
                });

                let fullContent = "";
                const accumulatedLogprobs: TokenLogprob[] = [];

                for await (const chunk of stream) {
                  if (chunk.message?.content) {
                    fullContent += chunk.message.content;
                    emit.single({
                      type: "text_delta",
                      text: chunk.message.content,
                    });
                  }

                  // Accumulate per-chunk logprobs when available
                  if (wantLogprobs) {
                    const chunkLp = (chunk as any).logprobs;
                    if (Array.isArray(chunkLp)) {
                      for (const lp of chunkLp) {
                        accumulatedLogprobs.push({
                          token: lp.token,
                          logprob: lp.logprob,
                          ...(lp.top_logprobs
                            ? { topLogprobs: lp.top_logprobs.map((t: any) => ({ token: t.token, logprob: t.logprob })) }
                            : {}),
                        });
                      }
                    }
                  }

                  if (chunk.done) {
                    emit.single({
                      type: "content_complete",
                      content: fullContent,
                    });
                    if (accumulatedLogprobs.length > 0) {
                      emit.single({
                        type: "logprobs",
                        logprobs: accumulatedLogprobs,
                      });
                    }
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
                emit.fail(ollamaError(error, model));
              }
            };
            void doStream();
          });
        }),

      completeStructured: (request) =>
        Effect.gen(function* () {
          const encodedSchema = Schema.encodedSchema(request.outputSchema);
          const schemaObj = JSON.parse(JSON.stringify(encodedSchema));
          const schemaStr = JSON.stringify(schemaObj, null, 2);

          // Build Ollama-native format constraint.
          // Ollama SDK ≥0.5 supports format: { type: "object", properties: ... }
          // for schema-enforced JSON output (GBNF grammar under the hood).
          // Fall back to format: "json" if the schema doesn't have properties.
          const ollamaFormat: "json" | Record<string, unknown> =
            schemaObj && typeof schemaObj === "object" && schemaObj.properties
              ? (schemaObj as Record<string, unknown>)
              : "json";

          const model =
            typeof request.model === "string"
              ? request.model
              : (request.model?.model ?? defaultModel);

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
                  format: ollamaFormat,
                  keep_alive: "5m",
                  options: {
                    temperature:
                      request.temperature ?? config.defaultTemperature,
                    num_predict: request.maxTokens ?? config.defaultMaxTokens,
                  },
                });
              },
              catch: (error) => ollamaError(error, model),
            });

            const content = response.message?.content ?? "";

            try {
              const parsed = JSON.parse(content);
              const decoded = Schema.decodeUnknownEither(request.outputSchema)(
                parsed,
              );

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
            ollamaError(
              error,
              model ?? config.embeddingConfig.model ?? "nomic-embed-text",
            ),
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

      getStructuredOutputCapabilities: () =>
        Effect.succeed({
          nativeJsonMode: true,
          jsonSchemaEnforcement: true,
          prefillSupport: false,
          grammarConstraints: true,
        }),
    });
  }),
);
