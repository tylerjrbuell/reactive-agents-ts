// Run: bun test packages/reasoning/tests/kernel/llm-first-token-ms.test.ts --timeout 20000
//
// LLMRequestCompleted.firstTokenMs (2026-11-11): the observable LLM chokepoint
// sees both the request start and every stream event, so it is the one producer
// of time-to-first-output. A streamed call carries it (queue + prefill time, so
// outputTokensPerSecond measures generation only); a non-streamed call, and a
// stream that emitted no output delta, omit it.

import { describe, expect, it } from "bun:test";
import { Context, Effect, Layer, Ref, Stream } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import { LLMService, TestLLMServiceLayer, type CompletionRequest, type StreamEvent } from "@reactive-agents/llm-provider";
import { makeObservableLLM } from "../../src/kernel/observable-llm.js";

const request: CompletionRequest = { messages: [{ role: "user", content: "hi" }] };
const usage = { inputTokens: 10, outputTokens: 20, totalTokens: 30, estimatedCost: 0 };

const PREFILL_MS = 60;
const GENERATION_MS = 40;

const sleep = (ms: number): Stream.Stream<never> => Stream.fromEffect(Effect.sleep(`${ms} millis`)).pipe(Stream.drain);

/** Provider double: `prefill` ms of silence, the given first event, `generation` ms, then the rest. */
const delayedProvider = (first: readonly StreamEvent[]) =>
  Layer.effect(
    LLMService,
    Effect.gen(function* () {
      const base = yield* LLMService;
      return {
        ...base,
        complete: () =>
          Effect.sleep(`${PREFILL_MS} millis`).pipe(
            Effect.as({ content: "ok", stopReason: "end_turn" as const, usage, model: "stub" }),
          ),
        stream: () =>
          Effect.succeed(
            sleep(PREFILL_MS).pipe(
              Stream.concat(Stream.fromIterable(first)),
              Stream.concat(sleep(GENERATION_MS)),
              Stream.concat(
                Stream.make<StreamEvent[]>(
                  { type: "content_complete", content: "ok" },
                  { type: "usage", usage },
                ),
              ),
            ),
          ),
      } as Context.Tag.Service<LLMService>;
    }),
  ).pipe(Layer.provide(TestLLMServiceLayer([{ text: "unused" }])));

type Completed = { readonly durationMs: number; readonly firstTokenMs: number | undefined; readonly has: boolean };

const runWith = (call: "complete" | "stream", first: readonly StreamEvent[]) => {
  const llmLayer = Layer.merge(makeObservableLLM().pipe(Layer.provide(delayedProvider(first))), EventBusLive);
  return Effect.runPromise(
    Effect.gen(function* () {
      const sink = yield* Ref.make<readonly Completed[]>([]);
      const bus = yield* EventBus;
      yield* bus.on("LLMRequestCompleted", (ev) =>
        Ref.update(sink, (xs) => [
          ...xs,
          { durationMs: ev.durationMs, firstTokenMs: ev.firstTokenMs, has: "firstTokenMs" in ev },
        ]),
      );
      const llm = yield* LLMService;
      if (call === "complete") yield* llm.complete(request);
      else yield* Stream.runCollect(yield* llm.stream(request));
      return yield* Ref.get(sink);
    }).pipe(Effect.provide(llmLayer)),
  );
};

describe("LLMRequestCompleted.firstTokenMs", () => {
  const firstEvents: ReadonlyArray<readonly [string, StreamEvent]> = [
    ["text delta", { type: "text_delta", text: "ok" }],
    ["thinking delta", { type: "thinking_delta", thinking: "hmm" }],
    ["tool-call start", { type: "tool_use_start", id: "t1", name: "web-search" }],
  ];

  for (const [label, first] of firstEvents) {
    it(`stream(): first output is a ${label} → firstTokenMs covers the silent prefill and is below durationMs`, async () => {
      const completed = await runWith("stream", [first]);
      expect(completed.length).toBe(1);
      const ev = completed[0]!;
      expect(ev.firstTokenMs).toBeDefined();
      // Timer slack: a sleep may fire a few ms early on a loaded box.
      expect(ev.firstTokenMs!).toBeGreaterThanOrEqual(PREFILL_MS - 5);
      expect(ev.firstTokenMs!).toBeLessThanOrEqual(ev.durationMs);
      expect(ev.durationMs - ev.firstTokenMs!).toBeGreaterThanOrEqual(GENERATION_MS - 5);
    });
  }

  it("stream() with no output delta (bookkeeping events only) omits firstTokenMs", async () => {
    const completed = await runWith("stream", []);
    expect(completed.length).toBe(1);
    expect(completed[0]!.has).toBe(false);
  });

  it("complete() omits firstTokenMs (no stream, no first-delta signal)", async () => {
    const completed = await runWith("complete", []);
    expect(completed.length).toBe(1);
    expect(completed[0]!.has).toBe(false);
    expect(completed[0]!.durationMs).toBeGreaterThanOrEqual(PREFILL_MS - 5);
  });
});
