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
  MetaToolsConfig,
  HarnessSkillConfig,
  RecallConfig,
  FindConfig,
  PulseConfig,
  CalibrationMode,
} from "./types.js";

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
  unwrapError,
  unwrapErrorWithSuggestion,
  errorContext,
  type RuntimeErrors,
  type ErrorContext,
} from "./errors.js";

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

// ─── Builder (Primary Public DX) ───
export {
  ReactiveAgents,
  ReactiveAgentBuilder,
  deriveGoalAchieved,
} from "./builder.js";
export { ReactiveAgent } from "./reactive-agent.js";
export type {
  AgentResult,
  AgentResultMetadata,
  AgentPersona,
  MemoryOptions,
  CostTrackingOptions,
  GuardrailsOptions,
  VerificationOptions,
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

export type { ChannelsConfig } from "@reactive-agents/channels";

// ─── Streaming ───
export type { AgentStreamEvent, StreamDensity } from "./stream-types.js";
export { AgentStream, AgentStreamCollectError } from "./agent-stream.js";
export { RunController } from "./run-controller.js";
export type { RunHandle, RunStatus, RunControllerLike } from "./run-controller.js";

// ─── Deployment ───
export { createSigtermHandler, registerShutdownHandlers } from "./sigterm.js";

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

// ─── Composition API ───
export { agentFn, pipe, parallel, race } from "./compose.js";
export type { AgentFn } from "./compose.js";

// ─── Chat / Session ───
export {
  AgentSession,
  directChat,
  requiresTools,
  buildContextSummary,
  formatTaskContextForChat,
  buildChatSystemContext,
  type ChatMessage,
  type ChatReply,
  type ChatOptions,
  type SessionOptions,
} from "./chat.js";

// ─── Calibration Resolver ───
export {
  resolveModelCalibration,
  resolveModelCalibrationAsync,
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
