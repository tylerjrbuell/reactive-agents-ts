// ─── Types ───
export type {
  LifecyclePhase,
  HookTiming,
  AgentState,
  ExecutionContext,
  ToolResult,
  LifecycleHook,
  ReactiveAgentsConfig,
  ReasoningOptions,
  ModelParams,
  ModelParamsInput,
  MetaToolsConfig,
  HarnessSkillConfig,
  RecallConfig,
  FindConfig,
  PulseConfig,
  CalibrationMode,
} from "./types.js";

export type { JudgeInput } from "./reactive-agent.js";
export type { JudgmentModel } from "@reactive-agents/judgment";
export type {
  JudgeRankCandidate,
  JudgeRankOptions,
  JudgeRankQuestion,
  JudgeRankResult,
} from "./judgment-rank.js";
export { DEFAULT_JUDGE_RANK_CHUNK_CAP } from "./judgment-rank.js";

// ─── Schemas ───
export {
  LifecyclePhase as LifecyclePhaseSchema,
  HookTiming as HookTimingSchema,
  AgentState as AgentStateSchema,
  ExecutionContextSchema,
  ToolResultSchema,
  ReactiveAgentsConfigSchema,
  ModelParamsSchema,
  defaultReactiveAgentsConfig,
} from "./types.js";

// ─── Errors ───
export {
  ExecutionError,
  HookError,
  MaxIterationsError,
  GuardrailViolationError,
  BudgetExceededError,
  KillSwitchTriggeredError,
  BehavioralContractViolationError,
  DurableRunNotFoundError,
  DurableConfigMismatchError,
  RunNotResumableError,
  ToolsOptionError,
  UnsupportedModalityError,
  unwrapError,
  unwrapErrorWithSuggestion,
  errorContext,
  type RuntimeErrors,
  type ErrorContext,
} from "./errors.js";
export { StructuredOutputError, OutputSchemaError } from "./errors/structured-output-error.js";
export { PlanNoStepsError } from "./errors/plan-no-steps-error.js";
export type { PlanRunOptions, PlanRunOption, PlanStepInput } from "./agent/plan-facade.js";
export { SubAgentInputError, SubAgentParametersError } from "./errors/sub-agent-parameters-error.js";
export { isJsonSchemaObject, type JsonSchemaObject, type OutputSchemaInput, type AnyOutputSchema } from "./engine/finalize/json-schema-contract.js";
export type { DeepPartial, OutputSchemaOptions } from "./builder/types.js";
export type { UserInteractionOptions } from "./builder/withers/horizon-contract.js";

// ─── Services ───
export { LifecycleHookRegistry, LifecycleHookRegistryLive } from "./hooks.js";

export { ExecutionEngine, ExecutionEngineLive, checkAllowedToolsMismatch } from "./execution-engine.js";

// ─── Runtime ───
export { createRuntime, createLightRuntime } from "./runtime.js";
export type { RuntimeOptions, MCPServerConfig, LightRuntimeOptions } from "./runtime.js";

export { resolveSynthesisConfigForStrategy, withoutStrategyIcsOverrides } from "./synthesis-resolve.js";
export type { ReasoningSynthesisResolutionInput } from "./reasoning-synthesis-fields.js";
export { ReasoningOptionsJsonSchema } from "./reasoning-options-schema.js";
export type { ReasoningOptionsEncoded } from "./reasoning-options-schema.js";

// ─── Capability Manifest (dynamic surface for Cortex / any UI) ───
export { getCapabilityManifest } from "./capability/manifest.js";
export type {
  CapabilityManifest,
  StrategyDescriptor,
  BuilderMethodDescriptor,
  ConfigFieldDescriptor,
} from "./capability/manifest.js";

// ─── Builder (Primary Public DX) ───
export {
  ReactiveAgents,
  ReactiveAgentBuilder,
  deriveGoalAchieved,
} from "./builder.js";
export { ReactiveAgent } from "./reactive-agent.js";
// Multimodal task input: `agent.run([{ type: "text", ... }, { type: "image", ... }])`.
export { modelInputCapabilities, taskInputText, taskInputParts } from "./agent/task-input.js";
export type { TaskInput, ModelInputCapabilities } from "./agent/task-input.js";

// ─── Declarative front door (dual API — spec 2026-07-11) ───
export { createAgent } from "./create-agent.js";

// ─── Loop-stopped runs: summary on results/run rows + resume options ───
export type { LoopStopSummary } from "./loop-stop-summary.js";
export type { ResumeRunOptions } from "./engine/loop-stop-resume.js";

// ─── Build validation (fail-fast config errors) ───
export {
  BuildValidationError,
  readProviderApiKey,
  providerApiKeyName,
  providerRequiresApiKey,
} from "./build-validation.js";
export type {
  AgentResult,
  AgentResultMetadata,
  AgentPersona,
  MemoryOptions,
  CostTrackingOptions,
  GuardrailsOptions,
  VerificationOptions,
  JudgmentBuilderOptions,
  JudgmentSites,
  ProviderName,
  StrategySynthesisFields,
  ToolsOptions,
  PromptsOptions,
  ObservabilityOptions,
  A2AOptions,
  GatewayOptions,
  GatewaySummary,
  GatewayHandle,
  AgentToolOptions,
} from "./builder.js";

export type { SchedulesApi, ScheduleRunRequest } from "./agent/schedules-facade.js";
export { toolBuilderToEntry } from "./builder/withers/tools.js";
export type { AgentOutcome, StrategySwitchRecord } from "./builder/agent-result.js";
export type { SkillsOptions, SkillsRunOption } from "./runtime-skills-layer.js";
export type { SkillRefinementResult } from "./agent/skill-refine.js";
export type { SkillRollbackResult, SkillControlError } from "./agent/skills-facade.js";
export type { LoadSkillOptions } from "./agent/skill-install.js";
export { MemoryNotEnabledError } from "./agent/memory-facade.js";
export type {
  AgentMemoryHandle,
  SemanticMemoryItem,
  ProceduralMemoryItem,
  EpisodicMemoryItem,
  SemanticMemoryPatch,
  ProceduralMemoryPatch,
  MemorySearchOptions,
  MemoryListOptions,
  MemoryProvenanceListOptions,
  EpisodicListOptions,
  MemoryFacadeError,
} from "./agent/memory-facade.js";
export type { ToolDisclosure, ResolvedDisclosure, DisclosureSource } from "./engine/tool-disclosure.js";

export type { ChannelsConfig } from "./channels-config.js";
export type { ChannelAgentFactory, ChannelAgentHandle } from "./agent/channel-router-resolver.js";
export { toChannelHandle, makeAcknowledge, drainWithNarration } from "./agent/channel-ack-ports.js";
export type { StreamedTurn } from "./agent/channel-ack-ports.js";

// ─── Streaming ───
export type { AgentStreamEvent, StreamDensity } from "./stream-types.js";
export { AgentStream, AgentStreamCollectError } from "./agent-stream.js";
export { RunController } from "./run-controller.js";
export type { RunHandle, RunStatus, RunControllerLike } from "./run-controller.js";

// ─── Conversation to-do list (persist between chat turns) ───
export { snapshotToTodoSeed } from "./chat/todo-seed.js";
export type { TodoSeedItem, TodoSeedOption } from "./chat/todo-seed.js";

// ─── Deployment ───
export { createSigtermHandler, registerShutdownHandlers } from "./sigterm.js";

// ─── Trust receipt signing (Arc 1 Task 9, opt-in) ───
export { generateReceiptKeyPair, signReceipt, verifyReceipt } from "./receipt-signing.js";

// ─── Agentic-UI kit: server endpoint helpers (Task 13) ───
export {
  createAgentEndpoint,
  createRunAttachEndpoint,
  createInteractionEndpoint,
  createApprovalEndpoint,
  createInboxEndpoint,
  type AgentEndpointOptions,
  type IdentityResolver,
} from "./server/endpoints.js";
export { DEFAULT_LIMITS, type EndpointLimits, type Window as LimitWindow } from "./server/guards.js";

// ─── Debrief ───
export {
  synthesizeDebrief,
  formatDebriefMarkdown,
  type AgentDebrief,
  type DebriefInput,
  type ToolCallStat,
} from "./debrief.js";

// ─── Context Ingestion ───
export { ingestDocuments } from "./context-ingestion.js";
export type { DocumentSpec } from "./context-ingestion.js";
export type { WithDocumentsOptions } from "./builder/withers/tools.js";
/** Fresh document store; pass one to several `.withDocuments(docs, { store })` calls to share documents. */
export { createDocumentStore } from "@reactive-agents/tools";
export { fetchDocument, isHttpUrl } from "./document-fetch.js";
export type { FetchedDocument, FetchFailure } from "./document-fetch.js";

// ─── Agent Config ───
export {
  AgentConfigSchema,
  ProviderNameSchema,
  agentConfigToJSON,
  agentConfigFromJSON,
  agentConfigToBuilder,
  type AgentConfig,
  type PersonaConfig,
} from "./agent-config.js";
export {
  agentConfigToBuilderCalls,
  type BuilderCall,
  type BuilderMethod,
} from "./builder/config-calls.js";
export { agentConfigToSource, type AgentConfigSourceOptions } from "./builder/config-source.js";

// ─── Composition API ───
export { agentFn, pipe, parallel, race } from "./compose.js";
export type { AgentFn } from "./compose.js";

// ─── Chat / Session ───
export {
  AgentSession,
  ChatEngine,
  requiresTools,
  buildContextSummary,
  formatTaskContextForChat,
  buildChatSystemContext,
  type ChatMessage,
  type ChatReply,
  type ChatOptions,
  type SessionOptions,
  type ChatMode,
} from "./chat.js";
export type { ToolIntent } from "./builder/withers/capability-progress.js";

// ─── Calibration Resolver ───
export {
  resolveModelCalibration,
  resolveModelCalibrationAsync,
  resolveModelCalibrationWithProvenance,
  type CalibrationSource,
  type CalibrationProvenance,
  type ResolvedModelCalibration,
  type ResolveModelCalibrationOptions,
  type ResolveModelCalibrationAsyncOptions,
} from "./calibration-resolver.js";

// ─── Capability Cost Registry (MOVE-2) ───
export {
  CapabilityRegistry,
  CapabilityRegistryLive,
  CapabilityNotFoundError,
  bootstrapEntries,
  type CapabilityEntry,
  type CapabilityAuditReport,
  type CostSignature,
  type LiftEvidence,
  type WardenOwner,
  type TierId,
} from "./capabilities/registry.js";

// ─── Harness Profile presets (MOVE-6) ───
export {
  HarnessProfile,
  type HarnessProfilePatch,
  type HarnessProfileName,
} from "./capabilities/profile.js";

// ─── Durable RunStore substrate (Arc 1 Task 7: `rax ps` / `rax attach`) ───
// `RunStatus` is already exported above (run-controller's own in-memory
// running/paused/stopped/terminated/completed status) — alias the store's
// persisted lifecycle status as `RunStoreStatus` to avoid a name collision,
// mirroring the internal alias `run-controller.ts` already uses.
export {
  RunStoreLive,
  RunStoreService,
  defaultDurableRunsDir,
  type RunRecord,
  type RunStatus as RunStoreStatus,
} from "./services/run-store.js";
export { listDurableRuns } from "./engine/durable-resume.js";

// ─── Goal supervisor (plan 2026-10-29 A1): consumed by Cortex's chat goals ───
export {
  evaluateGoal,
  pursueGoal,
  goalRunOf,
  type GoalRunOutcome,
  type GoalRunResultSlice,
  type GoalRunEventSlice,
  type PursueGoalOptions,
  type PursueGoalResult,
  type GoalSegmentResult,
  type GoalEvaluation,
  type GoalCheckOutcome,
  type EvaluateGoalOptions,
} from "./goal/index.js";
