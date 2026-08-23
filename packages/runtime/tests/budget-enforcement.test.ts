import { describe, it, expect } from "bun:test";
import { Effect, Layer, Context } from "effect";
import {
  ExecutionEngine,
  ExecutionEngineLive,
  LifecycleHookRegistryLive,
  BudgetExceededError,
} from "../src/index.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";
import { CostService } from "@reactive-agents/cost";

// ─── Stub ReasoningService (Move 1 dead-arm removal, 2026-08-21) ───
//
// `ExecutionEngineLive` now always routes through the kernel arm when a
// `ReasoningService` is available; the raw `LLMService` mock this file used
// to drive the (now-deleted) inline arm directly is no longer on the
// execution path. The budget checks under test (pre-flight, in
// `cost-route.ts`) all fire BEFORE the reasoningOpt branch split, so a
// minimal `ReasoningService` stub (matching the pattern in
// `chat-history-seeds-kernel.test.ts`) preserves every assertion's meaning
// for the pre-flight cases; only tests that reach "think" actually invoke it.
const MockLLMServiceLive = Layer.succeed(
  Context.GenericTag<{
    execute: (params: { [k: string]: unknown }) => Effect.Effect<{
      output: unknown;
      status: "completed" | "failed" | "partial";
      steps?: readonly { id: string; type: string; content: string }[];
      metadata: { cost: number; tokensUsed: number; stepsCount: number };
    }>;
  }>("ReasoningService"),
  {
    execute: (_params: { [k: string]: unknown }) =>
      Effect.succeed({
        output: "Task completed: Here is the answer.",
        status: "completed" as const,
        steps: [{ id: "step-1", type: "thought", content: "Task completed: Here is the answer." }],
        metadata: { cost: 0, tokensUsed: 30, stepsCount: 1 },
      }),
  },
);

// ─── Mock CostService that always exceeds budget ───

const OverBudgetCostService = Layer.succeed(CostService, {
  routeToModel: () => Effect.succeed({ model: "test-model" } as any),
  checkCache: () => Effect.succeed(null),
  cacheResponse: () => Effect.void,
  compressPrompt: (prompt: string) =>
    Effect.succeed({ compressed: prompt, savedTokens: 0 }),
  checkBudget: (_estimatedCost: number, _agentId: string, _sessionId: string) =>
    Effect.fail({
      _tag: "BudgetExceededError" as const,
      message: "Daily spend $26.00 exceeds limit $25.00",
      budgetType: "daily" as const,
      limit: 25,
      current: 26,
      requested: 0,
    } as any),
  recordCost: () => Effect.void,
  getBudgetStatus: () =>
    Effect.succeed({
      currentSession: 0,
      currentDaily: 26,
      currentMonthly: 100,
      limits: { perRequest: 1, perSession: 5, daily: 25, monthly: 200 },
      percentUsedDaily: 104,
      percentUsedMonthly: 50,
    }),
  getReport: () =>
    Effect.succeed({
      period: "daily" as const,
      totalCost: 26,
      totalRequests: 100,
      cacheHits: 0,
      cacheMisses: 100,
      cacheHitRate: 0,
      savings: 0,
      costByTier: {},
      costByAgent: {},
      avgCostPerRequest: 0.26,
      avgLatencyMs: 100,
    }),
});

// ─── Mock CostService with plenty of budget ───

const WithinBudgetCostService = Layer.succeed(CostService, {
  routeToModel: () => Effect.succeed({ model: "test-model" } as any),
  checkCache: () => Effect.succeed(null),
  cacheResponse: () => Effect.void,
  compressPrompt: (prompt: string) =>
    Effect.succeed({ compressed: prompt, savedTokens: 0 }),
  checkBudget: () => Effect.void,
  recordCost: () => Effect.void,
  getBudgetStatus: () =>
    Effect.succeed({
      currentSession: 0,
      currentDaily: 1,
      currentMonthly: 10,
      limits: { perRequest: 1, perSession: 5, daily: 25, monthly: 200 },
      percentUsedDaily: 4,
      percentUsedMonthly: 5,
    }),
  getReport: () =>
    Effect.succeed({
      period: "daily" as const,
      totalCost: 1,
      totalRequests: 10,
      cacheHits: 0,
      cacheMisses: 10,
      cacheHitRate: 0,
      savings: 0,
      costByTier: {},
      costByAgent: {},
      avgCostPerRequest: 0.1,
      avgLatencyMs: 100,
    }),
});

// ─── Mock CostService that exceeds budget after first iteration ───

let checkBudgetCallCount = 0;

const ExceedsAfterFirstCostService = Layer.succeed(CostService, {
  routeToModel: () => Effect.succeed({ model: "test-model" } as any),
  checkCache: () => Effect.succeed(null),
  cacheResponse: () => Effect.void,
  compressPrompt: (prompt: string) =>
    Effect.succeed({ compressed: prompt, savedTokens: 0 }),
  checkBudget: (_estimatedCost: number, _agentId: string, _sessionId: string) => {
    checkBudgetCallCount++;
    // First call (pre-flight in cost-route) passes; subsequent calls fail
    if (checkBudgetCallCount <= 1) {
      return Effect.void;
    }
    return Effect.fail({
      _tag: "BudgetExceededError" as const,
      message: "Session spend $5.50 exceeds limit $5.00",
      budgetType: "perSession" as const,
      limit: 5,
      current: 5.5,
      requested: 0,
    } as any);
  },
  recordCost: () => Effect.void,
  getBudgetStatus: () =>
    Effect.succeed({
      currentSession: 5.5,
      currentDaily: 5.5,
      currentMonthly: 50,
      limits: { perRequest: 1, perSession: 5, daily: 25, monthly: 200 },
      percentUsedDaily: 22,
      percentUsedMonthly: 25,
    }),
  getReport: () =>
    Effect.succeed({
      period: "daily" as const,
      totalCost: 5.5,
      totalRequests: 20,
      cacheHits: 0,
      cacheMisses: 20,
      cacheHitRate: 0,
      savings: 0,
      costByTier: {},
      costByAgent: {},
      avgCostPerRequest: 0.275,
      avgLatencyMs: 100,
    }),
});

const mockTask = {
  id: "task-budget-001" as any,
  agentId: "agent-budget" as any,
  type: "query" as const,
  input: { question: "What is 2+2?" },
  priority: "medium" as const,
  status: "pending" as const,
  metadata: { tags: [] },
  createdAt: new Date(),
};

describe("Budget Enforcement", () => {
  it("should fail with BudgetExceededError when budget is exceeded before think phase", async () => {
    const config = defaultReactiveAgentsConfig("agent-budget", {
      enableCostTracking: true,
    });

    const hookLayer = LifecycleHookRegistryLive;
    const engineLayer = ExecutionEngineLive(config).pipe(
      Layer.provide(hookLayer),
    );

    const testLayer = Layer.mergeAll(
      hookLayer,
      engineLayer,
      MockLLMServiceLive,
      OverBudgetCostService,
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask).pipe(Effect.either);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("BudgetExceededError");
      if (result.left._tag === "BudgetExceededError") {
        expect(result.left.message).toContain("exceeds limit");
        expect(result.left.taskId).toBe("task-budget-001");
      }
    }
  });

  it("should execute normally when budget has room", async () => {
    const config = defaultReactiveAgentsConfig("agent-budget", {
      enableCostTracking: true,
    });

    const hookLayer = LifecycleHookRegistryLive;
    const engineLayer = ExecutionEngineLive(config).pipe(
      Layer.provide(hookLayer),
    );

    const testLayer = Layer.mergeAll(
      hookLayer,
      engineLayer,
      MockLLMServiceLive,
      WithinBudgetCostService,
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.success).toBe(true);
    expect(String(result.taskId)).toBe("task-budget-001");
  });

  it("should work normally when cost tracking is disabled (backward compat)", async () => {
    const config = defaultReactiveAgentsConfig("agent-budget", {
      enableCostTracking: false,
    });

    const hookLayer = LifecycleHookRegistryLive;
    const engineLayer = ExecutionEngineLive(config).pipe(
      Layer.provide(hookLayer),
    );

    // No CostService provided at all
    const testLayer = Layer.mergeAll(
      hookLayer,
      engineLayer,
      MockLLMServiceLive,
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.success).toBe(true);
    expect(String(result.taskId)).toBe("task-budget-001");
  });

  it("should gracefully stop mid-loop when budget is exceeded per-iteration", async () => {
    // REDESIGN NOTE (Move 1 dead-arm removal, 2026-08-21): this test used to
    // drive the inline arm's while-loop with a raw `LLMService` mock that
    // returned a tool call on iteration 1 (forcing a second loop pass), with
    // `CostService.checkBudget` failing starting on the second check — the
    // inline arm's per-iteration budget guard then swallowed the failure and
    // returned a graceful `success:true` completion.
    //
    // The kernel arm's equivalent mechanism is the Arbitrator's budget
    // pre-intent guard (`packages/reasoning/src/kernel/capabilities/decide/
    // arbitrator.ts` — "the BudgetSignal reports `exceeded` ⇒ terminate
    // immediately as exit-failure, regardless of intent.kind, dominating
    // every other termination signal"), which is a graceful
    // `status:"failed"` result (a real "task did not complete because the
    // budget ran out" outcome), not a crash and not a silent success. This
    // stub simulates a reasoning pass that itself calls the REAL
    // `CostService.checkBudget()` mid-execution (mirroring where the
    // kernel's own budget signal is sourced) and, on rejection, returns that
    // same graceful failed shape — proving the engine assembles a coherent
    // `TaskResult` (the Effect resolves, it does not throw or hang) rather
    // than crashing when budget-exceeded surfaces mid-loop.
    checkBudgetCallCount = 0;

    const config = defaultReactiveAgentsConfig("agent-budget", {
      enableCostTracking: true,
    });

    const midLoopBudgetReasoningLayer = Layer.effect(
      Context.GenericTag<{
        execute: (params: { [k: string]: unknown }) => Effect.Effect<{
          output: unknown;
          status: "completed" | "failed" | "partial";
          steps?: readonly { id: string; type: string; content: string }[];
          metadata: { cost: number; tokensUsed: number; stepsCount: number };
          error?: string;
        }>;
      }>("ReasoningService"),
      Effect.gen(function* () {
        const cost = yield* CostService;
        return {
          execute: (_params: { [k: string]: unknown }) =>
            Effect.gen(function* () {
              // First iteration: budget check passes (pre-flight semantics).
              yield* cost.checkBudget(0.005, "agent-budget", "session").pipe(
                Effect.catchAll(() => Effect.void),
              );
              // Second iteration (the loop continuing after a tool call):
              // budget check fails — mirrors the Arbitrator's mid-run budget
              // signal dominating every other termination path.
              const secondCheck = yield* cost
                .checkBudget(0.005, "agent-budget", "session")
                .pipe(Effect.either);
              if (secondCheck._tag === "Left") {
                return {
                  output: null,
                  status: "failed" as const,
                  steps: [{ id: "step-1", type: "thought", content: "Let me search for that." }],
                  metadata: { cost: 5.5, tokensUsed: 100, stepsCount: 1 },
                  error: "budget_exceeded: Session spend $5.50 exceeds limit $5.00",
                };
              }
              return {
                output: "Here is the answer: 4.",
                status: "completed" as const,
                steps: [{ id: "step-1", type: "thought", content: "Here is the answer: 4." }],
                metadata: { cost: 5.5, tokensUsed: 200, stepsCount: 2 },
              };
            }),
        };
      }),
    );

    const hookLayer = LifecycleHookRegistryLive;
    const engineLayer = ExecutionEngineLive(config).pipe(
      Layer.provide(hookLayer),
    );

    const testLayer = Layer.mergeAll(
      hookLayer,
      engineLayer,
      midLoopBudgetReasoningLayer.pipe(Layer.provide(ExceedsAfterFirstCostService)),
      ExceedsAfterFirstCostService,
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    // The engine resolved to a coherent TaskResult — it did not crash or
    // hang when the budget signal fired mid-loop. Under the kernel arm's
    // real contract this is a graceful failure (see note above), not a
    // silent success.
    expect(result).toBeDefined();
    expect(String(result.taskId)).toBe("task-budget-001");
    expect(result.success).toBe(false);
  });
});
