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
  agentConfigToBuilderCalls,
  agentConfigToSource,

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
  RunNotResumableError,

  // Multimodal task input (`agent.run([textPart, imagePart])`)
  UnsupportedModalityError,
  modelInputCapabilities,
  taskInputText,
  taskInputParts,

  // Failed-run rejection class (supports identity checks in user code)
  AgentRunError,

  // Structured output
  StructuredOutputError,
  OutputSchemaError,
  PlanNoStepsError,
  PlanInvalidError,
  SubAgentInputError,
  SubAgentParametersError,
  isJsonSchemaObject,

  // Memory inspection (`agent.memory()`)
  MemoryNotEnabledError,
} from "@reactive-agents/runtime";

export type {
  AgentResult,
  LoopStopSummary,
  ResumeRunOptions,
  TaskInput,
  ModelInputCapabilities,
  AgentResultMetadata,
  AgentOutcome,
  StrategySwitchRecord,
  AgentDebrief,
  LifecyclePhase,
  HookTiming,
  AgentState,
  ExecutionContext,
  LifecycleHook,
  EngineLifecycleHook,
  KernelTurnLifecycleHook,
  KernelTurnErrorLifecycleHook,
  KernelTurnHookContext,
  KernelTurnErrorHookContext,
  KernelTurnPhase,
  EngineLifecyclePhase,
  ReactiveAgentsConfig,
  /** Provider names accepted by `.withProvider()`. */
  ProviderName,
  // Streaming types
  AgentStreamEvent,
  StreamDensity,
  JsonSchemaObject,
  OutputSchemaInput,
  // Agent as Data types
  AgentConfig as RuntimeAgentConfig,
  PersonaConfig,
  BuilderCall,
  BuilderMethod,
  AgentConfigSourceOptions,
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

  // Judgment (`.withJudgment()` / `agent.judge()`)
  JudgmentBuilderOptions,
  JudgmentSites,
  JudgmentShadowOptions,

  // Judgment (`agent.judge()` / `agent.judgeRank()`)
  JudgeInput,
  JudgeRankCandidate,
  JudgeRankOptions,
  JudgeRankQuestion,
  JudgeRankResult,

  // Memory inspection (`agent.memory()`)
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

  // Living skills (`agent.refineSkills()`, `rollbackSkill()`, `setSkillMode()`, `loadSkill()`)
  SkillRefinementResult,
  SkillRollbackResult,
  SkillControlError,
  LoadSkillOptions,
} from "@reactive-agents/runtime";

export { DEFAULT_JUDGE_RANK_CHUNK_CAP } from "@reactive-agents/runtime";

// ─── Approval policy: the code-action refusal rule, for pre-run warnings ───
export { codeActionApprovalConflict } from "@reactive-agents/runtime";
export type { CodeActionApprovalConflict, CodeActionApprovalConflictInput } from "@reactive-agents/runtime";

// ─── Judgment (calibrated Choice/Score/Noul typed judgments) ───

export {
  JudgmentService,
  JudgmentUnsupported,
  DEFAULT_JUDGMENT_CAPABILITIES,
  capabilitiesOf,
  makeOllamaBackend,
  makeSystemOneHttpBackend,
} from "@reactive-agents/judgment";

export type {
  ChoiceAnswer,
  ChoiceCriteria,
  ChoiceSpec,
  JudgmentAnswer,
  JudgmentAnswers,
  JudgmentBackend,
  JudgmentCapabilities,
  JudgmentEntry,
  JudgmentError,
  JudgmentModel,
  JudgmentQuestionKind,
  NoulAnswer,
  NoulSpec,
  OllamaJudgmentConfig,
  QuestionSpec,
  QuestionSpecs,
  ScoreAnswer,
  ScoreCriteria,
  ScoreSpec,
  SystemOneHttpConfig,
  SystemOneProviderDescriptor,
} from "@reactive-agents/judgment";

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
  StructuredOutputReport,
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

export { ingestDocuments, createDocumentStore } from "@reactive-agents/runtime";
export type { DocumentSpec, WithDocumentsOptions } from "@reactive-agents/runtime";

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
export { createA2AClientLayer } from "@reactive-agents/a2a";

// ─── Deployment ───
export { registerShutdownHandlers } from "@reactive-agents/runtime";
