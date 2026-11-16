// ─── Canonical Contracts (Sprint-1 typed-contract foundation) ───
// See wiki/Architecture/Design-Specs/2026-06-02-canonical-contracts-and-invariants.md
export type {
  TaskContract,
  ToolRequirement,
  FixtureContract,
  ModelFloor,
  SuccessCriterion,
  OutputContract,
} from "./contracts/task-contract.js";
export { toolsToExpose } from "./contracts/task-contract.js";

export type {
  Deliverable,
  ValidatedObservation,
  ThoughtStepRef,
  LLMRoundTripRef,
} from "./contracts/deliverable.js";
export {
  deliverableToContent,
  modelSynthesisDeliverable,
  toolArtifactDeliverable,
  harnessSynthesisDeliverable,
  sentinelDeliverable,
} from "./contracts/deliverable.js";

export type {
  Capability as ContractCapability,
  CapabilitySource,
  CapabilitySupports,
  CapabilityCache,
  CapabilityProbe,
  CapabilityResolveOptions,
  CapabilityResolver,
  Tier as CapabilityTier,
} from "./contracts/capability.js";
export {
  TIER_TOOL_RESULT_PRESERVE,
  fallbackCapability,
  effectiveWindowFromClaimedTokens,
} from "./contracts/capability.js";

export type {
  PreFlightViolation,
  PreFlightWarning,
  PreFlightReport,
  CapabilityFactsForPreflight,
} from "./contracts/preflight.js";
export {
  emptyPreFlightReport,
  capabilitySourcePreflight,
  formatViolations,
} from "./contracts/preflight.js";

export type { QualityDimension, DimensionScore } from "./contracts/score-contract.js";
export { CANONICAL_QUALITY_DIMENSIONS } from "./contracts/score-contract.js";

// ─── Types (pure type-only exports) ───
export type { Agent, AgentDefinition, Capability } from "./types/agent.js";
export type { Task, TaskConfig, TaskMetadata, TaskCurrentTurn } from "./types/task.js";
export type { TaskResult, ResultMetadata, ReasoningStep } from "./types/result.js";
export { makeRunTree } from "./run-tree.js";
export type { RunNode, RunScope, RunTree } from "./run-tree.js";
export {
  checklistChanged,
  foldAdvisory,
  planStepToolHint,
  planStepToolHints,
  inferChecklistProgress,
  isChecklistEvidenceFact,
  isChecklistFact,
  makeChecklistTracker,
  nextAdvisoryIds,
  projectChecklist,
} from "./types/checklist.js";
export type {
  AdvisoryItem,
  ArtifactFact,
  ChecklistEvidenceFact,
  ChecklistEvidenceRef,
  ChecklistFact,
  ChecklistInputFact,
  ChecklistItemSource,
  ChecklistItemOrigin,
  ToolInvocationFact,
  ToolResultFact,
  ChecklistGroup,
  ChecklistItemFact,
  ChecklistItemOp,
  ChecklistItemStatus,
  ChecklistRow,
  ChecklistSnapshot,
  ChecklistTracker,
  RequirementFact,
} from "./types/checklist.js";
export type { LlmCallPurpose } from "./types/llm-purpose.js";
export type { StructuredAttemptReport } from "./types/structured-attempt.js";
export type {
  StructuredOutputReport,
  StructuredOutputLayer,
  StructuredOutputFailureKind,
  StructuredFieldError,
  JsonRepairStep,
  NativeOutcome,
} from "./types/structured-output-report.js";
export type { Message } from "./types/message.js";
export {
  MediaSourceSchema,
  ArtifactRefSchema,
  TextPartSchema,
  ImagePartSchema,
  AudioPartSchema,
  FilePartSchema,
  ContentPartSchema,
  MessageContentSchema,
  ContentPartSummarySchema,
  contentText,
  contentParts,
  normalizeContent,
} from "./types/content.js";
export type {
  MediaSource,
  ArtifactRef,
  TextPart,
  ImagePart,
  AudioPart,
  FilePart,
  ContentPart,
  MessageContent,
  ContentPartSummary,
} from "./types/content.js";
export {
  base64DecodedBytes,
  summarizeMediaSource,
  summarizePart,
  summarizeParts,
  summarizeWireContent,
  isInlineMediaPart,
  inlineMediaStub,
  redactInlineMedia,
  mediaLabel,
  mediaPartLabel,
} from "./types/content-summary.js";
export type { MediaPart, MediaLabelFacts } from "./types/content-summary.js";
export { sha256Hex } from "./utils/sha256.js";
export type { RunPosture } from "./types/posture.js";
export { RUN_ORIGINS, isRunOrigin } from "./types/origin.js";
export type { RunOrigin, RunAbortCause, RunAbortReason } from "./types/origin.js";
export type { Rationale } from "./types/rationale.js";
export type {
  TrustReceipt,
  DeliverableReceipt,
  EffectReceiptRecord,
  InterventionReceipt,
  InterventionStepLike,
} from "./types/receipt.js";
export {
  computeTrustReceipt,
  deriveInterventionsFromSteps,
  formatInterventions,
} from "./types/receipt.js";
export type {
  RuntimeConfig,
  TelemetryConfig,
  ContextController,
  CircuitBreakerConfig,
  TokenBudgetConfig,
  UncertaintySignal,
  AgentDecision,
} from "./types/config.js";

// ─── Schemas & Branded Types (value+type via typeof) ───
export {
  AgentId,
  AgentSchema,
  AgentDefinitionSchema,
  CapabilitySchema,
  CapabilityType,
  ReasoningStrategy,
  MemoryType,
} from "./types/agent.js";

export {
  TaskId,
  TaskSchema,
  TaskConfigSchema,
  TaskMetadataSchema,
  TaskCurrentTurnSchema,
  TaskType,
  Priority,
  TaskStatus,
} from "./types/task.js";

export {
  TaskResultSchema,
  ResultMetadataSchema,
  ReasoningStepSchema,
  StepType,
  OutputFormat,
  TerminatedBy,
} from "./types/result.js";

export { MessageId, MessageSchema, MessageType } from "./types/message.js";

export {
  RuntimeConfigSchema,
  defaultRuntimeConfig,
  LogLevel,
  TelemetryConfigSchema,
  ContextControllerSchema,
  CircuitBreakerConfigSchema,
  TokenBudgetConfigSchema,
  UncertaintySignalSchema,
  AgentDecisionSchema,
} from "./types/config.js";

// ─── Services ───
export { AgentService, AgentServiceLive } from "./services/agent-service.js";
export { TaskService, TaskServiceLive } from "./services/task-service.js";
export { EventBus, EventBusLive } from "./services/event-bus.js";
export type {
  AgentEvent,
  AgentEventTag,
  EventHandler,
  TypedEventHandler,
  LedgerEntryAppendedEvent,
  ChecklistInferredEvent,
  EnvironmentChangedEvent,
  ChatModeChangedEvent,
  PlanRecordedEvent,
  PlanStepStatusChangedEvent,
  EnvironmentChangeKind,
  PromptAssembledEvent,
  PromptAssembledFragment,
  PromptAssembledToolDescription,
  StructuredOutputReportedEvent,
} from "./services/event-bus.js";
// Plan primitive: plan IS the advisory checklist (plan/execute posture).
export {
  PlanSchema,
  PlanStepSchema,
  PlanSourceSchema,
  PlanStepStatusSchema,
  isPlanEmpty,
  planFromChecklist,
  planToChecklistSeed,
} from "./types/plan.js";
export type {
  Plan,
  PlanStep,
  PlanSource,
  PlanStepStatus,
  PlanChecklistSeedItem,
  PlanFromChecklistMeta,
} from "./types/plan.js";
// Portable plan formats (Markdown / JSON / HTML).
export {
  PLAN_FORMAT_VERSION,
  planToMarkdown,
  planFromMarkdown,
  planToJSON,
  planFromJSON,
  planToHtml,
} from "./types/plan-portable.js";
export type { PlanParseError, PlanParseReason, PlanFromMarkdownDefaults } from "./types/plan-portable.js";
// LLM throughput: output tokens/sec from LLMRequestCompleted (firstTokenMs-aware).
export { outputTokensPerSecond } from "./utils/llm-throughput.js";
export type { LLMThroughputFields } from "./utils/llm-throughput.js";
// Prompt-fragment contract (2026-11-10 prompt audit §7): ids, overrides, resolution.
export {
  resolvePromptFragment,
  promptFragmentText,
  promptFragmentHash,
} from "./types/prompt-fragment.js";
export type {
  PromptFragmentId,
  ToolDescriptionFragmentId,
  PromptFragmentSlot,
  PromptFragmentVar,
  PromptFragmentVars,
  PromptFragmentDefinition,
  PromptFragmentCtx,
  PromptFragmentTransform,
  PromptFragmentOverrideValue,
  PromptFragmentOverride,
  PromptOverrides,
  SerializablePromptOverrides,
  PromptFragmentStatus,
  ResolvedPromptFragment,
} from "./types/prompt-fragment.js";
// ErrorSwallowed instrumentation (Phase 0 S0.2) — replaces silent
// `catchAll(() => Effect.void)` sites with an observable event.
export {
  emitErrorSwallowed,
  emitLoadBearingFailure,
  errorTag,
  errorMessage,
} from "./services/error-swallowed.js";
export type { ErrorSwallowedPayload, LoadBearingFailurePayload } from "./services/error-swallowed.js";
export {
  ContextWindowManager,
  ContextWindowManagerLive,
  ContextError,
} from "./services/context-window-manager.js";
export type { TruncationStrategy } from "./services/context-window-manager.js";

// ─── Errors ───
// Pre-existing (backward compatible)
export {
  AgentError,
  AgentNotFoundError,
  TaskError,
  ValidationError,
  RuntimeError,
} from "./errors/errors.js";

// Framework error taxonomy (Phase 0 S0.1) — retry rules pattern-match on _tag.
// See packages/core/src/errors/index.ts for namespace docs.
export {
  FrameworkError,
  TransientError,
  LLMTimeoutError,
  CapacityError,
  LLMRateLimitError,
  CapabilityError,
  ModelCapabilityError,
  ContractError,
  ToolIdempotencyViolation,
  SecurityError,
  ToolCapabilityViolation,
  VerificationFailed,
  isRetryable,
} from "./errors/index.js";

// ─── IDs ───
export { generateAgentId, generateTaskId, generateMessageId } from "./id.js";

// ─── Runtime ───
export { CoreServicesLive } from "./runtime.js";

// ─── Harness API (Wave A) ───
export { HarnessPipeline, RegistrationHarness, ALL_TAGS } from "./services/harness-pipeline.js";
export type { Harness } from "./services/harness-pipeline.js";
export { emitToCompose } from "./services/compose-bridge.js";
export type {
  Tag,
  TagMap,
  TagPattern,
  Phase,
  PayloadFor,
  ContextFor,
  TransformFor,
  TapFor,
  TransformFn,
  TapFn,
  PhaseHookFn,
  ErrorHookFn,
  Registration,
  BaseCtx,
  NudgeCtx,
  ToolResultCtx,
  KernelMessageLike,
  ObservationStepLike,
  LifecycleFailurePayload,
  ControlStrategyEvaluatedPayload,
} from "./services/harness-types.js";

// ─── Run correlation spine (RunContext — the explicit value threaded through
// Task.metadata / LLMRequest.traceContext; the active run scope carries it as
// a fallback, see `@reactive-agents/core/internal/run-scope`) ───
export {
  rootContext,
  childContext,
  contextOrFallback,
  runTaskId,
} from "./run-context.js";
export type { RunContext } from "./run-context.js";

// ─── Streaming / durable shapes (per-run values live in run slots) ───
export { toolEffectIdentityKey, canonicalToolArgsJson } from "./streaming.js";
export type { InteractionResponse, InteractionQuestion, InteractionQuestionOption, ToolEffectSpec, ToolEffectOutcome, ToolEffectRecord } from "./streaming.js";
export type { RunControllerLike, ApprovalDecision } from "./streaming.js";

// ─── AgentMemory port (NS §3.1 — FIX-34) ───
// Narrow port the kernel resolves so it does NOT depend on
// @reactive-agents/memory at runtime. Adapter Layer lives in the memory
// package; user code is also free to ship its own AgentMemory provider.
export { AgentMemory } from "./services/agent-memory.js";
export type {
  AgentMemoryEntry,
  AgentMemoryRelatedEntry,
  AgentMemorySearchResult,
  AgentMemoryLinkType,
} from "./services/agent-memory.js";

// ─── Entropy Sensor Tag (for reactive-intelligence layer) ───
export { EntropySensorService } from "./services/entropy-sensor-tag.js";
export {
  KERNEL_INLINE_ENTROPY_STRATEGIES,
  scoresEntropyInline,
} from "./services/entropy-sensor-tag.js";
export type {
  KernelStateLike,
  TokenLogprobLike,
  EntropyScoreLike,
  EntropyTrajectoryLike,
  ModelCalibrationLike,
  ContextSectionLike,
  ContextPressureLike,
} from "./services/entropy-sensor-tag.js";

// ─── Skill types ───
export type {
  SkillRecord,
  SkillVersion,
  SkillFragmentConfig,
  SkillSource,
  SkillConfidence,
  SkillEvolutionMode,
  SkillVerbosityMode,
  SkillTierBudget,
} from "./types/skill.js";

// ─── Intelligence events ───
export type {
  SkillActivated,
  SkillRefined,
  SkillRefinementSuggested,
  SkillRolledBack,
  SkillConflictDetected,
  SkillPromoted,
  SkillSkippedContextFull,
  SkillEvicted,
  TemperatureAdjusted,
  ToolInjected,
  MemoryBoostTriggered,
  AgentNeedsHuman,
  SkillEvent,
  IntelligenceControlEvent,
  IntelligenceEvent,
} from "./types/intelligence-events.js";

export type {
  MemorySnapshot,
  ContextPressure,
  ChatTurnEvent,
  AgentHealthReport,
  ProviderFallbackActivated,
  DebriefCompleted,
  AgentConnected,
  AgentDisconnected,
} from "./types/cortex-events.js";

export type { JudgmentEvaluated, JudgmentFailed, JudgmentShadow } from "./types/judgment-events.js";

export type {
  GoalCriterionCheck,
  GoalCriterion,
  GoalBudget,
  GoalVerdict,
  GoalStatus,
  GoalSpent,
  GoalState,
} from "./types/goal.js";
