// Run: bun test packages/reasoning/tests/kernel/token-halves-unknown.test.ts --timeout 20000
//
// TokenUsage `inputTokens` / `outputTokens` are optional (2026-11-10): an absent
// half means the provider did not split its count, never a measured 0. This
// suite pins the one aggregation rule (`addKnown`) and its end-to-end effect at
// the observable LLM chokepoint: a call with no split leaves the halves unknown
// on LLMRequestCompleted and on the run meter, while the total is unchanged.

import { describe, expect, it } from "bun:test";
import { Context, Effect, Layer, Ref, Stream } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import { LLMService, TestLLMServiceLayer, type CompletionRequest, type StreamEvent } from "@reactive-agents/llm-provider";
import { addKnown, contributedHalf } from "../../src/kernel/utils/known-count.js";
import { makeObservableLLM } from "../../src/kernel/observable-llm.js";
import { applyRunSpend, makeRunBudgetMeter, withRunBudgetMeter } from "../../src/kernel/run-budget.js";

describe("addKnown", () => {
  it("sums two known counts", () => {
    expect(addKnown(3, 4)).toBe(7);
    expect(addKnown(0, 0)).toBe(0);
  });

  it("is unknown when either side is unknown", () => {
    expect(addKnown(undefined, 4)).toBeUndefined();
    expect(addKnown(3, undefined)).toBeUndefined();
    expect(addKnown(undefined, undefined)).toBeUndefined();
  });
});

describe("contributedHalf", () => {
  it("keeps a reported half, a zero-token contribution is a known 0, a spent-but-unsplit one is unknown", () => {
    expect(contributedHalf(7, 10)).toBe(7);
    expect(contributedHalf(undefined, 0)).toBe(0);
    expect(contributedHalf(undefined, undefined)).toBe(0);
    expect(contributedHalf(undefined, 10)).toBeUndefined();
  });

  it("a zero-token spend leaves the meter halves known", () => {
    const meter = makeRunBudgetMeter();
    applyRunSpend(meter, { tokens: 10, cost: 0, inputTokens: 7, outputTokens: 3 });
    applyRunSpend(meter, { tokens: 0, cost: 0 });
    expect(meter.inputTokens).toBe(7);
    expect(meter.outputTokens).toBe(3);
  });
});

describe("run meter — an unknown half stays unknown", () => {
  it("a spend with no split makes the meter halves unknown; tokens still add", () => {
    const meter = makeRunBudgetMeter();
    applyRunSpend(meter, { tokens: 10, cost: 0, inputTokens: 7, outputTokens: 3, llmCalls: 1 });
    applyRunSpend(meter, { tokens: 100, cost: 0, llmCalls: 1 });
    applyRunSpend(meter, { tokens: 5, cost: 0, inputTokens: 4, outputTokens: 1, llmCalls: 1 });
    expect(meter.tokens).toBe(115);
    expect(meter.llmCalls).toBe(3);
    expect(meter.inputTokens).toBeUndefined();
    expect(meter.outputTokens).toBeUndefined();
  });
});

const request: CompletionRequest = { messages: [{ role: "user", content: "hi" }] };

/** Provider double that reports a total but no input/output split. */
const noSplitUsage = { totalTokens: 100, estimatedCost: 0.01 };
const noSplitProvider = Layer.effect(
  LLMService,
  Effect.gen(function* () {
    const base = yield* LLMService;
    return {
      ...base,
      complete: () =>
        Effect.succeed({
          content: "ok",
          stopReason: "end_turn" as const,
          usage: noSplitUsage,
          model: "stub",
        }),
      stream: () =>
        Effect.succeed(
          Stream.make<StreamEvent[]>(
            { type: "text_delta", text: "ok" },
            { type: "content_complete", content: "ok" },
            { type: "usage", usage: noSplitUsage },
          ),
        ),
    } as Context.Tag.Service<LLMService>;
  }),
).pipe(Layer.provide(TestLLMServiceLayer([{ text: "unused" }])));

type Completed = { readonly tokensUsed: number; readonly hasIn: boolean; readonly hasOut: boolean; readonly hasBilled: boolean };

const runWith = (call: "complete" | "stream") => {
  const meter = makeRunBudgetMeter();
  const llmLayer = Layer.merge(makeObservableLLM().pipe(Layer.provide(noSplitProvider)), EventBusLive);
  return Effect.runPromise(
    withRunBudgetMeter(
      Effect.gen(function* () {
        const sink = yield* Ref.make<readonly Completed[]>([]);
        const bus = yield* EventBus;
        yield* bus.on("LLMRequestCompleted", (ev) =>
          Ref.update(sink, (xs) => [
            ...xs,
            { tokensUsed: ev.tokensUsed, hasIn: "tokensIn" in ev, hasOut: "tokensOut" in ev, hasBilled: "billedTokens" in ev },
          ]),
        );
        const llm = yield* LLMService;
        if (call === "complete") yield* llm.complete(request);
        else yield* Stream.runCollect(yield* llm.stream(request));
        return yield* Ref.get(sink);
      }).pipe(Effect.provide(llmLayer)),
      meter,
    ),
  ).then((completed) => ({ completed, meter }));
};

describe("observable LLM — a call with no split", () => {
  for (const call of ["complete", "stream"] as const) {
    it(`${call}(): LLMRequestCompleted omits both halves and billedTokens; the meter halves are unknown; totals unchanged`, async () => {
      const { completed, meter } = await runWith(call);
      expect(completed.length).toBe(1);
      expect(completed[0]).toEqual({ tokensUsed: 100, hasIn: false, hasOut: false, hasBilled: false });
      expect(meter.tokens).toBe(100);
      expect(meter.cost).toBeCloseTo(0.01, 10);
      expect(meter.llmCalls).toBe(1);
      expect(meter.inputTokens).toBeUndefined();
      expect(meter.outputTokens).toBeUndefined();
    });
  }
});
