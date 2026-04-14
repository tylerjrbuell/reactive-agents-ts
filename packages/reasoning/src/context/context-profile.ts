// File: src/context/context-profile.ts
import { Schema } from "effect";

// ─── Model Tier ───

export const ModelTier = Schema.Literal("local", "mid", "large", "frontier");
export type ModelTier = typeof ModelTier.Type;

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
    maxTokens: 4096,
  },
  mid: {
    tier: "mid",
    toolResultMaxChars: 1200,
    toolResultPreviewItems: 5,
    toolSchemaDetail: "full",
    maxIterations: 10,
    temperature: 0.5,
    maxTokens: 8192,
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
