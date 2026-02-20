import { Schema } from "effect";

// ─── Model Tier ───

export const ModelTier = Schema.Literal("haiku", "sonnet", "opus");
export type ModelTier = typeof ModelTier.Type;

// ─── Model Cost Configuration ───
// Named ModelCostConfig (not ModelConfig) to avoid collision with llm-provider's ModelConfig

export const ModelCostConfigSchema = Schema.Struct({
  tier: ModelTier,
  provider: Schema.Literal("anthropic", "openai", "ollama"),
  model: Schema.String,
  costPer1MInput: Schema.Number,
  costPer1MOutput: Schema.Number,
  maxContext: Schema.Number,
  quality: Schema.Number,
  speedTokensPerSec: Schema.Number,
});
export type ModelCostConfig = typeof ModelCostConfigSchema.Type;

// ─── Cost Entry ───

export const CostEntrySchema = Schema.Struct({
  id: Schema.String,
  timestamp: Schema.DateFromSelf,
  agentId: Schema.String,
  sessionId: Schema.String,
  model: Schema.String,
  tier: ModelTier,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cost: Schema.Number,
  cachedHit: Schema.Boolean,
  taskType: Schema.String,
  latencyMs: Schema.Number,
});
export type CostEntry = typeof CostEntrySchema.Type;

// ─── Budget ───

export const BudgetLimitsSchema = Schema.Struct({
  perRequest: Schema.Number,
  perSession: Schema.Number,
  daily: Schema.Number,
  monthly: Schema.Number,
});
export type BudgetLimits = typeof BudgetLimitsSchema.Type;

export const BudgetStatusSchema = Schema.Struct({
  currentSession: Schema.Number,
  currentDaily: Schema.Number,
  currentMonthly: Schema.Number,
  limits: BudgetLimitsSchema,
  percentUsedDaily: Schema.Number,
  percentUsedMonthly: Schema.Number,
});
export type BudgetStatus = typeof BudgetStatusSchema.Type;

// ─── Cost Report ───

export const CostReportSchema = Schema.Struct({
  period: Schema.Literal("session", "daily", "weekly", "monthly"),
  totalCost: Schema.Number,
  totalRequests: Schema.Number,
  cacheHits: Schema.Number,
  cacheMisses: Schema.Number,
  cacheHitRate: Schema.Number,
  savings: Schema.Number,
  costByTier: Schema.Record({ key: Schema.String, value: Schema.Number }),
  costByAgent: Schema.Record({ key: Schema.String, value: Schema.Number }),
  avgCostPerRequest: Schema.Number,
  avgLatencyMs: Schema.Number,
});
export type CostReport = typeof CostReportSchema.Type;

// ─── Complexity Analysis ───

export const ComplexityAnalysisSchema = Schema.Struct({
  score: Schema.Number,
  factors: Schema.Array(Schema.String),
  recommendedTier: ModelTier,
  estimatedTokens: Schema.Number,
  estimatedCost: Schema.Number,
});
export type ComplexityAnalysis = typeof ComplexityAnalysisSchema.Type;

// ─── Cache Entry ───

export const CacheEntrySchema = Schema.Struct({
  queryHash: Schema.String,
  response: Schema.String,
  model: Schema.String,
  createdAt: Schema.DateFromSelf,
  hitCount: Schema.Number,
  lastHitAt: Schema.DateFromSelf,
  ttlMs: Schema.Number,
});
export type CacheEntry = typeof CacheEntrySchema.Type;

// ─── Default Budget Limits ───

export const DEFAULT_BUDGET_LIMITS: BudgetLimits = {
  perRequest: 1.0,
  perSession: 5.0,
  daily: 25.0,
  monthly: 200.0,
};
