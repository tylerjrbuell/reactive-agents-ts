// File: src/types/mode.ts
import { Schema } from "effect";

// ─── Interaction Mode Type ───

export const InteractionModeType = Schema.Literal(
  "autonomous", // Fire-and-forget: agent runs independently
  "supervised", // Checkpoints: agent pauses at milestones for approval
  "collaborative", // Real-time: agent and user work together
  "consultative", // Advisory: agent observes and suggests
  "interrogative", // Drill-down: user explores agent state/reasoning
);
export type InteractionModeType = typeof InteractionModeType.Type;

// ─── Session ID ───

export const SessionId = Schema.String.pipe(Schema.brand("SessionId"));
export type SessionId = typeof SessionId.Type;

// ─── Interaction Mode ───

export const InteractionModeSchema = Schema.Struct({
  mode: InteractionModeType,
  agentId: Schema.String,
  sessionId: SessionId,
  startedAt: Schema.DateFromSelf,
  metadata: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});
export type InteractionMode = typeof InteractionModeSchema.Type;
