/**
 * Local Aggregator — In-process telemetry collection and summarization.
 *
 * Accumulates TelemetryRecords from agent runs and computes aggregate statistics.
 * Subscribes to EventBus to automatically capture run data. Provides a "Total Runs"
 * counter and summary statistics for dashboards and collective intelligence.
 *
 * Implemented as an Effect-TS service with a Ref-backed state.
 *
 * @see telemetry-schema.ts for record/aggregate types
 * @see privacy-preserver.ts for anonymization before sharing
 */
import { Effect, Context, Layer, Ref } from "effect";
import type { TelemetryRecord, TelemetryAggregate } from "./telemetry-schema.js";

// ─── Aggregator State ───

interface AggregatorState {
  readonly records: readonly TelemetryRecord[];
  readonly totalRuns: number;
}

const emptyState: AggregatorState = { records: [], totalRuns: 0 };

// ─── Service Interface ───

/**
 * Local telemetry aggregator.
 *
 * Collects anonymized TelemetryRecords and provides aggregate statistics.
 * The running `totalRuns` counter persists for the lifetime of the service.
 */
export interface TelemetryAggregator {
  /** Record an anonymized run. Increments the total counter. */
  readonly record: (entry: TelemetryRecord) => Effect.Effect<void>;
  /** Get the running total of agent runs. */
  readonly getTotalRuns: () => Effect.Effect<number>;
  /** Get all collected records (for export or inspection). */
  readonly getRecords: () => Effect.Effect<readonly TelemetryRecord[]>;
  /** Compute aggregate statistics from collected records. */
  readonly getAggregate: () => Effect.Effect<TelemetryAggregate>;
  /** Clear all records (keeps totalRuns counter). */
  readonly reset: () => Effect.Effect<void>;
}

export class TelemetryAggregatorTag extends Context.Tag("TelemetryAggregator")<
  TelemetryAggregatorTag,
  TelemetryAggregator
>() {}

// ─── Aggregate Computation ───

function computeAggregate(records: readonly TelemetryRecord[]): TelemetryAggregate {
  const n = records.length;
  if (n === 0) {
    return {
      totalRuns: 0,
      successfulRuns: 0,
      successRate: 0,
      meanLatencyMs: 0,
      p95LatencyMs: 0,
      meanCostUsd: 0,
      totalCostUsd: 0,
      meanIterations: 0,
      meanCacheHitRate: 0,
      strategyDistribution: {},
      modelTierDistribution: {},
      toolUsage: {},
      windowStart: "",
      windowEnd: "",
    };
  }

  const successful = records.filter((r) => r.success).length;
  const latencies = records.map((r) => r.latencyMs).sort((a, b) => a - b);
  const p95Index = Math.min(Math.ceil(n * 0.95) - 1, n - 1);

  const strategyDist: Record<string, number> = {};
  const modelTierDist: Record<string, number> = {};
  const toolUsage: Record<string, number> = {};

  let totalCost = 0;
  let totalIterations = 0;
  let totalCacheHitRate = 0;
  let totalLatency = 0;

  for (const r of records) {
    totalCost += r.costUsd;
    totalIterations += r.iterationCount;
    totalCacheHitRate += r.cacheHitRate;
    totalLatency += r.latencyMs;

    strategyDist[r.strategy] = (strategyDist[r.strategy] ?? 0) + 1;
    modelTierDist[r.modelTier] = (modelTierDist[r.modelTier] ?? 0) + 1;

    for (const tool of r.toolNames) {
      toolUsage[tool] = (toolUsage[tool] ?? 0) + 1;
    }
  }

  // Compute time window from records
  const timestamps = records.map((r) => r.timestampBucket).sort();

  return {
    totalRuns: n,
    successfulRuns: successful,
    successRate: successful / n,
    meanLatencyMs: totalLatency / n,
    p95LatencyMs: latencies[p95Index] ?? 0,
    meanCostUsd: totalCost / n,
    totalCostUsd: totalCost,
    meanIterations: totalIterations / n,
    meanCacheHitRate: totalCacheHitRate / n,
    strategyDistribution: strategyDist,
    modelTierDistribution: modelTierDist,
    toolUsage,
    windowStart: timestamps[0] ?? "",
    windowEnd: timestamps[timestamps.length - 1] ?? "",
  };
}

// ─── Live Implementation ───

/** Maximum records to keep in memory before rotating oldest. */
const MAX_RECORDS = 10_000;

/**
 * Creates a live TelemetryAggregator backed by Ref state.
 *
 * @example
 * ```typescript
 * const layer = TelemetryAggregatorLive;
 * const agg = yield* TelemetryAggregatorTag;
 * yield* agg.record(anonymizedRecord);
 * const stats = yield* agg.getAggregate();
 * ```
 */
export const TelemetryAggregatorLive = Layer.effect(
  TelemetryAggregatorTag,
  Effect.gen(function* () {
    const stateRef = yield* Ref.make<AggregatorState>(emptyState);

    return {
      record: (entry: TelemetryRecord) =>
        Ref.update(stateRef, (state) => {
          const records =
            state.records.length >= MAX_RECORDS
              ? [...state.records.slice(1), entry]
              : [...state.records, entry];
          return { records, totalRuns: state.totalRuns + 1 };
        }),

      getTotalRuns: () => Ref.get(stateRef).pipe(Effect.map((s) => s.totalRuns)),

      getRecords: () => Ref.get(stateRef).pipe(Effect.map((s) => s.records)),

      getAggregate: () =>
        Ref.get(stateRef).pipe(Effect.map((s) => computeAggregate(s.records))),

      reset: () =>
        Ref.update(stateRef, (state) => ({ records: [], totalRuns: state.totalRuns })),
    } satisfies TelemetryAggregator;
  }),
);
