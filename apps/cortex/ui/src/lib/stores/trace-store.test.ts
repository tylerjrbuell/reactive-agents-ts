// Run: cd apps/cortex/ui && bun test src/lib/stores/trace-store.test.ts --timeout 15000
import { describe, expect, it } from "bun:test";
import { get, writable } from "svelte/store";
import { createTraceStore } from "./trace-store.js";
import type { RunState } from "./run-store.js";

const event = (type: string, payload: Record<string, unknown>, ts = 1) => ({ ts, agentId: "a", runId: "r", type, payload });

function framesOf(events: ReturnType<typeof event>[]): Array<Record<string, unknown>> {
  return get(createTraceStore(writable({ events } as unknown as RunState))) as unknown as Array<
    Record<string, unknown>
  >;
}

describe("createTraceStore token halves", () => {
  it("carries the provider split and billed/reasoning onto the iteration frame", () => {
    const frames = framesOf([
      event("LLMRequestCompleted", { tokensUsed: 1500, tokensIn: 1000, tokensOut: 500, billedTokens: 700, reasoningTokens: 120, durationMs: 900 }),
      event("ReasoningIterationProgress", { iteration: 1, toolsThisStep: ["grep"] }),
    ]);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ tokensUsed: 1500, tokensIn: 1000, tokensOut: 500, billedTokens: 700, reasoningTokens: 120 });
  });

  it("an unpriced call leaves the frame's priced cost and marks it partial", () => {
    const frames = framesOf([
      event("LLMRequestCompleted", { tokensUsed: 10, estimatedCost: 0.02, priceSource: "price-book" }),
      event("LLMRequestCompleted", { tokensUsed: 10, priceSource: "unknown" }),
      event("ReasoningIterationProgress", { iteration: 1 }),
      event("LLMRequestCompleted", { tokensUsed: 10, estimatedCost: 0.01, priceSource: "price-book" }),
      event("ReasoningIterationProgress", { iteration: 2 }),
    ]);
    expect(frames[0]).toMatchObject({ estimatedCost: 0.02, costComplete: false });
    expect(frames[1]).toMatchObject({ estimatedCost: 0.01 });
    expect(frames[1]).not.toHaveProperty("costComplete");
  });

  it("leaves halves absent when the call reported no split", () => {
    const frames = framesOf([
      event("LLMRequestCompleted", { tokensUsed: 1500 }),
      event("ReasoningIterationProgress", { iteration: 1 }),
    ]);
    expect(frames[0]).not.toHaveProperty("tokensIn");
    expect(frames[0]).not.toHaveProperty("tokensOut");
    expect(frames[0]).not.toHaveProperty("billedTokens");
  });

  it("resets carries at the frame boundary so iteration 2 does not inherit iteration 1's halves", () => {
    const frames = framesOf([
      event("LLMRequestCompleted", { tokensUsed: 1000, tokensIn: 800, tokensOut: 200 }),
      event("ReasoningIterationProgress", { iteration: 1 }),
      event("LLMRequestCompleted", { tokensUsed: 500, tokensIn: 300, tokensOut: 200 }),
      event("ReasoningIterationProgress", { iteration: 2 }),
    ]);
    expect(frames).toHaveLength(2);
    expect(frames[1]).toMatchObject({ tokensUsed: 500, tokensIn: 300, tokensOut: 200 });
  });
});

describe("createTraceStore one row per loop", () => {
  it("folds an iteration reported twice (tools, then think) into one row (2026-11-11 QA: 'Loop 1' twice)", () => {
    const frames = framesOf([
      event("ReasoningStepCompleted", { thought: "Plan it" }),
      event("ReasoningIterationProgress", { iteration: 0, toolsThisStep: [] }),
      event("ToolCallCompleted", { durationMs: 40 }),
      event("ReasoningIterationProgress", { iteration: 1, toolsThisStep: ["todo"] }),
      event("LLMRequestCompleted", { tokensUsed: 300 }),
      event("ReasoningStepCompleted", { thought: "Now search" }),
      event("ReasoningIterationProgress", { iteration: 1, toolsThisStep: [] }),
    ]);
    expect(frames.map((f) => f.iteration)).toEqual([0, 1]);
    expect(frames[1]).toMatchObject({ thought: "Now search", toolsThisStep: ["todo"], toolName: "todo", tokensUsed: 300, durationMs: 40 });
  });
});
