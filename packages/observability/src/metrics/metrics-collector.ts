import { Effect, Ref, Context, Layer, Option } from "effect";
import type { Metric, ToolMetric, ToolMetricStatus } from "../types.js";
import { EventBus } from "@reactive-agents/core";

export interface ToolSummary {
  readonly callCount: number;
  readonly totalDuration: number;
  readonly avgDuration: number;
  readonly successCount: number;
  readonly errorCount: number;
}

export interface MetricsCollector {
  readonly incrementCounter: (name: string, value?: number, labels?: Record<string, string>) => Effect.Effect<void, never>;
  readonly recordHistogram: (name: string, value: number, labels?: Record<string, string>) => Effect.Effect<void, never>;
  readonly setGauge: (name: string, value: number, labels?: Record<string, string>) => Effect.Effect<void, never>;
  readonly getMetrics: (filter?: { name?: string; startTime?: Date; endTime?: Date }) => Effect.Effect<readonly Metric[], never>;
  readonly recordToolExecution: (toolName: string, duration: number, status: ToolMetricStatus) => Effect.Effect<void, never>;
  readonly getToolMetrics: () => Effect.Effect<readonly ToolMetric[], never>;
  readonly getToolSummary: () => Effect.Effect<Map<string, ToolSummary>, never>;
}

// ─── Context Tag and Layer ───

export class MetricsCollectorTag extends Context.Tag("MetricsCollector")<MetricsCollectorTag, MetricsCollector>() {}

export const makeMetricsCollector = Effect.gen(function* () {
  const metricsRef = yield* Ref.make<Metric[]>([]);
  const toolMetricsRef = yield* Ref.make<ToolMetric[]>([]);

  const incrementCounter = (
    name: string,
    value: number = 1,
    labels: Record<string, string> = {},
  ): Effect.Effect<void, never> =>
    Ref.update(metricsRef, (metrics) => [
      ...metrics,
      { name, type: "counter" as const, value, timestamp: new Date(), labels },
    ]);

  const recordHistogram = (
    name: string,
    value: number,
    labels: Record<string, string> = {},
  ): Effect.Effect<void, never> =>
    Ref.update(metricsRef, (metrics) => [
      ...metrics,
      { name, type: "histogram" as const, value, timestamp: new Date(), labels },
    ]);

  const setGauge = (
    name: string,
    value: number,
    labels: Record<string, string> = {},
  ): Effect.Effect<void, never> =>
    Ref.update(metricsRef, (metrics) => [
      ...metrics,
      { name, type: "gauge" as const, value, timestamp: new Date(), labels },
    ]);

  const getMetrics = (filter?: { name?: string; startTime?: Date; endTime?: Date }): Effect.Effect<readonly Metric[], never> =>
    Effect.gen(function* () {
      const metrics = yield* Ref.get(metricsRef);
      let filtered = metrics;
      if (filter?.name) filtered = filtered.filter((m) => m.name === filter.name || m.name.startsWith(filter.name!));
      if (filter?.startTime) filtered = filtered.filter((m) => m.timestamp >= filter.startTime!);
      if (filter?.endTime) filtered = filtered.filter((m) => m.timestamp <= filter.endTime!);
      return filtered;
    });

  const recordToolExecution = (
    toolName: string,
    duration: number,
    status: ToolMetricStatus,
  ): Effect.Effect<void, never> =>
    Effect.gen(function* () {
      // Record in tool-specific tracker
      yield* Ref.update(toolMetricsRef, (metrics) => [
        ...metrics,
        { toolName, duration, status, callCount: 1, timestamp: new Date() },
      ]);

      // Also add to metrics array for dashboard export
      // Record as gauge metrics for tool call aggregation
      yield* Ref.update(metricsRef, (metrics) => [
        ...metrics,
        { name: "execution.tool.execution", type: "histogram" as const, value: duration, timestamp: new Date(), labels: { tool: toolName, status } },
      ]);
    });

  const getToolMetrics = (): Effect.Effect<readonly ToolMetric[], never> =>
    Ref.get(toolMetricsRef);

  const getToolSummary = (): Effect.Effect<Map<string, ToolSummary>, never> =>
    Effect.gen(function* () {
      const toolMetrics = yield* Ref.get(toolMetricsRef);
      const summary = new Map<string, ToolSummary>();

      for (const metric of toolMetrics) {
        const existing = summary.get(metric.toolName);
        if (existing) {
          summary.set(metric.toolName, {
            callCount: existing.callCount + 1,
            totalDuration: existing.totalDuration + metric.duration,
            avgDuration: (existing.totalDuration + metric.duration) / (existing.callCount + 1),
            successCount: metric.status === "success" ? existing.successCount + 1 : existing.successCount,
            errorCount: metric.status === "error" ? existing.errorCount + 1 : existing.errorCount,
          });
        } else {
          summary.set(metric.toolName, {
            callCount: 1,
            totalDuration: metric.duration,
            avgDuration: metric.duration,
            successCount: metric.status === "success" ? 1 : 0,
            errorCount: metric.status === "error" ? 1 : 0,
          });
        }
      }

      return summary;
    });

  return { incrementCounter, recordHistogram, setGauge, getMetrics, recordToolExecution, getToolMetrics, getToolSummary } satisfies MetricsCollector;
});

export const MetricsCollectorLive: Layer.Layer<MetricsCollectorTag, never> = Layer.effect(
  MetricsCollectorTag,
  Effect.gen(function* () {
    const collector = yield* makeMetricsCollector;

    // Optionally subscribe to EventBus for ToolCallCompleted events
    const ebOpt = yield* Effect.serviceOption(EventBus);
    if (Option.isSome(ebOpt)) {
      // Register a handler — subscribe() returns an unsubscribe fn which we ignore
      // (the collector lives for the process lifetime)
      yield* ebOpt.value.on("ToolCallCompleted", (event) =>
        collector
          .recordToolExecution(
            event.toolName,
            event.durationMs,
            event.success ? "success" : "error",
          )
          .pipe(Effect.catchAll(() => Effect.void)),
      );
    }

    return collector;
  }),
);
