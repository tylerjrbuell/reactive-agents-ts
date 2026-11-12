import { Schema } from "effect";
import { CaseVerdictSchema, CheckBreakdownSchema, RubricVerdictSchema } from "./rubric.js";
import { GradeFieldResultSchema } from "./structured-expectation.js";

export const DimensionScoreSchema = Schema.Struct({
  dimension: Schema.String,
  score: Schema.Number,
  details: Schema.optional(Schema.String),
  /**
   * Calibrated confidence from the `jev` judge engine — distribution
   * concentration, 1.0 = fully confident (docs.typesafe.ai/confidence).
   * Absent when scored via the `llm` engine (that path has no calibration
   * concept) or when the dimension isn't judgment-shaped (cost-efficiency).
   */
  confidence: Schema.optional(Schema.Number),
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
  /** Per-field results of a structured case's deterministic grade. Absent for judged cases. */
  fieldResults: Schema.optional(Schema.Array(GradeFieldResultSchema)),
  /**
   * Set for cases graded by `structured` and/or `rubric`. `inconclusive` means
   * the grader could not decide: `passed` is false, but the case is counted
   * apart from failures in the run summary and in `checkRegression`.
   */
  verdict: Schema.optional(CaseVerdictSchema),
  /** The rubric judge's verdict: raw answer, confidence, calibration and backend. */
  rubric: Schema.optional(RubricVerdictSchema),
  /** Per-check breakdown (structured, rubric) behind `verdict`. */
  checks: Schema.optional(Schema.Array(CheckBreakdownSchema)),
});
export type EvalResult = typeof EvalResultSchema.Type;

/**
 * Repeat-scoring statistics for one dimension (Task 6). Populated only when
 * `EvalConfig.repeats > 1` — the DEFAULT `repeats: 1` run carries no
 * variance data, and `checkRegression`/`compare` fall back to the flat
 * threshold exactly as before (documented fallback, not a silent gap).
 */
export const DimensionVarianceStatsSchema = Schema.Struct({
  mean: Schema.Number,
  stddev: Schema.Number,
  n: Schema.Number,
  ci95Low: Schema.Number,
  ci95High: Schema.Number,
});
export type DimensionVarianceStats = typeof DimensionVarianceStatsSchema.Type;

export const EvalRunSummarySchema = Schema.Struct({
  totalCases: Schema.Number,
  passed: Schema.Number,
  failed: Schema.Number,
  /**
   * Cases a grader could not decide (`verdict: "inconclusive"`). Not in
   * `passed` or `failed`, and left out of the averages. Absent in runs saved
   * before rubric graders; read as 0.
   */
  inconclusive: Schema.optional(Schema.Number),
  avgScore: Schema.Number,
  avgLatencyMs: Schema.Number,
  totalCostUsd: Schema.Number,
  dimensionAverages: Schema.Record({ key: Schema.String, value: Schema.Number }),
  /** Per-dimension repeat-scoring variance, pooled across every case's repeats in this run. */
  dimensionVariance: Schema.optional(
    Schema.Record({ key: Schema.String, value: DimensionVarianceStatsSchema }),
  ),
  /** `EvalConfig.repeats` this run was scored with (informational — 1 means "no variance data"). */
  repeats: Schema.optional(Schema.Number),
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
