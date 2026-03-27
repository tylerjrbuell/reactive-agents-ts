import { Effect, Layer, Stream } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type {
  CompletionResponse,
  StreamEvent,
} from "@reactive-agents/llm-provider";
import type { MockLLMRule } from "../types.js";

export interface LLMCall {
  readonly messages: readonly { role: string; content: unknown }[];
  readonly response: string;
}

/**
 * Create a mock LLM service with pattern-matching rules.
 * Rules are matched in order; first match wins.
 * If no rule matches, returns "FINAL ANSWER: mock response".
 */
export function createMockLLM(rules: MockLLMRule[]) {
  const calls: LLMCall[] = [];

  const findMatch = (
    text: string,
  ): { response: string; tokens?: number } | undefined => {
    for (const rule of rules) {
      if (typeof rule.match === "string") {
        if (text.includes(rule.match)) {
          return { response: rule.response, tokens: rule.tokens };
        }
      } else {
        if (rule.match.test(text)) {
          return { response: rule.response, tokens: rule.tokens };
        }
      }
    }
    return undefined;
  };

  const service = {
    complete: (request: {
      messages: readonly { role: string; content: unknown }[];
      systemPrompt?: string;
    }) =>
      Effect.gen(function* () {
        const lastMessage = request.messages[request.messages.length - 1];
        const content =
          lastMessage && typeof lastMessage.content === "string"
            ? lastMessage.content
            : "";

        const systemPrompt =
          typeof request.systemPrompt === "string" ? request.systemPrompt : "";
        const searchText = `${content} ${systemPrompt}`;

        const matched = findMatch(searchText);
        const response = matched?.response ?? "FINAL ANSWER: mock response";
        const tokens = matched?.tokens ?? Math.ceil(response.length / 4);

        calls.push({ messages: request.messages, response });

        return {
          content: response,
          stopReason: "end_turn" as const,
          usage: {
            inputTokens: Math.ceil(content.length / 4),
            outputTokens: tokens,
            totalTokens: Math.ceil(content.length / 4) + tokens,
            estimatedCost: 0,
          },
          model: "mock",
        } satisfies CompletionResponse;
      }),

    stream: (request: {
      messages: readonly { role: string; content: unknown }[];
    }) =>
      Effect.gen(function* () {
        const lastMessage = request.messages[request.messages.length - 1];
        const content =
          lastMessage && typeof lastMessage.content === "string"
            ? lastMessage.content
            : "";

        const matched = findMatch(content);
        const response = matched?.response ?? "FINAL ANSWER: mock response";

        calls.push({ messages: request.messages, response });

        return Stream.make(
          { type: "text_delta" as const, text: response } satisfies StreamEvent,
          {
            type: "content_complete" as const,
            content: response,
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
        ) as Stream.Stream<StreamEvent, never>;
      }),

    completeStructured: (_request: unknown) => Effect.succeed({} as never),

    embed: (texts: readonly string[]) =>
      Effect.succeed(texts.map(() => new Array(768).fill(0))),

    countTokens: (messages: readonly { content: unknown }[]) =>
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
        model: "mock",
        contextWindow: 8000,
        id: "mock",
      }),
  };

  const layer = Layer.succeed(LLMService, service as any);

  return {
    layer,
    service,
    calls,
    get callCount() {
      return calls.length;
    },
    reset() {
      calls.length = 0;
    },
  };
}

/**
 * Convenience: create a mock LLM from a simple pattern->response map.
 */
export function createMockLLMFromMap(responses: Record<string, string>) {
  const rules: MockLLMRule[] = Object.entries(responses).map(
    ([match, response]) => ({
      match,
      response,
    }),
  );
  return createMockLLM(rules);
}

/**
 * Create a test LLM Layer that returns responses in sequence.
 * Each call to `complete()` returns the next response in the array.
 * After all responses are exhausted, repeats the last one.
 *
 * Useful for testing services that make a fixed number of LLM calls.
 */
export function createTestLLMServiceLayer(
  responses: Array<{ content: string; stopReason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" }>,
): Layer.Layer<LLMService> {
  let index = 0;

  const service = {
    complete: (_request: {
      messages: readonly { role: string; content: unknown }[];
      systemPrompt?: string;
    }) =>
      Effect.gen(function* () {
        const resp = responses[index] ?? responses[responses.length - 1];
        if (index < responses.length - 1) index++;

        return {
          content: resp?.content ?? "",
          stopReason: (resp?.stopReason ?? "end_turn") as CompletionResponse["stopReason"],
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            estimatedCost: 0,
          },
          model: "mock",
        } satisfies CompletionResponse;
      }),

    stream: (_request: {
      messages: readonly { role: string; content: unknown }[];
    }) =>
      Effect.gen(function* () {
        const resp = responses[index] ?? responses[responses.length - 1];
        if (index < responses.length - 1) index++;
        const content = resp?.content ?? "";

        return Stream.make(
          { type: "text_delta" as const, text: content } satisfies StreamEvent,
          { type: "content_complete" as const, content } satisfies StreamEvent,
          {
            type: "usage" as const,
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 },
          } satisfies StreamEvent,
        ) as Stream.Stream<StreamEvent, never>;
      }),

    completeStructured: (_request: unknown) => Effect.succeed({} as never),

    embed: (texts: readonly string[]) =>
      Effect.succeed(texts.map(() => new Array(768).fill(0))),

    countTokens: (_messages: readonly { content: unknown }[]) =>
      Effect.succeed(0),

    getModelConfig: () =>
      Effect.succeed({
        provider: "anthropic" as const,
        model: "mock",
        contextWindow: 8000,
        id: "mock",
      }),

    getStructuredOutputCapabilities: () =>
      Effect.succeed({
        supportsNativeJson: false,
        supportsJsonMode: false,
        supportsToolForcing: false,
      }),

    capabilities: () =>
      Effect.succeed({
        supportsToolCalling: true,
        supportsStreaming: true,
        supportsStructuredOutput: false,
        supportsLogprobs: false,
      }),
  };

  return Layer.succeed(LLMService, service as any);
}
