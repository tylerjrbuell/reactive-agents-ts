// File: src/context/index.ts
export {
  ModelTier,
  ContextProfileSchema,
  CONTEXT_PROFILES,
  mergeProfile,
} from "./context-profile.js";
export type { ContextProfile } from "./context-profile.js";

export { resolveProfile } from "./profile-resolver.js";

export {
  ContextBudgetSchema,
  BudgetSectionSchema,
  allocateBudget,
  estimateTokens,
  wouldExceedBudget,
  trackUsage,
} from "./context-budget.js";
export type { ContextBudget, BudgetSection } from "./context-budget.js";

export {
  formatStepFull,
  formatStepSummary,
  shouldPreserve,
  clearOldToolResults,
  groupToolSequences,
  progressiveSummarize,
} from "./compaction.js";

export {
  scoreContextItem,
  allocateContextBudget,
  buildContext,
  buildStaticContext,
  buildDynamicContext,
} from "./context-engine.js";
export type {
  ContextItem,
  MemoryItem,
  ScoringContext,
  BudgetResult,
  ContextBuildInput,
  StaticContextInput,
  DynamicContextInput,
} from "./context-engine.js";
