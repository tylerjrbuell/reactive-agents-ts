// ─── Types ───
export type {
  LogEntry,
  Span,
  SpanStatus,
  Metric,
  AgentStateSnapshot,
} from "./types.js";
export {
  LogLevel,
  LogEntrySchema,
  SpanStatusSchema,
  SpanSchema,
  MetricType,
  MetricSchema,
  AgentStateSnapshotSchema,
} from "./types.js";

// ─── Errors ───
export { TracingError, MetricsError, ExporterError } from "./errors.js";

// ─── Tracing ───
export { makeTracer } from "./tracing/tracer.js";
export type { Tracer } from "./tracing/tracer.js";

// ─── Logging ───
export { makeStructuredLogger } from "./logging/structured-logger.js";
export type { StructuredLogger } from "./logging/structured-logger.js";

// ─── Metrics ───
export { makeMetricsCollector } from "./metrics/metrics-collector.js";
export type { MetricsCollector } from "./metrics/metrics-collector.js";

// ─── Debugging ───
export { makeStateInspector } from "./debugging/state-inspector.js";
export type { StateInspector } from "./debugging/state-inspector.js";

// ─── Service ───
export { ObservabilityService, ObservabilityServiceLive } from "./observability-service.js";

// ─── Runtime ───
export { createObservabilityLayer } from "./runtime.js";
