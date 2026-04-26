// File: src/context/context-profile.ts
import { Schema } from "effect";
import { ModelTierSchema, type ModelTier as CapabilityModelTier } from "@reactive-agents/llm-provider";

// ─── Model Tier ───
//
// Phase 1 Sprint 2 S2.2 — G-2 structurally closed.
// ModelTier is now re-exported from @reactive-agents/llm-provider (where
// it's defined as `Capability.tier`'s literal union). Before S2.2 this file
// declared its own `Schema.Literal(...)` with the same 4 literals — equal
// by value but a separate Schema AST node, which made it possible for the
// two definitions to drift independently. Re-exporting forces them to
// stay identical by construction.
//
// Test pin: packages/reasoning/tests/context/tier-source-of-truth.test.ts
// Gate scenario: cf-NN-tier-derived-from-capability

export const ModelTier = ModelTierSchema;
export type ModelTier = CapabilityModelTier;

// ─── Context Profile ───

export const ContextProfileSchema = Schema.Struct({
  tier: ModelTier,
  /** Maximum characters shown per tool result in compressed previews. */
  toolResultMaxChars: Schema.Number,
  /** Number of preview items (lines, array rows) shown in compressed tool results. */
  toolResultPreviewItems: Schema.Number,
  /** Tool schema verbosity in the system prompt. */
  toolSchemaDetail: Schema.Literal("names-only", "names-and-types", "full"),
  /** Maximum kernel iterations before failing. */
  maxIterations: Schema.optional(Schema.Number),
  /** LLM sampling temperature. */
  temperature: Schema.optional(Schema.Number),
  /** Maximum context window tokens for this tier. Used by pressure gates and message compaction. */
  maxTokens: Schema.optional(Schema.Number),
  /**
   * S2.5 Slice C — opt-in production wiring for the curator's trust-aware
   * "Recent tool observations:" section. When > 0, the kernel asks
   * defaultContextCurator to append the last N observation steps (untrusted
   * wrapped in <tool_output>, trusted plain) to the system prompt.
   *
   * Default 0 across all tiers — preserves byte-identical Slice A/B behavior.
   * Agents enable per-run via profileOverrides: { recentObservationsLimit: 5 }.
   * Tier defaults stay at 0 deliberately — turning this on globally would
   * change every prompt's token budget, which is a per-agent decision, not
   * a per-tier one.
   */
  recentObservationsLimit: Schema.optional(Schema.Number),
});
export type ContextProfile = typeof ContextProfileSchema.Type;

// ─── Default Profiles per Tier ───

export const CONTEXT_PROFILES: Record<ModelTier, ContextProfile> = {
  local: {
    tier: "local",
    toolResultMaxChars: 2000,
    toolResultPreviewItems: 8,
    toolSchemaDetail: "names-and-types",
    maxIterations: 8,
    temperature: 0.3,
    // Modern local models (gemma3+, llama3.x+, qwen2.5+) ship 32K-128K context
    // windows. The dynamic Ollama probe returns 32K+ for almost everything;
    // the 4096 default here forced pressure-narrowing-to-final-answer to fire
    // at ~3K tokens, panicking models on any non-trivial tool result. The
    // probe-resolved capability.recommendedNumCtx should override this when
    // wired (Sprint 1 S1.4 — see runner.ts profile resolution); 32K matches
    // the conservative probe ceiling so the pressure gate doesn't trip
    // prematurely even before that wiring lands.
    maxTokens: 32_768,
  },
  mid: {
    tier: "mid",
    toolResultMaxChars: 1200,
    toolResultPreviewItems: 5,
    toolSchemaDetail: "full",
    maxIterations: 10,
    temperature: 0.5,
    maxTokens: 32_768,
  },
  large: {
    tier: "large",
    toolResultMaxChars: 800,
    toolResultPreviewItems: 5,
    toolSchemaDetail: "full",
    maxIterations: 10,
    temperature: 0.5,
    maxTokens: 32768,
  },
  frontier: {
    tier: "frontier",
    toolResultMaxChars: 600,
    toolResultPreviewItems: 3,
    toolSchemaDetail: "full",
    maxIterations: 12,
    temperature: 0.6,
    maxTokens: 128000,
  },
};

/**
 * Merge partial overrides into a base profile.
 */
export const mergeProfile = (
  base: ContextProfile,
  overrides: Partial<ContextProfile>,
): ContextProfile => ({
  ...base,
  ...overrides,
  tier: overrides.tier ?? base.tier,
});
