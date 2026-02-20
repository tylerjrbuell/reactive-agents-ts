// ─── Types (pure type-only exports) ───
export type { Agent, AgentConfig, Capability } from "./types/agent.js";
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
  AgentConfigSchema,
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
export type { AgentEvent, EventHandler } from "./services/event-bus.js";
export {
  ContextWindowManager,
  ContextWindowManagerLive,
  ContextError,
} from "./services/context-window-manager.js";
export type { TruncationStrategy } from "./services/context-window-manager.js";

// ─── Errors ───
export {
  AgentError,
  AgentNotFoundError,
  TaskError,
  ValidationError,
  RuntimeError,
} from "./errors/errors.js";

// ─── IDs ───
export { generateAgentId, generateTaskId, generateMessageId } from "./id.js";

// ─── Runtime ───
export { CoreServicesLive } from "./runtime.js";
