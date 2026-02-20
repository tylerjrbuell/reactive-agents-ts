import { Effect, Layer, Stream, Schema } from "effect";
import { LLMService } from "./llm-service.js";
import type {
  CompletionResponse,
  StreamEvent,
  LLMMessage,
} from "./types.js";
import type { LLMErrors } from "./errors.js";

/**
 * Create a deterministic test LLM service.
 * Returns responses based on pattern matching against prompt content.
 *
 * Usage:
 * ```ts
 * const layer = TestLLMServiceLayer({
 *   "capital of France": "Paris",
 *   "plan": '{"goal":"test","steps":[]}',
 * });
 * ```
 */
export const TestLLMService = (
  responses: Record<string, string>,
): typeof LLMService.Service => ({
  complete: (request) =>
    Effect.gen(function* () {
      const lastMessage = request.messages[request.messages.length - 1];
      const content =
        lastMessage && typeof lastMessage.content === "string"
          ? lastMessage.content
          : "";

      // Also check systemPrompt for pattern matching
      const systemPrompt =
        typeof (request as any).systemPrompt === "string"
          ? (request as any).systemPrompt
          : "";
      const searchText = `${content} ${systemPrompt}`;

      // Match against registered patterns
      for (const [pattern, response] of Object.entries(responses)) {
        if (pattern.length > 0 && searchText.includes(pattern)) {
          return {
            content: response,
            stopReason: "end_turn" as const,
            usage: {
              inputTokens: Math.ceil(content.length / 4),
              outputTokens: Math.ceil(response.length / 4),
              totalTokens:
                Math.ceil(content.length / 4) +
                Math.ceil(response.length / 4),
              estimatedCost: 0,
            },
            model: "test-model",
          } satisfies CompletionResponse;
        }
      }

      // Default response
      return {
        content: "Test response",
        stopReason: "end_turn" as const,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          estimatedCost: 0,
        },
        model: "test-model",
      } satisfies CompletionResponse;
    }),

  stream: (_request) =>
    Effect.succeed(
      Stream.make(
        { type: "text_delta" as const, text: "Test " } satisfies StreamEvent,
        { type: "text_delta" as const, text: "response" } satisfies StreamEvent,
        {
          type: "content_complete" as const,
          content: "Test response",
        } satisfies StreamEvent,
        {
          type: "usage" as const,
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            estimatedCost: 0,
          },
        } satisfies StreamEvent,
      ) as Stream.Stream<StreamEvent, LLMErrors>,
    ),

  completeStructured: (request) =>
    Effect.gen(function* () {
      const lastMessage = request.messages[request.messages.length - 1];
      const content =
        lastMessage && typeof lastMessage.content === "string"
          ? lastMessage.content
          : "";

      // Try to find a matching response
      let responseContent = "Test response";
      for (const [pattern, response] of Object.entries(responses)) {
        if (content.includes(pattern)) {
          responseContent = response;
          break;
        }
      }

      const parsed = JSON.parse(responseContent);
      return Schema.decodeUnknownSync(request.outputSchema)(parsed);
    }),

  embed: (texts) =>
    Effect.succeed(
      texts.map(() => new Array(768).fill(0).map(() => Math.random())),
    ),

  countTokens: (messages) =>
    Effect.succeed(
      messages.reduce(
        (sum, m) =>
          sum +
          (typeof m.content === "string"
            ? Math.ceil(m.content.length / 4)
            : 100),
        0,
      ),
    ),

  getModelConfig: () =>
    Effect.succeed({
      provider: "anthropic" as const,
      model: "test-model",
    }),
});

/**
 * Create a test Layer for LLMService with optional pattern-matched responses.
 */
export const TestLLMServiceLayer = (
  responses: Record<string, string> = {},
) => Layer.succeed(LLMService, LLMService.of(TestLLMService(responses)));
