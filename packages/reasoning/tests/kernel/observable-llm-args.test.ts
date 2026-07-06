import { describe, it, expect } from "bun:test";
import { Effect, Layer, Ref, Stream } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { CompletionRequest, CompletionResponse, StreamEvent } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { makeObservableLLM } from "../../src/kernel/observable-llm.js";

const streamedEvents: readonly StreamEvent[] = [
  { type: "tool_use_start", id: "call_1", name: "calculator" },
  { type: "tool_use_delta", input: '{"expres' },
  { type: "tool_use_delta", input: 'sion":"137*89"}' },
  { type: "usage", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 } },
];

// Stub inner LLMService — only `stream` is exercised by this suite; the rest
// die with a descriptive error if ever invoked so a misrouted call fails loud.
const innerLLM = Layer.succeed(LLMService, {
  complete: () => Effect.die("unused: complete"),
  stream: () => Effect.succeed(Stream.fromIterable(streamedEvents)),
  completeStructured: () => Effect.die("unused: completeStructured"),
  embed: () => Effect.die("unused: embed"),
  countTokens: () => Effect.succeed(0),
  getModelConfig: () => Effect.die("unused: getModelConfig"),
  getStructuredOutputCapabilities: () => Effect.die("unused: getStructuredOutputCapabilities"),
  capabilities: () => Effect.die("unused: capabilities"),
});

describe("makeObservableLLM — stream argument capture", () => {
  it("accumulates tool_use_delta chunks into parsed arguments", async () => {
    const captured = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.on("LLMExchangeEmitted", (ev) => Ref.update(sink, (xs) => [...xs, ev]));

        const llm = yield* LLMService;
        const stream = yield* llm.stream({
          messages: [{ role: "user", content: "calc" }],
          maxTokens: 64,
        } satisfies CompletionRequest);

        yield* Stream.runDrain(stream);
        return yield* Ref.get(sink);
      }).pipe(
        Effect.provide(
          Layer.merge(makeObservableLLM().pipe(Layer.provide(innerLLM)), EventBusLive),
        ),
      ),
    );

    expect(captured.length).toBe(1);
    const ev = captured[0]! as Extract<AgentEvent, { _tag: "LLMExchangeEmitted" }>;
    expect(ev.response.toolCalls).toHaveLength(1);
    expect(ev.response.toolCalls?.[0]?.name).toBe("calculator");
    expect(ev.response.toolCalls?.[0]?.arguments).toEqual({ expression: "137*89" });
  }, 15000);

  it("falls back to the raw string when accumulated argsJson fails to parse", async () => {
    const malformedEvents: readonly StreamEvent[] = [
      { type: "tool_use_start", id: "call_2", name: "broken_tool" },
      { type: "tool_use_delta", input: "{not valid json" },
      { type: "usage", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCost: 0 } },
    ];
    const brokenInnerLLM = Layer.succeed(LLMService, {
      complete: () => Effect.die("unused: complete"),
      stream: () => Effect.succeed(Stream.fromIterable(malformedEvents)),
      completeStructured: () => Effect.die("unused: completeStructured"),
      embed: () => Effect.die("unused: embed"),
      countTokens: () => Effect.succeed(0),
      getModelConfig: () => Effect.die("unused: getModelConfig"),
      getStructuredOutputCapabilities: () => Effect.die("unused: getStructuredOutputCapabilities"),
      capabilities: () => Effect.die("unused: capabilities"),
    });

    const captured = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.on("LLMExchangeEmitted", (ev) => Ref.update(sink, (xs) => [...xs, ev]));

        const llm = yield* LLMService;
        const stream = yield* llm.stream({
          messages: [{ role: "user", content: "calc" }],
          maxTokens: 64,
        } satisfies CompletionRequest);

        yield* Stream.runDrain(stream);
        return yield* Ref.get(sink);
      }).pipe(
        Effect.provide(
          Layer.merge(makeObservableLLM().pipe(Layer.provide(brokenInnerLLM)), EventBusLive),
        ),
      ),
    );

    expect(captured.length).toBe(1);
    const ev = captured[0]! as Extract<AgentEvent, { _tag: "LLMExchangeEmitted" }>;
    expect(ev.response.toolCalls).toHaveLength(1);
    expect(ev.response.toolCalls?.[0]?.arguments).toBe("{not valid json");
  }, 15000);

  it("attaches interleaved deltas to the correct call when multiple tool calls stream in sequence", async () => {
    const multiEvents: readonly StreamEvent[] = [
      { type: "tool_use_start", id: "call_a", name: "first_tool" },
      { type: "tool_use_delta", input: '{"a":1}' },
      { type: "tool_use_start", id: "call_b", name: "second_tool" },
      { type: "tool_use_delta", input: '{"b":2}' },
      { type: "usage", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCost: 0 } },
    ];
    const multiInnerLLM = Layer.succeed(LLMService, {
      complete: () => Effect.die("unused: complete"),
      stream: () => Effect.succeed(Stream.fromIterable(multiEvents)),
      completeStructured: () => Effect.die("unused: completeStructured"),
      embed: () => Effect.die("unused: embed"),
      countTokens: () => Effect.succeed(0),
      getModelConfig: () => Effect.die("unused: getModelConfig"),
      getStructuredOutputCapabilities: () => Effect.die("unused: getStructuredOutputCapabilities"),
      capabilities: () => Effect.die("unused: capabilities"),
    });

    const captured = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.on("LLMExchangeEmitted", (ev) => Ref.update(sink, (xs) => [...xs, ev]));

        const llm = yield* LLMService;
        const stream = yield* llm.stream({
          messages: [{ role: "user", content: "calc" }],
          maxTokens: 64,
        } satisfies CompletionRequest);

        yield* Stream.runDrain(stream);
        return yield* Ref.get(sink);
      }).pipe(
        Effect.provide(
          Layer.merge(makeObservableLLM().pipe(Layer.provide(multiInnerLLM)), EventBusLive),
        ),
      ),
    );

    expect(captured.length).toBe(1);
    const ev = captured[0]! as Extract<AgentEvent, { _tag: "LLMExchangeEmitted" }>;
    expect(ev.response.toolCalls).toHaveLength(2);
    expect(ev.response.toolCalls?.[0]).toEqual({ name: "first_tool", arguments: { a: 1 } });
    expect(ev.response.toolCalls?.[1]).toEqual({ name: "second_tool", arguments: { b: 2 } });
  }, 15000);

  it("omits arguments when a tool call receives no deltas (empty argsJson)", async () => {
    const noArgsEvents: readonly StreamEvent[] = [
      { type: "tool_use_start", id: "call_c", name: "no_arg_tool" },
      { type: "usage", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCost: 0 } },
    ];
    const noArgsInnerLLM = Layer.succeed(LLMService, {
      complete: () => Effect.die("unused: complete"),
      stream: () => Effect.succeed(Stream.fromIterable(noArgsEvents)),
      completeStructured: () => Effect.die("unused: completeStructured"),
      embed: () => Effect.die("unused: embed"),
      countTokens: () => Effect.succeed(0),
      getModelConfig: () => Effect.die("unused: getModelConfig"),
      getStructuredOutputCapabilities: () => Effect.die("unused: getStructuredOutputCapabilities"),
      capabilities: () => Effect.die("unused: capabilities"),
    });

    const captured = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.on("LLMExchangeEmitted", (ev) => Ref.update(sink, (xs) => [...xs, ev]));

        const llm = yield* LLMService;
        const stream = yield* llm.stream({
          messages: [{ role: "user", content: "calc" }],
          maxTokens: 64,
        } satisfies CompletionRequest);

        yield* Stream.runDrain(stream);
        return yield* Ref.get(sink);
      }).pipe(
        Effect.provide(
          Layer.merge(makeObservableLLM().pipe(Layer.provide(noArgsInnerLLM)), EventBusLive),
        ),
      ),
    );

    expect(captured.length).toBe(1);
    const ev = captured[0]! as Extract<AgentEvent, { _tag: "LLMExchangeEmitted" }>;
    expect(ev.response.toolCalls).toHaveLength(1);
    expect(ev.response.toolCalls?.[0]).toEqual({ name: "no_arg_tool" });
  }, 15000);
});
