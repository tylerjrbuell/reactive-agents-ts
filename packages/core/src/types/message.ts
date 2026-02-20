import { Schema } from "effect";
import { AgentId } from "./agent.js";

// ─── Message ID (branded string) ───

export const MessageId = Schema.String.pipe(Schema.brand("MessageId"));
export type MessageId = typeof MessageId.Type;

// ─── Message Type ───

export const MessageType = Schema.Literal(
  "request",
  "response",
  "notification",
  "delegation",
  "query",
);
export type MessageType = typeof MessageType.Type;

// ─── Message Schema ───

export const MessageSchema = Schema.Struct({
  id: MessageId,
  fromAgentId: AgentId,
  toAgentId: AgentId,
  type: MessageType,
  content: Schema.Unknown,
  timestamp: Schema.DateFromSelf,
  metadata: Schema.optional(
    Schema.Struct({
      correlationId: Schema.optional(Schema.String),
      causationId: Schema.optional(Schema.String),
      context: Schema.optional(
        Schema.Record({ key: Schema.String, value: Schema.Unknown }),
      ),
    }),
  ),
});
export type Message = typeof MessageSchema.Type;
