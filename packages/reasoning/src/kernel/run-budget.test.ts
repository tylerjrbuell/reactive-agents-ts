// Run: bun test packages/reasoning/src/kernel/run-budget.test.ts --timeout 20000
//
// Issue #231 / DEBT D-2026-10-05-P — the run-scoped LLM spend meter.
//
// The Arbitrator's pre-intent budget guard reads `state.tokens`, which
// `initialKernelState` resets per kernel, so multi-kernel strategies that also
// make direct LLM calls each get a fresh budget pool. This suite pins the
// mechanism that fixes it: the observable LLM wrapper feeds a plain mutable
// meter carried on the ambient `CurrentRunBudget` FiberRef; the runner stores
// the LIVE reference on `state.meta.runBudgetMeter`; the pure+sync Arbitrator
// reads it.
//
// Co-located under src/kernel/** (authority bound) — imports strategies
// read-only.

import { describe, expect, it } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { LLMService, TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import type { CompletionRequest } from "@reactive-agents/llm-provider";
import { makeObservableLLM } from "./observable-llm.js";
import {
  CurrentRunBudget,
  addRunSpend,
  makeRunBudgetMeter,
  withRunBudgetMeter,
} from "./run-budget.js";
import {
  initialKernelState,
  transitionState,
  type KernelState,
  type ThoughtKernel,
} from "./state/kernel-state.js";
import { runKernel } from "./loop/runner.js";
import { arbitrate, arbitrationContextFromState } from "./capabilities/decide/arbitrator.js";
import { serializeKernelState, deserializeKernelState } from "./state/kernel-codec.js";

const baseState = (): KernelState =>
  initialKernelState({ maxIterations: 5, strategy: "reactive", kernelType: "react" });

describe("run-budget — meter primitive", () => {
  it("makeRunBudgetMeter starts zeroed and addRunSpend accumulates in place", async () => {
    const meter = makeRunBudgetMeter();
    expect(meter).toEqual({ tokens: 0, cost: 0 });

    await Effect.runPromise(
      withRunBudgetMeter(
        Effect.gen(function* () {
          yield* addRunSpend({ tokens: 120, cost: 0.001 });
          yield* addRunSpend({ tokens: 30, cost: 0.002 });
        }),
        meter,
      ),
    );

    expect(meter.tokens).toBe(150);
    expect(meter.cost).toBeCloseTo(0.003, 10);
  });

  it("addRunSpend is a no-op when no ambient meter is armed", async () => {
    // No withRunBudgetMeter wrapper → CurrentRunBudget is null.
    const before = await Effect.runPromise(Effect.succeed(null));
    await Effect.runPromise(addRunSpend({ tokens: 999, cost: 9.99 }));
    expect(before).toBeNull();
  });

  it("Effect.locally scopes the meter to the fiber subtree", async () => {
    const outer = makeRunBudgetMeter();
    const inner = makeRunBudgetMeter();
    await Effect.runPromise(
      withRunBudgetMeter(
        Effect.gen(function* () {
          yield* addRunSpend({ tokens: 10, cost: 0 });
          yield* withRunBudgetMeter(addRunSpend({ tokens: 7, cost: 0 }), inner);
          yield* addRunSpend({ tokens: 5, cost: 0 });
        }),
        outer,
      ),
    );
    expect(outer.tokens).toBe(15);
    expect(inner.tokens).toBe(7);
  });
});

describe("run-budget — observable LLM wrapper feeds the meter", () => {
  const request: CompletionRequest = {
    messages: [{ role: "user", content: "hello world, this is a prompt" }],
    systemPrompt: "you are a test",
  };

  it("complete() advances the ambient meter by the response usage", async () => {
    const meter = makeRunBudgetMeter();
    const llmLayer = makeObservableLLM().pipe(
      Layer.provide(TestLLMServiceLayer([{ text: "a short reply" }])),
    );

    const response = await Effect.runPromise(
      withRunBudgetMeter(
        Effect.gen(function* () {
          const llm = yield* LLMService;
          return yield* llm.complete(request);
        }).pipe(Effect.provide(llmLayer)),
        meter,
      ),
    );

    expect(response.usage?.totalTokens ?? 0).toBeGreaterThan(0);
    expect(meter.tokens).toBe(response.usage?.totalTokens ?? -1);
  });

  it("stream() advances the ambient meter by the accumulated usage event", async () => {
    const meter = makeRunBudgetMeter();
    const llmLayer = makeObservableLLM().pipe(
      Layer.provide(TestLLMServiceLayer([{ text: "a streamed reply" }])),
    );

    const collected = await Effect.runPromise(
      withRunBudgetMeter(
        Effect.gen(function* () {
          const llm = yield* LLMService;
          const stream = yield* llm.stream(request);
          return yield* Stream.runCollect(stream);
        }).pipe(Effect.provide(llmLayer)),
        meter,
      ),
    );

    expect(collected.length).toBeGreaterThan(0);
    expect(meter.tokens).toBeGreaterThan(0);
  });
});

describe("run-budget — Arbitrator consumes run spend", () => {
  it("arbitrationContextFromState uses the live meter and maxes it over state.tokens", () => {
    const state = transitionState(baseState(), {
      tokens: 5,
      cost: 0.01,
      meta: {
        ...baseState().meta,
        budgetLimits: { tokenLimit: 100 },
        runBudgetMeter: { tokens: 250, cost: 0.02 },
      },
    });

    const ctx = arbitrationContextFromState(state, { task: "t" });
    expect(ctx.budget?.tokensUsed).toBe(250);
    expect(ctx.budget?.costUsd).toBe(0.02);
    expect(ctx.budget?.status).toBe("exceeded");

    // The guard DOMINATES every intent kind.
    const verdict = arbitrate({ kind: "max-iterations", output: "partial" }, ctx);
    expect(verdict.action).toBe("exit-failure");
    if (verdict.action !== "exit-failure") throw new Error("expected exit-failure");
    expect(verdict.terminatedBy).toBe("budget_exceeded");
  });

  it("falls back to state.tokens when no meter is present", () => {
    const state = transitionState(baseState(), {
      tokens: 250,
      meta: { ...baseState().meta, budgetLimits: { tokenLimit: 100 } },
    });
    const ctx = arbitrationContextFromState(state, { task: "t" });
    expect(ctx.budget?.tokensUsed).toBe(250);
    expect(ctx.budget?.status).toBe("exceeded");
  });
});

describe("run-budget — runner seeds the live meter onto state.meta", () => {
  it("runKernel stores the ambient meter reference on the terminal state", async () => {
    const meter = makeRunBudgetMeter();
    // Seed spend before the run: the terminal state's meta must carry the LIVE
    // reference, not a copy, so later mutation is visible to the Arbitrator.
    meter.tokens = 42;

    const kernel: ThoughtKernel = (state) =>
      Effect.succeed(transitionState(state, { status: "done", output: "done" }));

    const finalState = await Effect.runPromise(
      withRunBudgetMeter(
        runKernel(kernel, { task: "t" }, { maxIterations: 3, strategy: "reactive", kernelType: "react" }).pipe(
          Effect.provide(TestLLMServiceLayer([{ text: "x" }])),
        ),
        meter,
      ),
    );

    expect(finalState.meta.runBudgetMeter).toBe(meter);
    meter.tokens += 8;
    expect(finalState.meta.runBudgetMeter?.tokens).toBe(50);
  });

  it("resume max-seeds the fresh ambient meter from the persisted state", async () => {
    // A checkpoint restored from disk carries the spend recorded before the
    // crash as plain data. The runner must not forget it.
    const resumeState = transitionState(baseState(), {
      meta: { ...baseState().meta, runBudgetMeter: { tokens: 500, cost: 1.25 } },
    });
    const meter = makeRunBudgetMeter();
    meter.tokens = 10; // fresh process, fresh ambient meter

    const kernel: ThoughtKernel = (state) =>
      Effect.succeed(transitionState(state, { status: "done", output: "done" }));

    const finalState = await Effect.runPromise(
      withRunBudgetMeter(
        runKernel(
          kernel,
          { task: "t", resumeState },
          { maxIterations: 3, strategy: "reactive", kernelType: "react" },
        ).pipe(Effect.provide(TestLLMServiceLayer([{ text: "x" }]))),
        meter,
      ),
    );

    expect(meter.tokens).toBe(500);
    expect(meter.cost).toBe(1.25);
    expect(finalState.meta.runBudgetMeter).toBe(meter);
  });
});

describe("run-budget — codec round-trips the meter as data", () => {
  it("serialize/deserialize preserves runBudgetMeter numbers", () => {
    const state = transitionState(baseState(), {
      meta: { ...baseState().meta, runBudgetMeter: { tokens: 1234, cost: 0.567 } },
    });

    const restored = deserializeKernelState(serializeKernelState(state));
    expect(restored.meta.runBudgetMeter).toEqual({ tokens: 1234, cost: 0.567 });
    // The restored meter is a fresh data object, not the live reference.
    expect(restored.meta.runBudgetMeter).not.toBe(state.meta.runBudgetMeter);
  });
});
