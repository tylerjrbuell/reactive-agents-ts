// Run: bun test packages/reasoning/tests/kernel/seam-cost-honesty.test.ts --timeout 20000
//
// Cost honesty at the observable LLM chokepoint (token-cost-accuracy audit F5,
// 2026-11-19). Provider usage without `estimatedCost` means the model's price is
// UNKNOWN, not $0. This suite pins:
// - LLMRequestCompleted omits `estimatedCost` and says `priceSource: "unknown"`;
// - the run meter marks its cost incomplete (`costComplete: false`) and keeps
//   the known part as a lower bound;
// - a priced call is unchanged (same numbers, provenance carried through);
// - kernel `state.cost` never becomes NaN on an unpriced stream.

import { describe, expect, it } from "bun:test";
import { Context, Effect, Layer, Ref, Stream } from "effect";
import { EventBus, EventBusLive, type PriceSource } from "@reactive-agents/core";
import {
  LLMService,
  TestLLMServiceLayer,
  type CompletionRequest,
  type StreamEvent,
  type TokenUsage,
} from "@reactive-agents/llm-provider";
import { makeObservableLLM } from "../../src/kernel/observable-llm.js";
import {
  addTokenSpend,
  applyRunSpend,
  costSumOf,
  makeRunBudgetMeter,
  usageSpend,
  withRunBudgetMeter,
} from "../../src/kernel/run-budget.js";
import { executeReActKernel } from "../../src/kernel/loop/react-kernel.js";

const request: CompletionRequest = { messages: [{ role: "user", content: "hi" }] };

const UNPRICED: TokenUsage = { inputTokens: 60, outputTokens: 40, totalTokens: 100, priceSource: "unknown" };
const PRICED: TokenUsage = {
  inputTokens: 60,
  outputTokens: 40,
  totalTokens: 100,
  estimatedCost: 0.01,
  priceSource: "price-book",
};

/** Provider double whose complete() and stream() report `usage`. */
const providerWith = (usage: TokenUsage, text = "ok") =>
  Layer.effect(
    LLMService,
    Effect.gen(function* () {
      const base = yield* LLMService;
      return {
        ...base,
        complete: () =>
          Effect.succeed({ content: text, stopReason: "end_turn" as const, usage, model: "stub" }),
        stream: () =>
          Effect.succeed(
            Stream.make<StreamEvent[]>(
              { type: "text_delta", text },
              { type: "content_complete", content: text },
              { type: "usage", usage },
            ),
          ),
      } as Context.Tag.Service<LLMService>;
    }),
  ).pipe(Layer.provide(TestLLMServiceLayer([{ text: "unused" }])));

type Completed = {
  readonly hasCost: boolean;
  readonly estimatedCost: number | undefined;
  readonly priceSource: PriceSource | undefined;
};

const runWith = (usages: readonly TokenUsage[], call: "complete" | "stream") => {
  const meter = makeRunBudgetMeter();
  const run = Effect.gen(function* () {
    const sink = yield* Ref.make<readonly Completed[]>([]);
    for (const usage of usages) {
      const llmLayer = Layer.merge(makeObservableLLM().pipe(Layer.provide(providerWith(usage))), EventBusLive);
      yield* Effect.gen(function* () {
        const bus = yield* EventBus;
        yield* bus.on("LLMRequestCompleted", (ev) =>
          Ref.update(sink, (xs) => [
            ...xs,
            { hasCost: "estimatedCost" in ev, estimatedCost: ev.estimatedCost, priceSource: ev.priceSource },
          ]),
        );
        const llm = yield* LLMService;
        if (call === "complete") yield* llm.complete(request);
        else yield* Stream.runCollect(yield* llm.stream(request));
      }).pipe(Effect.provide(llmLayer));
    }
    return yield* Ref.get(sink);
  });
  return Effect.runPromise(withRunBudgetMeter(run, meter)).then((completed) => ({ completed, meter }));
};

describe("observable LLM — unknown price stays unknown", () => {
  for (const call of ["complete", "stream"] as const) {
    it(`${call}(): an unpriced call publishes no estimatedCost, priceSource "unknown"; meter cost incomplete`, async () => {
      const { completed, meter } = await runWith([UNPRICED], call);
      expect(completed).toEqual([{ hasCost: false, estimatedCost: undefined, priceSource: "unknown" }]);
      expect(meter.cost).toBe(0);
      expect(meter.costComplete).toBe(false);
      expect(meter.tokens).toBe(100);
    });

    it(`${call}(): a priced call is unchanged; provenance rides the event; meter complete`, async () => {
      const { completed, meter } = await runWith([PRICED], call);
      expect(completed).toEqual([{ hasCost: true, estimatedCost: 0.01, priceSource: "price-book" }]);
      expect(meter.cost).toBeCloseTo(0.01, 12);
      // Absent = complete: a fully priced meter stays byte-identical.
      expect("costComplete" in meter).toBe(false);
      expect(costSumOf(meter)).toEqual({ usd: meter.cost, complete: true });
    });

    it(`${call}(): priced then unpriced keeps the known part as a lower bound and marks the run incomplete`, async () => {
      const { meter } = await runWith([PRICED, UNPRICED, PRICED], call);
      expect(meter.cost).toBeCloseTo(0.02, 12);
      expect(costSumOf(meter).complete).toBe(false);
      expect(meter.llmCalls).toBe(3);
    });
  }
});

describe("run meter cost completeness", () => {
  it("is sticky: a later priced spend does not restore completeness", () => {
    const meter = makeRunBudgetMeter();
    applyRunSpend(meter, usageSpend(UNPRICED));
    applyRunSpend(meter, usageSpend(PRICED));
    expect(meter.costComplete).toBe(false);
    expect(meter.cost).toBeCloseTo(0.01, 12);
  });

  it("a combined spend carries incompleteness and its known cost", () => {
    const sum = addTokenSpend(usageSpend(PRICED), usageSpend(UNPRICED));
    expect(sum.cost).toBeCloseTo(0.01, 12);
    expect(sum.costComplete).toBe(false);
    expect(addTokenSpend(usageSpend(PRICED), usageSpend(PRICED)).costComplete).toBeUndefined();
  });
});

describe("kernel state.cost — never NaN", () => {
  it("an unpriced stream leaves totalCost a finite known lower bound", async () => {
    const result = await Effect.runPromise(
      executeReActKernel({ task: "Simple task", maxIterations: 2 }).pipe(
        Effect.provide(providerWith(UNPRICED, "FINAL ANSWER: done.")),
      ),
    );
    expect(Number.isNaN(result.totalCost)).toBe(false);
    expect(result.totalCost).toBe(0);
  });

  it("a priced stream sums the reported cost", async () => {
    const result = await Effect.runPromise(
      executeReActKernel({ task: "Simple task", maxIterations: 2 }).pipe(
        Effect.provide(providerWith(PRICED, "FINAL ANSWER: done.")),
      ),
    );
    expect(result.totalCost).toBeGreaterThan(0);
    expect(Number.isFinite(result.totalCost)).toBe(true);
  });
});
