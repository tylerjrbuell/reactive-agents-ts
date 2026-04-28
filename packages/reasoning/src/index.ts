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

/**
 * ─── Observation + TrustLevel (Sprint 3.x trust-level work) ───
 * `ObservationResult` carries categorized tool-call evidence with a `trustLevel`
 * tag (Q5 grandfather decision); `TrustLevel` schema, derivation helpers, and
 * the grandfather constants are all post-v0.9.0 surfaces.
 *
 * @unstable Sprint 3.x surface; not external-validated. May change in v0.10.x
 * without notice. See AUDIT-overhaul-2026.md §10.1 reasoning + §11 #15.
 */
export type { ObservationResult, TrustLevel } from "./types/observation.js";
export {
  ObservationCategory,
  ResultKind,
  TrustLevel as TrustLevelSchema,
  ObservationResultSchema,
  categorizeToolName,
  deriveResultKind,
  KNOWN_TRUSTED_TOOL_NAMES,
  GRANDFATHER_TRUST_JUSTIFICATION,
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

// ─── Context Profiles ───
export {
  ModelTier,
  ContextProfileSchema,
  CONTEXT_PROFILES,
  mergeProfile,
  resolveProfile,
  buildStaticContext,
  buildEnvironmentContext,
  buildRules,
} from "./context/index.js";
export type {
  ContextProfile,
  StaticContextInput,
} from "./context/index.js";

// ─── Message Window Compaction ───
export { applyMessageWindowWithCompact } from "./context/message-window.js";

// ─── ContextCurator (Phase 1 Sprint 2 S2.5) ───
export {
  defaultContextCurator,
  renderObservationForPrompt,
  buildRecentObservationsSection,
  RECENT_OBSERVATIONS_HEADER,
} from "./context/context-curator.js";
export type { Prompt, ContextCurator, CuratorOptions } from "./context/context-curator.js";

// ─── Intelligent Context Synthesis (ICS) ───
export type {
  TaskPhase,
  SynthesisInput,
  SynthesizedContext,
  SynthesisConfig,
  SynthesisStrategy,
  SynthesisSignalsSnapshot,
  SynthesisEntropySignals,
} from "./context/synthesis-types.js";
export { SynthesisConfigJsonSchema } from "./context/synthesis-schema.js";
export type { SynthesisConfigJson } from "./context/synthesis-schema.js";
export { KernelMetaToolsSchema, StaticBriefInfoSchema } from "./types/kernel-meta-tools.js";
export type { KernelMetaToolsConfig } from "./types/kernel-meta-tools.js";

// ─── Shared Utilities ───
export { filterToolsByRelevance } from "./kernel/capabilities/attend/tool-formatting.js";
export { planNextMoveBatches } from "./kernel/capabilities/act/tool-gating.js";
export type { ToolSchema, ToolParamSchema } from "./kernel/capabilities/attend/tool-formatting.js";
export type { KernelMessage } from "./kernel/state/kernel-state.js";
export { META_TOOLS, INTROSPECTION_META_TOOLS } from "./kernel/state/kernel-constants.js";

// ─── Termination Oracle (CHANGE A — Verdict-Override) ───
export {
  evaluateTermination,
  defaultEvaluators,
  controllerSignalVetoEvaluator,
} from "./kernel/capabilities/decide/arbitrator.js";
export type {
  TerminationContext,
  TerminationDecision,
  TerminationSignalEvaluator,
  SignalVerdict,
} from "./kernel/capabilities/decide/arbitrator.js";

// ─── Arbitrator — Sole Termination Authority (Sprint 3.3 — closes G-5) ───
export {
  arbitrate,
  applyTermination,
  arbitrateAndApply,
  arbitrationContextFromState,
} from "./kernel/capabilities/decide/arbitrator.js";
export type {
  TerminationIntent,
  Verdict,
  ArbitrationContext,
} from "./kernel/capabilities/decide/arbitrator.js";

// ─── Verifier (Sprint 3.2 — Verify capability promotion) ───
export {
  defaultVerifier,
  contextFromObservation,
} from "./kernel/capabilities/verify/verifier.js";
export type {
  Verifier,
  VerificationContext,
  VerificationCheck,
  VerificationResult,
} from "./kernel/capabilities/verify/verifier.js";

/**
 * ─── Verifier Retry Policy (Sprint 3.5 — developer-overridable retry) ───
 * Pure-function policy consulted on every verifier rejection — controls retry/
 * skip + custom signal text. `defaultVerifierRetryPolicy` preserves pre-3.5
 * behavior (retry while budget remains).
 *
 * @unstable Sprint 3.5 surface (commit 14135d6d); not external-validated. May
 * change in v0.10.x. See AUDIT-overhaul-2026.md §11 #15.
 */
export { defaultVerifierRetryPolicy } from "./kernel/capabilities/verify/verifier.js";
export type {
  VerifierRetryPolicy,
  VerifierRetryPolicyContext,
  VerifierRetryDecision,
} from "./kernel/capabilities/verify/verifier.js";

// ─── Structured Output ───
export { inferRequiredTools, classifyToolRelevance } from "./structured-output/infer-required-tools.js";
export type { ToolSummary, InferRequiredToolsConfig, ToolClassificationResult } from "./structured-output/infer-required-tools.js";

// ─── Runtime ───
export { createReasoningLayer } from "./runtime.js";
