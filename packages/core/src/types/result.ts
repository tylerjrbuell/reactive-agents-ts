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
  tokensUsed: Schema.Number,
  confidence: Schema.optional(Schema.Literal("high", "medium", "low")),
  strategyUsed: Schema.optional(Schema.String),
  stepsCount: Schema.optional(Schema.Number),
  iterations: Schema.optional(Schema.Number),
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
