import { Layer } from "effect";
import { LifecycleHookRegistryLive } from "./hooks.js";
import { ExecutionEngineLive } from "./execution-engine.js";
import type { ReactiveAgentsConfig } from "./types.js";
import { defaultReactiveAgentsConfig } from "./types.js";
import { CoreServicesLive, EventBusLive } from "@reactive-agents/core";
import { createLLMProviderLayer } from "@reactive-agents/llm-provider";
import { createMemoryLayer } from "@reactive-agents/memory";

// Optional package imports
import { createGuardrailsLayer } from "@reactive-agents/guardrails";
import { createVerificationLayer } from "@reactive-agents/verification";
import { createCostLayer } from "@reactive-agents/cost";
import { createReasoningLayer, defaultReasoningConfig } from "@reactive-agents/reasoning";
import type { ReasoningConfig } from "@reactive-agents/reasoning";
import { createToolsLayer } from "@reactive-agents/tools";
import type { ReasoningOptions } from "./builder.js";
import { createIdentityLayer } from "@reactive-agents/identity";
import { createObservabilityLayer } from "@reactive-agents/observability";
import { createInteractionLayer } from "@reactive-agents/interaction";
import { createPromptLayer } from "@reactive-agents/prompts";
import { createOrchestrationLayer } from "@reactive-agents/orchestration";

// ─── Runtime Options ───

export interface MCPServerConfig {
  name: string;
  transport: "stdio" | "sse" | "websocket";
  command?: string;
  args?: string[];
  endpoint?: string;
}

export interface RuntimeOptions {
  agentId: string;
  provider?: "anthropic" | "openai" | "ollama" | "gemini" | "test";
  model?: string;
  memoryTier?: "1" | "2";
  maxIterations?: number;
  testResponses?: Record<string, string>;
  extraLayers?: Layer.Layer<any, any>;

  // Optional features
  enableGuardrails?: boolean;
  enableVerification?: boolean;
  enableCostTracking?: boolean;
  enableReasoning?: boolean;
  enableTools?: boolean;
  enableIdentity?: boolean;
  enableObservability?: boolean;
  enableInteraction?: boolean;
  enablePrompts?: boolean;
  enableOrchestration?: boolean;
  enableAudit?: boolean;

  // Custom system prompt for the agent
  systemPrompt?: string;

  // MCP servers — implicitly enables tools if set
  mcpServers?: MCPServerConfig[];

  // Reasoning configuration overrides
  reasoningOptions?: ReasoningOptions;
}

/**
 * Create the full reactive-agents runtime layer.
 *
 * Composes Core + LLM + Memory + ExecutionEngine as the base,
 * then merges optional layers based on the enabled flags.
 *
 * Usage:
 *   const Runtime = createRuntime({
 *     agentId: "my-agent",
 *     provider: "anthropic",
 *     enableReasoning: true,
 *     enableGuardrails: true,
 *   });
 */
export const createRuntime = (options: RuntimeOptions) => {
  const config: ReactiveAgentsConfig = {
    ...defaultReactiveAgentsConfig(options.agentId),
    defaultModel: options.model,
    memoryTier: options.memoryTier ?? "1",
    maxIterations: options.maxIterations ?? 10,
    enableGuardrails: options.enableGuardrails ?? false,
    enableVerification: options.enableVerification ?? false,
    enableCostTracking: options.enableCostTracking ?? false,
    enableAudit: options.enableAudit ?? false,
    systemPrompt: options.systemPrompt,
  };

  // ── Required layers ──
  // EventBusLive is exposed separately so optional layers that need it can be provided
  const eventBusLayer = EventBusLive;
  const coreLayer = CoreServicesLive;
  const llmLayer = createLLMProviderLayer(
    options.provider ?? "test",
    options.testResponses,
    options.model,
  );
  const memoryLayer = createMemoryLayer(config.memoryTier, {
    agentId: options.agentId,
  });
  const hookLayer = LifecycleHookRegistryLive;
  const engineLayer = ExecutionEngineLive(config).pipe(Layer.provide(hookLayer));

  let runtime = Layer.mergeAll(
    coreLayer,
    eventBusLayer,
    llmLayer,
    memoryLayer,
    hookLayer,
    engineLayer,
  );

  // ── Optional layers ──

  if (options.enableGuardrails) {
    runtime = Layer.merge(runtime, createGuardrailsLayer()) as any;
  }

  if (options.enableVerification) {
    runtime = Layer.merge(runtime, createVerificationLayer()) as any;
  }

  if (options.enableCostTracking) {
    runtime = Layer.merge(runtime, createCostLayer()) as any;
  }

  // Build tools layer first — reasoning may depend on it
  // MCP servers implicitly enable tools
  let toolsLayer: Layer.Layer<any, any> | null = null;
  const shouldEnableTools = options.enableTools || (options.mcpServers && options.mcpServers.length > 0);
  if (shouldEnableTools) {
    // ToolService requires EventBus
    toolsLayer = createToolsLayer().pipe(Layer.provide(eventBusLayer));
    runtime = Layer.merge(runtime, toolsLayer) as any;
  }

  if (options.enableReasoning) {
    // Build reasoning config from defaults + user overrides
    const reasoningConfig: ReasoningConfig = options.reasoningOptions
      ? {
          ...defaultReasoningConfig,
          ...(options.reasoningOptions.defaultStrategy
            ? { defaultStrategy: options.reasoningOptions.defaultStrategy }
            : {}),
          adaptive: {
            ...defaultReasoningConfig.adaptive,
            ...(options.reasoningOptions.adaptive ?? {}),
          },
          strategies: {
            reactive: {
              ...defaultReasoningConfig.strategies.reactive,
              ...(options.reasoningOptions.strategies?.reactive ?? {}),
            },
            planExecute: {
              ...defaultReasoningConfig.strategies.planExecute,
              ...(options.reasoningOptions.strategies?.planExecute ?? {}),
            },
            treeOfThought: {
              ...defaultReasoningConfig.strategies.treeOfThought,
              ...(options.reasoningOptions.strategies?.treeOfThought ?? {}),
            },
            reflexion: {
              ...defaultReasoningConfig.strategies.reflexion,
              ...(options.reasoningOptions.strategies?.reflexion ?? {}),
            },
          },
        }
      : defaultReasoningConfig;

    // ReasoningService requires LLMService, optionally ToolService
    let reasoningDeps = llmLayer;
    if (toolsLayer) {
      reasoningDeps = Layer.merge(llmLayer, toolsLayer) as any;
    }
    const reasoningLayer = createReasoningLayer(reasoningConfig).pipe(
      Layer.provide(reasoningDeps),
    );
    runtime = Layer.merge(runtime, reasoningLayer) as any;
  }

  if (options.enableIdentity) {
    runtime = Layer.merge(runtime, createIdentityLayer()) as any;
  }

  if (options.enableObservability) {
    runtime = Layer.merge(runtime, createObservabilityLayer()) as any;
  }

  if (options.enableInteraction) {
    // InteractionManager requires EventBus
    const interactionLayer = createInteractionLayer().pipe(
      Layer.provide(eventBusLayer),
    );
    runtime = Layer.merge(runtime, interactionLayer) as any;
  }

  if (options.enablePrompts) {
    runtime = Layer.merge(runtime, createPromptLayer()) as any;
  }

  if (options.enableOrchestration) {
    runtime = Layer.merge(runtime, createOrchestrationLayer()) as any;
  }

  if (options.extraLayers) {
    runtime = Layer.merge(runtime, options.extraLayers) as any;
  }

  return runtime;
};
