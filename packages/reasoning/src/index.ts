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
export { STRATEGY_CATALOG } from "./services/strategy-catalog.js";
export type { StrategyCatalogEntry } from "./services/strategy-catalog.js";

// ─── Strategy Functions ───
export { executeReactive } from "./strategies/reactive.js";
export { executeReflexion } from "./strategies/reflexion.js";
export { executePlanExecute } from "./strategies/plan-execute.js";
export { executeTreeOfThought } from "./strategies/tree-of-thought.js";
export { executeAdaptive } from "./strategies/adaptive.js";
export type { StrategyOutcome } from "./strategies/adaptive.js";
export { executeDirect } from "./strategies/direct.js";
export type { DirectInput } from "./strategies/direct.js";

// ─── Context Profiles ───
export {
  ModelTier,
  ContextProfileSchema,
  CONTEXT_PROFILES,
  mergeProfile,
  resolveProfile,
  resolveProfileWithWindow,
  buildEnvironmentContext,
  resolveEnvTimePrecision,
  buildRules,
} from "./context/index.js";
export type {
  ContextProfile,
  StaticContextInput,
  EnvTimePrecision,
} from "./context/index.js";

// Message-window compaction + APC composer DELETED (Phase 1b, 2026-07-07) —
// dead since the RA_ASSEMBLY flip; compactHistoryStage in assembly/ is the
// live history compactor.

// ContextCurator + curate() DELETED in Sprint-1 A3 (2026-06-02). Canonical
// project() from assembly/ is the sole assembler. See spec
// wiki/Architecture/Design-Specs/2026-06-02-canonical-contracts-and-invariants.md.



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
export { planNextMoveBatches } from "./kernel/capabilities/decide/tool-gating.js";
export type { ToolSchema, ToolParamSchema } from "./kernel/capabilities/attend/tool-formatting.js";
export type { KernelMessage, EntropyScoreLike, KernelState } from "./kernel/state/kernel-state.js";

// ─── Durable-execution codec (v0.12.0 track 1) ───
// Lossless KernelState ⇄ JSON-string codec. The runtime resume path (Phase C2)
// persists serialized snapshots and re-materializes them onto
// KernelInput.resumeState; re-exported here so @reactive-agents/runtime can
// deserialize without reaching into reasoning's deep paths.
export {
  serializeKernelState,
  deserializeKernelState,
  KERNEL_CODEC_VERSION,
} from "./kernel/state/kernel-codec.js";
// Canonical KernelInput assembly (FM-I #195) — strategies merge their run-wide
// cross-cutting bundle with a per-pass bundle here instead of hand-building
// literals that silently drop {harnessPipeline, budgetLimits, calibration, …}.
export { buildKernelInput } from "./kernel/state/build-kernel-input.js";
export type { CrossCuttingInput, PerPassInput } from "./kernel/state/build-kernel-input.js";
export { META_TOOLS, INTROSPECTION_META_TOOLS, HARNESS_PSEUDO_TOOLS } from "./kernel/state/kernel-constants.js";
// Termination meta-tool name (NOT in META_TOOLS) — exported so runtime receipt
// derivation (Arc 1 Task 8) can exclude it from grounding evidence without a
// hardcoded copy that could drift.
export { ABSTAIN_TOOL_NAME } from "./kernel/capabilities/act/meta-tool-handlers.js";
export { extractOutputFormat } from "./kernel/capabilities/comprehend/task-intent.js";
export { classifyTask } from "./kernel/capabilities/comprehend/task-classification.js";
export type { TaskClassification } from "./kernel/capabilities/comprehend/task-classification.js";
export { classifyTaskComplexity } from "./kernel/capabilities/comprehend/task-complexity.js";
export type { TaskComplexityClassification, PreTaskComplexity } from "./kernel/capabilities/comprehend/task-complexity.js";
export { assembleOutput, extractCodeBlocks } from "./kernel/loop/output-assembly.js";
export type { TaskIntent, OutputFormat } from "./kernel/capabilities/comprehend/task-intent.js";
export { buildOracleNudge } from "./kernel/capabilities/decide/oracle-nudge.js";
export type { OracleNudgeContext } from "./kernel/capabilities/decide/oracle-nudge.js";

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
  checkSeverity,
  resolveResultSeverity,
} from "./kernel/capabilities/verify/verifier.js";
export { noopVerifier } from "./kernel/capabilities/verify/noop-verifier.js";
export type {
  Verifier,
  VerificationContext,
  VerificationCheck,
  VerificationResult,
  VerificationSeverity,
} from "./kernel/capabilities/verify/verifier.js";

// ─── Structured Output ───
export { classifyToolRelevance } from "./structured-output/infer-required-tools.js";
export type { ToolSummary, InferRequiredToolsConfig, ToolClassificationResult } from "./structured-output/infer-required-tools.js";
export { toSchemaContract } from "./structured-output/schema-contract.js";
export type { SchemaContract, SchemaIssue, SchemaValidationResult } from "./structured-output/schema-contract.js";
export { extractStructuredOutput } from "./structured-output/pipeline.js";
export type { StructuredOutputConfig, StructuredOutputResult } from "./structured-output/pipeline.js";
export { groundedExtract } from "./structured-output/grounded/grounded-extract.js";
export type { GroundedInput, GroundedOutput } from "./structured-output/grounded/grounded-extract.js";
export { groundFields } from "./structured-output/grounded/field-provenance.js";
export type { GroundResult } from "./structured-output/grounded/field-provenance.js";
export { buildEvidenceCorpusFromSteps, detectFabricatedMeasurement, resolveFabricationGuardMode } from "./kernel/capabilities/verify/evidence-grounding.js";
export type { FabricationGuardMode } from "./kernel/capabilities/verify/evidence-grounding.js";
export { DEFAULT_STALL_POLICY } from "./kernel/state/kernel-state.js";
export type { StallPolicy } from "./kernel/state/kernel-state.js";
export { parsePartial } from "./structured-output/partial-parse.js";
export { stripThinking } from "./kernel/utils/stream-parser.js";

// ─── React Kernel (public entrypoint for callers that drive the kernel directly) ───
export { executeReActKernel, reactKernel } from "./kernel/loop/react-kernel.js";
export type { KernelInput, ReActKernelInput, ReActKernelResult } from "./kernel/state/kernel-state.js";

// ─── Runtime ───
export { createReasoningLayer } from "./runtime.js";

// ─── Observable LLM (Task 7 — direct-LLM-call observability) ───
export { makeObservableLLM } from "./kernel/observable-llm.js";

// ─── LLM Gateway (Overhaul Phase 1 — single mediated model-call path) ───
export {
  gatewayComplete,
  gatewayStream,
  resolveOutputBudget,
  type LlmCallIntent,
  type LlmPurpose,
  type BudgetClass,
  type GatewayRequest,
} from "./kernel/llm-gateway.js";
