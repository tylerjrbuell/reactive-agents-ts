// File: src/services/reasoning-service-run-budget.test.ts
//
// Issue #231 / DEBT D-2026-10-05-P — production wiring proof.
//
// The kernel half (`kernel/run-budget*.test.ts`) pins the meter primitive, the
// observable-wrapper feed, the runner seed, and the Arbitrator consume. This
// file proves the PRODUCTION seam in `ReasoningService.execute`:
//   - with `budgetLimits` declared, ONE run-scoped meter is armed on the ambient
//     `CurrentRunBudget` FiberRef and the observable LLM wrapper feeds it on a
//     real `llm.complete` call from inside a strategy;
//   - without `budgetLimits`, no meter is armed (byte-identical to pre-#231).
import { describe, it, expect } from "bun:test";
import { Effect, FiberRef, Layer } from "effect";
import { LLMService, TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { ReasoningService } from "./reasoning-service.js";
import { createReasoningLayer } from "../runtime.js";
import { defaultReasoningConfig } from "../types/config.js";
import { makeObservableLLM } from "../kernel/observable-llm.js";
import { CurrentRunBudget } from "../kernel/run-budget.js";
import type { StrategyFn } from "./strategy-registry.js";
import { finalizeStrategyResult } from "../kernel/capabilities/sense/finalize-result.js";

// Probe strategy: makes one real LLM call through the observable wrapper, then
// reports the ambient meter's token count and the call's own reported usage as
// `<meterTokens>:<responseTokens>`. A `-1` meter means none was armed.
const probe: StrategyFn = () =>
  Effect.gen(function* () {
    const llm = yield* LLMService;
    // The scripted TestLLMService never fails; `orDie` keeps the probe's error
    // channel inside `StrategyFn`'s `ExecutionError | IterationLimitError`.
    const response = yield* llm
      .complete({
        messages: [{ role: "user", content: "hello from the probe" }],
        systemPrompt: "probe",
      })
      .pipe(Effect.orDie);
    const meter = yield* FiberRef.get(CurrentRunBudget);
    return yield* finalizeStrategyResult({
      strategy: "reflexion",
      steps: [],
      output: `${meter ? meter.tokens : -1}:${response.usage?.totalTokens ?? 0}`,
      status: "completed",
      start: Date.now(),
      totalTokens: 0,
      totalCost: 0,
    });
  });

const observableLlmLayer = makeObservableLLM().pipe(
  Layer.provide(TestLLMServiceLayer([{ text: "a short probe reply" }])),
);
const testLayer = Layer.provide(
  createReasoningLayer({
    ...defaultReasoningConfig,
    adaptive: { enabled: false, learning: false },
  }),
  observableLlmLayer,
);

const runProbe = (budgetLimits?: { tokenLimit: number }) =>
  Effect.gen(function* () {
    const reasoning = yield* ReasoningService;
    yield* reasoning.registerStrategy("reflexion", probe);
    return yield* reasoning.execute({
      taskDescription: "A task",
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      strategy: "reflexion",
      ...(budgetLimits ? { budgetLimits } : {}),
    });
  }).pipe(Effect.provide(testLayer));

describe("ReasoningService.execute arms the run-scoped budget meter", () => {
  it("feeds the ambient meter through the observable wrapper when budgetLimits are declared", async () => {
    const result = await Effect.runPromise(runProbe({ tokenLimit: 1000 }));
    const [meterTokens, responseTokens] = String(result.output).split(":").map(Number);
    // The meter was armed and the wrapper recorded this call's spend.
    expect(meterTokens).toBeGreaterThan(0);
    expect(meterTokens).toBe(responseTokens);
  });

  it("arms no meter when budgetLimits are absent (byte-identical path)", async () => {
    const result = await Effect.runPromise(runProbe());
    const [meterTokens] = String(result.output).split(":").map(Number);
    expect(meterTokens).toBe(-1);
  });
});
