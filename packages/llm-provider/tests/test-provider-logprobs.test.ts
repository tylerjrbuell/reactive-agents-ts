import { describe, it, expect } from "bun:test";
import { Effect, Stream } from "effect";
import { LLMService, TestLLMServiceLayer } from "../src/index.js";
import type { TokenLogprob } from "../src/types.js";

const fixtureLogprobs: readonly TokenLogprob[] = [
  {
    token: "Paris",
    logprob: -0.0234,
    topLogprobs: [
      { token: "Paris", logprob: -0.0234 },
      { token: "London", logprob: -3.89 },
    ],
  },
  {
    token: ".",
    logprob: -0.12,
  },
];

const run = <A>(
  effect: Effect.Effect<A, unknown, LLMService>,
  layer: ReturnType<typeof TestLLMServiceLayer>,
) => Effect.runPromise(effect.pipe(Effect.provide(layer)));

describe("TestLLMService — logprobs round-trip", () => {
  it("surfaces TestTurn.logprobs on CompletionResponse from complete()", async () => {
    const layer = TestLLMServiceLayer([
      { text: "Paris.", logprobs: fixtureLogprobs },
    ]);

    const result = await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "Capital of France?" }],
        });
      }),
      layer,
    );

    expect(result.content).toBe("Paris.");
    expect(result.logprobs).toBeDefined();
    expect(result.logprobs!.length).toBe(2);
    expect(result.logprobs![0].token).toBe("Paris");
    expect(result.logprobs![0].logprob).toBe(-0.0234);
    expect(result.logprobs![0].topLogprobs).toBeDefined();
    expect(result.logprobs![0].topLogprobs!.length).toBe(2);
  });

  it("emits a logprobs StreamEvent from stream() for text turns", async () => {
    const layer = TestLLMServiceLayer([
      { text: "Paris.", logprobs: fixtureLogprobs },
    ]);

    const events = await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const stream = yield* llm.stream({
          messages: [{ role: "user", content: "Capital of France?" }],
        });
        return yield* Stream.runCollect(stream);
      }),
      layer,
    );

    const arr = Array.from(events);
    const logprobsEvent = arr.find((e) => e.type === "logprobs");
    expect(logprobsEvent).toBeDefined();
    if (logprobsEvent && logprobsEvent.type === "logprobs") {
      expect(logprobsEvent.logprobs.length).toBe(2);
      expect(logprobsEvent.logprobs[0].token).toBe("Paris");
      expect(logprobsEvent.logprobs[0].logprob).toBe(-0.0234);
    }
  });

  it("surfaces logprobs on json turns too", async () => {
    const layer = TestLLMServiceLayer([
      { json: { ok: true }, logprobs: fixtureLogprobs },
    ]);

    const result = await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "anything" }],
        });
      }),
      layer,
    );

    expect(result.content).toBe(JSON.stringify({ ok: true }));
    expect(result.logprobs).toBeDefined();
    expect(result.logprobs!.length).toBe(2);
  });

  it("omits logprobs when TestTurn does not declare them", async () => {
    const layer = TestLLMServiceLayer([{ text: "no logprobs here" }]);

    const result = await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "hi" }],
        });
      }),
      layer,
    );

    expect(result.logprobs).toBeUndefined();

    const events = await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const stream = yield* llm.stream({
          messages: [{ role: "user", content: "hi" }],
        });
        return yield* Stream.runCollect(stream);
      }),
      layer,
    );

    const arr = Array.from(events);
    expect(arr.some((e) => e.type === "logprobs")).toBe(false);
  });
});
