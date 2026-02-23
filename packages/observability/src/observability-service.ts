import { Effect, Context, Layer } from "effect";
import type { LogLevel, Metric, AgentStateSnapshot, Span, LogEntry, SpanStatus } from "./types.js";
import type { ExporterError } from "./errors.js";
import { makeTracer } from "./tracing/tracer.js";
import { makeStructuredLogger } from "./logging/structured-logger.js";
import { makeMetricsCollector } from "./metrics/metrics-collector.js";
import { makeStateInspector } from "./debugging/state-inspector.js";
import { makeConsoleExporter, makeFileExporter, makeLiveLogWriter } from "./exporters/index.js";
import type { ConsoleExporterOptions, FileExporterOptions } from "./exporters/index.js";

// ─── Verbosity / Exporter Config ───

export type VerbosityLevel = "minimal" | "normal" | "verbose" | "debug";

export type ExporterConfig = {
  /** Console exporter — pretty-prints to stdout. */
  readonly console?: ConsoleExporterOptions | false;
  /** File exporter — writes JSONL for post-analysis. */
  readonly file?: FileExporterOptions | false;
  /** Verbosity level for structured log output. Default: "normal" */
  readonly verbosity?: VerbosityLevel;
  /** Stream logs in real-time (live mode). Default: false */
  readonly live?: boolean;
};

// ─── Service Tag ───

export class ObservabilityService extends Context.Tag("ObservabilityService")<
  ObservabilityService,
  {
    readonly withSpan: <A, E>(name: string, effect: Effect.Effect<A, E>, attributes?: Record<string, unknown>) => Effect.Effect<A, E>;
    readonly getTraceContext: () => Effect.Effect<{ traceId: string; spanId: string; parentSpanId?: string }, never>;
    readonly log: (level: LogLevel, message: string, metadata?: Record<string, unknown>) => Effect.Effect<void, never>;
    readonly debug: (message: string, metadata?: Record<string, unknown>) => Effect.Effect<void, never>;
    readonly info: (message: string, metadata?: Record<string, unknown>) => Effect.Effect<void, never>;
    readonly warn: (message: string, metadata?: Record<string, unknown>) => Effect.Effect<void, never>;
    readonly error: (message: string, error?: unknown, metadata?: Record<string, unknown>) => Effect.Effect<void, never>;
    readonly incrementCounter: (name: string, value?: number, labels?: Record<string, string>) => Effect.Effect<void, never>;
    readonly recordHistogram: (name: string, value: number, labels?: Record<string, string>) => Effect.Effect<void, never>;
    readonly setGauge: (name: string, value: number, labels?: Record<string, string>) => Effect.Effect<void, never>;
    readonly getMetrics: (filter?: { name?: string; startTime?: Date; endTime?: Date }) => Effect.Effect<readonly Metric[], never>;
    readonly getLogs: (filter?: { level?: LogLevel; agentId?: string; limit?: number }) => Effect.Effect<readonly LogEntry[], never>;
    readonly getSpans: (filter?: { name?: string; status?: SpanStatus }) => Effect.Effect<readonly Span[], never>;
    readonly captureSnapshot: (agentId: string, state: Partial<AgentStateSnapshot>) => Effect.Effect<AgentStateSnapshot, never>;
    readonly getSnapshots: (agentId: string, limit?: number) => Effect.Effect<readonly AgentStateSnapshot[], never>;
    readonly flush: () => Effect.Effect<void, ExporterError>;
    readonly verbosity: () => VerbosityLevel;
  }
>() {}

// ─── Live Implementation ───

export const ObservabilityServiceLive = (exporterConfig: ExporterConfig = {}) =>
  Layer.effect(
    ObservabilityService,
    Effect.gen(function* () {
      const verbosityLevel: VerbosityLevel = exporterConfig.verbosity ?? "normal";

      // Build live writer when live mode is enabled
      const liveWriter = exporterConfig.live
        ? makeLiveLogWriter(
            typeof exporterConfig.console === "object" ? exporterConfig.console : undefined,
          )
        : undefined;

      const tracer = yield* makeTracer;
      const logger = yield* makeStructuredLogger(liveWriter ? { liveWriter } : undefined);
      const metrics = yield* makeMetricsCollector;
      const inspector = yield* makeStateInspector;

      // Build exporters from config
      const consoleExp =
        exporterConfig.console !== false
          ? makeConsoleExporter(
              typeof exporterConfig.console === "object" ? exporterConfig.console : {},
            )
          : null;
      const fileExp =
        exporterConfig.file
          ? makeFileExporter(exporterConfig.file as FileExporterOptions)
          : null;

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
        getLogs: (filter) => logger.getLogs(filter),
        getSpans: (filter) => tracer.getSpans(filter),
        captureSnapshot: (agentId, state) => inspector.capture(agentId, state),
        getSnapshots: (agentId, limit) => inspector.getSnapshots(agentId, limit),

        verbosity: () => verbosityLevel,

        flush: () =>
          Effect.gen(function* () {
            const [logs, spans, allMetrics] = yield* Effect.all([
              logger.getLogs(),
              tracer.getSpans(),
              metrics.getMetrics(),
            ]);

            if (consoleExp) {
              consoleExp.exportLogs(logs);
              consoleExp.exportSpans(spans);
              consoleExp.exportMetrics(allMetrics);
            }
            if (fileExp) {
              fileExp.exportLogs(logs);
              fileExp.exportSpans(spans);
              fileExp.exportMetrics(allMetrics);
            }
          }) as Effect.Effect<void, ExporterError>,
      };
    }),
  );

// ─── Backwards-compat default export (no exporters) ───
// Previously ObservabilityServiceLive was a Layer directly; now it's a function.
// The runtime.ts creates it via createObservabilityLayer() which stays the factory.
