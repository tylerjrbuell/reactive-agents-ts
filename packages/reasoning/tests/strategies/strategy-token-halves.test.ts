// File: tests/strategies/strategy-token-halves.test.ts
//
// Pins that a strategy's direct LLM work (reflexion critique, plan-execute
// reflect + synthesis, the quality gate) carries the provider's input/output
// split into the run's spend. A direct call accounted as `{ tokens, cost }`
// only makes the run's halves unknown (`contributedHalf`), so a provider that
// DID split would show no split for the whole run.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { executeReflexion } from "../../src/strategies/reflexion.js";
import { executePlanExecute } from "../../src/strategies/plan-execute.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import { NO_TOKEN_SPEND, addTokenSpend, tokenSpendOf, usageSpend } from "../../src/kernel/run-budget.js";

describe("TokenSpend helpers", () => {
  it("usageSpend carries the reported split and omits an unreported half", () => {
    expect(usageSpend({ totalTokens: 30, estimatedCost: 0.1, inputTokens: 20, outputTokens: 10 })).toEqual({
      tokens: 30, cost: 0.1, inputTokens: 20, outputTokens: 10,
    });
    expect(usageSpend({ totalTokens: 30, estimatedCost: 0 })).toEqual({ tokens: 30, cost: 0 });
    expect(usageSpend(undefined)).toEqual(NO_TOKEN_SPEND);
  });

  it("addTokenSpend keeps halves known only while both sides knew them", () => {
    const split = { tokens: 30, cost: 0, inputTokens: 20, outputTokens: 10 };
    expect(addTokenSpend(NO_TOKEN_SPEND, split)).toEqual(split);
    expect(addTokenSpend(split, split)).toEqual({ tokens: 60, cost: 0, inputTokens: 40, outputTokens: 20 });
    // An unsplit spend with tokens makes the sum's halves unknown.
    expect(addTokenSpend(split, { tokens: 5, cost: 0 })).toEqual({ tokens: 35, cost: 0 });
  });

  it("tokenSpendOf drops non-spend fields", () => {
    expect(tokenSpendOf({ tokens: 3, cost: 0, inputTokens: 2, outputTokens: 1, ...{ content: "x" } })).toEqual({
      tokens: 3, cost: 0, inputTokens: 2, outputTokens: 1,
    });
  });
});

const PLAN = JSON.stringify({
  steps: [
    { title: "Research the topic", instruction: "Find relevant information", type: "analysis" },
    { title: "Summarize findings", instruction: "Write a clear summary", type: "analysis" },
  ],
});

describe("strategy token halves (provider reports a split)", () => {
  it("reflexion: inputTokens + outputTokens equals tokensUsed", async () => {
    const result = await Effect.runPromise(
      provideTestEnvelope(
        executeReflexion({
          taskDescription: "Explain quantum entanglement briefly.",
          taskType: "explanation",
          memoryContext: "",
          availableTools: [],
          config: {
            ...defaultReasoningConfig,
            strategies: {
              ...defaultReasoningConfig.strategies,
              reflexion: { ...defaultReasoningConfig.strategies.reflexion, maxRetries: 2 },
            },
          },
        }).pipe(Effect.provide(TestLLMServiceLayer())),
      ),
    );
    // The critique ran: a direct call joined the spend.
    expect(result.steps.some((s) => s.content.includes("[CRITIQUE"))).toBe(true);
    const { tokensUsed, inputTokens, outputTokens } = result.metadata;
    expect(tokensUsed).toBeGreaterThan(0);
    expect(inputTokens).toBeNumber();
    expect(outputTokens).toBeNumber();
    expect((inputTokens ?? 0) + (outputTokens ?? 0)).toBe(tokensUsed);
  });

  it("plan-execute: inputTokens + outputTokens equals tokensUsed", async () => {
    const layer = TestLLMServiceLayer([
      { match: "planning agent", text: PLAN },
      { match: "OVERALL GOAL", text: "FINAL ANSWER: Step analysis completed successfully." },
      { match: "OVERALL GOAL", text: "FINAL ANSWER: Summary written." },
      { match: "GOAL:", text: "SATISFIED: All steps completed and the task is fully addressed." },
      { match: "Synthesize", text: "The topic has been thoroughly researched and summarized with key findings." },
    ]);
    const result = await Effect.runPromise(
      provideTestEnvelope(
        executePlanExecute({
          taskDescription: "Research quantum computing trends",
          taskType: "research",
          memoryContext: "",
          availableTools: [],
          config: defaultReasoningConfig,
        }).pipe(Effect.provide(layer)),
      ),
    );
    // Reflect and synthesis ran: direct calls joined the spend.
    expect(result.steps.some((s) => s.content.startsWith("[SYNTHESIS"))).toBe(true);
    const { tokensUsed, inputTokens, outputTokens } = result.metadata;
    expect(tokensUsed).toBeGreaterThan(0);
    expect(inputTokens).toBeNumber();
    expect(outputTokens).toBeNumber();
    expect((inputTokens ?? 0) + (outputTokens ?? 0)).toBe(tokensUsed);
  });
});
