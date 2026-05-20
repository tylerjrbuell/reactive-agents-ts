import { describe, it, expect } from "bun:test";
import { Effect, Layer, Ref, Stream } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { CompletionRequest, CompletionResponse } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { makeObservableLLM } from "../../src/kernel/observable-llm.js";

// Stub inner LLMService that always returns a canned response.
const innerLLM = Layer.succeed(LLMService, {
  complete: () =>
    Effect.succeed({
      content: "Hello, world.",
      stopReason: "end_turn",
      usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8, estimatedCost: 0 },
      model: "test-model",
    } as CompletionResponse),
  stream: () => Effect.succeed(Stream.empty as any),
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
});
