// Run: bun test packages/reasoning/tests/strategies/kernel/utils/thinking-channel-consumption.test.ts --timeout 15000
/**
 * W1.3 — kernel CONSUMPTION of the provider thinking channel (Review Focus #1 pin).
 *
 * Three arms, per controller ruling #4 (w1-34-brief):
 *  1. thinking-only-with-answer: a scripted provider stream whose VISIBLE
 *     content is empty/deficient while the thinking channel carries the final
 *     answer. The existing `providerThinking` / `rescueFromThinking` /
 *     `lastThinking` machinery at think.ts must FIRE — the kernel's thought
 *     lands on the answer. Before the accumulator wiring lands, these are RED
 *     (thinking never reaches `thoughtResponse.thinking`).
 *  2. no-thinking regression arm: same pipeline with zero thinking events —
 *     behavior byte-identical to HEAD (golden snapshot + shape pins).
 *  3. cut-wiring arm is a manual pre-commit experiment (sever the
 *     accumulator wiring in think.ts → arm 1 goes red); recorded in
 *     w1-34-report.md, not committed here.
 *
 * Consent semantics (ruling #2): NOTHING in these arms configures
 * "thinking enabled". Thinking presence alone drives the path — presence is
 * never consent, and no config gates the rescue/FA-check machinery.
 *
 * Zero new parsing logic: everything asserted here is EXISTING downstream
 * machinery (extractThinking/rescueFromThinking at think.ts:1328-1338)
 * activated by populating `thoughtResponse.thinking` from the stream
 * accumulator.
 */
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type {
  CompletionRequest,
  CompletionResponse,
  StreamEvent,
  StructuredCompletionRequest,
} from "@reactive-agents/llm-provider";
import { handleThinking } from "../../../../src/kernel/capabilities/reason/think.js";
import {
  noopHooks,
  type KernelContext,
  type KernelState,
} from "../../../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../../../src/context/context-profile.js";
import { TextParseDriver } from "@reactive-agents/tools";

// ── Minimal state/context factories (mirrors max-output-tokens-recovery.test.ts) ──

function makeState(overrides: Partial<KernelState> = {}): KernelState {
  const base: KernelState = {
    taskId: "test-task",
    strategy: "reactive",
    kernelType: "react",
    steps: [],
    toolsUsed: new Set<string>(),
    scratchpad: new Map<string, string>(),
    iteration: 0,
    tokens: 0,
    cost: 0,
    status: "thinking",
    output: null,
    error: null,
    llmCalls: 0,
    meta: { maxIterations: 10 },
    controllerDecisionLog: [],
    messages: [],
    ...overrides,
  };
  return base;
}

function makeContext(overrides: Partial<KernelContext["input"]> = {}): KernelContext {
  return {
    input: {
      task: "What is 6 times 7?",
      availableToolSchemas: [],
      ...overrides,
    },
    profile: CONTEXT_PROFILES["mid"],
    compression: {
      enabled: false,
      maxResultChars: 4000,
      previewLines: 10,
      arrayPreviewItems: 5,
    },
    toolService: { _tag: "None" },
    hooks: noopHooks,
    toolCallingDriver: new TextParseDriver(),
  };
}

// ── Scripted-stream LLMService layer (fully typed, no casts) ────────────────

function makeStreamLayer(events: readonly StreamEvent[]): Layer.Layer<LLMService> {
  const usage = { inputTokens: 10, outputTokens: 30, totalTokens: 40, estimatedCost: 0 };
  return Layer.succeed(
    LLMService,
    LLMService.of({
      complete: (_request: CompletionRequest) =>
        Effect.succeed<CompletionResponse>({
          content: "",
          stopReason: "end_turn",
          usage,
          model: "test",
        }),
      // The canned stream is inert (never errors), so `never` widens into the
      // service's error channel without any cast.
      stream: (_request: CompletionRequest) =>
        Effect.succeed(Stream.fromIterable(events)),
      completeStructured: <A>(_request: StructuredCompletionRequest<A>) =>
        Effect.die("unused in thinking-channel consumption test"),
      embed: (texts: readonly string[]) =>
        Effect.succeed(texts.map(() => new Array<number>(768).fill(0))),
      countTokens: (messages: readonly unknown[]) =>
        Effect.succeed(messages.length * 10),
      getModelConfig: () =>
        Effect.succeed({ provider: "anthropic", model: "test-model" }),
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
          supportsSystemPrompt: true,
          supportsLogprobs: false,
          supportsNativeStreaming: true,
          supportsPromptCaching: false,
        }),
    }),
  );
}

// ── Canned thinking-channel fixtures ────────────────────────────────────────

const THINKING_HEAD =
  "Let me work through this carefully. The user asked for six times seven. " +
  "I compute it step by step: 6 + 6 + 6 + 6 + 6 + 6, adding one group at a time, " +
  "which lands squarely on forty-two. ";
const THINKING_TAIL = "FINAL ANSWER: 42";
const FULL_THINKING = THINKING_HEAD + THINKING_TAIL;

const NO_THINKING_EVENTS: readonly StreamEvent[] = [
  { type: "text_delta", text: "The capital of France is Paris." },
  { type: "content_complete", content: "The capital of France is Paris." },
  {
    type: "usage",
    usage: { inputTokens: 11, outputTokens: 6, totalTokens: 17, estimatedCost: 0 },
  },
];

function runThink(events: readonly StreamEvent[]): Promise<KernelState> {
  return Effect.runPromise(
    handleThinking(makeState(), makeContext()).pipe(
      Effect.provide(makeStreamLayer(events)),
    ),
  );
}

/** First `thought` step's content, or null when none exists. */
function thoughtStepContent(state: KernelState): string | null {
  const step = state.steps.find((s) => s.type === "thought");
  return step ? step.content : null;
}

// ── Arm 1 — thinking-only-with-answer: rescue/FA-check FIRES ────────────────

describe("W1.3 thinking-channel consumption — arm 1: rescue fires", () => {
  it("empty visible content + thinking carrying the final answer → thought lands on the answer", async () => {
    // S2-baseline shape: provider reports NOTHING on the visible channel;
    // the model's reasoning (including the FINAL ANSWER line) rode the
    // thinking channel only.
    const events: readonly StreamEvent[] = [
      { type: "thinking_delta", thinking: THINKING_HEAD },
      { type: "thinking_delta", thinking: THINKING_TAIL },
      { type: "content_complete", content: "", thinking: FULL_THINKING },
      {
        type: "usage",
        usage: { inputTokens: 10, outputTokens: 200, totalTokens: 210, estimatedCost: 0 },
      },
    ];

    const state = await runThink(events);
    const content = thoughtStepContent(state);

    // Pre-wiring this is "" (empty thought — exactly the thinking-starve the
    // S2 baseline measured). Post-wiring the thought is the provider thinking
    // text, which carries the answer.
    expect(content).not.toBeNull();
    expect(content).toContain("FINAL ANSWER: 42");
    // The thinking must also be STAMPED onto the thought step's metadata so
    // lastThinking/FA-check consumers see it (existing think.ts machinery).
    const step = state.steps.find((s) => s.type === "thought");
    expect(step?.metadata?.thinking).toBe(FULL_THINKING);
  }, 15000);

  it("deficient 4-char visible content + long thinking-with-answer → rescueFromThinking fires, thought == answer", async () => {
    // The exact Review Focus #1 pin: content is a tiny fragment (< 50 chars,
    // matching the S2 baseline's 4 visible chars), thinking > 100 chars with
    // a FINAL ANSWER marker → the EXISTING rescue returns "FINAL ANSWER: 42"
    // and the stored thought equals it byte-for-byte.
    const events: readonly StreamEvent[] = [
      { type: "thinking_delta", thinking: THINKING_HEAD },
      { type: "thinking_delta", thinking: THINKING_TAIL },
      { type: "text_delta", text: "Sure" },
      { type: "content_complete", content: "Sure", thinking: FULL_THINKING },
      {
        type: "usage",
        usage: { inputTokens: 10, outputTokens: 200, totalTokens: 210, estimatedCost: 0 },
      },
    ];

    const state = await runThink(events);

    expect(thoughtStepContent(state)).toBe(`FINAL ANSWER: 42`);
    const step = state.steps.find((s) => s.type === "thought");
    expect(step?.metadata?.thinking).toBe(FULL_THINKING);
  }, 15000);

  it("thinking arriving ONLY via content_complete.thinking (no deltas) still activates rescue", async () => {
    // Anthropic parity: some providers report the accumulated thinking once
    // on content_complete instead of streaming deltas. Same consumption seam.
    const events: readonly StreamEvent[] = [
      { type: "text_delta", text: "Sure" },
      { type: "content_complete", content: "Sure", thinking: FULL_THINKING },
      {
        type: "usage",
        usage: { inputTokens: 10, outputTokens: 200, totalTokens: 210, estimatedCost: 0 },
      },
    ];

    const state = await runThink(events);
    expect(thoughtStepContent(state)).toBe(`FINAL ANSWER: 42`);
  }, 15000);
});

// ── Arm 2 — no-thinking regression pin: byte-identical to HEAD ──────────────

describe("W1.3 thinking-channel consumption — arm 2: no-thinking regression pin", () => {
  /**
   * Golden snapshot captured by running this scenario against HEAD (before
   * the accumulator wiring). The W1.3 change must leave EVERY field below
   * byte-identical when the stream carries no thinking — the `thinking` key
   * is added to `thoughtResponse` ONLY conditionally, so the no-thinking
   * shape never gains a property.
   */
  const HEAD_GOLDEN = {
    status: "done",
    iteration: 1,
    tokens: 17,
    cost: 0,
    output: "The capital of France is Paris.",
    priorThought: "The capital of France is Paris.",
    steps: [
      {
        type: "thought",
        content: "The capital of France is Paris.",
        metadata: undefined,
      },
    ],
  } as const;

  function snapshot(state: KernelState) {
    return {
      status: state.status,
      iteration: state.iteration,
      tokens: state.tokens,
      cost: state.cost,
      output: state.output,
      priorThought: state.priorThought,
      steps: state.steps.map((s) => ({
        type: s.type,
        content: s.content,
        metadata: s.metadata,
      })),
    };
  }

  it("stream WITHOUT any thinking event behaves byte-identically to HEAD", async () => {
    const state = await runThink(NO_THINKING_EVENTS);

    // No thinking anywhere: not on the step metadata, not in meta.lastThinking.
    expect(state.meta.lastThinking).toBeUndefined();
    const step = state.steps.find((s) => s.type === "thought");
    expect(step?.metadata?.thinking).toBeUndefined();

    // Deep behavior pin against the HEAD-captured golden (JSON round-trip so
    // `metadata: undefined` vs absent-key differences are normalized).
    expect(JSON.parse(JSON.stringify(snapshot(state)))).toEqual(
      JSON.parse(JSON.stringify(HEAD_GOLDEN)),
    );
  }, 15000);
});
