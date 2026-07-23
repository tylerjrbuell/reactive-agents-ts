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
  /** Cumulative prompt tokens (optional — providers/strategies may not split). */
  inputTokens: Schema.optional(Schema.Number),
  /** Cumulative completion tokens (optional — providers/strategies may not split). */
  outputTokens: Schema.optional(Schema.Number),
  stepsCount: Schema.Number,
  confidence: Schema.Number, // 0-1
  effectiveness: Schema.optional(Schema.Number), // 0-1 (learned)
  selectedStrategy: Schema.optional(ReasoningStrategy), // for adaptive
  /**
   * Terminal judgment record (cross-cutting cascade, 2026-07-22). Computed by
   * finalizeStrategyResult on EVERY result. `enforced: false` ⇒ informational
   * (no wither configured, or judgment found nothing). Enforcement flips
   * status/output at the mint — never anywhere else.
   */
  verdict: Schema.optional(
    Schema.Struct({
      /** Did judgment alter the result (status flip / output replacement)? */
      enforced: Schema.Boolean,
      /** Grounding verdict against required tools, when requiredTools were declared. */
      groundedOnRequired: Schema.optional(Schema.Boolean),
      /** Contract requirement outcomes, when a taskContract was declared. */
      contractSatisfied: Schema.optional(Schema.Boolean),
      /**
       * Names of judgment checks that failed. Empty means clean OR
       * unjudged — the mint only pushes "grounding-on-required" when
       * `envelope.policy.fabricationGuard` is configured, so an ungrounded
       * run with no guard set also reports `failed: []`. Do not read an
       * empty array as proof the run was checked and passed.
       */
      failed: Schema.Array(Schema.String),
      /** Declared repair gaps for this strategy (e.g. "per-iteration"). */
      repairGaps: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
});
export type ReasoningMetadata = typeof ReasoningMetadataSchema.Type;

// ─── Reasoning Result ───

export const ReasoningResultSchema = Schema.Struct({
  strategy: ReasoningStrategy,
  steps: Schema.Array(ReasoningStepSchema),
  output: Schema.Unknown,
  metadata: ReasoningMetadataSchema,
  status: ReasoningStatus,
  /**
   * Failure detail carried up from the kernel's final failed state (e.g. the
   * `explainProviderError`-enriched "LLM stream failed at iteration N: <provider
   * 413/400 …>" message). Present only on failed/error results; lets the runtime
   * surface the real cause instead of a generic "Reasoning failed".
   */
  error: Schema.optional(Schema.String),
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
