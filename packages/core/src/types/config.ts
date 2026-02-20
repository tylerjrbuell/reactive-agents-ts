import { Schema } from "effect";

// ─── Log Level ───

export const LogLevel = Schema.Literal("debug", "info", "warn", "error");
export type LogLevel = typeof LogLevel.Type;

// ─── Telemetry Config ───

export const TelemetryConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  endpoint: Schema.optional(Schema.String),
  serviceName: Schema.String,
  sampleRate: Schema.Number.pipe(Schema.between(0, 1)),
});
export type TelemetryConfig = typeof TelemetryConfigSchema.Type;

// ─── Runtime Config ───

export const RuntimeConfigSchema = Schema.Struct({
  maxConcurrentTasks: Schema.Number,
  taskTimeout: Schema.Number,
  maxRetries: Schema.Number,
  retryDelay: Schema.Number,
  logLevel: LogLevel,
  telemetry: TelemetryConfigSchema,
});
export type RuntimeConfig = typeof RuntimeConfigSchema.Type;

// ─── Default Config ───

export const defaultRuntimeConfig: RuntimeConfig = {
  maxConcurrentTasks: 10,
  taskTimeout: 300_000,
  maxRetries: 3,
  retryDelay: 1_000,
  logLevel: "info",
  telemetry: {
    enabled: true,
    serviceName: "reactive-agents",
    sampleRate: 1.0,
  },
};

// ─── Context Controller (Vision Pillar: Control) ───

export const ContextControllerSchema = Schema.Struct({
  prioritization: Schema.optional(
    Schema.Literal("semantic", "recency", "importance"),
  ),
  pruning: Schema.optional(
    Schema.Literal("adaptive", "sliding-window", "fifo"),
  ),
  retention: Schema.optional(Schema.Array(Schema.String)),
  compression: Schema.optional(
    Schema.Literal("none", "aggressive", "adaptive"),
  ),
});
export type ContextController = typeof ContextControllerSchema.Type;

// ─── Circuit Breaker (Vision Pillar: Reliability) ───

export const CircuitBreakerConfigSchema = Schema.Struct({
  errorThreshold: Schema.Number.pipe(Schema.between(0, 1)),
  timeout: Schema.Number, // ms: max execution time before trip
  resetTimeout: Schema.Number, // ms: time before attempting reset
});
export type CircuitBreakerConfig = typeof CircuitBreakerConfigSchema.Type;

// ─── Token Budget (Vision Pillar: Efficiency) ───

export const TokenBudgetConfigSchema = Schema.Struct({
  total: Schema.Number,
  allocation: Schema.optional(
    Schema.Struct({
      system: Schema.optional(Schema.Number),
      context: Schema.optional(Schema.Number),
      reasoning: Schema.optional(Schema.Number),
      output: Schema.optional(Schema.Number),
    }),
  ),
  enforcement: Schema.Literal("hard", "soft"),
});
export type TokenBudgetConfig = typeof TokenBudgetConfigSchema.Type;

// ─── Decision & Uncertainty Signals (Vision Pillar: Control) ───

export const UncertaintySignalSchema = Schema.Struct({
  taskId: Schema.String,
  agentId: Schema.String,
  confidence: Schema.Number,
  phase: Schema.String,
  context: Schema.String,
});
export type UncertaintySignal = typeof UncertaintySignalSchema.Type;

export const AgentDecisionSchema = Schema.Struct({
  type: Schema.Literal("tool_call", "strategy_switch", "output"),
  importance: Schema.Number,
  content: Schema.Unknown,
});
export type AgentDecision = typeof AgentDecisionSchema.Type;
