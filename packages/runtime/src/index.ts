// ─── Types ───
export type {
  LifecyclePhase,
  HookTiming,
  AgentState,
  ExecutionContext,
  ToolResult,
  LifecycleHook,
  ReactiveAgentsConfig,
} from "./types.js";

// ─── Schemas ───
export {
  LifecyclePhase as LifecyclePhaseSchema,
  HookTiming as HookTimingSchema,
  AgentState as AgentStateSchema,
  ExecutionContextSchema,
  ToolResultSchema,
  ReactiveAgentsConfigSchema,
  defaultReactiveAgentsConfig,
} from "./types.js";

// ─── Errors ───
export {
  ExecutionError,
  HookError,
  MaxIterationsError,
  GuardrailViolationError,
  type RuntimeErrors,
} from "./errors.js";

// ─── Services ───
export { LifecycleHookRegistry, LifecycleHookRegistryLive } from "./hooks.js";

export { ExecutionEngine, ExecutionEngineLive } from "./execution-engine.js";

// ─── Runtime ───
export { createRuntime } from "./runtime.js";

// ─── Builder (Primary Public DX) ───
export {
  ReactiveAgents,
  ReactiveAgentBuilder,
  ReactiveAgent,
} from "./builder.js";
export type { AgentResult, AgentResultMetadata } from "./builder.js";
