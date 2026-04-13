// File: src/types/step.ts
import { Schema } from "effect";
import { ObservationResultSchema } from "./observation.js";

// ─── Step ID (branded string) ───

export const StepId = Schema.String.pipe(Schema.brand("StepId"));
export type StepId = typeof StepId.Type;

// ─── Step Type ───

export const StepType = Schema.Literal(
  "thought", // Thinking/reasoning
  "action", // Tool call
  "observation", // Tool result
  "plan", // Planning step
  "reflection", // Self-reflection
  "critique", // Self-critique
);
export type StepType = typeof StepType.Type;

// ─── Step Metadata ───

export const StepMetadataSchema = Schema.Struct({
  confidence: Schema.optional(Schema.Number),
  toolUsed: Schema.optional(Schema.String),
  cost: Schema.optional(Schema.Number),
  duration: Schema.optional(Schema.Number),
  observationResult: Schema.optional(ObservationResultSchema),
  /** Internal reasoning from thinking models (e.g. <think> blocks) */
  thinking: Schema.optional(Schema.String),
  /** Structured tool call data from native function calling */
  toolCall: Schema.optional(Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    arguments: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  })),
  /** Scratchpad key for auto-stored compressed tool results */
  storedKey: Schema.optional(Schema.String),
  /** Links an observation step back to its originating tool call for parallel batch matching */
  toolCallId: Schema.optional(Schema.String),
});
export type StepMetadata = typeof StepMetadataSchema.Type;

// ─── Reasoning Step ───

export const ReasoningStepSchema = Schema.Struct({
  id: StepId,
  type: StepType,
  content: Schema.String,
  timestamp: Schema.DateFromSelf,
  metadata: Schema.optional(StepMetadataSchema),
});
export type ReasoningStep = typeof ReasoningStepSchema.Type;
