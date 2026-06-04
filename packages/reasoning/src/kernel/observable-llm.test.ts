import { describe, it, expect } from "bun:test";
import { Effect, Layer, Ref, Stream } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { CompletionRequest, CompletionResponse, StreamEvent } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { makeObservableLLM } from "./observable-llm.js";

// Co-located here (vs the existing tests/kernel/observable-llm.test.ts) because
// authority bounds restrict edits to packages/reasoning/src/kernel/**. Same
// stub-LLM + EventBus capture pattern as the sibling suite.

const cannedStreamEvents: readonly StreamEvent[] = [
  { type: "text_delta", text: "hi" },
  { type: "content_complete", content: "hi" },
  {
    type: "usage",
    usage: { inputTokens: 4, outputTokens: 1, totalTokens: 5, estimatedCost: 0 },
  },
];

const innerLLM = Layer.succeed(LLMService, {
  complete: () =>
    Effect.succeed({
      content: "ok",
      stopReason: "end_turn",
      usage: { inputTokens: 4, outputTokens: 1, totalTokens: 5, estimatedCost: 0 },
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

const captureStream = (request: CompletionRequest) =>
  Effect.gen(function* () {
    const sink = yield* Ref.make<AgentEvent[]>([]);
    const bus = yield* EventBus;
    yield* bus.on("LLMExchangeEmitted", (ev) => Ref.update(sink, (xs) => [...xs, ev]));
    const llm = yield* LLMService;
    const stream = yield* llm.stream(request);
    yield* Stream.runCollect(stream);
    return yield* Ref.get(sink);
  }).pipe(
    Effect.provide(Layer.merge(makeObservableLLM().pipe(Layer.provide(innerLLM)), EventBusLive)),
  );

describe("makeObservableLLM — trace correlation via request.traceContext", () => {
  it("keys LLMExchange to the real taskId/iteration when request.traceContext is present", async () => {
    const captured = await Effect.runPromise(
      captureStream({
        messages: [{ role: "user", content: "say hi" } as any],
        systemPrompt: "You are a test agent.",
        maxTokens: 64,
        temperature: 0.1,
        traceContext: { taskId: "run-XYZ", iteration: 3 },
      } satisfies CompletionRequest),
    );

    expect(captured.length).toBe(1);
    const ev = captured[0]! as Extract<AgentEvent, { _tag: "LLMExchangeEmitted" }>;
    expect(ev._tag).toBe("LLMExchangeEmitted");
    expect(ev.requestKind).toBe("stream");
    // The fix: trace event must carry the real run correlation, not the placeholder.
    expect(ev.taskId).toBe("run-XYZ");
    expect(ev.iteration).toBe(3);
  }, 15000);

  it("falls back to placeholder taskId/iteration when request has no traceContext (back-compat for non-kernel call sites)", async () => {
    const captured = await Effect.runPromise(
      captureStream({
        messages: [{ role: "user", content: "say hi" } as any],
        systemPrompt: "You are a test agent.",
        maxTokens: 64,
        temperature: 0.1,
      } satisfies CompletionRequest),
    );

    expect(captured.length).toBe(1);
    const ev = captured[0]! as Extract<AgentEvent, { _tag: "LLMExchangeEmitted" }>;
    expect(ev.taskId).toBe("llm-direct");
    expect(ev.iteration).toBe(0);
  }, 15000);
});
