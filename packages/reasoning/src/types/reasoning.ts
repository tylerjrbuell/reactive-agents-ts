// File: src/types/reasoning.ts
import { Schema } from "effect";
import { ReasoningStepSchema } from "./step.js";

// ─── Reasoning Strategy ───
// Canonical definition lives in @reactive-agents/core.
// Re-export here so downstream reasoning code can import from either package.
import { ReasoningStrategy } from "@reactive-agents/core";
export { ReasoningStrategy };

// ─── Result Status ───

export const ReasoningStatus = Schema.Literal("completed", "failed", "partial");
export type ReasoningStatus = typeof ReasoningStatus.Type;

// ─── Reasoning Metadata ───

export const ReasoningMetadataSchema = Schema.Struct({
  duration: Schema.Number, // ms
  cost: Schema.Number, // USD
  tokensUsed: Schema.Number,
  stepsCount: Schema.Number,
  confidence: Schema.Number, // 0-1
  effectiveness: Schema.optional(Schema.Number), // 0-1 (learned)
  selectedStrategy: Schema.optional(ReasoningStrategy), // for adaptive
});
export type ReasoningMetadata = typeof ReasoningMetadataSchema.Type;

// ─── Reasoning Result ───

export const ReasoningResultSchema = Schema.Struct({
  strategy: ReasoningStrategy,
  steps: Schema.Array(ReasoningStepSchema),
  output: Schema.Unknown,
  metadata: ReasoningMetadataSchema,
  status: ReasoningStatus,
});
export type ReasoningResult = typeof ReasoningResultSchema.Type;

// ─── Selection Context ───

export const SelectionContextSchema = Schema.Struct({
  taskDescription: Schema.String,
  taskType: Schema.String,
  complexity: Schema.Number, // 0-1
  urgency: Schema.Number, // 0-1
  costBudget: Schema.optional(Schema.Number),
  timeConstraint: Schema.optional(Schema.Number), // ms
  preferredStrategy: Schema.optional(ReasoningStrategy),
});
export type SelectionContext = typeof SelectionContextSchema.Type;
