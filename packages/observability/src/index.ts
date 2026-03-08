// ─── Types ───
export type {
  LogEntry,
  Span,
  SpanStatus,
  Metric,
  AgentStateSnapshot,
  ToolMetric,
  ToolMetricStatus,
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
} from "./types.js";

// ─── Errors ───
export { TracingError, MetricsError, ExporterError } from "./errors.js";

// ─── Tracing ───
export { makeTracer } from "./tracing/tracer.js";
export type { Tracer } from "./tracing/tracer.js";

// ─── Logging ───
export { makeStructuredLogger } from "./logging/structured-logger.js";
export type { StructuredLogger, LiveLogWriter } from "./logging/structured-logger.js";

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
