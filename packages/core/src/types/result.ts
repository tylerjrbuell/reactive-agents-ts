import { Schema } from "effect";
import { AgentId } from "./agent.js";
import { TaskId } from "./task.js";

// ─── Reasoning Step ───

export const StepType = Schema.Literal(
  "thought",
  "action",
  "observation",
  "plan",
  "reflection",
  "critique",
);
export type StepType = typeof StepType.Type;

export const ReasoningStepSchema = Schema.Struct({
  id: Schema.String,
  type: StepType,
  content: Schema.String,
  timestamp: Schema.DateFromSelf,
  metadata: Schema.optional(
    Schema.Struct({
      confidence: Schema.optional(Schema.Number),
      toolUsed: Schema.optional(Schema.String),
      cost: Schema.optional(Schema.Number),
      duration: Schema.optional(Schema.Number),
    }),
  ),
});
export type ReasoningStep = typeof ReasoningStepSchema.Type;

// ─── Result Metadata ───

export const ResultMetadataSchema = Schema.Struct({
  duration: Schema.Number,
  cost: Schema.Number,
  /**
   * Canonical token-count field. Always populated equal to `totalTokens`.
   * See GH #126 — other framework surfaces (`AgentCompleted` event,
   * `ReasoningResult.totalTokens`, `traceStats.totalTokens`) use the
   * `totalTokens` name; consumers expecting that name read it from this
   * metadata via the optional alias below.
   */
  tokensUsed: Schema.Number,
  /**
   * Alias of `tokensUsed`. Added 2026-05-24 to close the naming
   * inconsistency tracked in GH #126 — `AgentCompleted.totalTokens` /
   * `ReasoningResult.totalTokens` / `traceStats.totalTokens` use this
   * name, only `ResultMetadata` was the outlier. Both fields are now
   * always populated to the same value; consumers may use either.
   * No deprecation — `tokensUsed` remains canonical per #104 reversal.
   */
  totalTokens: Schema.optional(Schema.Number),
  /**
   * Prompt/input tokens consumed across all LLM calls in this execution.
   * Optional — providers/strategies may not always split (e.g. test-provider,
   * sub-agent rollups). Sum should equal `tokensUsed` when both present.
   */
  inputTokens: Schema.optional(Schema.Number),
  /**
   * Completion/output tokens generated across all LLM calls in this execution.
   * Optional — see `inputTokens` for cases where this may be absent.
   */
  outputTokens: Schema.optional(Schema.Number),
  confidence: Schema.optional(Schema.Literal("high", "medium", "low")),
  strategyUsed: Schema.optional(Schema.String),
  stepsCount: Schema.optional(Schema.Number),
  iterations: Schema.optional(Schema.Number),
  /** Derived task-complexity bucket ("trivial" | "moderate" | "complex" | "expert"). */
  complexity: Schema.optional(Schema.String),
  /** Total LLM calls made across this execution. */
  llmCalls: Schema.optional(Schema.Number),
});
export type ResultMetadata = typeof ResultMetadataSchema.Type;

// ─── Output Format & Termination Reason ───

export const OutputFormat = Schema.Literal("text", "json", "markdown", "csv", "html");
export type OutputFormat = typeof OutputFormat.Type;

export const TerminatedBy = Schema.Literal(
  "final_answer_tool",
  "final_answer",
  "max_iterations",
  "end_turn",
  /** LLM request/stream failed (provider error, invalid tool schema, network, etc.) */
  "llm_error",
);
export type TerminatedBy = typeof TerminatedBy.Type;

// ─── Task Result ───

export const TaskResultSchema = Schema.Struct({
  taskId: TaskId,
  agentId: AgentId,
  output: Schema.Unknown,
  success: Schema.Boolean,
  error: Schema.optional(Schema.String),
  metadata: ResultMetadataSchema,
  completedAt: Schema.DateFromSelf,
});
export type TaskResult = typeof TaskResultSchema.Type;
