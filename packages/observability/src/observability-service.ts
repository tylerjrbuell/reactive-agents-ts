import { Effect, Context, Layer } from "effect";
import type { LogLevel, Metric, AgentStateSnapshot, Span, LogEntry, SpanStatus } from "./types.js";
import { ExporterError } from "./errors.js";
import { makeTracer } from "./tracing/tracer.js";
import { makeStructuredLogger } from "./logging/structured-logger.js";
import { makeMetricsCollector, MetricsCollectorTag } from "./metrics/metrics-collector.js";
import { makeStateInspector } from "./debugging/state-inspector.js";
import { makeConsoleExporter, makeFileExporter, makeLiveLogWriter, setupOTLPExporter } from "./exporters/index.js";
import type { ConsoleExporterOptions, FileExporterOptions, OTLPExporterConfig } from "./exporters/index.js";

// ─── Verbosity / Exporter Config ───

/**
 * Logging verbosity level for observability output.
 *
 * @remarks
 * - `minimal`: No structured logs, only final metrics
 * - `normal`: Standard logs with phase boundaries and tool calls
 * - `verbose`: Detailed logs including thought traces and LLM requests
 * - `debug`: Full debug output with all internal state changes
 */
export type VerbosityLevel =
  /** No structured logs, only final metrics dashboard. */
  | "minimal"
  /** Standard logs with phase boundaries and tool calls. */
  | "normal"
  /** Detailed logs including thought traces and LLM requests. */
  | "verbose"
  /** Full debug output with all internal state changes. */
  | "debug";

/**
 * Configuration for observability exporters (console, file, live streaming).
 *
 * @example
 * ```typescript
 * const config: ExporterConfig = {
 *   console: { colorize: true },
 *   file: { filePath: "./logs/execution.jsonl" },
 *   verbosity: "verbose",
 *   live: true,
 * };
 * ```
 */
export type ExporterConfig = {
  /**
   * Console exporter options for pretty-printing to stdout.
   * Set to `false` to disable console output.
   *
   * @default `{ colorize: true }`
   */
  readonly console?: ConsoleExporterOptions | false;

  /**
   * File exporter options for JSONL output to disk.
   * Set to `false` to disable file output.
   *
   * @default disabled
   */
  readonly file?: FileExporterOptions | false;

  /**
   * Verbosity level for structured log output.
   *
   * @default "normal"
   */
  readonly verbosity?: VerbosityLevel;

  /**
   * Stream logs in real-time to exporters during execution.
   * When `false`, logs are buffered and exported on `flush()`.
   *
   * @default false
   */
  readonly live?: boolean;

  /**
   * OTLP exporter configuration for sending spans/metrics to OTel-compatible backends.
   * When provided, registers a global TracerProvider with OTLP HTTP exporters.
   *
   * @example
   * ```typescript
   * { otlp: { endpoint: "http://localhost:4318" } }
   * ```
   */
  readonly otlp?: OTLPExporterConfig;
};

// ─── Service Tag ───

/**
 * Observability service for tracing, logging, metrics collection, and state snapshots.
 *
 * Provides a unified interface for monitoring agent execution with support for:
 * - Distributed tracing (trace IDs, spans, parent-child relationships)
 * - Structured logging at multiple verbosity levels
 * - Metrics collection (counters, histograms, gauges)
 * - Real-time log streaming and post-execution export
 * - Agent state snapshots for debugging
 *
 * @remarks
 * The service is auto-subscribed to EventBus events and automatically tracks
 * phase timing, tool execution, and LLM requests without manual instrumentation.
 *
 * @see {@link ExporterConfig} for exporter options
 * @see {@link VerbosityLevel} for log output detail levels
 */
export class ObservabilityService extends Context.Tag("ObservabilityService")<
  ObservabilityService,
  {
    /**
     * Wrap an Effect with distributed tracing.
     *
     * Creates a new span under the current trace context, executes the effect,
     * and automatically records span completion/failure. Increments span counters.
     *
     * @param name - Span name (e.g., "guardrail-check", "llm-request")
     * @param effect - Effect to wrap with tracing
     * @param attributes - Optional span attributes for correlation and debugging
     * @returns Effect with the same success/error type, wrapped in a span
     *
     * @example
     * ```typescript
     * obs.withSpan("my-operation", Effect.promise(() => fetch(url)), {
     *   url,
     *   method: "GET",
     * })
     * ```
     */
    readonly withSpan: <A, E>(
      name: string,
      effect: Effect.Effect<A, E>,
      attributes?: Record<string, unknown>,
    ) => Effect.Effect<A, E>;

    /**
     * Get the current distributed trace context (trace ID, span ID, parent).
     *
     * @returns Object with `traceId` (string), `spanId` (string), and optional `parentSpanId`
     *
     * @example
     * ```typescript
     * const { traceId, spanId } = yield* obs.getTraceContext();
     * ```
     */
    readonly getTraceContext: () => Effect.Effect<
      { traceId: string; spanId: string; parentSpanId?: string },
      never
    >;

    /**
     * Log a message at a specific level.
     *
     * @param level - Log level: "debug" | "info" | "warn" | "error"
     * @param message - Log message text
     * @param metadata - Optional metadata object for structured logging
     *
     * @example
     * ```typescript
     * yield* obs.log("info", "Agent started", { agentId, provider: "anthropic" });
     * ```
     */
    readonly log: (
      level: LogLevel,
      message: string,
      metadata?: Record<string, unknown>,
    ) => Effect.Effect<void, never>;

    /**
     * Log a debug-level message.
     *
     * Only shown when verbosity is "debug".
     *
     * @param message - Debug message
     * @param metadata - Optional metadata
     */
    readonly debug: (
      message: string,
      metadata?: Record<string, unknown>,
    ) => Effect.Effect<void, never>;

    /**
     * Log an info-level message.
     *
     * Shown when verbosity is "normal", "verbose", or "debug".
     *
     * @param message - Info message
     * @param metadata - Optional metadata
     */
    readonly info: (
      message: string,
      metadata?: Record<string, unknown>,
    ) => Effect.Effect<void, never>;

    /**
     * Log a warning-level message.
     *
     * Shown at all verbosity levels except "minimal".
     *
     * @param message - Warning message
     * @param metadata - Optional metadata
     */
    readonly warn: (
      message: string,
      metadata?: Record<string, unknown>,
    ) => Effect.Effect<void, never>;

    /**
     * Log an error-level message.
     *
     * Shown at all verbosity levels except "minimal".
     *
     * @param message - Error message
     * @param error - Optional error object to log
     * @param metadata - Optional metadata
     *
     * @example
     * ```typescript
     * yield* obs.error("Tool execution failed", err, { toolName, args });
     * ```
     */
    readonly error: (
      message: string,
      error?: unknown,
      metadata?: Record<string, unknown>,
    ) => Effect.Effect<void, never>;

    /**
     * Increment a counter metric.
     *
     * @param name - Metric name (e.g., "tool.calls", "llm.requests")
     * @param value - Amount to increment by. Default: 1
     * @param labels - Optional dimension labels (e.g., { provider: "anthropic" })
     *
     * @example
     * ```typescript
     * yield* obs.incrementCounter("tool.calls", 1, { toolName: "web-search" });
     * ```
     */
    readonly incrementCounter: (
      name: string,
      value?: number,
      labels?: Record<string, string>,
    ) => Effect.Effect<void, never>;

    /**
     * Record a histogram value (for latency, size distributions).
     *
     * @param name - Metric name (e.g., "llm.latency.ms", "tool.execution.time")
     * @param value - Value to record
     * @param labels - Optional dimension labels
     *
     * @example
     * ```typescript
     * const latencyMs = Date.now() - startTime;
     * yield* obs.recordHistogram("llm.latency.ms", latencyMs, { model: "claude-3" });
     * ```
     */
    readonly recordHistogram: (
      name: string,
      value: number,
      labels?: Record<string, string>,
    ) => Effect.Effect<void, never>;

    /**
     * Set a gauge metric (point-in-time value).
     *
     * @param name - Metric name (e.g., "agent.tokens.used", "queue.depth")
     * @param value - Gauge value
     * @param labels - Optional dimension labels
     *
     * @example
     * ```typescript
     * yield* obs.setGauge("agent.tokens.used", totalTokens, { agentId });
     * ```
     */
    readonly setGauge: (
      name: string,
      value: number,
      labels?: Record<string, string>,
    ) => Effect.Effect<void, never>;

    /**
     * Retrieve metrics filtered by name, time range, or labels.
     *
     * @param filter - Optional filter object with `name`, `startTime`, `endTime`
     * @returns Array of Metric objects matching the filter
     *
     * @example
     * ```typescript
     * const metrics = yield* obs.getMetrics({
     *   name: "llm.latency.ms",
     *   startTime: new Date(Date.now() - 60000),
     * });
     * ```
     */
    readonly getMetrics: (filter?: {
      name?: string;
      startTime?: Date;
      endTime?: Date;
    }) => Effect.Effect<readonly Metric[], never>;

    /**
     * Retrieve logs filtered by level, agent ID, or limit.
     *
     * @param filter - Optional filter with `level`, `agentId`, `limit` (max entries)
     * @returns Array of LogEntry objects matching the filter
     *
     * @example
     * ```typescript
     * const errors = yield* obs.getLogs({
     *   level: "error",
     *   agentId: "my-agent",
     *   limit: 100,
     * });
     * ```
     */
    readonly getLogs: (filter?: {
      level?: LogLevel;
      agentId?: string;
      limit?: number;
    }) => Effect.Effect<readonly LogEntry[], never>;

    /**
     * Retrieve spans filtered by name or status.
     *
     * @param filter - Optional filter with `name` or `status` ("success" | "error" | "cancelled")
     * @returns Array of Span objects matching the filter
     *
     * @example
     * ```typescript
     * const errorSpans = yield* obs.getSpans({ status: "error" });
     * ```
     */
    readonly getSpans: (filter?: {
      name?: string;
      status?: SpanStatus;
    }) => Effect.Effect<readonly Span[], never>;

    /**
     * Capture a snapshot of agent state for debugging.
     *
     * Records the provided state along with timestamp and trace context.
     * Can be used to capture decision points, context windows, or intermediate results.
     *
     * @param agentId - ID of the agent
     * @param state - Partial agent state to capture (merged with defaults)
     * @returns Complete AgentStateSnapshot with metadata
     *
     * @example
     * ```typescript
     * const snapshot = yield* obs.captureSnapshot("agent-1", {
     *   phase: "think",
     *   contextTokens: 2048,
     *   thoughtChain: ["step1", "step2"],
     * });
     * ```
     */
    readonly captureSnapshot: (
      agentId: string,
      state: Partial<AgentStateSnapshot>,
    ) => Effect.Effect<AgentStateSnapshot, never>;

    /**
     * Retrieve snapshots for a specific agent.
     *
     * @param agentId - Agent ID to query
     * @param limit - Maximum number of snapshots to return. @default 100
     * @returns Array of AgentStateSnapshot objects, most recent first
     *
     * @example
     * ```typescript
     * const snapshots = yield* obs.getSnapshots("agent-1", 50);
     * ```
     */
    readonly getSnapshots: (
      agentId: string,
      limit?: number,
    ) => Effect.Effect<readonly AgentStateSnapshot[], never>;

    /**
     * Export all buffered logs, spans, and metrics to configured exporters.
     *
     * Called automatically at agent completion when exporters are enabled.
     * When `live: true` in ExporterConfig, logs stream during execution;
     * `flush()` finalizes remaining data and metrics dashboard.
     *
     * @throws {@link ExporterError} if file I/O or exporter fails
     *
     * @example
     * ```typescript
     * yield* obs.flush(); // Write all data to console and/or file
     * ```
     */
    readonly flush: () => Effect.Effect<void, ExporterError>;

    /**
     * Get the configured verbosity level.
     *
     * @returns Current verbosity level from ExporterConfig
     *
     * @example
     * ```typescript
     * const level = obs.verbosity(); // "normal"
     * if (level === "debug") { ... }
     * ```
     */
    readonly verbosity: () => VerbosityLevel;
  }
>() {}

// ─── Live Implementation ───

/**
 * Live implementation of ObservabilityService.
 *
 * Creates a fully wired observability layer with tracing, logging, metrics,
 * and exporters. Automatically subscribes to EventBus for phase timing,
 * tool execution, and LLM requests.
 *
 * @param exporterConfig - Optional configuration for console, file, verbosity, and live mode
 * @returns Effect that yields an ObservabilityService instance
 *
 * @example
 * ```typescript
 * const layer = ObservabilityServiceLive({
 *   verbosity: "verbose",
 *   live: true,
 *   console: { colorize: true },
 *   file: { filePath: "./logs/agent.jsonl" },
 * });
 * ```
 */
export const ObservabilityServiceLive = (exporterConfig: ExporterConfig = {}) =>
  Layer.effect(
    ObservabilityService,
    Effect.gen(function* () {
      const verbosityLevel: VerbosityLevel = exporterConfig.verbosity ?? "normal";

      // Setup OTLP exporter before tracer so global OTel provider is registered
      const otlpShutdown = exporterConfig.otlp
        ? setupOTLPExporter(exporterConfig.otlp)
        : undefined;

      // Build live writer when live mode is enabled
      const liveWriter = exporterConfig.live
        ? makeLiveLogWriter(
            typeof exporterConfig.console === "object" ? exporterConfig.console : undefined,
          )
        : undefined;

      const tracer = yield* makeTracer;
      const logger = yield* makeStructuredLogger(liveWriter ? { liveWriter } : undefined);
      // Use provided MetricsCollectorTag if available, otherwise create a new one
      // This ensures shared instance across ExecutionEngine and ObservabilityService
      const metrics = yield* Effect.serviceOption(MetricsCollectorTag).pipe(
        Effect.flatMap((opt) =>
          opt._tag === "Some"
            ? Effect.succeed(opt.value)
            : makeMetricsCollector,
        ),
      );
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
              consoleExp.exportMetrics(allMetrics, metrics);
            }
            if (fileExp) {
              yield* Effect.promise(() =>
                Promise.all([
                  fileExp.exportLogs(logs),
                  fileExp.exportSpans(spans),
                  fileExp.exportMetrics(allMetrics),
                ]),
              );
            }
            if (otlpShutdown) {
              yield* Effect.tryPromise({
                try: () => otlpShutdown(),
                catch: (err) => new ExporterError({ message: `OTLP shutdown failed: ${err}`, exporter: "otlp" }),
              });
            }
          }) as Effect.Effect<void, ExporterError>,
      };
    }),
  );

// ─── Backwards-compat default export (no exporters) ───
// Previously ObservabilityServiceLive was a Layer directly; now it's a function.
// The runtime.ts creates it via createObservabilityLayer() which stays the factory.
