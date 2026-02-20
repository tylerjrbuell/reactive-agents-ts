import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { CostService, CostServiceLive } from "../src/cost-service.js";
import { BudgetExceededError } from "../src/errors.js";

const TestCostLayer = CostServiceLive();

const runWithCost = <A>(
  effect: Effect.Effect<A, any, CostService>,
) => Effect.runPromise(Effect.provide(effect, TestCostLayer));

describe("CostService", () => {
  test("routes simple tasks to haiku", async () => {
    const model = await runWithCost(
      Effect.gen(function* () {
        const cost = yield* CostService;
        return yield* cost.routeToModel("What is 2+2?");
      }),
    );
    expect(model.tier).toBe("haiku");
  });

  test("routes complex tasks to higher tier", async () => {
    const model = await runWithCost(
      Effect.gen(function* () {
        const cost = yield* CostService;
        return yield* cost.routeToModel(
          "Analyze the following code, compare it against best practices, evaluate performance characteristics, and then synthesize a comprehensive refactoring plan with step-by-step instructions.",
        );
      }),
    );
    expect(["sonnet", "opus"]).toContain(model.tier);
  });

  test("caches and retrieves responses", async () => {
    const cached = await runWithCost(
      Effect.gen(function* () {
        const cost = yield* CostService;
        yield* cost.cacheResponse("What is TypeScript?", "TypeScript is a typed superset of JavaScript.", "haiku");
        return yield* cost.checkCache("What is TypeScript?");
      }),
    );
    expect(cached).toBe("TypeScript is a typed superset of JavaScript.");
  });

  test("returns null for cache misses", async () => {
    const cached = await runWithCost(
      Effect.gen(function* () {
        const cost = yield* CostService;
        return yield* cost.checkCache("never seen before query");
      }),
    );
    expect(cached).toBeNull();
  });

  test("enforces budget limits", async () => {
    const result = await runWithCost(
      Effect.gen(function* () {
        const cost = yield* CostService;
        return yield* cost.checkBudget(999, "agent-1", "session-1").pipe(Effect.flip);
      }),
    );
    expect(result._tag).toBe("BudgetExceededError");
  });

  test("generates accurate cost reports", async () => {
    const report = await runWithCost(
      Effect.gen(function* () {
        const cost = yield* CostService;

        yield* cost.recordCost({
          agentId: "agent-1",
          sessionId: "sess-1",
          model: "claude-haiku",
          tier: "haiku",
          inputTokens: 1000,
          outputTokens: 500,
          cost: 0.002,
          cachedHit: false,
          taskType: "qa",
          latencyMs: 500,
        });

        yield* cost.recordCost({
          agentId: "agent-1",
          sessionId: "sess-1",
          model: "claude-sonnet",
          tier: "sonnet",
          inputTokens: 2000,
          outputTokens: 1000,
          cost: 0.021,
          cachedHit: false,
          taskType: "analysis",
          latencyMs: 1500,
        });

        return yield* cost.getReport("session", "agent-1");
      }),
    );
    expect(report.totalRequests).toBe(2);
    expect(report.totalCost).toBeCloseTo(0.023, 3);
    expect(report.avgLatencyMs).toBe(1000);
  });

  test("compresses long prompts", async () => {
    const longPrompt = "This is a test prompt.\n\n\n\n\n\nWith    lots    of    extra    whitespace.\n\n\n\nAnd    multiple    blank    lines    repeated    many    times.".repeat(20);
    const result = await runWithCost(
      Effect.gen(function* () {
        const cost = yield* CostService;
        return yield* cost.compressPrompt(longPrompt);
      }),
    );
    expect(result.savedTokens).toBeGreaterThan(0);
    expect(result.compressed.length).toBeLessThan(longPrompt.length);
  });

  test("provides budget status", async () => {
    const status = await runWithCost(
      Effect.gen(function* () {
        const cost = yield* CostService;
        return yield* cost.getBudgetStatus("agent-1");
      }),
    );
    expect(status.limits.daily).toBe(25.0);
    expect(status.percentUsedDaily).toBe(0);
  });
});
