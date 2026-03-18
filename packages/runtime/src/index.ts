// ─── Types ───
export type {
  LifecyclePhase,
  HookTiming,
  AgentState,
  ExecutionContext,
  ToolResult,
  LifecycleHook,
  ReactiveAgentsConfig,
  ModelParams,
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

export { ExecutionEngine, ExecutionEngineLive } from "./execution-engine.js";

// ─── Runtime ───
export { createRuntime } from "./runtime.js";
export type { RuntimeOptions, MCPServerConfig } from "./runtime.js";

// ─── Builder (Primary Public DX) ───
export {
  ReactiveAgents,
  ReactiveAgentBuilder,
  ReactiveAgent,
} from "./builder.js";
export type {
  AgentResult,
  AgentResultMetadata,
  AgentPersona,
  MemoryOptions,
  CostTrackingOptions,
  GuardrailsOptions,
  VerificationOptions,
  ProviderName,
  ReasoningOptions,
  ToolsOptions,
  PromptsOptions,
  ObservabilityOptions,
  A2AOptions,
  GatewayOptions,
  GatewaySummary,
  GatewayHandle,
  AgentToolOptions,
} from "./builder.js";

// ─── Streaming ───
export type { AgentStreamEvent, StreamDensity } from "./stream-types.js";
export { AgentStream } from "./agent-stream.js";

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
  type ChatMessage,
  type ChatReply,
  type ChatOptions,
  type SessionOptions,
} from "./chat.js";
