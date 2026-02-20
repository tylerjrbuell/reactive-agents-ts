// File: src/types/step.ts
import { Schema } from "effect";

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
