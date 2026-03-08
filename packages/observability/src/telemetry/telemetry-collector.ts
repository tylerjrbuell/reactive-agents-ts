/**
 * Telemetry Collector — Auto-wires EventBus → Privacy Preserver → Aggregator.
 *
 * Subscribes to `AgentCompleted` events and accumulates per-LLM-call data from
 * `LLMRequestCompleted` + `FinalAnswerProduced` to build a full `RawRunData`
 * record. Applies differential privacy and feeds into the TelemetryAggregator.
 *
 * Provided as an Effect Layer that performs EventBus subscription on initialization.
 */
import { Effect, Context, Layer, Ref } from "effect";
import type { TelemetryAggregator } from "./local-aggregator.js";
import { TelemetryAggregatorTag, TelemetryAggregatorLive } from "./local-aggregator.js";
import { preservePrivacy, type PrivacyConfig } from "./privacy-preserver.js";
import type { RawRunData } from "./privacy-preserver.js";
import { EventBus } from "@reactive-agents/core";

// ─── Per-Task Accumulator ───

interface TaskAccumulator {
  model: string;
  provider: string;
  tokensIn: number;
  tokensOut: number;
  totalCost: number;
  toolNames: Set<string>;
  strategy: string;
  cacheHits: number;
  totalRequests: number;
}

// ─── Telemetry Mode ───

/** Telemetry participation mode. */
export type TelemetryMode = "contribute" | "consume" | "both" | "isolated";

/** Configuration for `.withTelemetry()`. */
export interface TelemetryConfig {
  /** Participation mode. @default "isolated" */
  readonly mode?: TelemetryMode;
  /** Privacy settings for differential noise. */
  readonly privacy?: PrivacyConfig;
}

// ─── Service Interface ───

/** Marker service indicating telemetry is enabled; provides access to aggregator. */
export interface TelemetryCollector {
  readonly mode: TelemetryMode;
  readonly aggregator: TelemetryAggregator;
}

export class TelemetryCollectorTag extends Context.Tag("TelemetryCollector")<
  TelemetryCollectorTag,
  TelemetryCollector
>() {}

// ─── Live Implementation ───

/**
 * Creates a TelemetryCollector that auto-subscribes to EventBus events.
 *
 * Accumulates per-task LLM metrics, then on `AgentCompleted` produces an
 * anonymized TelemetryRecord and feeds it to the TelemetryAggregator.
 */
export const TelemetryCollectorLive = (config: TelemetryConfig = {}) =>
  Layer.effect(
    TelemetryCollectorTag,
    Effect.gen(function* () {
      const eb = yield* EventBus;
      const aggregator = yield* TelemetryAggregatorTag;
      const mode = config.mode ?? "isolated";
      const privacyConfig = config.privacy;

      // Per-task accumulators keyed by taskId
      const accumulators = yield* Ref.make<Map<string, TaskAccumulator>>(new Map());

      const getOrCreate = (taskId: string, map: Map<string, TaskAccumulator>) => {
        let acc = map.get(taskId);
        if (!acc) {
          acc = {
            model: "unknown",
            provider: "unknown",
            tokensIn: 0,
            tokensOut: 0,
            totalCost: 0,
            toolNames: new Set(),
            strategy: "unknown",
            cacheHits: 0,
            totalRequests: 0,
          };
          map.set(taskId, acc);
        }
        return acc;
      };

      // ── Subscribe to LLMRequestCompleted for per-call metrics ──
      yield* eb.on("LLMRequestCompleted", (event) =>
        Ref.update(accumulators, (map) => {
          const next = new Map(map);
          const acc = getOrCreate(event.taskId, next);
          acc.model = event.model;
          acc.provider = event.provider;
          acc.tokensIn += Math.round(event.tokensUsed * 0.7); // estimate input ~70%
          acc.tokensOut += Math.round(event.tokensUsed * 0.3);
          acc.totalCost += event.estimatedCost;
          acc.totalRequests += 1;
          return next;
        }),
      );

      // ── Subscribe to ToolCallCompleted for tool tracking ──
      yield* eb.on("ToolCallCompleted", (event) =>
        Ref.update(accumulators, (map) => {
          const next = new Map(map);
          const acc = getOrCreate(event.taskId, next);
          acc.toolNames.add(event.toolName);
          return next;
        }),
      );

      // ── Subscribe to FinalAnswerProduced for strategy ──
      yield* eb.on("FinalAnswerProduced", (event) =>
        Ref.update(accumulators, (map) => {
          const next = new Map(map);
          const acc = getOrCreate(event.taskId, next);
          acc.strategy = event.strategy;
          return next;
        }),
      );

      // ── Subscribe to AgentCompleted — produce anonymized record ──
      yield* eb.on("AgentCompleted", (event) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(accumulators);
          const acc = map.get(event.taskId);

          const raw: RawRunData = {
            strategy: acc?.strategy ?? "unknown",
            model: acc?.model ?? "unknown",
            tokensIn: acc?.tokensIn ?? Math.round(event.totalTokens * 0.7),
            tokensOut: acc?.tokensOut ?? Math.round(event.totalTokens * 0.3),
            latencyMs: event.durationMs,
            success: event.success,
            toolNames: acc ? [...acc.toolNames] : [],
            iterationCount: event.totalIterations,
            costUsd: acc?.totalCost ?? 0,
            cacheHitRate: acc && acc.totalRequests > 0 ? acc.cacheHits / acc.totalRequests : 0,
            timestamp: new Date(),
          };

          const record = preservePrivacy(raw, privacyConfig);
          yield* aggregator.record(record);

          // Clean up accumulator for this task
          yield* Ref.update(accumulators, (m) => {
            const next = new Map(m);
            next.delete(event.taskId);
            return next;
          });
        }),
      );

      return { mode, aggregator } satisfies TelemetryCollector;
    }),
  ).pipe(Layer.provide(TelemetryAggregatorLive));
