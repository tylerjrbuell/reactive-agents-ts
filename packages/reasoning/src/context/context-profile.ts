// File: src/context/context-profile.ts
import { Schema } from "effect";

// ─── Model Tier ───

export const ModelTier = Schema.Literal("local", "mid", "large", "frontier");
export type ModelTier = typeof ModelTier.Type;

// ─── Context Profile ───

export const ContextProfileSchema = Schema.Struct({
  tier: ModelTier,
  promptVerbosity: Schema.Literal("minimal", "standard", "full"),
  rulesComplexity: Schema.Literal("simplified", "standard", "detailed"),
  fewShotExampleCount: Schema.Number,
  compactAfterSteps: Schema.Number,
  fullDetailSteps: Schema.Number,
  toolResultMaxChars: Schema.Number,
  contextBudgetPercent: Schema.Number,
  toolSchemaDetail: Schema.Literal("names-only", "names-and-types", "full"),
  maxIterations: Schema.optional(Schema.Number),
  temperature: Schema.optional(Schema.Number),
});
export type ContextProfile = typeof ContextProfileSchema.Type;

// ─── Default Profiles per Tier ───

export const CONTEXT_PROFILES: Record<ModelTier, ContextProfile> = {
  local: {
    tier: "local",
    promptVerbosity: "minimal",
    rulesComplexity: "simplified",
    fewShotExampleCount: 0,
    compactAfterSteps: 4,
    fullDetailSteps: 2,
    toolResultMaxChars: 600,
    contextBudgetPercent: 70,
    toolSchemaDetail: "names-and-types",
    maxIterations: 8,
    temperature: 0.3,
  },
  mid: {
    tier: "mid",
    promptVerbosity: "standard",
    rulesComplexity: "standard",
    fewShotExampleCount: 1,
    compactAfterSteps: 6,
    fullDetailSteps: 4,
    toolResultMaxChars: 800,
    contextBudgetPercent: 80,
    toolSchemaDetail: "full",
    maxIterations: 10,
    temperature: 0.5,
  },
  large: {
    tier: "large",
    promptVerbosity: "standard",
    rulesComplexity: "standard",
    fewShotExampleCount: 2,
    compactAfterSteps: 8,
    fullDetailSteps: 6,
    toolResultMaxChars: 1200,
    contextBudgetPercent: 85,
    toolSchemaDetail: "full",
    maxIterations: 12,
    temperature: 0.7,
  },
  frontier: {
    tier: "frontier",
    promptVerbosity: "full",
    rulesComplexity: "detailed",
    fewShotExampleCount: 3,
    compactAfterSteps: 12,
    fullDetailSteps: 8,
    toolResultMaxChars: 2000,
    contextBudgetPercent: 90,
    toolSchemaDetail: "full",
    maxIterations: 15,
    temperature: 0.7,
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
