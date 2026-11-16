import { Schema } from "effect";
import { AgentId } from "./agent.js";
import { MessageContentSchema } from "./content.js";

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

// ─── Current Turn ───

/**
 * The user's current ask, carried as typed data. Chat producers fold prior
 * turns into the flattened task text (a "Conversation history" block); this
 * lets them say which part is the current turn instead of consumers parsing
 * text markers. Modality-neutral: `content` is a string or typed parts.
 */
export const TaskCurrentTurnSchema = Schema.Struct({
  /** The current turn's content, WITHOUT any inlined prior conversation. Text or typed parts (image/audio/file). */
  content: MessageContentSchema,
  /** How many prior turns were folded into the task text ahead of this turn. Absent when unknown; 0 means none. */
  priorTurnCount: Schema.optional(Schema.Number),
});
export type TaskCurrentTurn = typeof TaskCurrentTurnSchema.Type;

// ─── Task Metadata ───

export const TaskMetadataSchema = Schema.Struct({
  maxDuration: Schema.optional(Schema.Number),
  maxCost: Schema.optional(Schema.Number),
  requiresApproval: Schema.optional(Schema.Boolean),
  tags: Schema.optional(Schema.Array(Schema.String)),
  context: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
  /**
   * The current turn as typed data, set by the producer that flattened
   * history into the task text (the chat engine). Absent for non-chat runs and
   * older producers; consumers then fall back to text-marker parsing
   * (`extractCurrentTurn` in reasoning).
   */
  currentTurn: Schema.optional(TaskCurrentTurnSchema),
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
