import { Effect, Ref } from "effect";
import type { Metric } from "../types.js";

export interface MetricsCollector {
  readonly incrementCounter: (name: string, value?: number, labels?: Record<string, string>) => Effect.Effect<void, never>;
  readonly recordHistogram: (name: string, value: number, labels?: Record<string, string>) => Effect.Effect<void, never>;
  readonly setGauge: (name: string, value: number, labels?: Record<string, string>) => Effect.Effect<void, never>;
  readonly getMetrics: (filter?: { name?: string; startTime?: Date; endTime?: Date }) => Effect.Effect<readonly Metric[], never>;
}

export const makeMetricsCollector = Effect.gen(function* () {
  const metricsRef = yield* Ref.make<Metric[]>([]);

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

  return { incrementCounter, recordHistogram, setGauge, getMetrics } satisfies MetricsCollector;
});
