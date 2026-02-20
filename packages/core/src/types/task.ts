import { Schema } from "effect";
import { AgentId } from "./agent.js";

// ─── Task ID (branded string) ───

export const TaskId = Schema.String.pipe(Schema.brand("TaskId"));
export type TaskId = typeof TaskId.Type;

// ─── Task Type ───

export const TaskType = Schema.Literal(
  "query",
  "action",
  "workflow",
  "research",
  "delegation",
);
export type TaskType = typeof TaskType.Type;

// ─── Priority ───

export const Priority = Schema.Literal("low", "medium", "high", "critical");
export type Priority = typeof Priority.Type;

// ─── Task Status ───

export const TaskStatus = Schema.Literal(
  "pending",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
);
export type TaskStatus = typeof TaskStatus.Type;

// ─── Task Metadata ───

export const TaskMetadataSchema = Schema.Struct({
  maxDuration: Schema.optional(Schema.Number),
  maxCost: Schema.optional(Schema.Number),
  requiresApproval: Schema.optional(Schema.Boolean),
  tags: Schema.optional(Schema.Array(Schema.String)),
  context: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});
export type TaskMetadata = typeof TaskMetadataSchema.Type;

// ─── Task Schema ───

export const TaskSchema = Schema.Struct({
  id: TaskId,
  agentId: AgentId,
  type: TaskType,
  input: Schema.Unknown,
  priority: Priority,
  status: TaskStatus,
  metadata: TaskMetadataSchema,
  createdAt: Schema.DateFromSelf,
  startedAt: Schema.optional(Schema.DateFromSelf),
  completedAt: Schema.optional(Schema.DateFromSelf),
});
export type Task = typeof TaskSchema.Type;

// ─── Task Config (input for creating tasks) ───

export const TaskConfigSchema = Schema.Struct({
  agentId: AgentId,
  type: TaskType,
  input: Schema.Unknown,
  priority: Schema.optional(Priority),
  metadata: Schema.optional(TaskMetadataSchema),
});
export type TaskConfig = typeof TaskConfigSchema.Type;
