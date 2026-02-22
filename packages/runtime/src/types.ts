import { Schema } from "effect";

// ─── Lifecycle Phase ───

export const LifecyclePhase = Schema.Literal(
  "bootstrap",
  "guardrail",
  "cost-route",
  "strategy-select",
  "think",
  "act",
  "observe",
  "verify",
  "memory-flush",
  "cost-track",
  "audit",
  "complete",
);
export type LifecyclePhase = typeof LifecyclePhase.Type;

// ─── Hook Timing ───

export const HookTiming = Schema.Literal("before", "after", "on-error");
export type HookTiming = typeof HookTiming.Type;

// ─── Agent State Machine ───

export const AgentState = Schema.Literal(
  "idle",
  "bootstrapping",
  "running",
  "paused",
  "verifying",
  "flushing",
  "completed",
  "failed",
);
export type AgentState = typeof AgentState.Type;

// ─── Execution Context (passed between phases) ───

export const ExecutionContextSchema = Schema.Struct({
  taskId: Schema.String,
  agentId: Schema.String,
  sessionId: Schema.String,
  phase: LifecyclePhase,
  agentState: AgentState,
  iteration: Schema.Number,
  maxIterations: Schema.Number,
  messages: Schema.Array(Schema.Unknown),
  memoryContext: Schema.optional(Schema.Unknown),
  selectedStrategy: Schema.optional(Schema.String),
  selectedModel: Schema.optional(Schema.Unknown),
  toolResults: Schema.Array(Schema.Unknown),
  cost: Schema.Number,
  tokensUsed: Schema.Number,
  startedAt: Schema.DateFromSelf,
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});
export type ExecutionContext = typeof ExecutionContextSchema.Type;

// ─── Tool Result ───

export const ToolResultSchema = Schema.Struct({
  toolCallId: Schema.String,
  toolName: Schema.String,
  result: Schema.Unknown,
  error: Schema.optional(Schema.String),
  durationMs: Schema.Number,
});
export type ToolResult = typeof ToolResultSchema.Type;

// ─── Lifecycle Hook ───

export interface LifecycleHook {
  readonly phase: LifecyclePhase;
  readonly timing: HookTiming;
  readonly handler: (
    ctx: ExecutionContext,
  ) => import("effect").Effect.Effect<
    ExecutionContext,
    import("./errors.js").ExecutionError
  >;
}

// ─── Reactive Agents Config ───

export const ReactiveAgentsConfigSchema = Schema.Struct({
  maxIterations: Schema.Number,
  defaultModel: Schema.optional(Schema.Unknown),
  memoryTier: Schema.Literal("1", "2"),
  enableGuardrails: Schema.Boolean,
  enableVerification: Schema.Boolean,
  enableCostTracking: Schema.Boolean,
  enableAudit: Schema.Boolean,
  agentId: Schema.String,
});
export type ReactiveAgentsConfig = typeof ReactiveAgentsConfigSchema.Type;

export const defaultReactiveAgentsConfig = (
  agentId: string,
): ReactiveAgentsConfig => ({
  maxIterations: 10,
  memoryTier: "1",
  enableGuardrails: false,
  enableVerification: false,
  enableCostTracking: false,
  enableAudit: false,
  agentId,
});
