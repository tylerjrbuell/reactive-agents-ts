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
   * Kernel-set verification warning for hard failures (FM-4 part 2). The kernel's
   * verifier may reject with a specific reason (e.g., "scaffold-leak") which
   * should take precedence over the result-boundary verifier's generic checks.
   */
  verificationWarning: Schema.optional(Schema.String),
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
      /**
       * Present (and always `true`) when this pass was an AUXILIARY fragment of
       * a run — a verification retry or a post-think continuation, whose
       * grounding evidence lives in a sibling pass. Judgment is recorded but
       * never enforced on such a pass; this field is how a reader tells "clean"
       * apart from "not judged as a terminal".
       */
      auxiliaryPass: Schema.optional(Schema.Boolean),
      /** Declared repair gaps for this strategy (e.g. "per-iteration"). */
      repairGaps: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
  /**
   * Namespaced, schema-typed extension slot (cross-cutting cascade Task 9,
   * DEBT-REGISTER §3). Strategy-contributed metadata fields with no
   * dedicated top-level forward at the `ExecutionEngine` boundary ride
   * here — the engine literal forwards this ONE key verbatim into
   * `TaskResult.metadata.extensions`, so future fields arrive with no
   * engine edit. Deliberately NOT a deny-list pass-through of top-level
   * `ReasoningMetadata` keys: an unenumerated top-level key still never
   * reaches `TaskResult` (that would leak internal fields onto the public
   * API surface instead of merely losing them).
   */
  extensions: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
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
