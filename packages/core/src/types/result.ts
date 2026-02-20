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
  confidence: Schema.optional(Schema.Number.pipe(Schema.between(0, 1))),
  strategyUsed: Schema.optional(Schema.String),
  stepsCount: Schema.optional(Schema.Number),
});
export type ResultMetadata = typeof ResultMetadataSchema.Type;

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
