/**
 * reactive-agents — The composable AI agent framework built on Effect-TS.
 *
 * Install:
 *   bun add reactive-agents
 *
 * Quick start:
 *   import { ReactiveAgents } from "reactive-agents";
 *
 *   const agent = await ReactiveAgents.create()
 *     .withName("my-agent")
 *     .withProvider("anthropic")
 *     .withModel("claude-sonnet-4-20250514")
 *     .withReasoning()
 *     .withGuardrails()
 *     .build();
 *
 *   const result = await agent.run("Hello!");
 *
 * For sub-package access:
 *   import { MemoryService } from "reactive-agents/memory";
 *   import { ToolService } from "reactive-agents/tools";
 */

// ─── Primary API (most users only need these) ───

export {
  // Builder (main entry point)
  ReactiveAgents,
  ReactiveAgentBuilder,
  ReactiveAgent,

  // Runtime composition
  createRuntime,

  // Execution engine
  ExecutionEngine,
  ExecutionEngineLive,

  // Lifecycle hooks
  LifecycleHookRegistry,
  LifecycleHookRegistryLive,

  // Config & types
  defaultReactiveAgentsConfig,

  // Streaming
  AgentStream,

  // Agent as Data
  AgentConfigSchema,
  agentConfigToJSON,
  agentConfigFromJSON,
  agentConfigToBuilder,

  // Composition API
  agentFn,
  pipe,
  parallel,
  race,
} from "@reactive-agents/runtime";

export type {
  AgentResult,
  AgentResultMetadata,
  AgentDebrief,
  LifecyclePhase,
  HookTiming,
  AgentState,
  ExecutionContext,
  LifecycleHook,
  ReactiveAgentsConfig,
  // Streaming types
  AgentStreamEvent,
  StreamDensity,
  // Agent as Data types
  AgentConfig as RuntimeAgentConfig,
  PersonaConfig,
  // Composition types
  AgentFn,
} from "@reactive-agents/runtime";

// ─── Core Services ───

export {
  // Services
  AgentService,
  AgentServiceLive,
  TaskService,
  TaskServiceLive,
  EventBus,
  EventBusLive,
  ContextWindowManager,
  ContextWindowManagerLive,
  CoreServicesLive,

  // ID generators
  generateAgentId,
  generateTaskId,
  generateMessageId,
} from "@reactive-agents/core";

export type {
  Agent,
  AgentId,
  AgentConfig,
  Task,
  TaskId,
  TaskResult,
  Message,
  MessageId,
} from "@reactive-agents/core";

// ─── LLM Provider ───

export {
  LLMService,
  createLLMProviderLayer,
  TestLLMServiceLayer,
} from "@reactive-agents/llm-provider";

export type {
  CompletionRequest,
  CompletionResponse,
  LLMMessage,
} from "@reactive-agents/llm-provider";

// ─── Tool Factories ───

export { defineTool, tool } from "@reactive-agents/tools";
export type { DefineToolOptions, DefinedTool } from "@reactive-agents/tools";
export type { SimpleTool } from "@reactive-agents/tools";

// ─── Context Ingestion ───

export { ingestDocuments } from "@reactive-agents/runtime";
export type { DocumentSpec } from "@reactive-agents/runtime";

// ─── Layer Factories (for advanced composition) ───

export { createMemoryLayer } from "@reactive-agents/memory";
export { createReasoningLayer } from "@reactive-agents/reasoning";
export { createToolsLayer } from "@reactive-agents/tools";
export { createGuardrailsLayer } from "@reactive-agents/guardrails";
export { createVerificationLayer } from "@reactive-agents/verification";
export { createCostLayer } from "@reactive-agents/cost";
export { createIdentityLayer } from "@reactive-agents/identity";
export { createObservabilityLayer } from "@reactive-agents/observability";
export { createInteractionLayer } from "@reactive-agents/interaction";
export { createOrchestrationLayer } from "@reactive-agents/orchestration";
export { createPromptLayer } from "@reactive-agents/prompts";
export { createEvalLayer } from "@reactive-agents/eval";
export {
  createA2AServerLayer,
  createA2AClientLayer,
} from "@reactive-agents/a2a";

// ─── Deployment ───
export { registerShutdownHandlers } from "@reactive-agents/runtime";
