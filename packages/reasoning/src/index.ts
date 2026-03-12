// File: src/index.ts

// ─── Types (pure type-only exports) ───
export type {
  StepMetadata,
  ReasoningStep,
} from "./types/step.js";

export type {
  ReasoningMetadata,
  ReasoningResult,
  SelectionContext,
} from "./types/reasoning.js";

export type { StrategyEffectiveness } from "./types/effectiveness.js";

export type { ObservationResult } from "./types/observation.js";

export {
  ObservationCategory,
  ResultKind,
  ObservationResultSchema,
  categorizeToolName,
  deriveResultKind,
} from "./types/observation.js";

export type {
  ReasoningConfig,
  ReactiveConfig,
  PlanExecuteConfig,
  TreeOfThoughtConfig,
  ReflexionConfig,
} from "./types/config.js";

// ─── Schemas (value exports — also export the type via verbatimModuleSyntax) ───
export {
  StepId,
  StepType,
  StepMetadataSchema,
  ReasoningStepSchema,
} from "./types/step.js";

export {
  ReasoningStrategy,
  ReasoningStatus,
  ReasoningMetadataSchema,
  ReasoningResultSchema,
  SelectionContextSchema,
} from "./types/reasoning.js";

export { StrategyEffectivenessSchema } from "./types/effectiveness.js";

export {
  ReasoningConfigSchema,
  ReactiveConfigSchema,
  PlanExecuteConfigSchema,
  TreeOfThoughtConfigSchema,
  ReflexionConfigSchema,
  defaultReasoningConfig,
} from "./types/config.js";

// ─── Errors ───
export {
  ReasoningError,
  StrategyNotFoundError,
  SelectionError,
  ExecutionError,
  IterationLimitError,
} from "./errors/errors.js";
export type { ReasoningErrors } from "./errors/errors.js";

// ─── Services ───
export {
  ReasoningService,
  ReasoningServiceLive,
} from "./services/reasoning-service.js";
export {
  StrategyRegistry,
  StrategyRegistryLive,
} from "./services/strategy-registry.js";
export type { StrategyFn } from "./services/strategy-registry.js";

// ─── Strategy Functions ───
export { executeReactive } from "./strategies/reactive.js";
export { executeReflexion } from "./strategies/reflexion.js";
export { executePlanExecute } from "./strategies/plan-execute.js";
export { executeTreeOfThought } from "./strategies/tree-of-thought.js";
export { executeAdaptive } from "./strategies/adaptive.js";
export type { StrategyOutcome } from "./strategies/adaptive.js";

// ─── Context Profiles & Budgets ───
export {
  ModelTier,
  ContextProfileSchema,
  CONTEXT_PROFILES,
  mergeProfile,
  resolveProfile,
  ContextBudgetSchema,
  BudgetSectionSchema,
  allocateBudget,
  estimateTokens,
  wouldExceedBudget,
  trackUsage,
  scoreContextItem,
  allocateContextBudget,
  buildContext,
} from "./context/index.js";
export type {
  ContextProfile,
  ContextBudget,
  BudgetSection,
  ContextItem,
  MemoryItem,
  ScoringContext,
  BudgetResult,
  ContextBuildInput,
} from "./context/index.js";

// ─── Shared Utilities ───
export { filterToolsByRelevance } from "./strategies/shared/tool-utils.js";
export type { ToolSchema, ToolParamSchema } from "./strategies/shared/tool-utils.js";

// ─── Structured Output ───
export { inferRequiredTools, classifyToolRelevance } from "./structured-output/infer-required-tools.js";
export type { ToolSummary, InferRequiredToolsConfig, ToolClassificationResult } from "./structured-output/infer-required-tools.js";

// ─── Strategy Switching ───
export type { StrategyHandoff, StrategyEvaluation } from "./strategies/shared/strategy-evaluator.js";
export { buildHandoff, evaluateStrategySwitch } from "./strategies/shared/strategy-evaluator.js";

// ─── Runtime ───
export { createReasoningLayer } from "./runtime.js";
