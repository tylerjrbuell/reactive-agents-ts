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

// ─── Tool Metric ───

export const ToolMetricStatusSchema = Schema.Literal("success", "error", "partial");
export type ToolMetricStatus = typeof ToolMetricStatusSchema.Type;

export const ToolMetricSchema = Schema.Struct({
  toolName: Schema.String,
  duration: Schema.Number,
  status: ToolMetricStatusSchema,
  callCount: Schema.Number,
  timestamp: Schema.DateFromSelf,
});
export type ToolMetric = typeof ToolMetricSchema.Type;

// ─── Log Event (for ObservableLogger) ───

export const PhaseStartedSchema = Schema.Struct({
  _tag: Schema.Literal("phase_started"),
  phase: Schema.String,
  timestamp: Schema.DateFromSelf,
});
export type PhaseStarted = typeof PhaseStartedSchema.Type;

export const PhaseCompleteSchema = Schema.Struct({
  _tag: Schema.Literal("phase_complete"),
  phase: Schema.String,
  duration: Schema.Number,
  status: Schema.Literal("success", "error", "warning"),
  details: Schema.optional(Schema.String),
});
export type PhaseComplete = typeof PhaseCompleteSchema.Type;

export const ToolCallSchema = Schema.Struct({
  _tag: Schema.Literal("tool_call"),
  tool: Schema.String,
  iteration: Schema.Number,
  timestamp: Schema.DateFromSelf,
});
export type ToolCall = typeof ToolCallSchema.Type;

export const ToolResultSchema = Schema.Struct({
  _tag: Schema.Literal("tool_result"),
  tool: Schema.String,
  duration: Schema.Number,
  status: Schema.Literal("success", "error"),
  error: Schema.optional(Schema.String),
  timestamp: Schema.DateFromSelf,
});
export type ToolResult = typeof ToolResultSchema.Type;

export const MetricEventSchema = Schema.Struct({
  _tag: Schema.Literal("metric"),
  name: Schema.String,
  value: Schema.Number,
  unit: Schema.optional(Schema.String),
  timestamp: Schema.DateFromSelf,
});
export type MetricEvent = typeof MetricEventSchema.Type;

export const WarningSchema = Schema.Struct({
  _tag: Schema.Literal("warning"),
  message: Schema.String,
  context: Schema.optional(Schema.String),
  timestamp: Schema.DateFromSelf,
});
export type Warning = typeof WarningSchema.Type;

export const ErrorEventSchema = Schema.Struct({
  _tag: Schema.Literal("error"),
  message: Schema.String,
  error: Schema.optional(Schema.Struct({
    name: Schema.String,
    message: Schema.String,
    stack: Schema.optional(Schema.String),
  })),
  timestamp: Schema.DateFromSelf,
});
export type ErrorEvent = typeof ErrorEventSchema.Type;

export const IterationSchema = Schema.Struct({
  _tag: Schema.Literal("iteration"),
  iteration: Schema.Number,
  phase: Schema.Literal("thought", "action"),
  summary: Schema.optional(Schema.String),
  timestamp: Schema.DateFromSelf,
});
export type Iteration = typeof IterationSchema.Type;

export const CompletionSchema = Schema.Struct({
  _tag: Schema.Literal("completion"),
  success: Schema.Boolean,
  summary: Schema.String,
  timestamp: Schema.DateFromSelf,
});
export type Completion = typeof CompletionSchema.Type;

export const NoticeSchema = Schema.Struct({
  _tag: Schema.Literal("notice"),
  level: Schema.Literal("info", "hint"),
  title: Schema.String,
  message: Schema.String,
  docsLink: Schema.optional(Schema.String),
  dismissible: Schema.Boolean,
  timestamp: Schema.DateFromSelf,
});
export type Notice = typeof NoticeSchema.Type;

export const LogEventSchema = Schema.Union(
  PhaseStartedSchema,
  PhaseCompleteSchema,
  ToolCallSchema,
  ToolResultSchema,
  MetricEventSchema,
  WarningSchema,
  ErrorEventSchema,
  IterationSchema,
  CompletionSchema,
  NoticeSchema,
);
export type LogEvent = typeof LogEventSchema.Type;

// ─── Run Summary ───

export const RunSummarySchema = Schema.Struct({
  status: Schema.Literal("success", "error", "partial"),
  duration: Schema.Number,
  totalTokens: Schema.Number,
  phaseMetrics: Schema.Record({
    key: Schema.String,
    value: Schema.Struct({
      duration: Schema.Number,
      status: Schema.String,
    }),
  }),
  toolMetrics: Schema.Record({
    key: Schema.String,
    value: Schema.Struct({
      calls: Schema.Number,
      successes: Schema.Number,
      failures: Schema.Number,
    }),
  }),
  warnings: Schema.Array(Schema.String),
  errors: Schema.Array(Schema.String),
});
export type RunSummary = typeof RunSummarySchema.Type;
