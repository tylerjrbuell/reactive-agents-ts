// ─── Types ───
export type {
  ModelCostConfig,
  CostEntry,
  BudgetLimits,
  BudgetStatus,
  CostReport,
  ComplexityAnalysis,
  CacheEntry,
} from "./types.js";
export {
  ModelTier,
  ModelCostConfigSchema,
  CostEntrySchema,
  BudgetLimitsSchema,
  BudgetStatusSchema,
  CostReportSchema,
  ComplexityAnalysisSchema,
  CacheEntrySchema,
  DEFAULT_BUDGET_LIMITS,
} from "./types.js";

// ─── Errors ───
export { BudgetExceededError, CostTrackingError, CacheError, RoutingError } from "./errors.js";

// ─── Routing ───
export {
  heuristicClassify,
  analyzeComplexity,
  routeToModel,
  getModelCostConfig,
  estimateTokens,
  estimateCost,
} from "./routing/complexity-router.js";

// ─── Caching ───
export { makeSemanticCache } from "./caching/semantic-cache.js";
export type { SemanticCache } from "./caching/semantic-cache.js";

// ─── Compression ───
export { makePromptCompressor } from "./compression/prompt-compressor.js";
export type { PromptCompressor } from "./compression/prompt-compressor.js";

// ─── Budgets ───
export { makeBudgetEnforcer } from "./budgets/budget-enforcer.js";
export type { BudgetEnforcer, BudgetState } from "./budgets/budget-enforcer.js";

// ─── Analytics ───
export { makeCostTracker } from "./analytics/cost-tracker.js";
export type { CostTracker } from "./analytics/cost-tracker.js";

// ─── Service ───
export { CostService, CostServiceLive } from "./cost-service.js";

// ─── Runtime ───
export { createCostLayer } from "./runtime.js";
