import { Effect, Context, Layer } from "effect";
import type { ModelCostConfig, CostEntry, BudgetLimits, BudgetStatus, CostReport } from "./types.js";
import { DEFAULT_BUDGET_LIMITS } from "./types.js";
import type { BudgetExceededError, CostTrackingError, CacheError, RoutingError } from "./errors.js";
import { routeToModel } from "./routing/complexity-router.js";
import { estimateTokens } from "./routing/complexity-router.js";
import { makeSemanticCache } from "./caching/semantic-cache.js";
import { makePromptCompressor } from "./compression/prompt-compressor.js";
import { makeBudgetEnforcer } from "./budgets/budget-enforcer.js";
import { makeCostTracker } from "./analytics/cost-tracker.js";

// ─── Service Tag ───

export class CostService extends Context.Tag("CostService")<
  CostService,
  {
    readonly routeToModel: (
      task: string,
      context?: string,
    ) => Effect.Effect<ModelCostConfig, RoutingError>;

    readonly checkCache: (
      query: string,
    ) => Effect.Effect<string | null, CacheError>;

    readonly cacheResponse: (
      query: string,
      response: string,
      model: string,
      ttlMs?: number,
    ) => Effect.Effect<void, CacheError>;

    readonly compressPrompt: (
      prompt: string,
      maxTokens?: number,
    ) => Effect.Effect<{ compressed: string; savedTokens: number }, CostTrackingError>;

    readonly checkBudget: (
      estimatedCost: number,
      agentId: string,
      sessionId: string,
    ) => Effect.Effect<void, BudgetExceededError>;

    readonly recordCost: (
      entry: Omit<CostEntry, "id" | "timestamp">,
    ) => Effect.Effect<void, CostTrackingError>;

    readonly getBudgetStatus: (
      agentId: string,
    ) => Effect.Effect<BudgetStatus, CostTrackingError>;

    readonly getReport: (
      period: "session" | "daily" | "weekly" | "monthly",
      agentId?: string,
    ) => Effect.Effect<CostReport, CostTrackingError>;
  }
>() {}

// ─── Live Implementation ───

export const CostServiceLive = (budgetLimits: BudgetLimits = DEFAULT_BUDGET_LIMITS) =>
  Layer.effect(
    CostService,
    Effect.gen(function* () {
      const cache = yield* makeSemanticCache;
      const compressor = yield* makePromptCompressor;
      const budget = yield* makeBudgetEnforcer(budgetLimits);
      const tracker = yield* makeCostTracker;

      return {
        routeToModel: (task, context) => routeToModel(task, context),

        checkCache: (query) => cache.check(query),

        cacheResponse: (query, response, model, ttlMs) =>
          cache.store(query, response, model, ttlMs),

        compressPrompt: (prompt, maxTokens) =>
          compressor.compress(prompt, maxTokens),

        checkBudget: (estimatedCost, agentId, sessionId) =>
          budget.check(estimatedCost, agentId, sessionId),

        recordCost: (entry) => tracker.record(entry),

        getBudgetStatus: (agentId) =>
          budget.getStatus(agentId) as Effect.Effect<BudgetStatus, CostTrackingError>,

        getReport: (period, agentId) => tracker.getReport(period, agentId),
      };
    }),
  );
