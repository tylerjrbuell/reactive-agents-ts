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

// ─── Mock LLM that returns a simple answer ───

const MockLLMServiceLive = Layer.succeed(
  Context.GenericTag<{
    complete: (req: unknown) => Effect.Effect<{
      content: string;
      stopReason: string;
      toolCalls?: unknown[];
      usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        estimatedCost: number;
      };
      model: string;
    }>;
  }>("LLMService"),
  {
    complete: (_req: unknown) =>
      Effect.succeed({
        content: "Task completed: Here is the answer.",
        stopReason: "end_turn",
        toolCalls: [],
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          estimatedCost: 0.001,
        },
        model: "test-model",
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
    // Reset call counter
    checkBudgetCallCount = 0;

    const config = defaultReactiveAgentsConfig("agent-budget", {
      enableCostTracking: true,
    });

    // LLM that returns tool calls on first request, forcing a second iteration
    let llmCallCount = 0;
    const LoopingLLM = Layer.succeed(
      Context.GenericTag<{
        complete: (req: unknown) => Effect.Effect<{
          content: string;
          stopReason: string;
          toolCalls?: unknown[];
          usage: {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            estimatedCost: number;
          };
          model: string;
        }>;
      }>("LLMService"),
      {
        complete: (_req: unknown) => {
          llmCallCount++;
          if (llmCallCount === 1) {
            // First call: return tool call to force loop continuation
            return Effect.succeed({
              content: "Let me search for that.",
              stopReason: "tool_use",
              toolCalls: [{ id: "call-1", name: "search", input: { query: "test" } }],
              usage: {
                inputTokens: 50,
                outputTokens: 50,
                totalTokens: 100,
                estimatedCost: 0.005,
              },
              model: "test-model",
            });
          }
          // Subsequent calls: complete
          return Effect.succeed({
            content: "Here is the answer: 4.",
            stopReason: "end_turn",
            toolCalls: [],
            usage: {
              inputTokens: 50,
              outputTokens: 50,
              totalTokens: 100,
              estimatedCost: 0.005,
            },
            model: "test-model",
          });
        },
      },
    );

    // Mock ToolService for handling tool calls
    const MockToolService = Layer.succeed(
      Context.GenericTag<{
        executeTool: (name: string, args: Record<string, unknown>) => Effect.Effect<unknown>;
        listTools: () => Effect.Effect<readonly any[]>;
        toFunctionCallingFormat: () => Effect.Effect<readonly any[]>;
        getTool: (name: string) => Effect.Effect<any>;
      }>("ToolService"),
      {
        executeTool: () => Effect.succeed({ result: "search result" }),
        listTools: () => Effect.succeed([]),
        toFunctionCallingFormat: () => Effect.succeed([]),
        getTool: () => Effect.succeed(null),
      },
    );

    const hookLayer = LifecycleHookRegistryLive;
    const engineLayer = ExecutionEngineLive(config).pipe(
      Layer.provide(hookLayer),
    );

    const testLayer = Layer.mergeAll(
      hookLayer,
      engineLayer,
      LoopingLLM,
      MockToolService,
      ExceedsAfterFirstCostService,
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    // Should complete gracefully (not crash) when budget exceeded mid-loop
    expect(result.success).toBe(true);
  });
});
