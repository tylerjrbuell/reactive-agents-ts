import { Effect, Context, Layer } from "effect";
import type { LogLevel, Metric, AgentStateSnapshot } from "./types.js";
import type { ExporterError } from "./errors.js";
import { makeTracer } from "./tracing/tracer.js";
import { makeStructuredLogger } from "./logging/structured-logger.js";
import { makeMetricsCollector } from "./metrics/metrics-collector.js";
import { makeStateInspector } from "./debugging/state-inspector.js";

// ─── Service Tag ───

export class ObservabilityService extends Context.Tag("ObservabilityService")<
  ObservabilityService,
  {
    readonly withSpan: <A, E>(name: string, effect: Effect.Effect<A, E>, attributes?: Record<string, unknown>) => Effect.Effect<A, E>;
    readonly getTraceContext: () => Effect.Effect<{ traceId: string; spanId: string }, never>;
    readonly log: (level: LogLevel, message: string, metadata?: Record<string, unknown>) => Effect.Effect<void, never>;
    readonly debug: (message: string, metadata?: Record<string, unknown>) => Effect.Effect<void, never>;
    readonly info: (message: string, metadata?: Record<string, unknown>) => Effect.Effect<void, never>;
    readonly warn: (message: string, metadata?: Record<string, unknown>) => Effect.Effect<void, never>;
    readonly error: (message: string, error?: unknown, metadata?: Record<string, unknown>) => Effect.Effect<void, never>;
    readonly incrementCounter: (name: string, value?: number, labels?: Record<string, string>) => Effect.Effect<void, never>;
    readonly recordHistogram: (name: string, value: number, labels?: Record<string, string>) => Effect.Effect<void, never>;
    readonly setGauge: (name: string, value: number, labels?: Record<string, string>) => Effect.Effect<void, never>;
    readonly getMetrics: (filter?: { name?: string; startTime?: Date; endTime?: Date }) => Effect.Effect<readonly Metric[], never>;
    readonly captureSnapshot: (agentId: string, state: Partial<AgentStateSnapshot>) => Effect.Effect<AgentStateSnapshot, never>;
    readonly getSnapshots: (agentId: string, limit?: number) => Effect.Effect<readonly AgentStateSnapshot[], never>;
    readonly flush: () => Effect.Effect<void, ExporterError>;
  }
>() {}

// ─── Live Implementation ───

export const ObservabilityServiceLive = Layer.effect(
  ObservabilityService,
  Effect.gen(function* () {
    const tracer = yield* makeTracer;
    const logger = yield* makeStructuredLogger;
    const metrics = yield* makeMetricsCollector;
    const inspector = yield* makeStateInspector;

    return {
      withSpan: (name, effect, attributes) =>
        tracer.withSpan(name, effect, attributes).pipe(
          Effect.tap(() => metrics.incrementCounter(`span.${name}.completed`)),
          Effect.tapError(() => metrics.incrementCounter(`span.${name}.errors`)),
        ),
      getTraceContext: () => tracer.getTraceContext(),
      log: (level, message, metadata) => logger.log(level, message, metadata),
      debug: (msg, meta) => logger.debug(msg, meta),
      info: (msg, meta) => logger.info(msg, meta),
      warn: (msg, meta) => logger.warn(msg, meta),
      error: (msg, err, meta) => logger.error(msg, err, meta),
      incrementCounter: (name, value, labels) => metrics.incrementCounter(name, value, labels),
      recordHistogram: (name, value, labels) => metrics.recordHistogram(name, value, labels),
      setGauge: (name, value, labels) => metrics.setGauge(name, value, labels),
      getMetrics: (filter) => metrics.getMetrics(filter),
      captureSnapshot: (agentId, state) => inspector.capture(agentId, state),
      getSnapshots: (agentId, limit) => inspector.getSnapshots(agentId, limit),
      flush: () => Effect.void as Effect.Effect<void, ExporterError>,
    };
  }),
);
