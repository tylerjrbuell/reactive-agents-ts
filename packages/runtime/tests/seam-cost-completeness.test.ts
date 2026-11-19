// Run: bun test packages/runtime/tests/seam-cost-completeness.test.ts --timeout 20000
//
// Cost honesty at the runtime boundary (audit 2026-11-19, F5/F7/F11; Fix plan
// item 4). An unknown price is reported as unknown, never as $0, and a pricing
// outage never fails build().
//
// Pins:
//   C1 — an unpriced call makes the run's result metadata `costComplete: false`
//        (settleRunSpend -> settled split -> assembleTaskResult).
//   C2 — a fully priced run carries no `costComplete` (absent = complete).
//   C3 — an unpriced delegated child makes the parent's meter incomplete
//        (spendOfChildResult carries the child's costComplete).
//   C4 — an end-to-end run whose model has no price: result.metadata.costComplete
//        is false.
//   S1 — the public stream's TokenUsage leaves costUsd ABSENT for an unknown
//        price (was 0) and forwards priceSource.
//   P1 — a failing pricing fetch (non-strict) falls back to user pricing with a
//        typed DynamicPricingUnavailable; a thrown fetch (defect) too.
//   P2 — user pricing beats remote rows.
//   P3 — strict mode still fails on a fetch failure.
//   P4 — build() succeeds with a failing withDynamicPricing provider.
//
// Red-on-cut (verified 2026-11-19): drop the costComplete spread in
// execute-result-assembly.ts -> C1, C4 fail; return the unguarded fetch in
// non-strict mode (what the old `try/catch` amounted to) -> P1, P4 fail; swap
// the merge order -> P2 fails.
import { describe, expect, it } from "bun:test";
import { Effect, Exit, Layer, Stream } from "effect";
import type { AgentId, Task, TaskId } from "@reactive-agents/core";
import { LLMService, TestLLMService, type PricingProvider, type StreamEvent } from "@reactive-agents/llm-provider";
import { addRunSpend, makeRunBudgetMeter, withRunBudgetMeter } from "@reactive-agents/reasoning";
import { assembleTaskResult } from "../src/engine/execute-result-assembly.js";
import { settleRunSpend } from "../src/engine/run-budget-arm.js";
import { foldChildMeter, spendOfChildResult } from "../src/builder/build-effect/child-spend-probe.js";
import { fetchAndMergePricing } from "../src/builder/build-effect/pricing-fetch.js";
import { toTokenUsageStreamEvent } from "../src/engine/token-usage-stream.js";
import { ReactiveAgents } from "../src/builder.js";
import type { ExecutionContext } from "../src/types.js";

const TASK: Task = {
  id: "t1" as TaskId,
  agentId: "a1" as AgentId,
  type: "query",
  input: { question: "q" },
  priority: "medium",
  status: "running",
  metadata: { tags: [] },
  createdAt: new Date(),
};

function makeCtx(): ExecutionContext {
  return {
    taskId: "t1",
    agentId: "a1",
    sessionId: "s1",
    phase: "complete",
    agentState: "completed",
    iteration: 1,
    maxIterations: 4,
    messages: [],
    toolResults: [],
    cost: 0,
    tokensUsed: 0,
    startedAt: new Date(),
    metadata: {},
  };
}

const assemble = (ctx: ExecutionContext) =>
  assembleTaskResult({
    task: TASK,
    ctx,
    rr: undefined,
    verificationOutcome: { output: "done", success: true, blocked: false },
    executionDurationMs: 1,
    toolCallLog: [],
    entropyLog: [],
    terminatedByRaw: "final_answer",
    debrief: undefined,
    boundaryVerification: undefined,
    traceLinkage: null,
    ambientRunMeter: null,
  });

const settleAfter = (...spends: Parameters<typeof addRunSpend>[0][]) =>
  Effect.runPromise(
    withRunBudgetMeter(
      Effect.gen(function* () {
        for (const s of spends) yield* addRunSpend(s);
        return yield* settleRunSpend(makeCtx());
      }),
      makeRunBudgetMeter(),
    ),
  );

const metaOf = (ctx: ExecutionContext) => assemble(ctx).metadata as Record<string, unknown>;

describe("run cost completeness (C)", () => {
  it("C1 an unpriced call makes result metadata costComplete false, cost the known lower bound", async () => {
    const settled = await settleAfter(
      { tokens: 100, cost: 0.002, inputTokens: 60, outputTokens: 40, llmCalls: 1 },
      { tokens: 50, cost: 0, costComplete: false, inputTokens: 30, outputTokens: 20, llmCalls: 1 },
    );
    const md = metaOf(settled);
    expect(md["costComplete"]).toBe(false);
    expect(md["cost"]).toBe(0.002);
    expect(md["tokensUsed"]).toBe(150);
  });

  it("C2 a fully priced run carries no costComplete", async () => {
    const settled = await settleAfter({ tokens: 100, cost: 0.002, inputTokens: 60, outputTokens: 40, llmCalls: 1 });
    expect("costComplete" in metaOf(settled)).toBe(false);
  });

  it("C3 an unpriced child's costComplete folds into the parent's meter", async () => {
    const spend = spendOfChildResult({ tokensUsed: 20, cost: 0.001, costComplete: false, llmCalls: 1 });
    expect(spend.costComplete).toBe(false);
    const meter = makeRunBudgetMeter();
    await Effect.runPromise(withRunBudgetMeter(foldChildMeter(spend), meter));
    expect(meter.costComplete).toBe(false);
    expect(meter.cost).toBe(0.001);
    expect(spendOfChildResult({ tokensUsed: 20, cost: 0.001 }).costComplete).toBeUndefined();
  });

  it("C4 a run on an unpriced model reports result.metadata.costComplete false end to end", async () => {
    const base = TestLLMService([{ text: "done" }]);
    const unpricedUsage = <U extends { readonly estimatedCost?: number }>(u: U) => {
      const { estimatedCost: _dropped, ...rest } = u;
      return { ...rest, priceSource: "unknown" as const };
    };
    const unpriced = Layer.succeed(
      LLMService,
      LLMService.of({
        ...base,
        complete: (req) => base.complete(req).pipe(Effect.map((r) => ({ ...r, usage: unpricedUsage(r.usage) }))),
        stream: (req) =>
          base.stream(req).pipe(
            Effect.map((s) =>
              Stream.map(s, (ev: StreamEvent): StreamEvent => (ev.type === "usage" ? { ...ev, usage: unpricedUsage(ev.usage) } : ev)),
            ),
          ),
      }),
    );
    const agent = await ReactiveAgents.create().withName("unpriced").withProvider("test").withReplayLLM(unpriced).build();
    try {
      const result = await agent.run("say done");
      expect(result.metadata.costComplete).toBe(false);
      expect(result.metadata.tokensUsed).toBeGreaterThan(0);
    } finally {
      await agent.dispose();
    }
  });
});

describe("stream TokenUsage cost (S)", () => {
  const busEvent = (extra: Record<string, unknown>) => ({
    _tag: "LLMRequestCompleted",
    taskId: "t1",
    requestId: "r1",
    tokensUsed: 10,
    tokensIn: 6,
    tokensOut: 4,
    model: "m",
    provider: "p",
    durationMs: 5,
    ...extra,
  });

  it("S1 an unknown price leaves costUsd absent (not 0) and forwards priceSource", () => {
    const unknown = toTokenUsageStreamEvent(busEvent({ priceSource: "unknown" }), "t1") as Record<string, unknown>;
    expect("costUsd" in unknown).toBe(false);
    expect(unknown["priceSource"]).toBe("unknown");
    const priced = toTokenUsageStreamEvent(busEvent({ estimatedCost: 0.01, priceSource: "price-book" }), "t1") as Record<string, unknown>;
    expect(priced["costUsd"]).toBe(0.01);
    expect(priced["priceSource"]).toBe("price-book");
  });
});

describe("dynamic pricing fetch (P)", () => {
  const failing: PricingProvider = { fetchPricing: () => Effect.fail({ name: "PricingDown", message: "boom" }) };
  const throwing: PricingProvider = { fetchPricing: () => Effect.sync(() => JSON.parse("{not json")) };
  const remote: PricingProvider = {
    fetchPricing: () =>
      Effect.succeed({ "my-model": { input: 99, output: 99 }, "other-model": { input: 1, output: 2, cacheRead: 0.1 } }),
  };
  const user = { "my-model": { input: 3, output: 15 } };

  it("P1 a failing fetch falls back to user pricing with a typed warning (failure and defect)", async () => {
    for (const provider of [failing, throwing]) {
      const out = await Effect.runPromise(fetchAndMergePricing({ pricingProvider: provider, pricingRegistry: user, strict: false }));
      expect(out.registry).toEqual(user);
      expect(out.fallback?._tag).toBe("DynamicPricingUnavailable");
    }
  });

  it("P2 user pricing beats remote rows; remote adds unpriced models with cache rates", async () => {
    const out = await Effect.runPromise(fetchAndMergePricing({ pricingProvider: remote, pricingRegistry: user, strict: false }));
    expect(out.registry["my-model"]).toEqual({ input: 3, output: 15 });
    expect(out.registry["other-model"]).toEqual({ input: 1, output: 2, cacheRead: 0.1, origin: "pricing-provider" });
    expect(out.fallback).toBeUndefined();
  });

  it("P3 strict mode still fails the fetch", async () => {
    const exit = await Effect.runPromiseExit(fetchAndMergePricing({ pricingProvider: failing, pricingRegistry: user, strict: true }));
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("P4 build() succeeds with a failing dynamic pricing provider", async () => {
    const agent = await ReactiveAgents.create()
      .withName("pricing-outage")
      .withTestScenario([{ text: "ok" }])
      .withModelPricing(user)
      .withDynamicPricing(failing)
      .build();
    try {
      const result = await agent.run("hi");
      expect(result.success).toBe(true);
    } finally {
      await agent.dispose();
    }
  });
});
