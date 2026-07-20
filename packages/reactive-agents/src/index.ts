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
 *     .withModel("claude-sonnet-4-6")
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

  // Declarative front door (dual API) — createAgent(config)
  createAgent,

  // Composition API
  agentFn,
  pipe,
  parallel,
  race,

  // Capability Cost Registry (MOVE-2)
  CapabilityRegistry,
  CapabilityRegistryLive,

  // Harness Profile presets (MOVE-6)
  HarnessProfile,

  // Durable execution (track 1)
  DurableRunNotFoundError,
  DurableConfigMismatchError,

  // Structured output
  StructuredOutputError,
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
  // External channels (webhooks, bots)
  ChannelsConfig,
  // Composition types
  AgentFn,

  // Capability Cost Registry (MOVE-2)
  CapabilityEntry,
  CapabilityAuditReport,
  CostSignature,
  LiftEvidence,
  WardenOwner,
  TierId,

  // Harness Profile presets (MOVE-6)
  HarnessProfilePatch,
  HarnessProfileName,

  // Structured output
  OutputSchemaOptions,
  DeepPartial,
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
  AgentDefinition,
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
export { createPromptLayer } from "@reactive-agents/prompts";
export { createEvalLayer } from "@reactive-agents/eval";
export {
  createA2AServerLayer,
  createA2AClientLayer,
} from "@reactive-agents/a2a";

// ─── Deployment ───
export { registerShutdownHandlers } from "@reactive-agents/runtime";
