import { describe, it, expect } from "bun:test";
import { Effect, Layer, Ref, Stream } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { CompletionRequest, CompletionResponse, StreamEvent } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { makeObservableLLM } from "../../src/kernel/observable-llm.js";

const cannedStreamEvents: readonly StreamEvent[] = [
  { type: "text_delta", text: "The capital " },
  { type: "text_delta", text: "is Paris." },
  { type: "tool_use_start", id: "call_1", name: "lookup_capital" },
  { type: "content_complete", content: "The capital is Paris." },
  {
    type: "usage",
    usage: { inputTokens: 11, outputTokens: 6, totalTokens: 17, estimatedCost: 0.00004 },
  },
];

// Stub inner LLMService that always returns a canned response.
const innerLLM = Layer.succeed(LLMService, {
  complete: () =>
    Effect.succeed({
      content: "Hello, world.",
      stopReason: "end_turn",
      usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8, estimatedCost: 0 },
      model: "test-model",
    } as CompletionResponse),
  stream: () => Effect.succeed(Stream.fromIterable(cannedStreamEvents) as any),
  completeStructured: () => Effect.succeed({ ok: true }) as any,
  embed: () => Effect.succeed([]),
  countTokens: () => Effect.succeed(0),
  getModelConfig: () => Effect.succeed({} as any),
  getStructuredOutputCapabilities: () => Effect.succeed({} as any),
  capabilities: () => Effect.succeed({} as any),
} as any);

describe("makeObservableLLM — emits LLMExchangeEmitted on direct LLM calls", () => {
  it("publishes LLMExchangeEmitted with systemPrompt, messages, and response on .complete()", async () => {
    const captured = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.on("LLMExchangeEmitted", (ev) =>
          Ref.update(sink, (xs) => [...xs, ev]),
        );

        const llm = yield* LLMService;
        yield* llm.complete({
          messages: [{ role: "user", content: "say hi" } as any],
          systemPrompt: "You are a test agent.",
          maxTokens: 64,
          temperature: 0.2,
        } satisfies CompletionRequest);

        return yield* Ref.get(sink);
      }).pipe(
        Effect.provide(
          Layer.merge(makeObservableLLM().pipe(Layer.provide(innerLLM)), EventBusLive),
        ),
      ),
    );

    expect(captured.length).toBe(1);
    const ev = captured[0]! as Extract<AgentEvent, { _tag: "LLMExchangeEmitted" }>;
    expect(ev._tag).toBe("LLMExchangeEmitted");
    expect(ev.requestKind).toBe("complete");
    expect(ev.systemPrompt).toBe("You are a test agent.");
    expect(ev.messages[0]!.content).toBe("say hi");
    expect(ev.response.content).toBe("Hello, world.");
    expect(typeof ev.response.durationMs).toBe("number");
  }, 15000);

  it("publishes LLMExchangeEmitted on .completeStructured() with stringified result", async () => {
    const captured = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.on("LLMExchangeEmitted", (ev) =>
          Ref.update(sink, (xs) => [...xs, ev]),
        );

        const llm = yield* LLMService;
        yield* llm.completeStructured({
          messages: [{ role: "user", content: "structured" } as any],
          systemPrompt: "You output JSON.",
          schema: undefined as any,
        } as any);

        return yield* Ref.get(sink);
      }).pipe(
        Effect.provide(
          Layer.merge(makeObservableLLM().pipe(Layer.provide(innerLLM)), EventBusLive),
        ),
      ),
    );

    expect(captured.length).toBe(1);
    const ev = captured[0]! as Extract<AgentEvent, { _tag: "LLMExchangeEmitted" }>;
    expect(ev.requestKind).toBe("completeStructured");
    expect(ev.response.content).toBe('{"ok":true}');
  }, 15000);

  it("publishes LLMExchangeEmitted exactly once on .stream() completion with accumulated content + toolCalls + usage (HS-117)", async () => {
    const captured = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.on("LLMExchangeEmitted", (ev) =>
          Ref.update(sink, (xs) => [...xs, ev]),
        );

        const llm = yield* LLMService;
        const stream = yield* llm.stream({
          messages: [{ role: "user", content: "what is the capital of france?" } as any],
          systemPrompt: "You answer geography questions.",
          maxTokens: 128,
          temperature: 0.1,
        } satisfies CompletionRequest);

        // Drain stream — wrapper must pass events through unchanged.
        const events = yield* Stream.runCollect(stream);

        return { captured: yield* Ref.get(sink), passthroughCount: events.pipe((c) => Array.from(c).length) };
      }).pipe(
        Effect.provide(
          Layer.merge(makeObservableLLM().pipe(Layer.provide(innerLLM)), EventBusLive),
        ),
      ),
    );

    // Pass-through invariant: every canned event reaches the consumer.
    expect(captured.passthroughCount).toBe(cannedStreamEvents.length);

    // Single emit at stream completion.
    expect(captured.captured.length).toBe(1);
    const ev = captured.captured[0]! as Extract<AgentEvent, { _tag: "LLMExchangeEmitted" }>;
    expect(ev._tag).toBe("LLMExchangeEmitted");
    expect(ev.requestKind).toBe("stream");
    expect(ev.systemPrompt).toBe("You answer geography questions.");
    expect(ev.messages[0]!.content).toBe("what is the capital of france?");

    // Content accumulated from text_delta + content_complete chain.
    expect(ev.response.content).toContain("The capital is Paris.");

    // Tool-use captured from tool_use_start.
    expect(ev.response.toolCalls?.length ?? 0).toBe(1);
    expect(ev.response.toolCalls?.[0]?.name).toBe("lookup_capital");
    expect(ev.response.stopReason).toBe("tool_use");

    // Usage captured from usage event.
    expect(ev.response.tokensIn).toBe(11);
    expect(ev.response.tokensOut).toBe(6);
    expect(typeof ev.response.durationMs).toBe("number");
  }, 15000);
});
