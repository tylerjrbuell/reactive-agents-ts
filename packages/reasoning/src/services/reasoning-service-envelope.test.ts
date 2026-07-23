// File: src/services/reasoning-service-envelope.test.ts
//
// Proves the cross-cutting cascade wiring (Task 2): the RunEnvelope built at
// the call site (`buildRunEnvelope`) is PROVIDED into the strategy effect by
// `ReasoningService.execute`, and a strategy can read it via `yield* RunEnvelope`.
// Zero behavior change — no production strategy reads the envelope yet.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { ReasoningService } from "./reasoning-service.js";
import { createReasoningLayer } from "../runtime.js";
import { defaultReasoningConfig } from "../types/config.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { RunEnvelope, buildRunEnvelope } from "../kernel/envelope/run-envelope.js";
import type { StrategyFn } from "./strategy-registry.js";
import { finalizeStrategyResult } from "../kernel/capabilities/sense/finalize-result.js";

describe("ReasoningService provides RunEnvelope to strategy effects", () => {
  const llmLayer = TestLLMServiceLayer([
    { match: "Think step-by-step", text: "FINAL ANSWER: The answer is 42." },
  ]);

  const reasoningLayer = createReasoningLayer({
    ...defaultReasoningConfig,
    adaptive: { enabled: false, learning: false },
  });

  // Combine: reasoning needs LLMService
  const testLayer = Layer.provide(reasoningLayer, llmLayer);

  it("a probe strategy can read the envelope the caller passed to execute()", async () => {
    // Probe strategy: returns the fabricationGuard it observes via the service.
    const probe: StrategyFn = () =>
      Effect.gen(function* () {
        const env = yield* RunEnvelope;
        // Task 5: StrategyFn returns the branded JudgedReasoningResult — even a
        // probe strategy has to cross the terminal mint.
        return yield* finalizeStrategyResult({
          strategy: "reflexion",
          steps: [],
          output: env.policy.fabricationGuard ?? "none",
          status: "completed",
          start: Date.now(),
          totalTokens: 0,
          totalCost: 0,
        });
      });

    const program = Effect.gen(function* () {
      const reasoning = yield* ReasoningService;

      yield* reasoning.registerStrategy("reflexion", probe);

      const result = yield* reasoning.execute({
        taskDescription: "A task",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        strategy: "reflexion",
        envelope: buildRunEnvelope({ fabricationGuard: "warn" }),
      });

      expect(result.output).toBe("warn");
    });

    await Effect.runPromise(program.pipe(Effect.provide(testLayer)));
  });

  it("defaults to emptyRunEnvelope when no envelope is passed", async () => {
    const probe: StrategyFn = () =>
      Effect.gen(function* () {
        const env = yield* RunEnvelope;
        // Task 5: StrategyFn returns the branded JudgedReasoningResult — even a
        // probe strategy has to cross the terminal mint.
        return yield* finalizeStrategyResult({
          strategy: "reflexion",
          steps: [],
          output: env.policy.fabricationGuard ?? "none",
          status: "completed",
          start: Date.now(),
          totalTokens: 0,
          totalCost: 0,
        });
      });

    const program = Effect.gen(function* () {
      const reasoning = yield* ReasoningService;

      yield* reasoning.registerStrategy("reflexion", probe);

      const result = yield* reasoning.execute({
        taskDescription: "A task",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        strategy: "reflexion",
      });

      expect(result.output).toBe("none");
    });

    await Effect.runPromise(program.pipe(Effect.provide(testLayer)));
  });
});
