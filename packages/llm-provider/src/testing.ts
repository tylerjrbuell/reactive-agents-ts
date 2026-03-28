import { Effect, Layer, Stream, Schema } from "effect";
import { LLMService } from "./llm-service.js";
import type {
  CompletionResponse,
  StreamEvent,
  LLMMessage,
} from "./types.js";
import type { LLMErrors } from "./errors.js";
import { DEFAULT_CAPABILITIES } from "./capabilities.js";

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface ToolCallSpec {
  name: string;
  args: Record<string, unknown>;
  id?: string; // auto-generated "call-<matchedIndex>-<i>" if omitted
}

export type TestTurn =
  | { text: string; match?: string }
  | { json: unknown; match?: string }
  | { toolCall: ToolCallSpec; match?: string }
  | { toolCalls: ToolCallSpec[]; match?: string }
  | { error: string; match?: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fakeUsage(inputLen: number, outputLen: number) {
  return {
    inputTokens: Math.ceil(inputLen / 4),
    outputTokens: Math.ceil(outputLen / 4),
    totalTokens: Math.ceil(inputLen / 4) + Math.ceil(outputLen / 4),
    estimatedCost: 0,
  };
}

function extractSearchText(
  messages: readonly LLMMessage[],
  request: { systemPrompt?: string },
): string {
  const lastMessage = messages[messages.length - 1];
  const content =
    lastMessage && typeof lastMessage.content === "string"
      ? lastMessage.content
      : "";
  const systemPrompt =
    typeof request.systemPrompt === "string"
      ? request.systemPrompt
      : "";
  return `${content} ${systemPrompt}`.trim();
}

function resolveTurn(
  scenario: TestTurn[],
  callIndex: { value: number },
  searchText: string,
): { turn: TestTurn; matchedIndex: number } {
  for (let i = callIndex.value; i < scenario.length; i++) {
    const turn = scenario[i];
    const guard = turn.match;
    if (!guard || new RegExp(guard, "i").test(searchText)) {
      callIndex.value = Math.min(i + 1, scenario.length - 1);
      return { turn, matchedIndex: i };
    }
  }
  // Nothing matched from callIndex onward — repeat last turn
  return { turn: scenario[scenario.length - 1], matchedIndex: scenario.length - 1 };
}

function buildToolCalls(
  specs: ToolCallSpec[],
  matchedIndex: number,
): Array<{ id: string; name: string; input: unknown }> {
  return specs.map((spec, i) => ({
    id: spec.id ?? `call-${matchedIndex}-${i}`,
    name: spec.name,
    input: spec.args,
  }));
}

// ─── Service Factory ──────────────────────────────────────────────────────────

/**
 * Create a deterministic test LLM service using a scenario of sequential turns.
 *
 * Turns are consumed in order. Each LLM call scans forward from the current
 * position for the first matching turn (or unconditional turn). The last turn
 * repeats when the scenario is exhausted, so single-turn tests need no special
 * handling.
 *
 * Usage:
 * ```ts
 * const layer = TestLLMServiceLayer([
 *   { toolCall: { name: "web-search", args: { query: "AI news" } } },
 *   { text: "Here is the summary..." },
 * ]);
 * ```
 */
export const TestLLMService = (
  scenario: TestTurn[],
): typeof LLMService.Service => {
  // Mutable cursor — safe because each build() creates a fresh Layer instance
  const callIndex = { value: 0 };

  return {
    complete: (request) =>
      Effect.gen(function* () {
        const searchText = extractSearchText(request.messages, request);
        const { turn, matchedIndex } = resolveTurn(scenario, callIndex, searchText);

        if ("error" in turn) {
          throw new Error(turn.error);
        }

        if ("toolCall" in turn) {
          return {
            content: "",
            stopReason: "tool_use" as const,
            usage: fakeUsage(searchText.length, 0),
            model: "test-model",
            toolCalls: buildToolCalls([turn.toolCall], matchedIndex),
          } satisfies CompletionResponse;
        }

        if ("toolCalls" in turn) {
          return {
            content: "",
            stopReason: "tool_use" as const,
            usage: fakeUsage(searchText.length, 0),
            model: "test-model",
            toolCalls: buildToolCalls(turn.toolCalls, matchedIndex),
          } satisfies CompletionResponse;
        }

        const content = "json" in turn ? JSON.stringify(turn.json) : "text" in turn ? turn.text : "";
        return {
          content,
          stopReason: "end_turn" as const,
          usage: fakeUsage(searchText.length, content.length),
          model: "test-model",
        } satisfies CompletionResponse;
      }),

    stream: (request) => {
      const searchText = extractSearchText(request.messages, request);
      const { turn, matchedIndex } = resolveTurn(scenario, callIndex, searchText);

      if ("error" in turn) {
        return Effect.succeed(
          Stream.make(
            { type: "error" as const, error: turn.error } satisfies StreamEvent,
          ) as Stream.Stream<StreamEvent, LLMErrors>,
        );
      }

      const specs =
        "toolCall" in turn
          ? [turn.toolCall]
          : "toolCalls" in turn
            ? turn.toolCalls
            : null;

      if (specs) {
        const events: StreamEvent[] = [
          ...specs.flatMap((spec, i): StreamEvent[] => [
            {
              type: "tool_use_start" as const,
              id: spec.id ?? `call-${matchedIndex}-${i}`,
              name: spec.name,
            },
            {
              type: "tool_use_delta" as const,
              input: JSON.stringify(spec.args),
            },
          ]),
          { type: "content_complete" as const, content: "" },
          { type: "usage" as const, usage: fakeUsage(searchText.length, 0) },
        ];
        return Effect.succeed(
          Stream.fromIterable(events) as Stream.Stream<StreamEvent, LLMErrors>,
        );
      }

      const content = "json" in turn ? JSON.stringify(turn.json) : "text" in turn ? turn.text : "";
      const inputTokens = Math.ceil(searchText.length / 4);
      const outputTokens = Math.ceil(content.length / 4);

      return Effect.succeed(
        Stream.make(
          { type: "text_delta" as const, text: content } satisfies StreamEvent,
          { type: "content_complete" as const, content } satisfies StreamEvent,
          {
            type: "usage" as const,
            usage: {
              inputTokens,
              outputTokens,
              totalTokens: inputTokens + outputTokens,
              estimatedCost: 0,
            },
          } satisfies StreamEvent,
        ) as Stream.Stream<StreamEvent, LLMErrors>,
      );
    },

    completeStructured: (request) =>
      Effect.gen(function* () {
        const searchText = extractSearchText(request.messages, request);
        const { turn } = resolveTurn(scenario, callIndex, searchText);

        if ("error" in turn) {
          throw new Error(turn.error);
        }

        if ("json" in turn) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test provider bypasses schema; json is unknown, return type is generic A
          return turn.json as any;
        }

        // text turn — try JSON.parse then decode against schema
        const responseContent = "text" in turn ? turn.text : "{}";
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

    getStructuredOutputCapabilities: () =>
      Effect.succeed({
        nativeJsonMode: true,
        jsonSchemaEnforcement: false,
        prefillSupport: false,
        grammarConstraints: false,
      }),

    capabilities: () =>
      Effect.succeed({
        ...DEFAULT_CAPABILITIES,
        supportsToolCalling: true, // Test provider emits native FC stream events (tool_use_start/tool_use_delta)
        supportsStreaming: true,
      }),
  };
};

/**
 * Create a test Layer for LLMService with a deterministic turn scenario.
 * Turns are consumed sequentially; the last turn repeats when exhausted.
 */
export const TestLLMServiceLayer = (scenario: TestTurn[] = [{ text: "" }]) =>
  Layer.succeed(LLMService, LLMService.of(TestLLMService(scenario)));
