// ─── Types ───
export type {
  LogEntry,
  Span,
  SpanStatus,
  Metric,
  AgentStateSnapshot,
  ToolMetric,
  ToolMetricStatus,
  LogEvent,
  RunSummary,
} from "./types.js";
export {
  LogLevel,
  LogEntrySchema,
  SpanStatusSchema,
  SpanSchema,
  MetricType,
  MetricSchema,
  AgentStateSnapshotSchema,
  ToolMetricSchema,
  ToolMetricStatusSchema,
  LogEventSchema,
  RunSummarySchema,
} from "./types.js";

// ─── Errors ───
export { TracingError, MetricsError, ExporterError } from "./errors.js";

// ─── Tracing ───
export { makeTracer } from "./tracing/tracer.js";
export type { Tracer } from "./tracing/tracer.js";

// ─── Logging ───
export { makeStructuredLogger } from "./logging/structured-logger.js";
export type { StructuredLogger, LiveLogWriter } from "./logging/structured-logger.js";
export { createProgressLogger, ProgressLogger } from "./logging/progress-logger.js";
export type { IterationProgress } from "./logging/progress-logger.js";
export { makeLoggerService } from "./logging/logger-service.js";
export type { LoggerService, LoggingConfig } from "./logging/logger-service.js";
export { makeObservableLogger, ObservableLogger } from "./logging/observable-logger.js";
export type { ObservableLogger as ObservableLoggerService } from "./logging/observable-logger.js";
export { formatEvent } from "./logging/event-formatter.js";

// ─── Metrics ───
export { makeMetricsCollector, MetricsCollectorTag, MetricsCollectorLive } from "./metrics/metrics-collector.js";
export type { MetricsCollector, ToolSummary } from "./metrics/metrics-collector.js";

// ─── Debugging ───
export { makeStateInspector } from "./debugging/state-inspector.js";
export type { StateInspector } from "./debugging/state-inspector.js";

export {
  makeThoughtTracer,
  ThoughtTracerService,
  ThoughtTracerLive,
} from "./debugging/thought-tracer.js";
export type { ThoughtTracer, ThoughtNode } from "./debugging/thought-tracer.js";

// ─── Exporters ───
export { makeConsoleExporter, makeFileExporter, formatLogEntryLive, makeLiveLogWriter, setupOTLPExporter, buildDashboardData, formatMetricsDashboard } from "./exporters/index.js";
export type {
  ConsoleExporter,
  ConsoleExporterOptions,
  DashboardData,
  DashboardPhase,
  DashboardTool,
  DashboardAlert,
  DashboardEntropyPoint,
  FileExporter,
  FileExporterOptions,
  OTLPExporterConfig,
} from "./exporters/index.js";

// ─── Service ───
export {
  ObservabilityService,
  ObservabilityServiceLive,
} from "./observability-service.js";
export type { ExporterConfig, VerbosityLevel } from "./observability-service.js";

// ─── Runtime ───
export { createObservabilityLayer } from "./runtime.js";

export {
  CortexReporter,
  CortexReporterLive,
  CortexReporterError,
} from "./cortex/cortex-reporter.js";

// ─── Renderers ───
export { renderCalibrationProvenance } from "./renderers/calibration-provenance.js";
export type { CalibrationProvenance } from "./renderers/calibration-provenance.js";

// ─── Telemetry ───
export {
  TelemetryRecordSchema,
  TelemetryAggregateSchema,
  ModelTier,
  SAFE_TOOL_NAMES,
  preservePrivacy,
  classifyModelTier,
  bucketToHour,
  sanitizeToolNames,
  TelemetryAggregatorTag,
  TelemetryAggregatorLive,
  TelemetryCollectorTag,
  TelemetryCollectorLive,
} from "./telemetry/index.js";
export type {
  TelemetryRecord,
  TelemetryAggregate,
  RawRunData,
  PrivacyConfig,
  TelemetryAggregator,
  TelemetryCollector,
  TelemetryMode,
  TelemetryConfig,
} from "./telemetry/index.js";
