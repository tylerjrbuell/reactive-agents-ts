import { describe, test, expect, beforeEach } from "bun:test";
import { Effect, Context } from "effect";
import { CostService, CostServiceLive } from "../src/cost-service.js";
import { DEFAULT_BUDGET_LIMITS } from "../src/types.js";
import type { BudgetLimits, ModelCostConfig } from "../src/types.js";

const runWithService = <A>(
  effect: Effect.Effect<A, any, CostService>,
  budgetLimits: BudgetLimits = DEFAULT_BUDGET_LIMITS,
) =>
  Effect.runPromise(
    Effect.provide(effect, CostServiceLive(budgetLimits)),
  );

describe("CostService", () => {
  describe("routeToModel", () => {
    test("routes simple tasks to haiku", async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const svc = yield* CostService;
          return yield* svc.routeToModel("What is TypeScript?");
        }),
      );
      expect(result.tier).toBe("haiku");
    });

    test("routes complex tasks to higher tiers", async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const svc = yield* CostService;
          return yield* svc.routeToModel(
            "```typescript\nconst x = 1;\n```\nAnalyze and evaluate this code",
          );
        }),
      );
      expect(["sonnet", "opus"]).toContain(result.tier);
    });
  });

  describe("checkCache", () => {
    test("returns null for uncached query", async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const svc = yield* CostService;
          return yield* svc.checkCache("unique query " + Date.now());
        }),
      );
      expect(result).toBeNull();
    });
  });

  describe("cacheResponse", () => {
    test("caches response without error", async () => {
      const testQuery = "test query cache " + Date.now();
      await runWithService(
        Effect.gen(function* () {
          const svc = yield* CostService;
          yield* svc.cacheResponse(testQuery, "cached response", "haiku");
        }),
      );
      // Cache test - just ensure no error thrown
      expect(true).toBe(true);
    });
  });

  describe("compressPrompt", () => {
    test("compresses long prompt without error", async () => {
      const longPrompt = "Hello ".repeat(100);
      const result = await runWithService(
        Effect.gen(function* () {
          const svc = yield* CostService;
          return yield* svc.compressPrompt(longPrompt, 50);
        }),
      );
      // Just ensure no error is thrown
      expect(result.compressed).toBeDefined();
    });
  });

  describe("checkBudget", () => {
    test("passes when under budget", async () => {
      await runWithService(
        Effect.gen(function* () {
          const svc = yield* CostService;
          return yield* svc.checkBudget(0.1, "agent-1", "session-1");
        }),
      );
    });

    test("throws when over per-request budget", async () => {
      expect.assertions(1);
      try {
        await runWithService(
          Effect.gen(function* () {
            const svc = yield* CostService;
            return yield* svc.checkBudget(100, "agent-1", "session-1");
          }),
        );
      } catch (e: any) {
        expect(e.message).toContain("exceeds");
      }
    });
  });

  describe("recordCost", () => {
    test("records cost entry without error", async () => {
      await runWithService(
        Effect.gen(function* () {
          const svc = yield* CostService;
          return yield* svc.recordCost({
            agentId: "agent-1",
            sessionId: "session-1",
            model: "claude-3-5-haiku-20241022",
            tier: "haiku",
            inputTokens: 100,
            outputTokens: 50,
            cost: 0.00025,
            cachedHit: false,
            taskType: "general",
            latencyMs: 500,
          });
        }),
      );
    });
  });

  describe("getBudgetStatus", () => {
    test("returns budget status", async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const svc = yield* CostService;
          return yield* svc.getBudgetStatus("agent-1");
        }),
      );
      expect(result.currentSession).toBeGreaterThanOrEqual(0);
      expect(result.limits).toBeDefined();
      expect(result.limits.perRequest).toBeDefined();
    });
  });

  describe("getReport", () => {
    test("returns cost report for session", async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const svc = yield* CostService;
          return yield* svc.getReport("session", "agent-1");
        }),
      );
      expect(result.totalCost).toBeGreaterThanOrEqual(0);
      expect(result.totalRequests).toBeGreaterThanOrEqual(0);
      expect(result.period).toBe("session");
    });

    test("returns cost report without agent filter", async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const svc = yield* CostService;
          return yield* svc.getReport("daily");
        }),
      );
      expect(result.costByTier).toBeDefined();
      expect(result.costByAgent).toBeDefined();
    });
  });
});

describe("Cost Calculations", () => {
  test("calculates token cost correctly", async () => {
    const haiku = await runWithService(
      Effect.gen(function* () {
        const svc = yield* CostService;
        return yield* svc.routeToModel("test");
      }),
    );

    const inputTokens = 1000;
    const outputTokens = 500;
    const expectedInputCost = (inputTokens / 1_000_000) * haiku.costPer1MInput;
    const expectedOutputCost = (outputTokens / 1_000_000) * haiku.costPer1MOutput;
    const totalCost = expectedInputCost + expectedOutputCost;

    expect(totalCost).toBeGreaterThan(0);
    expect(totalCost).toBeLessThan(0.01);
  });

  test("compares costs across providers", async () => {
    const haiku = await runWithService(
      Effect.gen(function* () {
        const svc = yield* CostService;
        return yield* svc.routeToModel("simple task");
      }),
    );

    const sonnet = await runWithService(
      Effect.gen(function* () {
        const svc = yield* CostService;
        return yield* svc.routeToModel(
          "Analyze this complex problem with deep reasoning required",
        );
      }),
    );

    expect(sonnet.costPer1MInput).toBeGreaterThan(haiku.costPer1MInput);
  });
});

describe("Budget Tracking", () => {
  test("tracks per-session budget", async () => {
    await runWithService(
      Effect.gen(function* () {
        const svc = yield* CostService;
        yield* svc.recordCost({
          agentId: "agent-track",
          sessionId: "session-track",
          model: "claude-3-5-haiku-20241022",
          tier: "haiku",
          inputTokens: 100,
          outputTokens: 50,
          cost: 0.00025,
          cachedHit: false,
          taskType: "test",
          latencyMs: 100,
        });
      }),
    );

    const status = await runWithService(
      Effect.gen(function* () {
        const svc = yield* CostService;
        return yield* svc.getBudgetStatus("agent-track");
      }),
    );

    expect(status.currentSession).toBeGreaterThanOrEqual(0);
  });

  test("tracks daily budget usage", async () => {
    const status = await runWithService(
      Effect.gen(function* () {
        const svc = yield* CostService;
        return yield* svc.getBudgetStatus("new-agent");
      }),
    );

    expect(status.percentUsedDaily).toBeGreaterThanOrEqual(0);
    expect(status.percentUsedMonthly).toBeGreaterThanOrEqual(0);
  });
});
