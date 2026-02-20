import { Schema } from "effect";

// ─── Log Level (matches @reactive-agents/core) ───

export const LogLevel = Schema.Literal("debug", "info", "warn", "error");
export type LogLevel = typeof LogLevel.Type;

// ─── Structured Log Entry ───

export const LogEntrySchema = Schema.Struct({
  timestamp: Schema.DateFromSelf,
  level: LogLevel,
  message: Schema.String,
  agentId: Schema.optional(Schema.String),
  sessionId: Schema.optional(Schema.String),
  traceId: Schema.optional(Schema.String),
  spanId: Schema.optional(Schema.String),
  layer: Schema.optional(Schema.String),
  operation: Schema.optional(Schema.String),
  durationMs: Schema.optional(Schema.Number),
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});
export type LogEntry = typeof LogEntrySchema.Type;

// ─── Span ───

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
  events: Schema.Array(Schema.Struct({
    name: Schema.String,
    timestamp: Schema.DateFromSelf,
    attributes: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  })),
});
export type Span = typeof SpanSchema.Type;

// ─── Metric ───

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

// ─── Agent State Snapshot ───

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
});
export type AgentStateSnapshot = typeof AgentStateSnapshotSchema.Type;
