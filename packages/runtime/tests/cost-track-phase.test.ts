// Run: bun test packages/runtime/tests/cost-track-phase.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { CostService } from "@reactive-agents/cost";
import { costTrack, classifyTier, recordedSplit } from "../src/engine/phases/cost-track.js";

describe("classifyTier (FF-5)", () => {
  it("classifies small/mini/flash-lite models as haiku", () => {
    expect(classifyTier("claude-haiku-4-5-20251001")).toBe("haiku");
    expect(classifyTier("gpt-4o-mini")).toBe("haiku");
    expect(classifyTier("gemini-2.0-flash-lite")).toBe("haiku");
    expect(classifyTier("llama3.2:3b")).toBe("haiku");
  });

  it("classifies large parameter-count models as opus", () => {
    expect(classifyTier("claude-opus-4-7")).toBe("opus");
    expect(classifyTier("llama3.1:70b")).toBe("opus");
    expect(classifyTier("qwen3.5:405b")).toBe("opus");
  });

  it("falls back to sonnet for anything without a size signal", () => {
    expect(classifyTier("gemma4:12b")).toBe("sonnet");
    expect(classifyTier("unknown-model-xyz")).toBe("sonnet");
  });
});

describe("cost-track phase (FF-5)", () => {
  it("records real inputTokens instead of hardcoded 0", async () => {
    let captured: any = null;
    const recordingCostService = Layer.succeed(CostService, {
      routeToModel: () => Effect.succeed({ model: "test-model" } as any),
      checkCache: () => Effect.succeed(null),
      cacheResponse: () => Effect.void,
      compressPrompt: (prompt: string) => Effect.succeed({ compressed: prompt, savedTokens: 0 }),
      checkBudget: () => Effect.void,
      recordCost: (args: any) => {
        captured = args;
        return Effect.void;
      },
      getBudgetStatus: () =>
        Effect.succeed({
          currentSession: 0,
          currentDaily: 0,
          currentMonthly: 0,
          limits: { perRequest: 1, perSession: 5, daily: 25, monthly: 200 },
          percentUsedDaily: 0,
          percentUsedMonthly: 0,
        }),
      getReport: () =>
        Effect.succeed({
          period: "daily" as const,
          totalCost: 0,
          totalRequests: 0,
          cacheHits: 0,
          cacheMisses: 0,
          cacheHitRate: 0,
          savings: 0,
          costByTier: {},
          costByAgent: {},
          avgCostPerRequest: 0,
          avgLatencyMs: 0,
        }),
    });

    const ctx = {
      agentId: "a1",
      sessionId: "s1",
      selectedModel: "claude-haiku-4-5-20251001",
      tokensUsed: 42,
      cost: 0.001,
      startedAt: new Date(),
      // The split settleRunSpend writes (run-budget-arm.ts), not a legacy key.
      metadata: { settledRunSplit: { inputTokens: 17, outputTokens: 25, llmCalls: 2 } },
    } as any;
    const deps = { config: { enableCostTracking: true }, task: { type: "generic" } } as any;

    expect(costTrack.skip!(ctx, deps)).toBe(false);
    await Effect.runPromise(costTrack.run(ctx, deps).pipe(Effect.provide(recordingCostService)) as any);

    expect(captured).not.toBeNull();
    expect(captured.inputTokens).toBe(17);
    // F11 (audit 2026-11-19): output is the real completion half, never the run total (42).
    expect(captured.outputTokens).toBe(25);
    expect(captured.cost).toBe(0.001);
    expect(captured.model).toBe("claude-haiku-4-5-20251001");
    expect(captured.tier).toBe("haiku");
  });

  it("records 0/0, not the run total as output, when the meter knows no split", () => {
    expect(recordedSplit(undefined)).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(recordedSplit({ inputTokens: 10, llmCalls: 1 })).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(recordedSplit({ inputTokens: 10, outputTokens: 5, llmCalls: 1 })).toEqual({ inputTokens: 10, outputTokens: 5 });
  });
});
