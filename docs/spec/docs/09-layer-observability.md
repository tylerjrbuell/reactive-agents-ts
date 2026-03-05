# Layer 9: Observability - AI Agent Implementation Spec

## Overview

OpenTelemetry-based distributed tracing, structured JSON logging, metrics collection, real-time state inspection, and debugging tools. This layer provides full visibility into agent behavior — what it's thinking, why it made decisions, how long operations took, and where things go wrong. Critical for development, debugging, and production monitoring.

**Package:** `@reactive-agents/observability`
**Dependencies:** `@reactive-agents/core` (EventBus, types)

---

## Package Structure

```
@reactive-agents/observability/
├── src/
│   ├── index.ts                          # Public API exports
│   ├── observability-service.ts          # Main ObservabilityService (Effect service)
│   ├── types.ts                          # All types & schemas
│   ├── tracing/
│   │   ├── tracer.ts                    # OpenTelemetry tracer integration
│   │   └── span-enricher.ts            # Agent-specific span attributes
│   ├── logging/
│   │   ├── structured-logger.ts         # JSON structured logging
│   │   └── log-context.ts              # Contextual logging (agent, session, trace)
│   ├── metrics/
│   │   ├── metrics-collector.ts         # Counter, histogram, gauge metrics
│   │   └── metrics-registry.ts          # Metric registration & export
│   ├── debugging/
│   │   ├── state-inspector.ts           # Real-time agent state inspection
│   │   └── thought-tracer.ts            # Reasoning chain visualization
│   └── exporters/
│       ├── console-exporter.ts          # Dev-friendly console output
│       ├── otlp-exporter.ts             # OpenTelemetry Protocol exporter
│       └── file-exporter.ts             # File-based export for CI/testing
├── tests/
│   ├── observability-service.test.ts
│   ├── tracing/
│   │   └── tracer.test.ts
│   ├── logging/
│   │   └── structured-logger.test.ts
│   ├── metrics/
│   │   └── metrics-collector.test.ts
│   └── debugging/
│       └── state-inspector.test.ts
└── package.json
```

---

## Build Order

1. `src/types.ts` — SpanSchema, LogEntrySchema, MetricSchema, TraceContextSchema, ExporterConfig schemas
2. `src/errors.ts` — All error types (ObservabilityError, TracingError, ExporterError)
3. `src/tracing/span-enricher.ts` — Agent-specific span attribute enrichment
4. `src/tracing/tracer.ts` — OpenTelemetry tracer integration
5. `src/logging/log-context.ts` — Contextual logging (agent, session, trace)
6. `src/logging/structured-logger.ts` — JSON structured logging
7. `src/metrics/metrics-registry.ts` — Metric registration and export
8. `src/metrics/metrics-collector.ts` — Counter, histogram, gauge metrics
9. `src/debugging/thought-tracer.ts` — Reasoning chain visualization
10. `src/debugging/state-inspector.ts` — Real-time agent state inspection
11. `src/exporters/console-exporter.ts` — Dev-friendly console output
12. `src/exporters/otlp-exporter.ts` — OpenTelemetry Protocol exporter
13. `src/exporters/file-exporter.ts` — File-based export for CI/testing
14. `src/observability-service.ts` — Main ObservabilityService Context.Tag + ObservabilityServiceLive
15. `src/index.ts` — Public re-exports
16. Tests for each module

---

## Core Types & Schemas

```typescript
import { Schema, Data, Effect, Context, Layer, Duration } from "effect";
import { LogLevel } from "@reactive-agents/core";
export { LogLevel };

// Re-exported from @reactive-agents/core for convenience.
// Canonical definition: layer-01-core-detailed-design.md src/types/config.ts

// ─── Structured Log Entry ───

export const LogEntrySchema = Schema.Struct({
  timestamp: Schema.DateFromSelf,
  level: LogLevel,
  message: Schema.String,
  agentId: Schema.optional(Schema.String),
  sessionId: Schema.optional(Schema.String),
  traceId: Schema.optional(Schema.String),
  spanId: Schema.optional(Schema.String),
  layer: Schema.optional(Schema.String), // Which architectural layer
  operation: Schema.optional(Schema.String), // e.g., 'reasoning.think', 'tools.execute'
  durationMs: Schema.optional(Schema.Number),
  error: Schema.optional(
    Schema.Struct({
      name: Schema.String,
      message: Schema.String,
      stack: Schema.optional(Schema.String),
    }),
  ),
  metadata: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});
export type LogEntry = typeof LogEntrySchema.Type;

// ─── Span (Trace) ───

export const SpanStatusSchema = Schema.Literal("ok", "error", "unset");
export type SpanStatus = typeof SpanStatusSchema.Type;

export const SpanSchema = Schema.Struct({
  traceId: Schema.String,
  spanId: Schema.String,
  parentSpanId: Schema.optional(Schema.String),
  name: Schema.String,
  startTime: Schema.DateFromSelf,
  endTime: Schema.optional(Schema.DateFromSelf),
  status: SpanStatusSchema,
  attributes: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  events: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      timestamp: Schema.DateFromSelf,
      attributes: Schema.optional(
        Schema.Record({ key: Schema.String, value: Schema.Unknown }),
      ),
    }),
  ),
});
export type Span = typeof SpanSchema.Type;

// ─── Metric Types ───

export const MetricType = Schema.Literal("counter", "histogram", "gauge");
export type MetricType = typeof MetricType.Type;

export const MetricSchema = Schema.Struct({
  name: Schema.String,
  type: MetricType,
  value: Schema.Number,
  timestamp: Schema.DateFromSelf,
  labels: Schema.Record({ key: Schema.String, value: Schema.String }),
  unit: Schema.optional(Schema.String),
});
export type Metric = typeof MetricSchema.Type;

// ─── Agent State Snapshot (for debugging) ───

export const AgentStateSnapshotSchema = Schema.Struct({
  agentId: Schema.String,
  timestamp: Schema.DateFromSelf,
  workingMemory: Schema.Array(Schema.Unknown),
  currentStrategy: Schema.optional(Schema.String),
  reasoningStep: Schema.optional(Schema.Number),
  activeTools: Schema.Array(Schema.String),
  tokenUsage: Schema.Struct({
    inputTokens: Schema.Number,
    outputTokens: Schema.Number,
    contextWindowUsed: Schema.Number,
    contextWindowMax: Schema.Number,
  }),
  costAccumulated: Schema.Number,
  verificationResults: Schema.optional(Schema.Array(Schema.Unknown)),
});
export type AgentStateSnapshot = typeof AgentStateSnapshotSchema.Type;

// ─── Pre-defined Metrics ───

export const AgentMetrics = {
  // Reasoning
  "reasoning.think_duration_ms": {
    type: "histogram" as const,
    unit: "ms",
    description: "Time spent in reasoning think step",
  },
  "reasoning.strategy_selected": {
    type: "counter" as const,
    unit: "count",
    description: "Strategy selection events",
  },
  "reasoning.steps_per_task": {
    type: "histogram" as const,
    unit: "count",
    description: "Reasoning steps per task",
  },
  "reasoning.max_steps_reached": {
    type: "counter" as const,
    unit: "count",
    description: "Times max reasoning steps was hit",
  },

  // LLM
  "llm.request_duration_ms": {
    type: "histogram" as const,
    unit: "ms",
    description: "LLM request latency",
  },
  "llm.tokens_input": {
    type: "counter" as const,
    unit: "tokens",
    description: "Total input tokens consumed",
  },
  "llm.tokens_output": {
    type: "counter" as const,
    unit: "tokens",
    description: "Total output tokens generated",
  },
  "llm.errors": {
    type: "counter" as const,
    unit: "count",
    description: "LLM call errors",
  },
  "llm.retries": {
    type: "counter" as const,
    unit: "count",
    description: "LLM call retries",
  },

  // Verification
  "verification.checks_run": {
    type: "counter" as const,
    unit: "count",
    description: "Total verification checks",
  },
  "verification.hallucinations_detected": {
    type: "counter" as const,
    unit: "count",
    description: "Hallucinations caught",
  },
  "verification.duration_ms": {
    type: "histogram" as const,
    unit: "ms",
    description: "Verification latency",
  },

  // Memory
  "memory.searches": {
    type: "counter" as const,
    unit: "count",
    description: "Memory search operations",
  },
  "memory.search_duration_ms": {
    type: "histogram" as const,
    unit: "ms",
    description: "Memory search latency",
  },
  "memory.facts_stored": {
    type: "gauge" as const,
    unit: "count",
    description: "Total facts in factual memory",
  },

  // Cost
  "cost.total_usd": {
    type: "gauge" as const,
    unit: "USD",
    description: "Total accumulated cost",
  },
  "cost.cache_hit_rate": {
    type: "gauge" as const,
    unit: "percent",
    description: "Semantic cache hit rate",
  },
  "cost.savings_usd": {
    type: "gauge" as const,
    unit: "USD",
    description: "Estimated savings from optimization",
  },

  // Tools
  "tools.executions": {
    type: "counter" as const,
    unit: "count",
    description: "Tool execution count",
  },
  "tools.execution_duration_ms": {
    type: "histogram" as const,
    unit: "ms",
    description: "Tool execution latency",
  },
  "tools.errors": {
    type: "counter" as const,
    unit: "count",
    description: "Tool execution errors",
  },

  // Orchestration
  "orchestration.workflows_active": {
    type: "gauge" as const,
    unit: "count",
    description: "Active workflows",
  },
  "orchestration.workflow_duration_ms": {
    type: "histogram" as const,
    unit: "ms",
    description: "Workflow total duration",
  },
  "orchestration.workers_active": {
    type: "gauge" as const,
    unit: "count",
    description: "Active worker agents",
  },
} as const;
```

---

## Error Types

```typescript
import { Data } from "effect";

export class TracingError extends Data.TaggedError("TracingError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class MetricsError extends Data.TaggedError("MetricsError")<{
  readonly message: string;
  readonly metricName?: string;
}> {}

export class ExporterError extends Data.TaggedError("ExporterError")<{
  readonly message: string;
  readonly exporter: string;
  readonly cause?: unknown;
}> {}
```

---

## Effect Service Definition

```typescript
import { Effect, Context } from "effect";

export class ObservabilityService extends Context.Tag("ObservabilityService")<
  ObservabilityService,
  {
    // ─── Tracing ───

    /**
     * Create a traced span wrapping an Effect operation.
     * Automatically records duration, status, and errors.
     */
    readonly withSpan: <A, E>(
      name: string,
      effect: Effect.Effect<A, E>,
      attributes?: Record<string, unknown>,
    ) => Effect.Effect<A, E>;

    /**
     * Get the current trace context (traceId, spanId).
     */
    readonly getTraceContext: () => Effect.Effect<
      { traceId: string; spanId: string },
      never
    >;

    // ─── Logging ───

    /**
     * Log a structured message with contextual metadata.
     */
    readonly log: (
      level: LogLevel,
      message: string,
      metadata?: Record<string, unknown>,
    ) => Effect.Effect<void, never>;

    /**
     * Convenience methods for common log levels.
     */
    readonly debug: (
      message: string,
      metadata?: Record<string, unknown>,
    ) => Effect.Effect<void, never>;
    readonly info: (
      message: string,
      metadata?: Record<string, unknown>,
    ) => Effect.Effect<void, never>;
    readonly warn: (
      message: string,
      metadata?: Record<string, unknown>,
    ) => Effect.Effect<void, never>;
    readonly error: (
      message: string,
      error?: unknown,
      metadata?: Record<string, unknown>,
    ) => Effect.Effect<void, never>;

    // ─── Metrics ───

    /**
     * Increment a counter metric.
     */
    readonly incrementCounter: (
      name: string,
      value?: number,
      labels?: Record<string, string>,
    ) => Effect.Effect<void, never>;

    /**
     * Record a histogram observation (e.g., latency).
     */
    readonly recordHistogram: (
      name: string,
      value: number,
      labels?: Record<string, string>,
    ) => Effect.Effect<void, never>;

    /**
     * Set a gauge value.
     */
    readonly setGauge: (
      name: string,
      value: number,
      labels?: Record<string, string>,
    ) => Effect.Effect<void, never>;

    /**
     * Get all collected metrics for a time range.
     */
    readonly getMetrics: (filter?: {
      name?: string;
      startTime?: Date;
      endTime?: Date;
    }) => Effect.Effect<readonly Metric[], never>;

    // ─── Debugging ───

    /**
     * Capture a snapshot of the current agent state for debugging.
     */
    readonly captureSnapshot: (
      agentId: string,
      state: Partial<AgentStateSnapshot>,
    ) => Effect.Effect<AgentStateSnapshot, never>;

    /**
     * Get recent snapshots for an agent.
     */
    readonly getSnapshots: (
      agentId: string,
      limit?: number,
    ) => Effect.Effect<readonly AgentStateSnapshot[], never>;

    /**
     * Flush all buffered telemetry data to exporters.
     */
    readonly flush: () => Effect.Effect<void, ExporterError>;
  }
>() {}
```

---

## Tracer Implementation

```typescript
import { Effect, Ref, FiberRef } from "effect";

export const makeTracer = Effect.gen(function* () {
  const spansRef = yield* Ref.make<Span[]>([]);

  // Generate IDs (in production: use OpenTelemetry SDK)
  const generateId = (): string => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  };

  const generateSpanId = (): string => {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  };

  const withSpan = <A, E>(
    name: string,
    effect: Effect.Effect<A, E>,
    attributes?: Record<string, unknown>,
  ): Effect.Effect<A, E> =>
    Effect.gen(function* () {
      const traceId = generateId();
      const spanId = generateSpanId();

      const span: Span = {
        traceId,
        spanId,
        name,
        startTime: new Date(),
        status: "unset",
        attributes: {
          ...attributes,
          "service.name": "reactive-agents",
          "span.kind": "internal",
        },
        events: [],
      };

      const startTime = performance.now();

      const result = yield* effect.pipe(
        Effect.tap(() =>
          Ref.update(spansRef, (spans) => [
            ...spans,
            {
              ...span,
              endTime: new Date(),
              status: "ok" as const,
              attributes: {
                ...span.attributes,
                duration_ms: performance.now() - startTime,
              },
            },
          ]),
        ),
        Effect.tapError((error) =>
          Ref.update(spansRef, (spans) => [
            ...spans,
            {
              ...span,
              endTime: new Date(),
              status: "error" as const,
              attributes: {
                ...span.attributes,
                duration_ms: performance.now() - startTime,
                "error.type":
                  typeof error === "object" && error !== null && "_tag" in error
                    ? (error as any)._tag
                    : "unknown",
                "error.message": String(error),
              },
              events: [
                ...span.events,
                {
                  name: "exception",
                  timestamp: new Date(),
                  attributes: { message: String(error) },
                },
              ],
            },
          ]),
        ),
      );

      return result;
    });

  const getTraceContext = (): Effect.Effect<
    { traceId: string; spanId: string },
    never
  > => Effect.succeed({ traceId: generateId(), spanId: generateSpanId() });

  const getSpans = (filter?: {
    name?: string;
    status?: SpanStatus;
  }): Effect.Effect<readonly Span[], never> =>
    Effect.gen(function* () {
      const spans = yield* Ref.get(spansRef);
      let filtered = spans;
      if (filter?.name)
        filtered = filtered.filter((s) => s.name.includes(filter.name!));
      if (filter?.status)
        filtered = filtered.filter((s) => s.status === filter.status);
      return filtered;
    });

  return { withSpan, getTraceContext, getSpans };
});
```

---

## Structured Logger Implementation

```typescript
import { Effect, Ref } from "effect";

export const makeStructuredLogger = Effect.gen(function* () {
  const logsRef = yield* Ref.make<LogEntry[]>([]);
  const minLevel = "debug" as LogLevel;

  const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    fatal: 4,
  };

  const shouldLog = (level: LogLevel): boolean =>
    LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[minLevel];

  const log = (
    level: LogLevel,
    message: string,
    metadata?: Record<string, unknown>,
  ): Effect.Effect<void, never> =>
    Effect.gen(function* () {
      if (!shouldLog(level)) return;

      const entry: LogEntry = {
        timestamp: new Date(),
        level,
        message,
        metadata,
      };

      yield* Ref.update(logsRef, (logs) => [...logs, entry]);

      // Also output to console in non-test environments
      if (process.env.NODE_ENV !== "test") {
        const json = JSON.stringify({
          timestamp: entry.timestamp.toISOString(),
          level: entry.level,
          message: entry.message,
          ...entry.metadata,
          ...(entry.agentId ? { agentId: entry.agentId } : {}),
          ...(entry.traceId ? { traceId: entry.traceId } : {}),
          ...(entry.error ? { error: entry.error } : {}),
        });

        switch (level) {
          case "debug":
            console.debug(json);
            break;
          case "info":
            console.info(json);
            break;
          case "warn":
            console.warn(json);
            break;
          case "error":
          case "fatal":
            console.error(json);
            break;
        }
      }
    });

  const debug = (msg: string, meta?: Record<string, unknown>) =>
    log("debug", msg, meta);
  const info = (msg: string, meta?: Record<string, unknown>) =>
    log("info", msg, meta);
  const warn = (msg: string, meta?: Record<string, unknown>) =>
    log("warn", msg, meta);
  const error = (msg: string, err?: unknown, meta?: Record<string, unknown>) =>
    log("error", msg, {
      ...meta,
      error:
        err instanceof Error
          ? { name: err.name, message: err.message, stack: err.stack }
          : { message: String(err) },
    });

  const getLogs = (filter?: {
    level?: LogLevel;
    agentId?: string;
    limit?: number;
  }): Effect.Effect<readonly LogEntry[], never> =>
    Effect.gen(function* () {
      const logs = yield* Ref.get(logsRef);
      let filtered = logs;
      if (filter?.level)
        filtered = filtered.filter(
          (l) => LOG_LEVEL_ORDER[l.level] >= LOG_LEVEL_ORDER[filter.level!],
        );
      if (filter?.agentId)
        filtered = filtered.filter((l) => l.agentId === filter.agentId);
      if (filter?.limit) filtered = filtered.slice(-filter.limit);
      return filtered;
    });

  return { log, debug, info, warn, error, getLogs };
});
```

---

## Metrics Collector Implementation

```typescript
import { Effect, Ref } from "effect";

export const makeMetricsCollector = Effect.gen(function* () {
  const metricsRef = yield* Ref.make<Metric[]>([]);
  const gaugesRef = yield* Ref.make<Map<string, number>>(new Map());

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
      {
        name,
        type: "histogram" as const,
        value,
        timestamp: new Date(),
        labels,
      },
    ]);

  const setGauge = (
    name: string,
    value: number,
    labels: Record<string, string> = {},
  ): Effect.Effect<void, never> =>
    Effect.gen(function* () {
      yield* Ref.set(
        gaugesRef,
        new Map(yield* Ref.get(gaugesRef)).set(name, value),
      );
      yield* Ref.update(metricsRef, (metrics) => [
        ...metrics,
        { name, type: "gauge" as const, value, timestamp: new Date(), labels },
      ]);
    });

  const getMetrics = (filter?: {
    name?: string;
    startTime?: Date;
    endTime?: Date;
  }): Effect.Effect<readonly Metric[], never> =>
    Effect.gen(function* () {
      const metrics = yield* Ref.get(metricsRef);
      let filtered = metrics;
      if (filter?.name)
        filtered = filtered.filter(
          (m) => m.name === filter.name || m.name.startsWith(filter.name!),
        );
      if (filter?.startTime)
        filtered = filtered.filter((m) => m.timestamp >= filter.startTime!);
      if (filter?.endTime)
        filtered = filtered.filter((m) => m.timestamp <= filter.endTime!);
      return filtered;
    });

  // Summary statistics for histograms
  const getHistogramSummary = (
    name: string,
  ): Effect.Effect<
    {
      count: number;
      min: number;
      max: number;
      avg: number;
      p50: number;
      p95: number;
      p99: number;
    },
    never
  > =>
    Effect.gen(function* () {
      const metrics = yield* Ref.get(metricsRef);
      const values = metrics
        .filter((m) => m.name === name && m.type === "histogram")
        .map((m) => m.value)
        .sort((a, b) => a - b);

      if (values.length === 0) {
        return { count: 0, min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
      }

      const count = values.length;
      const min = values[0];
      const max = values[count - 1];
      const avg = values.reduce((a, b) => a + b, 0) / count;
      const p50 = values[Math.floor(count * 0.5)];
      const p95 = values[Math.floor(count * 0.95)];
      const p99 = values[Math.floor(count * 0.99)];

      return { count, min, max, avg, p50, p95, p99 };
    });

  return {
    incrementCounter,
    recordHistogram,
    setGauge,
    getMetrics,
    getHistogramSummary,
  };
});
```

---

## State Inspector (Debugging)

```typescript
import { Effect, Ref } from "effect";

export const makeStateInspector = Effect.gen(function* () {
  const snapshotsRef = yield* Ref.make<AgentStateSnapshot[]>([]);
  const MAX_SNAPSHOTS = 1000;

  const capture = (
    agentId: string,
    partialState: Partial<AgentStateSnapshot>,
  ): Effect.Effect<AgentStateSnapshot, never> =>
    Effect.gen(function* () {
      const snapshot: AgentStateSnapshot = {
        agentId,
        timestamp: new Date(),
        workingMemory: partialState.workingMemory ?? [],
        currentStrategy: partialState.currentStrategy,
        reasoningStep: partialState.reasoningStep,
        activeTools: partialState.activeTools ?? [],
        tokenUsage: partialState.tokenUsage ?? {
          inputTokens: 0,
          outputTokens: 0,
          contextWindowUsed: 0,
          contextWindowMax: 200_000,
        },
        costAccumulated: partialState.costAccumulated ?? 0,
        verificationResults: partialState.verificationResults,
      };

      yield* Ref.update(snapshotsRef, (snaps) => {
        const updated = [...snaps, snapshot];
        return updated.length > MAX_SNAPSHOTS
          ? updated.slice(-MAX_SNAPSHOTS)
          : updated;
      });

      return snapshot;
    });

  const getSnapshots = (
    agentId: string,
    limit: number = 50,
  ): Effect.Effect<readonly AgentStateSnapshot[], never> =>
    Effect.gen(function* () {
      const snapshots = yield* Ref.get(snapshotsRef);
      return snapshots.filter((s) => s.agentId === agentId).slice(-limit);
    });

  return { capture, getSnapshots };
});
```

---

## Main ObservabilityService Implementation

```typescript
import { Effect, Layer } from "effect";
import { EventBus } from "@reactive-agents/core";

export const ObservabilityServiceLive = Layer.effect(
  ObservabilityService,
  Effect.gen(function* () {
    const eventBus = yield* EventBus;
    const tracer = yield* makeTracer;
    const logger = yield* makeStructuredLogger;
    const metrics = yield* makeMetricsCollector;
    const inspector = yield* makeStateInspector;

    // Subscribe to EventBus for automatic metric collection
    // (In real implementation, subscribe to all domain events)

    const withSpan = <A, E>(
      name: string,
      effect: Effect.Effect<A, E>,
      attributes?: Record<string, unknown>,
    ): Effect.Effect<A, E> =>
      tracer.withSpan(name, effect, attributes).pipe(
        Effect.tap(() => metrics.incrementCounter(`span.${name}.completed`)),
        Effect.tapError(() => metrics.incrementCounter(`span.${name}.errors`)),
      );

    const getTraceContext = () => tracer.getTraceContext();

    const log = (
      level: LogLevel,
      message: string,
      metadata?: Record<string, unknown>,
    ) => logger.log(level, message, metadata);

    const debug = (msg: string, meta?: Record<string, unknown>) =>
      logger.debug(msg, meta);
    const info = (msg: string, meta?: Record<string, unknown>) =>
      logger.info(msg, meta);
    const warn = (msg: string, meta?: Record<string, unknown>) =>
      logger.warn(msg, meta);
    const error = (
      msg: string,
      err?: unknown,
      meta?: Record<string, unknown>,
    ) => logger.error(msg, err, meta);

    const incrementCounter = (
      name: string,
      value?: number,
      labels?: Record<string, string>,
    ) => metrics.incrementCounter(name, value, labels);

    const recordHistogram = (
      name: string,
      value: number,
      labels?: Record<string, string>,
    ) => metrics.recordHistogram(name, value, labels);

    const setGauge = (
      name: string,
      value: number,
      labels?: Record<string, string>,
    ) => metrics.setGauge(name, value, labels);

    const getMetrics = (filter?: {
      name?: string;
      startTime?: Date;
      endTime?: Date;
    }) => metrics.getMetrics(filter);

    const captureSnapshot = (
      agentId: string,
      state: Partial<AgentStateSnapshot>,
    ) => inspector.capture(agentId, state);

    const getSnapshots = (agentId: string, limit?: number) =>
      inspector.getSnapshots(agentId, limit);

    const flush = (): Effect.Effect<void, ExporterError> =>
      Effect.gen(function* () {
        // In production: flush to OTLP endpoint
        yield* logger.info("Flushing telemetry data");
      }).pipe(
        Effect.mapError(
          (e) =>
            new ExporterError({
              message: "Flush failed",
              exporter: "otlp",
              cause: e,
            }),
        ),
      );

    return {
      withSpan,
      getTraceContext,
      log,
      debug,
      info,
      warn,
      error,
      incrementCounter,
      recordHistogram,
      setGauge,
      getMetrics,
      captureSnapshot,
      getSnapshots,
      flush,
    };
  }),
);
```

---

## Effect-TS Integration Helper

The observability service should be used as a cross-cutting concern. This helper wraps any Effect with automatic tracing, logging, and metrics:

```typescript
/**
 * Wrap an Effect with full observability instrumentation.
 * Automatically adds: span tracing, start/end logging, duration metric, error tracking.
 *
 * Usage:
 *   const result = yield* observed('reasoning.think', myEffect, { strategy: 'react' });
 */
export const observed = <A, E>(
  operationName: string,
  effect: Effect.Effect<A, E>,
  attributes?: Record<string, unknown>,
): Effect.Effect<A, E> =>
  Effect.gen(function* () {
    const obs = yield* ObservabilityService;
    const startTime = performance.now();

    yield* obs.debug(`Starting ${operationName}`, attributes);

    const result = yield* obs.withSpan(operationName, effect, attributes);

    const durationMs = performance.now() - startTime;
    yield* obs.recordHistogram(`${operationName}.duration_ms`, durationMs);
    yield* obs.debug(`Completed ${operationName}`, {
      ...attributes,
      durationMs,
    });

    return result;
  });
```

---

## Testing

```typescript
import { Effect, Layer } from "effect";
import { describe, it, expect } from "vitest";
import { ObservabilityService, ObservabilityServiceLive } from "../src";

const TestObservabilityLayer = ObservabilityServiceLive.pipe(
  Layer.provide(TestEventBusLayer),
);

describe("ObservabilityService", () => {
  it("should trace operations with spans", async () => {
    const program = Effect.gen(function* () {
      const obs = yield* ObservabilityService;

      const result = yield* obs.withSpan("test.operation", Effect.succeed(42), {
        component: "test",
      });

      expect(result).toBe(42);
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(TestObservabilityLayer)),
    );
  });

  it("should capture error spans", async () => {
    const program = Effect.gen(function* () {
      const obs = yield* ObservabilityService;

      yield* obs
        .withSpan("test.failing", Effect.fail(new Error("test error")))
        .pipe(Effect.catchAll(() => Effect.void));

      // The span should be recorded with error status
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(TestObservabilityLayer)),
    );
  });

  it("should log structured messages", async () => {
    const program = Effect.gen(function* () {
      const obs = yield* ObservabilityService;

      yield* obs.info("Test message", { key: "value" });
      yield* obs.warn("Warning message");
      yield* obs.error("Error occurred", new Error("test"));
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(TestObservabilityLayer)),
    );
  });

  it("should collect and query metrics", async () => {
    const program = Effect.gen(function* () {
      const obs = yield* ObservabilityService;

      yield* obs.incrementCounter("test.counter", 1, { env: "test" });
      yield* obs.incrementCounter("test.counter", 1, { env: "test" });
      yield* obs.recordHistogram("test.latency", 150, { endpoint: "/api" });
      yield* obs.recordHistogram("test.latency", 200, { endpoint: "/api" });
      yield* obs.setGauge("test.active_connections", 5);

      const metrics = yield* obs.getMetrics({ name: "test" });
      expect(metrics.length).toBeGreaterThanOrEqual(5);

      const counters = metrics.filter((m) => m.name === "test.counter");
      expect(counters).toHaveLength(2);
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(TestObservabilityLayer)),
    );
  });

  it("should capture agent state snapshots", async () => {
    const program = Effect.gen(function* () {
      const obs = yield* ObservabilityService;

      const snapshot = yield* obs.captureSnapshot("agent-1", {
        currentStrategy: "react",
        reasoningStep: 3,
        activeTools: ["web-search"],
        tokenUsage: {
          inputTokens: 5000,
          outputTokens: 1000,
          contextWindowUsed: 6000,
          contextWindowMax: 200_000,
        },
        costAccumulated: 0.05,
      });

      expect(snapshot.agentId).toBe("agent-1");
      expect(snapshot.currentStrategy).toBe("react");

      const snapshots = yield* obs.getSnapshots("agent-1");
      expect(snapshots).toHaveLength(1);
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(TestObservabilityLayer)),
    );
  });

  it("should flush without error", async () => {
    const program = Effect.gen(function* () {
      const obs = yield* ObservabilityService;
      yield* obs.flush();
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(TestObservabilityLayer)),
    );
  });
});
```

---

## Configuration

```typescript
export const ObservabilityConfig = {
  // Logging
  logging: {
    minLevel: "info" as LogLevel, // 'debug' in development
    format: "json" as const,
    maxLogEntries: 100_000,
  },

  // Tracing
  tracing: {
    enabled: true,
    samplingRate: 1.0, // 100% in dev, reduce in prod
    maxSpansInMemory: 10_000,
    exportIntervalMs: 30_000,
  },

  // Metrics
  metrics: {
    enabled: true,
    exportIntervalMs: 60_000, // Export every minute
    maxMetricsInMemory: 50_000,
  },

  // Debugging
  debugging: {
    stateSnapshotEnabled: true,
    maxSnapshots: 1000,
    snapshotIntervalMs: 5_000, // Capture every 5 seconds during active reasoning
  },

  // Exporters
  exporters: {
    console: { enabled: true },
    otlp: {
      enabled: false,
      endpoint: "http://localhost:4318",
      headers: {},
    },
    file: {
      enabled: false,
      path: "./logs/telemetry.jsonl",
    },
  },

  // Performance budget
  performanceBudget: {
    maxOverheadPercent: 1, // Observability should add <1% overhead
    batchSize: 100, // Batch metric exports
  },
};
```

---

## Performance Targets

| Metric                       | Target  | Notes                                      |
| ---------------------------- | ------- | ------------------------------------------ |
| Span creation overhead       | <0.1ms  | Per span create/close                      |
| Log write overhead           | <0.05ms | Per structured log entry                   |
| Metric recording             | <0.01ms | Per counter/histogram/gauge                |
| State snapshot capture       | <5ms    | Including serialization                    |
| Total observability overhead | <1%     | Of total request processing time           |
| Memory footprint             | <20MB   | For 10K spans + 50K metrics + 1K snapshots |
| Flush to OTLP                | <100ms  | Batch export                               |

---

## Integration Points

- **All Layers**: Every layer should use `ObservabilityService.withSpan()` or the `observed()` helper for automatic tracing
- **EventBus** (Layer 1): Subscribe to all domain events for automatic metric collection
- **Reasoning** (Layer 3): Trace reasoning steps, log strategy selections, metric reasoning duration
- **Verification** (Layer 4): Trace verification layers, metric hallucination detection rates
- **Cost** (Layer 5): Export cost metrics as gauges
- **Tools** (Layer 8): Trace tool executions, log tool inputs/outputs
- **Interaction** (Layer 10): Surface debugging UI, state inspector, and thought trace visualization

## Success Criteria

- [ ] OpenTelemetry-compatible span tracing across all layers
- [ ] Structured JSON logging with contextual metadata
- [ ] Counter, histogram, and gauge metrics for all key operations
- [ ] Real-time agent state inspection for debugging
- [ ] Console, OTLP, and file exporters working
- [ ] <1% overhead on total processing time
- [ ] `observed()` helper makes instrumentation easy for all layers
- [ ] Pre-defined metrics cover all 10 architectural layers
- [ ] All operations use Effect-TS patterns (no raw async/await)

---

## Package Config

### File: `package.json`

```json
{
  "name": "@reactive-agents/observability",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "dependencies": {
    "effect": "^3.10.0",
    "@reactive-agents/core": "workspace:*",
    "@opentelemetry/api": "^1.7.0",
    "@opentelemetry/sdk-node": "^0.48.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "bun-types": "latest"
  }
}
```

---

**Status: Ready for implementation**
**Priority: Phase 3 (Week 13)**
