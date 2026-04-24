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

// ─── Telemetry Model Tier ───

/**
 * Coarse model classification for privacy-preserving telemetry aggregation.
 *
 * **Five buckets** — collapses exact model names into k-anonymous groups so
 * telemetry records can be exported/compared without revealing which specific
 * model a user ran.
 *
 * **Distinct from the operational `ModelTier`** in `@reactive-agents/reasoning`,
 * which has **four buckets** (`local | mid | large | frontier`) used to drive
 * runtime behavior (context profiles, compression budgets, temperature tuning).
 * The operational `mid` bucket maps to either `small` or `medium` here depending
 * on the exact model family — see {@link toTelemetryTier}.
 *
 * Phase 1 Capability port will unify both by deriving from `Capability.tier`;
 * until then the two schemas coexist with a documented mapping. See North Star
 * v2.3 §1.2 G-2.
 */
export const TelemetryModelTier = Schema.Literal("local", "small", "medium", "large", "frontier");
export type TelemetryModelTier = typeof TelemetryModelTier.Type;

/**
 * @deprecated Use {@link TelemetryModelTier} instead. Kept as an alias to avoid
 * a breaking rename during Phase 0; will be removed when the Capability port
 * lands in Phase 1.
 */
export const ModelTier = TelemetryModelTier;
/**
 * @deprecated Use {@link TelemetryModelTier} instead. Kept as an alias to avoid
 * a breaking rename during Phase 0.
 */
export type ModelTier = TelemetryModelTier;

/**
 * Map an operational ModelTier (from `@reactive-agents/reasoning`) to the
 * coarser TelemetryModelTier used for privacy-preserving aggregation.
 *
 * The only bucket that splits is operational `"mid"`, which could reasonably
 * be either `"small"` or `"medium"` depending on the model family. Until the
 * Capability port lands, we conservatively map `"mid"` → `"medium"` so the
 * resulting TelemetryRecord is always decodeable.
 */
export function toTelemetryTier(
  operationalTier: "local" | "mid" | "large" | "frontier",
): TelemetryModelTier {
  switch (operationalTier) {
    case "local":
      return "local";
    case "mid":
      return "medium";
    case "large":
      return "large";
    case "frontier":
      return "frontier";
  }
}

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
