// Run: bun test packages/reasoning/tests/kernel/thinking-forensics-llm-exchange.test.ts --timeout 15000
/**
 * W1.4 — thinking forensics on the `llm-exchange` trace event.
 *
 * The S2 baseline proved the model's reasoning reaches the wire while the
 * visible channel starves, yet `rax diagnose replay` could not SHOW it:
 * `llm-exchange` carried no trace of the thinking channel at all. These tests
 * pin the forensics fields on the exchange emitted from the single observable
 * chokepoint (`makeObservableLLM`):
 *
 *  - `response.thinkingChars`   — full length of the provider thinking text.
 *  - `response.thinkingPreview` — prefix capped at the EXISTING trace-budget
 *    constant PREVIEW_MAX (diagnostics.ts) — no payload growth beyond a
 *    preview-sized string, and NEVER emitted when no thinking was received
 *    (old exchanges stay byte-identical; old traces still load).
 */
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Ref, Stream } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type {
  CompletionRequest,
  CompletionResponse,
  StreamEvent,
  StructuredCompletionRequest,
} from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { makeObservableLLM } from "../../src/kernel/observable-llm.js";

// ── Forensics accessor (typed structural read, no cast) ──────────────────────
// These optional fields are declared on the canonical recording schema
// (trace/src/events.ts LLMExchangeEvent) and, since the core integration
// commit 91e8d6006, on the core transit type too. A structural read is all a
// test needs.

interface ThinkingForensics {
  readonly thinkingChars?: number;
  readonly thinkingPreview?: string;
}

function forensicsOf(ev: AgentEvent): ThinkingForensics {
  if (ev._tag !== "LLMExchangeEmitted") return {};
  const resp: ThinkingForensics = ev.response;
  return resp;
}

// ── Stub inner LLMService with per-test scripted stream/complete payloads ───

const longThinking = "T".repeat(500);

const usage = { inputTokens: 5, outputTokens: 10, totalTokens: 15, estimatedCost: 0 };

function makeInnerLayer(
  streamEvents: readonly StreamEvent[],
  completeThinking?: string,
): Layer.Layer<LLMService> {
  return Layer.succeed(
    LLMService,
    LLMService.of({
      complete: (_request: CompletionRequest) =>
        Effect.succeed<CompletionResponse>({
          content: "visible answer",
          stopReason: "end_turn",
          usage,
          model: "test-model",
          ...(completeThinking !== undefined ? { thinking: completeThinking } : {}),
        }),
      stream: (_request: CompletionRequest) => Effect.succeed(Stream.fromIterable(streamEvents)),
      completeStructured: <A>(_request: StructuredCompletionRequest<A>) =>
        Effect.die("unused in forensics test"),
      embed: (texts: readonly string[]) =>
        Effect.succeed(texts.map(() => new Array<number>(4).fill(0))),
      countTokens: (messages: readonly unknown[]) => Effect.succeed(messages.length),
      getModelConfig: () => Effect.succeed({ provider: "ollama", model: "test-model" }),
      getStructuredOutputCapabilities: () =>
        Effect.succeed({
          nativeJsonMode: false,
          jsonSchemaEnforcement: false,
          prefillSupport: false,
          grammarConstraints: false,
        }),
      capabilities: () =>
        Effect.succeed({
          supportsToolCalling: false,
          supportsStreaming: true,
          supportsSystemPrompt: true,
          supportsLogprobs: false,
          supportsNativeStreaming: true,
          supportsPromptCaching: false,
        }),
    }),
  );
}

function provide(inner: Layer.Layer<LLMService>): Layer.Layer<LLMService | EventBus> {
  return Layer.merge(
    makeObservableLLM().pipe(Layer.provide(inner)),
    EventBusLive,
  );
}

const request: CompletionRequest = {
  messages: [{ role: "user", content: "6*7?" }],
  maxTokens: 64,
};

// ── Stream-path forensics ───────────────────────────────────────────────────

describe("W1.4 llm-exchange thinking forensics — stream path", () => {
  it("captures thinkingChars + PREVIEW_MAX-capped thinkingPreview from thinking_delta accumulation", async () => {
    const events: readonly StreamEvent[] = [
      { type: "thinking_delta", thinking: longThinking.slice(0, 300) },
      { type: "thinking_delta", thinking: longThinking.slice(300) },
      { type: "text_delta", text: "42" },
      { type: "content_complete", content: "42" },
      { type: "usage", usage: { inputTokens: 5, outputTokens: 200, totalTokens: 205, estimatedCost: 0 } },
    ];

    const captured = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.on("LLMExchangeEmitted", (ev) => Ref.update(sink, (xs) => [...xs, ev]));
        const llm = yield* LLMService;
        const innerStream = yield* llm.stream(request);
        // The exchange emits at Stream.ensuring — the caller must consume.
        yield* Stream.runDrain(innerStream);
        return yield* Ref.get(sink);
      }).pipe(Effect.provide(provide(makeInnerLayer(events)))),
    );

    expect(captured.length).toBe(1);
    const f = forensicsOf(captured[0]!);
    expect(f.thinkingChars).toBe(500);
    expect(typeof f.thinkingPreview).toBe("string");
    expect(f.thinkingPreview!.length).toBeLessThanOrEqual(240);
    expect(f.thinkingPreview).toBe(longThinking.slice(0, 240));
  }, 15000);

  it("content_complete.thinking (reported once, no deltas) is also captured", async () => {
    const events: readonly StreamEvent[] = [
      { type: "text_delta", text: "42" },
      { type: "content_complete", content: "42", thinking: longThinking },
      { type: "usage", usage: { inputTokens: 5, outputTokens: 200, totalTokens: 205, estimatedCost: 0 } },
    ];

    const captured = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.on("LLMExchangeEmitted", (ev) => Ref.update(sink, (xs) => [...xs, ev]));
        const llm = yield* LLMService;
        const innerStream = yield* llm.stream(request);
        yield* Stream.runDrain(innerStream);
        return yield* Ref.get(sink);
      }).pipe(Effect.provide(provide(makeInnerLayer(events)))),
    );

    const f = forensicsOf(captured[0]!);
    expect(f.thinkingChars).toBe(500);
  }, 15000);

  it("stream WITHOUT thinking emits NO thinking forensics keys (old exchanges byte-identical)", async () => {
    const events: readonly StreamEvent[] = [
      { type: "text_delta", text: "42" },
      { type: "content_complete", content: "42" },
      { type: "usage", usage: { inputTokens: 5, outputTokens: 8, totalTokens: 13, estimatedCost: 0 } },
    ];

    const captured = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.on("LLMExchangeEmitted", (ev) => Ref.update(sink, (xs) => [...xs, ev]));
        const llm = yield* LLMService;
        const innerStream = yield* llm.stream(request);
        yield* Stream.runDrain(innerStream);
        return yield* Ref.get(sink);
      }).pipe(Effect.provide(provide(makeInnerLayer(events)))),
    );

    const ev = captured[0]!;
    if (ev._tag !== "LLMExchangeEmitted") throw new Error("wrong event tag");
    const keys = Object.keys(ev.response);
    expect(keys).not.toContain("thinkingChars");
    expect(keys).not.toContain("thinkingPreview");
    expect(keys).not.toContain("thinking");
  }, 15000);
});

// ── complete()-path forensics ───────────────────────────────────────────────

describe("W1.4 llm-exchange thinking forensics — complete path", () => {
  it("CompletionResponse.thinking surfaces as thinkingChars + capped preview", async () => {
    const captured = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.on("LLMExchangeEmitted", (ev) => Ref.update(sink, (xs) => [...xs, ev]));
        const llm = yield* LLMService;
        yield* llm.complete(request);
        return yield* Ref.get(sink);
      }).pipe(Effect.provide(provide(makeInnerLayer([], longThinking)))),
    );

    expect(captured.length).toBe(1);
    const f = forensicsOf(captured[0]!);
    expect(f.thinkingChars).toBe(500);
    expect(f.thinkingPreview!.length).toBeLessThanOrEqual(240);
  }, 15000);

  it("complete WITHOUT thinking emits no forensics keys", async () => {
    const captured = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.on("LLMExchangeEmitted", (ev) => Ref.update(sink, (xs) => [...xs, ev]));
        const llm = yield* LLMService;
        yield* llm.complete(request);
        return yield* Ref.get(sink);
      }).pipe(Effect.provide(provide(makeInnerLayer([])))),
    );

    const ev = captured[0]!;
    if (ev._tag !== "LLMExchangeEmitted") throw new Error("wrong event tag");
    const keys = Object.keys(ev.response);
    expect(keys).not.toContain("thinkingChars");
    expect(keys).not.toContain("thinkingPreview");
  }, 15000);
});
