// ─── Types (pure type-only exports) ───
export type { Agent, AgentDefinition, Capability } from "./types/agent.js";
export type { Task, TaskConfig, TaskMetadata } from "./types/task.js";
export type { TaskResult, ResultMetadata, ReasoningStep } from "./types/result.js";
export type { Message } from "./types/message.js";
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
} from "./services/event-bus.js";
// ErrorSwallowed instrumentation (Phase 0 S0.2) — replaces silent
// `catchAll(() => Effect.void)` sites with an observable event.
export {
  emitErrorSwallowed,
  errorTag,
} from "./services/error-swallowed.js";
export type { ErrorSwallowedPayload } from "./services/error-swallowed.js";
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

// ─── Streaming ───
export { StreamingTextCallback } from "./streaming.js";

// ─── AgentMemory port (NS §3.1 — FIX-34) ───
// Narrow port the kernel resolves so it does NOT depend on
// @reactive-agents/memory at runtime. Adapter Layer lives in the memory
// package; user code is also free to ship its own AgentMemory provider.
export { AgentMemory } from "./services/agent-memory.js";
export type { AgentMemoryEntry } from "./services/agent-memory.js";

// ─── Entropy Sensor Tag (for reactive-intelligence layer) ───
export { EntropySensorService } from "./services/entropy-sensor-tag.js";
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
