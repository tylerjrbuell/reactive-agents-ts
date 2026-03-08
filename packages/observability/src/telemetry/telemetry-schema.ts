/**
 * Telemetry Schema — Anonymized run-level record for collective intelligence.
 *
 * Each TelemetryRecord captures the outcome of a single agent run with all
 * identifying information stripped and numerical fields noised via differential
 * privacy. These records can be safely aggregated locally or shared with the
 * collective network.
 *
 * @see privacy-preserver.ts for the differential privacy implementation
 * @see local-aggregator.ts for in-process aggregation
 */
import { Schema } from "effect";

// ─── Model Tier ───

/** Coarse model classification — no exact model name leaks. */
export const ModelTier = Schema.Literal("local", "small", "medium", "large", "frontier");
export type ModelTier = typeof ModelTier.Type;

// ─── Telemetry Record ───

/**
 * A single anonymized agent-run record.
 *
 * All numerical fields should be noised via Laplacian noise (epsilon=0.1)
 * before leaving the local process. String fields are limited to a safe
 * enum-like set — no free-form text.
 */
export const TelemetryRecordSchema = Schema.Struct({
  /** Random UUID per run — not correlated to any real ID. */
  runId: Schema.String,
  /** Reasoning strategy used (e.g., "reactive", "plan-execute", "tree-of-thought"). */
  strategy: Schema.String,
  /** Coarse model tier — never the exact model name. */
  modelTier: ModelTier,
  /** Input tokens (noised). */
  tokensIn: Schema.Number,
  /** Output tokens (noised). */
  tokensOut: Schema.Number,
  /** Total latency in milliseconds (noised). */
  latencyMs: Schema.Number,
  /** Whether the run succeeded. */
  success: Schema.Boolean,
  /** Tool names used (only built-in tool names — custom tools stripped). */
  toolNames: Schema.Array(Schema.String),
  /** Number of reasoning iterations (noised). */
  iterationCount: Schema.Number,
  /** Estimated cost in USD (noised). */
  costUsd: Schema.Number,
  /** Semantic cache hit rate 0..1 (noised). */
  cacheHitRate: Schema.Number,
  /** Timestamp bucketed to the hour (privacy: no sub-hour precision). */
  timestampBucket: Schema.String,
});
export type TelemetryRecord = typeof TelemetryRecordSchema.Type;

// ─── Telemetry Aggregate ───

/**
 * Summary statistics across multiple TelemetryRecords.
 * Used for local dashboards and collective intelligence sharing.
 */
export const TelemetryAggregateSchema = Schema.Struct({
  /** Total runs aggregated. */
  totalRuns: Schema.Number,
  /** Runs that succeeded. */
  successfulRuns: Schema.Number,
  /** Success rate (0..1). */
  successRate: Schema.Number,
  /** Mean latency in ms. */
  meanLatencyMs: Schema.Number,
  /** P95 latency in ms. */
  p95LatencyMs: Schema.Number,
  /** Mean cost in USD. */
  meanCostUsd: Schema.Number,
  /** Total cost in USD. */
  totalCostUsd: Schema.Number,
  /** Mean iteration count. */
  meanIterations: Schema.Number,
  /** Mean cache hit rate. */
  meanCacheHitRate: Schema.Number,
  /** Strategy → run count. */
  strategyDistribution: Schema.Record({ key: Schema.String, value: Schema.Number }),
  /** Model tier → run count. */
  modelTierDistribution: Schema.Record({ key: Schema.String, value: Schema.Number }),
  /** Tool name → call count. */
  toolUsage: Schema.Record({ key: Schema.String, value: Schema.Number }),
  /** Hourly bucket of the aggregation window. */
  windowStart: Schema.String,
  /** Hourly bucket of the aggregation window end. */
  windowEnd: Schema.String,
});
export type TelemetryAggregate = typeof TelemetryAggregateSchema.Type;

// ─── Known built-in tool names (safe to share) ───

/** Built-in tool names that are safe to include in telemetry. Custom tools are stripped. */
export const SAFE_TOOL_NAMES = new Set([
  "file-read",
  "file-write",
  "file-list",
  "web-search",
  "code-execute",
  "shell-execute",
  "http-request",
  "memory-query",
]);
