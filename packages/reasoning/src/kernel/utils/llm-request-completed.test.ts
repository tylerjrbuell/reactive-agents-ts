import { describe, expect, it } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { EventBus, type AgentEvent } from "@reactive-agents/core";
import { emitLLMExchange } from "./diagnostics.js";

/**
 * Recording EventBus stub — collects every published event for assertions.
 *
 * Implemented against the real `EventBus.Service` shape rather than cast into
 * it: `publish` takes an `AgentEvent`, and the two subscription methods return
 * a no-op unsubscribe, which is structurally what the tag declares. Keeping
 * the sink typed as `AgentEvent[]` also means `find(e => e._tag === "…")`
 * narrows to the real event variant, so the assertions below check the actual
 * published field types instead of a `Record<string, unknown>` bag.
 */
const recordingBus = (sink: Ref.Ref<readonly AgentEvent[]>) =>
  Layer.succeed(EventBus, {
    publish: (event: AgentEvent) => Ref.update(sink, (prev) => [...prev, event]),
    on: () => Effect.succeed(() => {}),
    subscribe: () => Effect.succeed(() => {}),
  });

const baseArgs = {
  taskId: "task-1",
  iteration: 3,
  provider: "anthropic",
  model: "claude-haiku-4-5-20251001",
  requestKind: "complete" as const,
  systemPrompt: "you are a test",
  messages: [{ role: "user" as const, content: "hi" }],
  toolSchemaNames: ["file-read"],
};

describe("emitLLMExchange -> LLMRequestCompleted", () => {
  it("publishes LLMRequestCompleted alongside LLMExchangeEmitted", async () => {
    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* Ref.make<readonly AgentEvent[]>([]);
        yield* emitLLMExchange({
          ...baseArgs,
          response: {
            content: "ok",
            tokensIn: 10_000,
            tokensOut: 500,
            cacheReadTokensIn: 9_000,
            costUsd: 0.004,
            durationMs: 1_200,
          },
        }).pipe(Effect.provide(recordingBus(sink)));
        return yield* Ref.get(sink);
      }),
    );

    const tags = events.map((e) => e._tag);
    expect(tags).toContain("LLMExchangeEmitted");
    expect(tags).toContain("LLMRequestCompleted");
  });

  it("carries billed tokens, cache reads and the raw total", async () => {
    const completed = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* Ref.make<readonly AgentEvent[]>([]);
        yield* emitLLMExchange({
          ...baseArgs,
          promptPrefixHash: "aaaaaaaaaaaaaaaa",
          toolSurfaceHash: "bbbbbbbbbbbbbbbb",
          response: {
            content: "ok",
            tokensIn: 10_000,
            tokensOut: 500,
            cacheReadTokensIn: 9_000,
            costUsd: 0.004,
            durationMs: 1_200,
          },
        }).pipe(Effect.provide(recordingBus(sink)));
        const all = yield* Ref.get(sink);
        return all.find((e) => e._tag === "LLMRequestCompleted");
      }),
    );

    expect(completed).toBeDefined();
    expect(completed?.tokensUsed).toBe(10_500); // RAW, unchanged semantics
    expect(completed?.billedTokens).toBe(1_500); // (10000 - 9000) + 500
    expect(completed?.cacheReadTokensIn).toBe(9_000);
    expect(completed?.cached).toBe(true);
    expect(completed?.estimatedCost).toBe(0.004);
    expect(completed?.durationMs).toBe(1_200);
    expect(completed?.model).toBe("claude-haiku-4-5-20251001");
    expect(completed?.provider).toBe("anthropic");
    expect(completed?.promptPrefixHash).toBe("aaaaaaaaaaaaaaaa");
    expect(completed?.toolSurfaceHash).toBe("bbbbbbbbbbbbbbbb");
  });

  it("omits cache fields and reports cached=false when the provider reports none", async () => {
    const completed = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* Ref.make<readonly AgentEvent[]>([]);
        yield* emitLLMExchange({
          ...baseArgs,
          response: { content: "ok", tokensIn: 800, tokensOut: 200, durationMs: 90 },
        }).pipe(Effect.provide(recordingBus(sink)));
        const all = yield* Ref.get(sink);
        return all.find((e) => e._tag === "LLMRequestCompleted");
      }),
    );

    expect(completed?.tokensUsed).toBe(1_000);
    expect(completed?.billedTokens).toBe(1_000);
    expect("cacheReadTokensIn" in (completed ?? {})).toBe(false);
    expect(completed?.cached).toBe(false);
  });

  it("does not throw when no EventBus is provided", async () => {
    await Effect.runPromise(
      emitLLMExchange({
        ...baseArgs,
        response: { content: "ok", tokensIn: 1, tokensOut: 1 },
      }),
    );
    expect(true).toBe(true);
  });
});
