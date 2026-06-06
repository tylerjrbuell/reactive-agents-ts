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

// A stream whose usage event carries Anthropic prompt-cache stats, mirroring
// what anthropic.ts emits when cache_read/cache_creation come back from the API.
const cachedStreamEvents: readonly StreamEvent[] = [
  { type: "text_delta", text: "hi" },
  { type: "content_complete", content: "hi" },
  {
    type: "usage",
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      estimatedCost: 0,
      cacheReadInputTokens: 3215,
      cacheCreationInputTokens: 1090,
    },
  },
];

// A stream whose usage event carries the provider-resolved context window —
// what local.ts emits so the chokepoint can drive the ContextPressure gauge off
// the exact num_ctx the provider received (honors user numCtx overrides).
const windowedStreamEvents: readonly StreamEvent[] = [
  { type: "text_delta", text: "hi" },
  { type: "content_complete", content: "hi" },
  {
    type: "usage",
    usage: { inputTokens: 2304, outputTokens: 12, totalTokens: 2316, estimatedCost: 0 },
    resolvedParams: { contextWindow: 32_768 },
  },
];

const makeInnerLLM = (events: readonly StreamEvent[]) =>
  Layer.succeed(LLMService, {
    complete: () =>
      Effect.succeed({
        content: "ok",
        stopReason: "end_turn",
        usage: { inputTokens: 4, outputTokens: 1, totalTokens: 5, estimatedCost: 0 },
        model: "test-model",
      } as CompletionResponse),
    stream: () => Effect.succeed(Stream.fromIterable(events) as any),
    completeStructured: () => Effect.succeed({ ok: true }) as any,
    embed: () => Effect.succeed([]),
    countTokens: () => Effect.succeed(0),
    getModelConfig: () => Effect.succeed({} as any),
    getStructuredOutputCapabilities: () => Effect.succeed({} as any),
    capabilities: () => Effect.succeed({} as any),
  } as any);

const innerLLM = makeInnerLLM(cannedStreamEvents);

const captureStreamWith = (inner: ReturnType<typeof makeInnerLLM>) => (request: CompletionRequest) =>
  Effect.gen(function* () {
    const sink = yield* Ref.make<AgentEvent[]>([]);
    const bus = yield* EventBus;
    yield* bus.on("LLMExchangeEmitted", (ev) => Ref.update(sink, (xs) => [...xs, ev]));
    const llm = yield* LLMService;
    const stream = yield* llm.stream(request);
    yield* Stream.runCollect(stream);
    return yield* Ref.get(sink);
  }).pipe(
    Effect.provide(Layer.merge(makeObservableLLM().pipe(Layer.provide(inner)), EventBusLive)),
  );

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

// Capture ContextPressure events off the bus for a given inner LLM + request.
const captureContextPressureWith =
  (inner: ReturnType<typeof makeInnerLLM>) => (request: CompletionRequest) =>
    Effect.gen(function* () {
      const sink = yield* Ref.make<AgentEvent[]>([]);
      const bus = yield* EventBus;
      yield* bus.on("ContextPressure", (ev) => Ref.update(sink, (xs) => [...xs, ev]));
      const llm = yield* LLMService;
      const stream = yield* llm.stream(request);
      yield* Stream.runCollect(stream);
      return yield* Ref.get(sink);
    }).pipe(
      Effect.provide(Layer.merge(makeObservableLLM().pipe(Layer.provide(inner)), EventBusLive)),
    );

describe("makeObservableLLM — uniform ContextPressure chokepoint", () => {
  it("emits ContextPressure when traceContext + inputTokens + resolvedParams.contextWindow are present", async () => {
    const captured = await Effect.runPromise(
      captureContextPressureWith(makeInnerLLM(windowedStreamEvents))({
        messages: [{ role: "user", content: "say hi" } as any],
        systemPrompt: "You are a test agent.",
        maxTokens: 64,
        temperature: 0.1,
        traceContext: { taskId: "run-CP", iteration: 1 },
      } satisfies CompletionRequest),
    );

    expect(captured.length).toBe(1);
    const cp = captured[0]! as Extract<AgentEvent, { _tag: "ContextPressure" }>;
    expect(cp._tag).toBe("ContextPressure");
    expect(cp.taskId).toBe("run-CP");
    expect(cp.tokensUsed).toBe(2304);
    expect(cp.tokensAvailable).toBe(30_464); // 32768 - 2304
    expect(cp.utilizationPct).toBeCloseTo(7.03, 1);
    expect(cp.level).toBe("low");
  }, 15000);

  it("emits NO ContextPressure when traceContext is absent (filters aux/non-correlated calls)", async () => {
    const captured = await Effect.runPromise(
      captureContextPressureWith(makeInnerLLM(windowedStreamEvents))({
        messages: [{ role: "user", content: "say hi" } as any],
        systemPrompt: "You are a test agent.",
        maxTokens: 64,
        temperature: 0.1,
      } satisfies CompletionRequest),
    );

    expect(captured.length).toBe(0);
  }, 15000);

  it("emits NO ContextPressure when resolvedParams.contextWindow is absent (no assumed-max fallback)", async () => {
    const captured = await Effect.runPromise(
      captureContextPressureWith(makeInnerLLM(cannedStreamEvents))({
        messages: [{ role: "user", content: "say hi" } as any],
        systemPrompt: "You are a test agent.",
        maxTokens: 64,
        temperature: 0.1,
        traceContext: { taskId: "run-NOWIN", iteration: 1 },
      } satisfies CompletionRequest),
    );

    expect(captured.length).toBe(0);
  }, 15000);
});

// Inner LLM whose complete() returns a CompletionResponse carrying resolvedParams
// — mirrors the plan-execute reflect/analysis path (runCritiquePass → complete()).
const windowedCompleteLLM = Layer.succeed(LLMService, {
  complete: () =>
    Effect.succeed({
      content: "ok",
      stopReason: "end_turn",
      usage: { inputTokens: 2304, outputTokens: 12, totalTokens: 2316, estimatedCost: 0 },
      model: "test-model",
      resolvedParams: { contextWindow: 32_768 },
    } as CompletionResponse),
  stream: () => Effect.succeed(Stream.fromIterable(cannedStreamEvents) as any),
  completeStructured: () => Effect.succeed({ ok: true }) as any,
  embed: () => Effect.succeed([]),
  countTokens: () => Effect.succeed(0),
  getModelConfig: () => Effect.succeed({} as any),
  getStructuredOutputCapabilities: () => Effect.succeed({} as any),
  capabilities: () => Effect.succeed({} as any),
} as any);

describe("makeObservableLLM — ContextPressure on the complete() path (plan-execute reflect/analysis)", () => {
  it("emits ContextPressure from complete() when traceContext + resolvedParams.contextWindow present", async () => {
    const captured = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.on("ContextPressure", (ev) => Ref.update(sink, (xs) => [...xs, ev]));
        const llm = yield* LLMService;
        yield* llm.complete({
          messages: [{ role: "user", content: "critique this" } as any],
          systemPrompt: "judge",
          maxTokens: 256,
          temperature: 0.3,
          traceContext: { taskId: "run-REFLECT", iteration: 2 },
        } satisfies CompletionRequest);
        return yield* Ref.get(sink);
      }).pipe(
        Effect.provide(Layer.merge(makeObservableLLM().pipe(Layer.provide(windowedCompleteLLM)), EventBusLive)),
      ),
    );

    expect(captured.length).toBe(1);
    const cp = captured[0]! as Extract<AgentEvent, { _tag: "ContextPressure" }>;
    expect(cp._tag).toBe("ContextPressure");
    expect(cp.taskId).toBe("run-REFLECT");
    expect(cp.tokensUsed).toBe(2304);
    expect(cp.tokensAvailable).toBe(30_464);
    expect(cp.level).toBe("low");
  }, 15000);
});

describe("makeObservableLLM — streamed prompt-cache stats", () => {
  it("surfaces cacheReadInputTokens/cacheCreationInputTokens from the usage StreamEvent into the emitted exchange", async () => {
    const captured = await Effect.runPromise(
      captureStreamWith(makeInnerLLM(cachedStreamEvents))({
        messages: [{ role: "user", content: "say hi" } as any],
        systemPrompt: "You are a test agent.",
        maxTokens: 64,
        temperature: 0.1,
        traceContext: { taskId: "run-CACHE", iteration: 2 },
      } satisfies CompletionRequest),
    );

    expect(captured.length).toBe(1);
    const ev = captured[0]! as Extract<AgentEvent, { _tag: "LLMExchangeEmitted" }>;
    expect(ev.requestKind).toBe("stream");
    // The fix: the stream accumulator must copy the cache fields off the usage
    // event so emitForRequest can surface them. Before the fix these are dropped
    // and both assertions fail (undefined).
    expect(ev.response.cacheReadTokensIn).toBe(3215);
    expect(ev.response.cacheCreationTokensIn).toBe(1090);
  }, 15000);
});
