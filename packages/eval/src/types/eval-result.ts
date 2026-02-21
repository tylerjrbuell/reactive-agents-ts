import { Schema } from "effect";

export const DimensionScoreSchema = Schema.Struct({
  dimension: Schema.String,
  score: Schema.Number,
  details: Schema.optional(Schema.String),
});
export type DimensionScore = typeof DimensionScoreSchema.Type;

export const EvalResultSchema = Schema.Struct({
  caseId: Schema.String,
  timestamp: Schema.DateFromSelf,
  agentConfig: Schema.String,
  scores: Schema.Array(DimensionScoreSchema),
  overallScore: Schema.Number,
  actualOutput: Schema.String,
  latencyMs: Schema.Number,
  costUsd: Schema.Number,
  tokensUsed: Schema.Number,
  stepsExecuted: Schema.Number,
  passed: Schema.Boolean,
  error: Schema.optional(Schema.String),
});
export type EvalResult = typeof EvalResultSchema.Type;

export const EvalRunSummarySchema = Schema.Struct({
  totalCases: Schema.Number,
  passed: Schema.Number,
  failed: Schema.Number,
  avgScore: Schema.Number,
  avgLatencyMs: Schema.Number,
  totalCostUsd: Schema.Number,
  dimensionAverages: Schema.Record({ key: Schema.String, value: Schema.Number }),
});
export type EvalRunSummary = typeof EvalRunSummarySchema.Type;

export const EvalRunSchema = Schema.Struct({
  id: Schema.String,
  suiteId: Schema.String,
  timestamp: Schema.DateFromSelf,
  agentConfig: Schema.String,
  results: Schema.Array(EvalResultSchema),
  summary: EvalRunSummarySchema,
});
export type EvalRun = typeof EvalRunSchema.Type;
