import { Effect, Layer, Stream, Schema } from "effect";
import { LLMService } from "./llm-service.js";
import type {
  CompletionResponse,
  StreamEvent,
  LLMMessage,
  LlmCallPurpose,
  TokenLogprob,
} from "./types.js";
import type { LLMErrors } from "./errors.js";
import { DEFAULT_CAPABILITIES } from "./capabilities.js";

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface ToolCallSpec {
  name: string;
  args: Record<string, unknown>;
  id?: string; // auto-generated "call-<matchedIndex>-<i>" if omitted
}

/**
 * Provider-specific output quirks the deterministic provider can simulate, so a
 * single behavioral contract can be replayed across the shapes real providers
 * actually emit (which the clean happy-path mock never exercises). The harness
 * (resolver + healing) must normalize each one.
 *
 * - `"stringified-args"`: tool-call arguments arrive as a JSON STRING instead of
 *   an object (some Ollama models; OpenAI before its adapter JSON.parses).
 * - `"snake_case-name"`: tool name uses `_` separators (`web_search`) instead of
 *   the registered `web-search` — must be healed.
 * - `"think-leak"`: a `<think>…</think>` reasoning block leaks into text content
 *   (qwen3 / reasoning models) — must be stripped from the final answer.
 */
export type ProviderQuirk = "stringified-args" | "snake_case-name" | "think-leak";

function quirkName(name: string, quirk?: ProviderQuirk): string {
  return quirk === "snake_case-name" ? name.replace(/-/g, "_") : name;
}

function quirkInput(args: Record<string, unknown>, quirk?: ProviderQuirk): unknown {
  return quirk === "stringified-args" ? JSON.stringify(args) : args;
}

function quirkText(text: string, quirk?: ProviderQuirk): string {
  return quirk === "think-leak" ? `<think>\nLet me reason about this step by step.\n</think>\n${text}` : text;
}

export type TestTurn =
  | {
      text: string;
      match?: string;
      delayMs?: number;
      logprobs?: readonly TokenLogprob[];
    }
  | {
      json: unknown;
      match?: string;
      delayMs?: number;
      logprobs?: readonly TokenLogprob[];
    }
  | { toolCall: ToolCallSpec; match?: string; delayMs?: number }
  | { toolCalls: ToolCallSpec[]; match?: string; delayMs?: number }
  | { error: string; match?: string; delayMs?: number };

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

/**
 * Which caller a resolve is serving.
 *
 * - `"agent"` — the agent loop's own turn (kernel `think`, or the inline path).
 *   Every turn kind is in scope, and consuming one advances the cursor.
 * - `"harness"` — a harness-internal call the agent never sees: the
 *   tool-relevance classifier, structured extraction, plan decomposition,
 *   grounding checks.
 *
 * The distinction is not cosmetic. Harness-internal calls used to share the
 * agent's cursor, and the tool-relevance classifier runs BEFORE the agent's
 * first think and retries on a parse failure. Against a tool-calling scenario
 * each attempt took a turn the agent had not consumed yet — the classifier
 * cannot answer a `toolCall` turn (it reads as `empty content
 * (stopReason=tool_use)`), so it burned the whole scenario and the run reached
 * `think` with only the trailing text turn left. That terminated `end_turn` at
 * one step having executed zero tools, and it looked exactly like "scripted tool
 * calls cannot reach the kernel act phase" — a structural kernel defect that
 * does not exist. The instrument was eating the script.
 */
type TurnChannel = "agent" | "harness";

const isAgentOnly = (turn: TestTurn): boolean =>
  "toolCall" in turn || "toolCalls" in turn;

/**
 * Resolve the turn that answers one LLM call.
 *
 * Agent calls behave exactly as they always have: scan forward from the cursor
 * for the first turn whose `match` guard passes, consume it, advance.
 *
 * Harness calls differ in two ways, both of which exist to keep them from
 * stealing the agent's script:
 *
 *  1. They skip `toolCall`/`toolCalls` turns, which are agent-only by
 *     construction — a schema-constrained call has no way to answer one.
 *  2. If reaching their turn required stepping OVER an agent-only turn, the
 *     resolve is a PEEK: it returns the turn without moving the cursor. Moving
 *     it would consume a turn the agent has not reached yet.
 *
 * When a harness call skips nothing — the ordinary case, e.g. a plan-execute
 * scenario that opens with the `json` plan the decomposition call is meant to
 * receive — it consumes and advances precisely as before. That keeps every
 * non-interleaved scenario byte-identical.
 */
function resolveTurn(
  scenario: TestTurn[],
  callIndex: { value: number },
  searchText: string,
  channel: TurnChannel = "agent",
): { turn: TestTurn; matchedIndex: number } | undefined {
  let steppedOverAgentTurn = false;
  for (let i = callIndex.value; i < scenario.length; i++) {
    const turn = scenario[i];
    if (channel === "harness" && isAgentOnly(turn)) {
      steppedOverAgentTurn = true;
      continue;
    }
    const guard = turn.match;
    if (!guard || new RegExp(guard, "i").test(searchText)) {
      if (!steppedOverAgentTurn) {
        callIndex.value = Math.min(i + 1, scenario.length - 1);
      }
      return { turn, matchedIndex: i };
    }
  }
  // Nothing matched from the cursor onward — repeat the last eligible turn,
  // which is what makes single-turn scenarios work without special handling.
  for (let i = scenario.length - 1; i >= 0; i--) {
    const turn = scenario[i];
    if (channel === "harness" && isAgentOnly(turn)) continue;
    return { turn, matchedIndex: i };
  }
  // Harness call against a scenario that scripts only tool calls. Fail rather
  // than invent a turn; callers of this path already degrade (the classifier
  // logs and proceeds with an empty relevance set).
  return undefined;
}

/**
 * Which channel a request belongs to.
 *
 * `"think"` is the agent's own turn. An absent purpose means the call did not go
 * through the kernel gateway at all — the inline execution path, or a direct
 * `LLMService` call in a unit test — and those ARE the agent, so they keep the
 * agent channel. Every other purpose is harness-internal.
 */
function channelOf(purpose: LlmCallPurpose | undefined): TurnChannel {
  return purpose === undefined || purpose === "think" ? "agent" : "harness";
}

/** Agent channel resolve. Always succeeds: `scenario` is non-empty by construction. */
function resolveAgentTurn(
  scenario: TestTurn[],
  callIndex: { value: number },
  searchText: string,
): { turn: TestTurn; matchedIndex: number } {
  return resolveTurn(scenario, callIndex, searchText, "agent") as {
    turn: TestTurn;
    matchedIndex: number;
  };
}

function buildToolCalls(
  specs: ToolCallSpec[],
  matchedIndex: number,
  quirk?: ProviderQuirk,
): Array<{ id: string; name: string; input: unknown }> {
  return specs.map((spec, i) => ({
    id: spec.id ?? `call-${matchedIndex}-${i}`,
    name: quirkName(spec.name, quirk),
    input: quirkInput(spec.args, quirk),
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
  quirk?: ProviderQuirk,
): typeof LLMService.Service => {
  // Mutable cursor — safe because each build() creates a fresh Layer instance.
  // ONE cursor, shared across channels on purpose: a harness call that skips
  // nothing must consume exactly as it always did, so non-interleaved scenarios
  // stay byte-identical. See resolveTurn for the peek rule that protects
  // interleaved ones.
  const callIndex = { value: 0 };

  /** Harness resolves can come up empty; the caller turns that into a failure. */
  const resolveFor = (
    request: { readonly purpose?: LlmCallPurpose },
    searchText: string,
  ) => resolveTurn(scenario, callIndex, searchText, channelOf(request.purpose));

  return {
    complete: (request) =>
      Effect.gen(function* () {
        const searchText = extractSearchText(request.messages, request);
        const resolved = resolveFor(request, searchText);
        if (resolved === undefined) {
          // Scenario scripts agent tool calls only, so there is nothing for a
          // harness-internal call to read. Answer empty rather than throw: that
          // is byte-identical to what these callers used to receive when they
          // consumed a `toolCall` turn (`empty content`) and already degrade on
          // it — minus the theft of the agent's turn, which was the bug.
          return {
            content: "",
            stopReason: "end_turn" as const,
            usage: fakeUsage(searchText.length, 0),
            model: "test-model",
          } satisfies CompletionResponse;
        }
        const { turn, matchedIndex } = resolved;

        const delayMs = "delayMs" in turn ? (turn.delayMs ?? 0) : 0;
        if (delayMs > 0) {
          yield* Effect.sleep(`${delayMs} millis`);
        }

        if ("error" in turn) {
          throw new Error(turn.error);
        }

        if ("toolCall" in turn) {
          return {
            content: "",
            stopReason: "tool_use" as const,
            usage: fakeUsage(searchText.length, 0),
            model: "test-model",
            toolCalls: buildToolCalls([turn.toolCall], matchedIndex, quirk),
          } satisfies CompletionResponse;
        }

        if ("toolCalls" in turn) {
          return {
            content: "",
            stopReason: "tool_use" as const,
            usage: fakeUsage(searchText.length, 0),
            model: "test-model",
            toolCalls: buildToolCalls(turn.toolCalls, matchedIndex, quirk),
          } satisfies CompletionResponse;
        }

        const content = quirkText("json" in turn ? JSON.stringify(turn.json) : "text" in turn ? turn.text : "", quirk);
        const logprobs =
          ("text" in turn || "json" in turn) && turn.logprobs
            ? turn.logprobs
            : undefined;
        return {
          content,
          stopReason: "end_turn" as const,
          usage: fakeUsage(searchText.length, content.length),
          model: "test-model",
          ...(logprobs ? { logprobs } : {}),
        } satisfies CompletionResponse;
      }),

    stream: (request) => {
      const searchText = extractSearchText(request.messages, request);
      // The streaming path is the agent's think turn; a harness call that lands
      // here still resolves, it simply never skips (see resolveTurn).
      const { turn, matchedIndex } =
        resolveFor(request, searchText) ??
        resolveAgentTurn(scenario, callIndex, searchText);

      const delayMs = "delayMs" in turn ? (turn.delayMs ?? 0) : 0;
      const delayStream: Stream.Stream<never, never> =
        delayMs > 0
          ? Stream.drain(Stream.fromEffect(Effect.sleep(`${delayMs} millis`)))
          : Stream.empty;

      if ("error" in turn) {
        return Effect.succeed(
          Stream.concat(
            delayStream,
            Stream.make(
              { type: "error" as const, error: turn.error } satisfies StreamEvent,
            ),
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
              name: quirkName(spec.name, quirk),
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
          Stream.concat(
            delayStream,
            Stream.fromIterable(events),
          ) as Stream.Stream<StreamEvent, LLMErrors>,
        );
      }

      const content = quirkText("json" in turn ? JSON.stringify(turn.json) : "text" in turn ? turn.text : "", quirk);
      const inputTokens = Math.ceil(searchText.length / 4);
      const outputTokens = Math.ceil(content.length / 4);
      const streamLogprobs =
        ("text" in turn || "json" in turn) && turn.logprobs
          ? turn.logprobs
          : undefined;

      const baseEvents: StreamEvent[] = [
        { type: "text_delta" as const, text: content },
        { type: "content_complete" as const, content },
        ...(streamLogprobs
          ? [
              {
                type: "logprobs" as const,
                logprobs: streamLogprobs,
              } satisfies StreamEvent,
            ]
          : []),
        {
          type: "usage" as const,
          usage: {
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
            estimatedCost: 0,
          },
        },
      ];

      return Effect.succeed(
        Stream.concat(
          delayStream,
          Stream.fromIterable(baseEvents),
        ) as Stream.Stream<StreamEvent, LLMErrors>,
      );
    },

    completeStructured: (request) =>
      Effect.gen(function* () {
        const searchText = extractSearchText(request.messages, request);
        // Schema-constrained by definition, so always the harness channel: it
        // has no way to answer a `toolCall` turn and must never consume one.
        const resolved = resolveTurn(scenario, callIndex, searchText, "harness");
        if (resolved === undefined) {
          throw new Error(
            "test provider: scenario scripts only tool calls, so it has no structured turn to answer completeStructured",
          );
        }
        const { turn } = resolved;

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
export const TestLLMServiceLayer = (
  scenario: TestTurn[] = [{ text: "" }],
  quirk?: ProviderQuirk,
) => Layer.succeed(LLMService, LLMService.of(TestLLMService(scenario, quirk)));
