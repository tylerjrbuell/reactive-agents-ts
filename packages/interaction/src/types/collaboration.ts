import { Schema } from "effect";
import { SessionId } from "./mode.js";

export const CollaborationStatus = Schema.Literal("active", "paused", "ended");
export type CollaborationStatus = typeof CollaborationStatus.Type;

export const QuestionStyle = Schema.Literal("inline", "batch", "separate");
export type QuestionStyle = typeof QuestionStyle.Type;

export const CollaborationSessionSchema = Schema.Struct({
  id: SessionId,
  agentId: Schema.String,
  taskId: Schema.String,
  status: CollaborationStatus,
  thinkingVisible: Schema.Boolean,
  streamingEnabled: Schema.Boolean,
  questionStyle: QuestionStyle,
  rollbackEnabled: Schema.Boolean,
  startedAt: Schema.DateFromSelf,
  endedAt: Schema.optional(Schema.DateFromSelf),
});
export type CollaborationSession = typeof CollaborationSessionSchema.Type;

export const CollaborationMessageType = Schema.Literal(
  "thought", "question", "answer", "suggestion", "update", "action",
);
export type CollaborationMessageType = typeof CollaborationMessageType.Type;

export const CollaborationMessageSchema = Schema.Struct({
  id: Schema.String,
  sessionId: SessionId,
  type: CollaborationMessageType,
  sender: Schema.Literal("agent", "user"),
  content: Schema.String,
  timestamp: Schema.DateFromSelf,
});
export type CollaborationMessage = typeof CollaborationMessageSchema.Type;
