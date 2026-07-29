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

// ─── RunContract — the goal compiler (meta-loop Phase 4a) ───
// The FIRST node of the meta-loop DAG: the typed, frozen answer to "what does
// DONE mean for this run", grafted onto the live PostCondition vocabulary.
// Consumed by Wave B/4b (terminal gate check 2.5, receipts, projector).
export {
  compileRunContract,
  mergeLlmRequirements,
  withRequirements,
} from "./kernel/contract/run-contract.js";
export { computeDeliverableReport } from "./kernel/contract/deliverable-report.js";
// Canonical step factories — the runtime's inline agent loop mints the same
// action/observation ledger pairs the kernel act phase writes, so deliverable
// receipts verify on the engine path too (2026-07-11 inline-loop fix).
export { makeStep } from "./kernel/capabilities/sense/step-utils.js";
// `buildStrategyResult` is deliberately NOT re-exported here (cascade Task 5).
// It stays a module-level export of `step-utils.ts` for exactly one consumer —
// `finalize-result.ts`, which wraps it in the terminal mint. Publishing it would
// hand callers an un-judged result constructor and reopen the bypass the brand
// on `JudgedReasoningResult` exists to close.
export { finalizeStrategyResult } from "./kernel/capabilities/sense/finalize-result.js";
export type {
  JudgedReasoningResult,
  FinalizeExtras,
} from "./kernel/capabilities/sense/finalize-result.js";
export { makeObservationResult } from "./kernel/utils/observation-helpers.js";
export { getRecoveryHint } from "./kernel/capabilities/act/tool-execution.js";
export type {
  RunContract,
  TaskRequirement,
  RequirementSpec,
  RequirementKind,
  DeliverableSpec,
  Constraint,
  AcceptanceTier,
  CompileRunContractOptions,
} from "./kernel/contract/run-contract.js";
export { decomposeRequirements, shouldDecompose } from "./kernel/contract/decompose.js";
export type { DecomposeOptions } from "./kernel/contract/decompose.js";

// ─── RunLedger — the append-only event store (meta-loop Phase 4b / task C1) ───
// The SECOND node of the meta-loop DAG: the typed, append-only record of what
// HAPPENED, grown FROM steps[] via dual-emit. The substrate later waves project
// from (Assessment evidence deltas, Projector renders, Control re-entry).
// Consumed by C2 (artifact entries), C3 (evidence facets), D1 (projector),
// B2/receipt (deliverables), and Arc-1 convergence (C1b — trace/EventBus rebase).
export {
  appendEntry,
  appendEntries,
  entriesOfKind,
  nextSeq,
  ledgerSize,
} from "./kernel/ledger/run-ledger.js";
// Wave C.2 — a run outlives ONE kernel call: the engine's auxiliary passes and a
// sub-agent's whole run merge into the run-scoped ledger through these.
export { mergePassLedger, entriesOfPass } from "./kernel/ledger/run-scope.js";
export type { LedgerPass } from "./kernel/ledger/run-scope.js";
export type {
  RunLedger,
  LedgerEntry,
  LedgerEntryKind,
  LedgerEntryInput,
  ToolInvocationEntry,
  ToolResultEntry,
  ArtifactEntry,
  RequirementEntry,
  RequirementStatus,
  ClaimEntry,
  VerdictEntry,
  HarnessSignalEntry,
  HandoffEntry,
  CompactionMarkerEntry,
} from "./kernel/ledger/run-ledger.js";
export { projectStepsToLedger, stepToEntries } from "./kernel/ledger/step-projection.js";
// The ANNOUNCED ledger seam (Wave C.2 slice 3b-ii). Outside `kernel/ledger/`
// this is the only sanctioned way to grow a run ledger: growth and publication
// are one act, so a path cannot record facts the stream never sees. Enforced by
// `check-ledger-writes.sh` (which confines `projectStepsToLedger` to the home).
export { growRunLedger } from "./kernel/ledger/ledger-sink.js";
export type { LedgerSinkTarget } from "./kernel/ledger/ledger-sink.js";
export { deriveArtifactEntries, artifacts } from "./kernel/ledger/artifact-projection.js";
export {
  recordTerminalVerdict,
  recordEvidenceClaims,
  recordRequirementsDeclared,
  recordRequirementTransitions,
} from "./kernel/ledger/emit.js";

// ─── RunAssessment — the progress estimator (meta-loop Phase 5a / task E1) ───
// The THIRD node of the meta-loop DAG: the pure perception of where the run
// stands — requirements satisfied/outstanding, deliverables produced/missing,
// the one evidenceDelta progress currency, run phase, pace band, windowed health.
// Recomputed each iteration; the ONE HOME for run-progress counters (spec §2).
// Consumed by E2 (guards read these fields — the D2 kill), E3 (pace actions),
// F (control plane proposals), G (policy recompile).
export { assess, PACE_ECONOMIZE, PACE_TRIAGE, PACE_TERMINAL } from "./kernel/assessment/assess.js";
export type {
  RunAssessment,
  RequirementAssessment,
  DeliverableAssessment,
  ArtifactRef,
  PaceAssessment,
  PaceBand,
  RunHealth,
  RunPhase,
  BudgetState,
} from "./kernel/assessment/assess.js";
export type { TerminalVerdictFact } from "./kernel/ledger/emit.js";

// ─── HarnessPlan — the policy compiler (meta-loop Phase 6 / task G1) ──────────
// The adaptive crown (convergence ruling C6). Compiles the per-run harness config
// from capability + calibration + contract.horizon + task classification; withers
// become plan overrides; recompiles mid-run on RunAssessment (deepen/lean).
export {
  compileHarnessPlan,
  applyExplicitOverrides,
  recompileOnAssessment,
  MAX_SCAFFOLDING,
} from "./kernel/policy/harness-plan.js";
export type {
  HarnessPlan,
  HarnessPlanInputs,
  HarnessBudgetPlan,
  HarnessGuardPlan,
  PlanOverrides,
  PlanStrategy,
  PlanBudgetClass,
  VerifierTier,
  MemoryPosture,
  PlanSource,
  RecompileResult,
  RecompileDirection,
  RecompileOptions,
} from "./kernel/policy/harness-plan.js";
export { deriveDeliverablePaths } from "./kernel/capabilities/verify/derive-conditions.js";
export { classifyTaskHorizon, classifyHorizon } from "./kernel/capabilities/comprehend/task-horizon.js";
export type { TaskHorizon, TaskHorizonClassification } from "./kernel/capabilities/comprehend/task-horizon.js";

// ─── Shared Utilities ───
export { filterToolsByRelevance } from "./kernel/capabilities/attend/tool-formatting.js";
export { planNextMoveBatches } from "./kernel/capabilities/decide/tool-gating.js";
// Block-mode approval gate (Durable HITL, Phase D). `wrapApprovalDecider` lifts
// the runtime's `.withApprovalPolicy({ onApprove })` callback into the kernel's
// Effect-returning decider; the types are the public surface the runtime maps.
export { resolveBlockApproval, wrapApprovalDecider } from "./kernel/capabilities/act/approval-gate.js";
export type {
  ApprovalCallback,
  ApprovalDecision,
  ApprovalMode,
  BlockApprovalDecider,
  BlockApprovalOutcome,
  // The one approval-policy shape, in its three pipeline stages. The runtime
  // types its author/config surfaces from these rather than re-declaring them.
  AuthoredApprovalPolicy,
  ConfiguredApprovalPolicy,
  ResolvedApprovalPolicy,
} from "./kernel/capabilities/act/approval-gate.js";
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
// ─── RunEnvelope — the run-wide cross-cutting carrier (cascade Task 1) ───
// ONE service, two named sub-records (policy = judgment inputs, rails = repair
// inputs) so strategies stop threading HITL/fabricationGuard/grounding/
// stallPolicy by hand and can no longer silently drop them.
export {
  RunEnvelope,
  buildRunEnvelope,
  emptyRunEnvelope,
  provideTestEnvelope,
} from "./kernel/envelope/run-envelope.js";
export type {
  RunEnvelopeData,
  RunEnvelopePolicy,
  RunEnvelopeRails,
  BuildRunEnvelopeOptions,
} from "./kernel/envelope/run-envelope.js";
export { META_TOOLS, INTROSPECTION_META_TOOLS, HARNESS_PSEUDO_TOOLS } from "./kernel/state/kernel-constants.js";
// The single tool-policy gate (P0-4 / boundary B1). Exported so the ENGINE's
// inline agent loop can delegate to the same decision the kernel act path uses,
// instead of running an independent allow/deny implementation — or, as was the
// case until 2026-07-28, none at all.
export { evaluateToolPolicy, forbiddenToolsFromContract, type ToolPolicy, type ToolPolicyDecision } from "./kernel/capabilities/act/tool-observe.js";
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
// The runtime's result-boundary verification (2026-07-12) publishes the same
// VerifierVerdictEmitted event the kernel does — one trace vocabulary, so
// `rax:diagnose` sees verdicts on strategy + inline paths too.
export { emitVerifierVerdict } from "./kernel/utils/diagnostics.js";
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
  CurrentModelRouting,
  type LlmCallIntent,
  type LlmPurpose,
  type BudgetClass,
  type GatewayRequest,
} from "./kernel/llm-gateway.js";

// ─── Purpose→tier model routing (meta-loop Phase 6 / task G2) ─────────────────
export {
  mapPurposeToTier,
  resolveRoutedModel,
  type RoutingTier,
  type ModelRoutingPool,
} from "./kernel/policy/purpose-routing.js";

// Harness killswitch resolution — one place decides what each env flag means.
export {
  lazyDisclosureEnabled,
  stableToolSurfaceEnabled,
  toolDiscoveryEnabled,
  verboseRulesEnabled,
  recencyBudgetCharsOverride,
  toolResultBudgetCharsOverride,
  thoughtContinuityEnabled,
  toolObserveSymmetryEnabled,
  rationaleAuditEnabled,
  treeOfThoughtExploreBudgetMs,
  assemblyDebugEnabled,
  promptDumpPathPrefix,
  overhaulEnabled,
} from "./harness-flags.js";
