// File: src/context/context-budget.ts
import { Schema } from "effect";
import type { ContextProfile, ModelTier } from "./context-profile.js";

// ─── Budget Allocation ───

export const BudgetSectionSchema = Schema.Struct({
  systemPrompt: Schema.Number,
  toolSchemas: Schema.Number,
  memoryContext: Schema.Number,
  stepHistory: Schema.Number,
  rules: Schema.Number,
});
export type BudgetSection = typeof BudgetSectionSchema.Type;

export const ContextBudgetSchema = Schema.Struct({
  totalBudget: Schema.Number,
  reserveOutput: Schema.Number,
  allocated: BudgetSectionSchema,
  used: BudgetSectionSchema,
  remaining: Schema.Number,
});
export type ContextBudget = typeof ContextBudgetSchema.Type;

// ─── Default Allocation Percentages by Tier ───

const TIER_ALLOCATIONS: Record<ModelTier, { systemPrompt: number; toolSchemas: number; memoryContext: number; stepHistory: number; rules: number; reserveOutput: number }> = {
  local:    { systemPrompt: 5, toolSchemas: 5,  memoryContext: 10, stepHistory: 55, rules: 5, reserveOutput: 20 },
  mid:      { systemPrompt: 8, toolSchemas: 10, memoryContext: 15, stepHistory: 47, rules: 5, reserveOutput: 15 },
  large:    { systemPrompt: 10, toolSchemas: 12, memoryContext: 18, stepHistory: 42, rules: 3, reserveOutput: 15 },
  frontier: { systemPrompt: 10, toolSchemas: 15, memoryContext: 20, stepHistory: 40, rules: 3, reserveOutput: 12 },
};

/**
 * Rough token estimation: ~4 chars per token (conservative).
 */
export const estimateTokens = (text: string): number =>
  Math.ceil(text.length / 4);

/**
 * Allocate a context budget based on total tokens, profile tier, and iteration progress.
 * As iterations progress, stepHistory gets a larger share (adaptive allocation).
 */
export const allocateBudget = (
  totalTokens: number,
  profile: ContextProfile,
  iteration: number,
  maxIterations: number,
): ContextBudget => {
  const pct = TIER_ALLOCATIONS[profile.tier];
  const usableBudget = Math.floor(totalTokens * (profile.contextBudgetPercent / 100));
  const reserveOutput = Math.floor(usableBudget * (pct.reserveOutput / 100));
  const available = usableBudget - reserveOutput;

  // Adaptive: as iterations progress, shift budget from toolSchemas/memory to stepHistory
  const progress = maxIterations > 1 ? iteration / (maxIterations - 1) : 0;
  const historyBoost = Math.floor(progress * 5); // up to +5% for step history
  const schemaReduction = Math.floor(historyBoost / 2);
  const memoryReduction = historyBoost - schemaReduction;

  const allocate = (basePct: number) => Math.floor(available * (basePct / 100));

  return {
    totalBudget: totalTokens,
    reserveOutput,
    allocated: {
      systemPrompt: allocate(pct.systemPrompt),
      toolSchemas: allocate(Math.max(2, pct.toolSchemas - schemaReduction)),
      memoryContext: allocate(Math.max(5, pct.memoryContext - memoryReduction)),
      stepHistory: allocate(pct.stepHistory + historyBoost),
      rules: allocate(pct.rules),
    },
    used: {
      systemPrompt: 0,
      toolSchemas: 0,
      memoryContext: 0,
      stepHistory: 0,
      rules: 0,
    },
    remaining: available,
  };
};

/**
 * Check if adding `additionalTokens` to a section would exceed its budget.
 */
export const wouldExceedBudget = (
  budget: ContextBudget,
  section: keyof BudgetSection,
  additionalTokens: number,
): boolean =>
  budget.used[section] + additionalTokens > budget.allocated[section];

/**
 * Track token usage in a section. Returns a new budget with updated counters.
 */
export const trackUsage = (
  budget: ContextBudget,
  section: keyof BudgetSection,
  text: string,
): ContextBudget => {
  const tokens = estimateTokens(text);
  const newUsed = { ...budget.used, [section]: budget.used[section] + tokens };
  return {
    ...budget,
    used: newUsed,
    remaining: budget.remaining - tokens,
  };
};
