import { Layer, Effect } from "effect";
import { LifecycleHookRegistryLive } from "./hooks.js";
import { ExecutionEngineLive } from "./execution-engine.js";
import type { ReactiveAgentsConfig } from "./types.js";
import { defaultReactiveAgentsConfig } from "./types.js";
import { CoreServicesLive, EventBusLive } from "@reactive-agents/core";
import {
  createLLMProviderLayer,
  getProviderDefaultModel,
} from "@reactive-agents/llm-provider";
import { createMemoryLayer } from "@reactive-agents/memory";

// Optional package imports
import { createGuardrailsLayer } from "@reactive-agents/guardrails";
import { createVerificationLayer } from "@reactive-agents/verification";
import { createCostLayer } from "@reactive-agents/cost";
import {
  createReasoningLayer,
  defaultReasoningConfig,
} from "@reactive-agents/reasoning";
import type { ReasoningConfig } from "@reactive-agents/reasoning";
import { createToolsLayer } from "@reactive-agents/tools";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import type { ReasoningOptions, ObservabilityOptions } from "./builder.js";
import type { ContextProfile } from "@reactive-agents/reasoning";
import { createIdentityLayer } from "@reactive-agents/identity";
import {
  createObservabilityLayer,
  MetricsCollectorLive,
} from "@reactive-agents/observability";
import { createInteractionLayer } from "@reactive-agents/interaction";
import { createPromptLayer } from "@reactive-agents/prompts";
import { createOrchestrationLayer } from "@reactive-agents/orchestration";

// ─── Runtime Options ───

/**
 * Configuration for connecting to a Model Context Protocol (MCP) server.
 *
 * MCP servers expose tools via a standardized protocol. The transport type determines
 * how the agent communicates with the server (process stdio, HTTP SSE, or WebSocket).
 *
 * @example
 * ```typescript
 * const config: MCPServerConfig = {
 *   name: "filesystem",
 *   transport: "stdio",
 *   command: "mcp-server-filesystem",
 *   args: ["/home/user/data"]
 * };
 * ```
 */
export interface MCPServerConfig {
  /**
   * Friendly name for the MCP server (for logging and identification).
   */
  name: string;
  /**
   * Communication protocol:
   * - `"stdio"` — Child process with stdin/stdout communication
   * - `"sse"` — HTTP Server-Sent Events streaming
   * - `"websocket"` — WebSocket bidirectional communication
   * - `"streamable-http"` — MCP 2025-03-26 Streamable HTTP (single POST endpoint, JSON or SSE response)
   */
  transport: "stdio" | "sse" | "websocket" | "streamable-http";
  /**
   * Command to execute (for `stdio` transport).
   *
   * Any executable on PATH or absolute path. Works with Docker, Python, Node, Bun, etc.
   * @example `"bunx"`, `"docker"`, `"python"`, `"node"`, `"/usr/local/bin/my-server"`
   */
  command?: string;
  /**
   * Command-line arguments (for `stdio` transport).
   * @example
   * ```typescript
   * // npm package via bunx
   * args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
   * // Docker container
   * args: ["run", "-i", "--rm", "-e", "API_KEY=...", "ghcr.io/org/mcp-server"]
   * ```
   */
  args?: string[];
  /**
   * Working directory for the subprocess (for `stdio` transport).
   *
   * Defaults to the current working directory of the parent process.
   * @example `"/home/user/project"`, `process.cwd()`
   */
  cwd?: string;
  /**
   * Additional environment variables to pass to the subprocess (for `stdio` transport).
   *
   * These are **merged** on top of the parent process environment — you only need
   * to specify the variables that differ. Useful for per-server secrets.
   *
   * @example
   * ```typescript
   * env: {
   *   GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN ?? "",
   *   SOME_SERVER_API_KEY: "sk-...",
   * }
   * ```
   */
  env?: Record<string, string>;
  /**
   * HTTP endpoint URL (for `sse` or `websocket` transport).
   * @example `"http://localhost:8000/mcp"`, `"ws://localhost:8000/mcp"`
   */
  endpoint?: string;
  /**
   * HTTP headers to send with every request (for `sse` and `websocket` transports).
   *
   * Use this to pass authentication credentials. For OAuth, obtain a Bearer token
   * via your own token exchange flow and pass it here.
   *
   * > **Note:** The native WebSocket API does not support custom headers.
   * > For WebSocket auth, prefer embedding credentials in the URL
   * > (`ws://host/mcp?token=…`) or use SSE transport instead.
   *
   * @example
   * ```typescript
   * // Bearer token (OAuth, JWT, PAT)
   * headers: { Authorization: "Bearer ghp_..." }
   * // API key header
   * headers: { "x-api-key": process.env.MCP_API_KEY ?? "" }
   * ```
   */
  headers?: Record<string, string>;
}

/**
 * Options for creating a Reactive Agents runtime layer.
 *
 * All fields except `agentId` are optional. The runtime composes multiple optional layers
 * based on the enabled flags. Use `createRuntime()` to instantiate; do not create a layer manually.
 *
 * @see createRuntime
 */
export interface RuntimeOptions {
  /**
   * Unique identifier for the agent instance.
   * Used in logging, event publishing, and lifecycle management.
   */
  agentId: string;

  /**
   * LLM provider to use.
   * One of: `"anthropic"`, `"openai"`, `"ollama"`, `"gemini"`, `"litellm"`, or `"test"`
   *
   * Default: `"test"` (mock provider)
   */
  provider?: "anthropic" | "openai" | "ollama" | "gemini" | "litellm" | "test";

  /**
   * LLM model identifier (provider-specific).
   * Examples: `"claude-opus-4-20250514"`, `"gpt-4-turbo"`, `"mistral-large"`
   *
   * Default: undefined (uses provider default if available)
   */
  model?: string;

  /**
   * Enable/disable thinking mode for thinking-capable models.
   * - `true` — Always enable thinking
   * - `false` — Always disable thinking
   * - `undefined` — Auto-detect based on model capabilities
   *
   * Default: undefined (auto-detect)
   */
  thinking?: boolean;

  /**
   * Override default LLM temperature (0.0-1.0).
   *
   * Default: undefined (uses provider default)
   */
  temperature?: number;

  /**
   * Override default max output tokens.
   *
   * Default: undefined (uses provider default)
   */
  maxTokens?: number;

  /**
   * Memory system tier:
   * - `"1"` — Lightweight (working memory only)
   * - `"2"` — Full system (working, episodic, procedural, semantic with embeddings)
   *
   * Default: `"1"`
   */
  memoryTier?: "1" | "2";

  /**
   * Maximum reasoning iterations before the agent stops (regardless of success).
   * Prevents infinite reasoning loops.
   *
   * Default: `10`
   */
  maxIterations?: number;

  /**
   * Mock LLM responses for testing (provider: "test" only).
   * Maps input patterns to predefined outputs.
   *
   * Default: undefined (no mocking)
   */
  testResponses?: Record<string, string>;

  /**
   * Additional Effect-TS layers to compose into the runtime.
   * Advanced feature for custom services or dependencies.
   *
   * Default: undefined (no extra layers)
   */
  extraLayers?: Layer.Layer<any, any>;

  // ─── Optional Features ───

  /**
   * Enable guardrails (injection attacks, PII masking).
   *
   * Default: `false`
   */
  enableGuardrails?: boolean;

  /**
   * Enable semantic verification (confidence assessment, fact-checking).
   *
   * Default: `false`
   */
  enableVerification?: boolean;

  /**
   * Enable cost tracking (token counting, USD estimation).
   *
   * Default: `false`
   */
  enableCostTracking?: boolean;

  /**
   * Enable the reasoning layer (multi-step strategies: ReAct, tree-of-thought, etc.).
   * Without this, agent uses single-step LLM calls.
   *
   * Default: `false`
   */
  enableReasoning?: boolean;

  /**
   * Enable the tools layer (built-in + custom + MCP tools).
   *
   * Default: `false`
   */
  enableTools?: boolean;

  /**
   * Enable agent identity and certificate verification.
   *
   * Default: `false`
   */
  enableIdentity?: boolean;

  /**
   * Enable observability (metrics, tracing, structured logging).
   *
   * Default: `false`
   */
  enableObservability?: boolean;

  /**
   * Enable interactive collaboration (approval gates, user feedback loops).
   *
   * Default: `false`
   */
  enableInteraction?: boolean;

  /**
   * Enable prompt template service (template library, A/B experiments).
   *
   * Default: `false`
   */
  enablePrompts?: boolean;

  /**
   * Enable multi-agent orchestration (workflow engine, task dependencies).
   *
   * Default: `false`
   */
  enableOrchestration?: boolean;

  /**
   * Enable audit logging (compliance, phase transitions, decision points).
   *
   * Default: `false`
   */
  enableAudit?: boolean;

  /**
   * Enable the kill switch service (pause/resume/stop/terminate).
   *
   * Default: `false`
   */
  enableKillSwitch?: boolean;

  /**
   * Enable behavioral contracts (tool/output/iteration constraints).
   *
   * Default: `false`
   */
  enableBehavioralContracts?: boolean;

  /**
   * Behavioral contract specification (required if `enableBehavioralContracts: true`).
   *
   * Default: undefined
   */
  behavioralContract?: import("@reactive-agents/guardrails").BehavioralContract;

  /**
   * Enable cross-task self-improvement (requires memory tier 2).
   *
   * Default: `false`
   */
  enableSelfImprovement?: boolean;

  // ─── Agent Behavior ───

  /**
   * Custom system prompt to guide LLM behavior.
   * If both system prompt and persona are provided, persona is prepended.
   *
   * Default: undefined (no custom system prompt)
   */
  systemPrompt?: string;

  // ─── Tool Configuration ───

  /**
   * MCP servers to connect and discover tools from.
   * Implicitly enables the tools layer.
   *
   * Default: undefined (no MCP servers)
   */
  mcpServers?: MCPServerConfig[];

  // ─── Reasoning Configuration ───

  /**
   * Reasoning layer options (strategy selection, per-strategy overrides).
   *
   * Default: undefined (uses framework defaults)
   */
  reasoningOptions?: ReasoningOptions;

  // ─── Observability Configuration ───

  /**
   * Observability configuration (verbosity, live streaming, file export).
   *
   * Default: undefined (minimal observability)
   */
  observabilityOptions?: ObservabilityOptions;

  // ─── A2A Configuration ───

  /**
   * Enable Agent-to-Agent (A2A) protocol server.
   *
   * Default: `false`
   */
  enableA2A?: boolean;

  /**
   * HTTP port for the A2A server.
   *
   * Default: `3000`
   */
  a2aPort?: number;

  /**
   * Base path for A2A endpoints (e.g., `/api/agents` → `http://localhost:3000/api/agents/rpc`).
   *
   * Default: `/` (root)
   */
  a2aBasePath?: string;

  // ─── Gateway Configuration ───

  /**
   * Enable the persistent gateway for autonomous agent behavior.
   *
   * Default: `false`
   */
  enableGateway?: boolean;

  /**
   * Gateway configuration options (heartbeat, crons, webhooks, policies).
   */
  gatewayOptions?: {
    timezone?: string;
    heartbeat?: {
      intervalMs?: number;
      policy?: string;
      instruction?: string;
      maxConsecutiveSkips?: number;
    };
    crons?: readonly {
      schedule: string;
      instruction: string;
      agentId?: string;
      priority?: string;
      timezone?: string;
      enabled?: boolean;
    }[];
    webhooks?: readonly {
      path: string;
      adapter: string;
      secret?: string;
      events?: readonly string[];
    }[];
    policies?: {
      dailyTokenBudget?: number;
      maxActionsPerHour?: number;
      heartbeatPolicy?: string;
      mergeWindowMs?: number;
    };
    channels?: {
      accessPolicy?: string;
      allowedSenders?: readonly string[];
      blockedSenders?: readonly string[];
      unknownSenderAction?: string;
      replyToUnknown?: string;
    };
    port?: number;
  };

  // ─── Context Engineering ───

  /**
   * Model-adaptive context profile overrides (budget, compaction, tool result sizes).
   * Partially overrides the default profile for the resolved model tier.
   *
   * Default: undefined (uses model-tier defaults)
   */
  contextProfile?: Partial<ContextProfile>;

  /**
   * Tool result compression configuration.
   * Controls how large tool outputs are truncated, previewed, and stored.
   *
   * Default: undefined (uses framework defaults)
   */
  resultCompression?: ResultCompressionConfig;
}

/**
 * Create the full Reactive Agents runtime layer.
 *
 * Composes the base layers (Core, LLM Provider, Memory, ExecutionEngine, EventBus, MetricsCollector)
 * and optionally merges additional feature layers (Guardrails, Reasoning, Tools, Observability, etc.)
 * based on the enabled flags in `RuntimeOptions`.
 *
 * This function is called internally by `ReactiveAgentBuilder.buildEffect()` and should not normally
 * be used directly. Use the builder API instead.
 *
 * @param options - Runtime configuration options
 * @returns A composed Effect-TS Layer that provides all configured services
 *
 * @example
 * ```typescript
 * // Low-level usage (normally use builder instead)
 * const layer = createRuntime({
 *   agentId: "my-agent",
 *   provider: "anthropic",
 *   model: "claude-opus-4-20250514",
 *   enableReasoning: true,
 *   enableTools: true,
 *   enableObservability: true,
 * });
 *
 * const result = await Effect.runPromise(
 *   ExecutionEngine.pipe(Effect.provide(layer))
 * );
 * ```
 *
 * @see ReactiveAgentBuilder
 * @see RuntimeOptions
 */
export const createRuntime = (options: RuntimeOptions) => {
  // Resolve default model: explicit > env var > provider registry fallback
  const resolvedModel =
    options.model ??
    process.env.LLM_DEFAULT_MODEL ??
    (options.provider
      ? getProviderDefaultModel(options.provider)
      : undefined) ??
    "claude-sonnet-4-20250514";

  const config: ReactiveAgentsConfig = {
    ...defaultReactiveAgentsConfig(options.agentId),
    defaultModel: resolvedModel,
    provider: options.provider,
    thinking: options.thinking,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    memoryTier: options.memoryTier ?? "1",
    maxIterations: options.maxIterations ?? 10,
    enableGuardrails: options.enableGuardrails ?? false,
    enableVerification: options.enableVerification ?? false,
    enableCostTracking: options.enableCostTracking ?? false,
    enableAudit: options.enableAudit ?? false,
    enableKillSwitch: options.enableKillSwitch ?? false,
    enableBehavioralContracts: options.enableBehavioralContracts ?? false,
    enableSelfImprovement: options.enableSelfImprovement ?? false,
    systemPrompt: options.systemPrompt,
    observabilityVerbosity: options.observabilityOptions?.verbosity,
    logModelIO: options.observabilityOptions?.logModelIO,
    contextProfile: options.contextProfile,
    defaultStrategy: options.reasoningOptions?.defaultStrategy,
    resultCompression: options.resultCompression,
  };

  // ── Required layers ──
  // EventBusLive and MetricsCollectorLive are exposed separately so optional layers that need them can be provided
  // This ensures they're singletons shared across all services (ExecutionEngine, ObservabilityService, etc.)
  const eventBusLayer = EventBusLive;
  // Provide EventBusLive to MetricsCollectorLive so it can subscribe to ToolCallCompleted events
  // IMPORTANT: MetricsCollectorLive must have EventBus available when it initializes
  const metricsCollectorLayer = MetricsCollectorLive.pipe(
    Layer.provide(eventBusLayer),
  );
  const coreLayer = CoreServicesLive;
  const llmLayer = createLLMProviderLayer(
    options.provider ?? "test",
    options.testResponses,
    options.model,
    {
      thinking: options.thinking,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    },
  );
  const memoryLayer = createMemoryLayer(config.memoryTier, {
    agentId: options.agentId,
  });
  const hookLayer = LifecycleHookRegistryLive;
  const engineLayer = ExecutionEngineLive(config).pipe(
    Layer.provide(hookLayer),
    Layer.provide(metricsCollectorLayer), // Now has EventBusLive already provided
  );

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

  if (options.enableKillSwitch) {
    const { KillSwitchServiceLive } =
      require("@reactive-agents/guardrails") as typeof import("@reactive-agents/guardrails");
    // Provide eventBusLayer so KillSwitchService captures the same EventBus instance
    // during its layer build (for AgentPaused/AgentResumed event emission).
    runtime = Layer.merge(
      runtime,
      KillSwitchServiceLive().pipe(Layer.provide(eventBusLayer)),
    ) as any;
  }

  if (options.enableBehavioralContracts && options.behavioralContract) {
    const { BehavioralContractServiceLive } =
      require("@reactive-agents/guardrails") as typeof import("@reactive-agents/guardrails");
    runtime = Layer.merge(
      runtime,
      BehavioralContractServiceLive(options.behavioralContract),
    ) as any;
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
  const shouldEnableTools =
    options.enableTools ||
    (options.mcpServers && options.mcpServers.length > 0);
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

    // ReasoningService requires LLMService, optionally ToolService + PromptService
    let reasoningDeps = llmLayer;
    if (toolsLayer) {
      reasoningDeps = Layer.merge(llmLayer, toolsLayer) as any;
    }
    if (options.enablePrompts) {
      reasoningDeps = Layer.merge(reasoningDeps, createPromptLayer()) as any;
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
    const obsExporterConfig = {
      verbosity: options.observabilityOptions?.verbosity,
      live: options.observabilityOptions?.live,
      file: options.observabilityOptions?.file
        ? { filePath: options.observabilityOptions.file }
        : undefined,
    };
    // Provide the shared metricsCollectorLayer so ObservabilityService uses the same instance
    // as ExecutionEngine, ensuring metrics flow through properly
    const obsLayer = createObservabilityLayer(
      obsExporterConfig,
      metricsCollectorLayer,
    );
    runtime = Layer.merge(runtime, obsLayer) as any;
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

  // A2A support - use extraLayers pattern for optional A2A
  if (options.enableA2A) {
    runtime = Layer.merge(
      runtime,
      A2aExtraLayer(options.agentId, options.a2aPort ?? 3000),
    ) as any;
  }

  // Gateway — compose GatewayService + SchedulerService when enabled.
  // The persistent event loop itself starts via agent.start(); layer composition just makes
  // the services resolvable from the ManagedRuntime.
  // EventBus is passed to gateway services for observability when available.
  if (options.enableGateway) {
    const gatewayLayer = Layer.unwrapEffect(
      Effect.gen(function* () {
        const gw = yield* Effect.promise(
          () => import("@reactive-agents/gateway"),
        );

        // Resolve EventBus from context for observability (optional).
        // Use Effect.catchAll — yield* with a missing service produces a fiber failure,
        // not a JS exception, so try/catch won't catch it.
        const core = yield* Effect.promise(
          () => import("@reactive-agents/core"),
        );
        type BusLike = { publish: (e: any) => Effect.Effect<void, never> };
        const bus: BusLike | undefined = yield* Effect.gen(function* () {
          const eb = yield* core.EventBus as any;
          return { publish: (e: any) => (eb as any).publish(e) } as BusLike;
        }).pipe(
          Effect.catchAll(() =>
            Effect.succeed(undefined as BusLike | undefined),
          ),
        );

        const gwLayer = gw.GatewayServiceLive(
          (options.gatewayOptions ?? {}) as any,
          bus,
        );
        const schedLayer = gw.SchedulerServiceLive(
          {
            agentId: options.agentId,
            timezone: options.gatewayOptions?.timezone as any,
            heartbeat: options.gatewayOptions?.heartbeat as any,
            crons: options.gatewayOptions?.crons as any,
          },
          bus,
        );
        return Layer.merge(gwLayer, schedLayer);
      }),
    );
    runtime = Layer.merge(
      runtime,
      gatewayLayer.pipe(Layer.provide(eventBusLayer)),
    ) as any;
  }

  if (options.extraLayers) {
    runtime = Layer.merge(runtime, options.extraLayers) as any;
  }

  return runtime;
};

/**
 * Create the A2A (Agent-to-Agent) protocol server layer.
 *
 * Sets up an HTTP server that exposes the agent via JSON-RPC 2.0 for remote invocation.
 * The agent becomes discoverable via an Agent Card at `/.well-known/agent.json`.
 *
 * If the `@reactive-agents/a2a` package is not installed, returns an empty layer (graceful degradation).
 *
 * @param agentId - Agent identifier (used in the Agent Card)
 * @param port - HTTP port to listen on (e.g., 3000)
 * @returns A Layer that sets up the A2A server
 *
 * @internal Called internally by `createRuntime()` when `enableA2A: true`
 */
const A2aExtraLayer = (
  agentId: string,
  port: number,
): Layer.Layer<any, any> => {
  // Use dynamic import() so Bun's mock.module() can intercept it in tests.
  // Layer.unwrapEffect lets us return a Layer from inside an async Effect.
  return Layer.unwrapEffect(
    Effect.promise(async () => {
      try {
        const mod = (await import("@reactive-agents/a2a")) as any;
        const { createA2AServerLayer } = mod;
        const agentCard = {
          id: agentId,
          name: agentId,
          version: "0.5.0",
          url: `http://localhost:${port}`,
          provider: { organization: "Reactive Agents" },
          capabilities: {
            streaming: true,
            pushNotifications: false,
            stateTransitionHistory: false,
          },
        };
        return createA2AServerLayer(agentCard, port) as Layer.Layer<any, any>;
      } catch {
        // A2A package not installed — return empty layer
        return Layer.empty as unknown as Layer.Layer<any, any>;
      }
    }),
  );
};
