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
  /** Distilled key fact extracted from raw tool results — surfaced in the system prompt Prior work section */
  extractedFact: Schema.optional(Schema.String),
  /**
   * Sprint 3.2 — Verifier output for this step. Attached by act.ts after
   * every effector output via defaultVerifier.verify(). Read by Arbitrator
   * (S3.3) and Reflection (S3.4) to make decisions consistent with
   * verification verdicts. Untyped here to avoid a cyclic schema import;
   * runtime callers cast to VerificationResult from
   * @reactive-agents/reasoning.
   */
  verification: Schema.optional(Schema.Unknown),
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
