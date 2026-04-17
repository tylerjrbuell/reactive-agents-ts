import { Layer, Effect, Context, Schedule, Duration, Ref } from "effect";
import { LifecycleHookRegistryLive } from "./hooks.js";
import { ExecutionEngineLive } from "./execution-engine.js";
import type { ReactiveAgentsConfig } from "./types.js";
import { defaultReactiveAgentsConfig } from "./types.js";
import { CoreServicesLive, EventBusLive, EventBus } from "@reactive-agents/core";
import type { AgentEvent } from "@reactive-agents/core";
import {
  createLLMProviderLayer,
  getProviderDefaultModel,
  LLMService,
  makeRateLimitedProvider,
  FallbackChain,
} from "@reactive-agents/llm-provider";
import type { TestTurn } from "@reactive-agents/llm-provider";
import { createMemoryLayer, ExperienceStoreLive, MemoryConsolidatorServiceLive, SessionStoreLive } from "@reactive-agents/memory";
import type { MemoryLLM } from "@reactive-agents/memory";

// Optional package imports
import { createGuardrailsLayer } from "@reactive-agents/guardrails";
import {
  createVerificationLayer,
  createVerificationLayerWithRuntimeLlm,
} from "@reactive-agents/verification";
import { createCostLayer } from "@reactive-agents/cost";
import {
  createReasoningLayer,
  defaultReasoningConfig,
} from "@reactive-agents/reasoning";
import type { ReasoningConfig, KernelMetaToolsConfig } from "@reactive-agents/reasoning";
import { createToolsLayer, ToolResultCacheLive, ToolService, ToolNotFoundError } from "@reactive-agents/tools";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import type { ObservabilityOptions } from "./builder.js";
import type { ReasoningOptions } from "./types.js";
import { withoutStrategyIcsOverrides } from "./synthesis-resolve.js";
import type { TelemetryConfig } from "@reactive-agents/observability";
import type { ContextProfile } from "@reactive-agents/reasoning";
import { createIdentityLayer } from "@reactive-agents/identity";
import {
  createObservabilityLayer,
  MetricsCollectorLive,
  TelemetryCollectorLive,
} from "@reactive-agents/observability";
import { createInteractionLayer } from "@reactive-agents/interaction";
import { createPromptLayer } from "@reactive-agents/prompts";
import { createOrchestrationLayer } from "@reactive-agents/orchestration";
import {
  createReactiveIntelligenceLayer,
  makeSkillResolverService,
  type SkillLayerConfig,
} from "@reactive-agents/reactive-intelligence";

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
  /**
   * Inferred automatically when omitted:
   * - `command` present → `"stdio"` (auto-upgrades to HTTP if the subprocess starts an HTTP server)
   * - `endpoint` with `/mcp` path → `"streamable-http"`
   * - `endpoint` with `/sse` or plain HTTP → `"sse"`
   */
  transport?: "stdio" | "sse" | "websocket" | "streamable-http";
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
   * Whether the memory layer was explicitly enabled via `.withMemory()`.
   * Controls debrief synthesis — debriefs are only synthesized when memory is enabled.
   *
   * Default: `false`
   */
  enableMemory?: boolean;

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
  testScenario?: TestTurn[];

  /**
   * Additional Effect-TS layers to compose into the runtime.
   * Advanced feature for custom services or dependencies.
   *
   * Default: undefined (no extra layers)
   */
  extraLayers?: Layer.Layer<any, any, any>;

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

  /**
   * Custom environment context key-value pairs injected into the system prompt.
   * Date, time, timezone, and platform are always injected automatically.
   * Use this for additional context like user location, locale, or project name.
   */
  environmentContext?: Record<string, string>;

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

  /**
   * Telemetry configuration for opt-in anonymous run data collection.
   * When provided, telemetry is enabled and EventBus events are captured.
   *
   * Default: undefined (no telemetry)
   */
  telemetryConfig?: TelemetryConfig;

  // ─── Config Passthrough (Sprint 3 DX) ───

  /**
   * Memory system configuration (tier, dbPath, capacity, etc.).
   * Passed through to `createMemoryLayer()`.
   *
   * Default: undefined (uses framework defaults)
   */
  memoryOptions?: import("./builder.js").MemoryOptions;

  /**
   * Guardrail detector toggles.
   * Passed through to `createGuardrailsLayer()`.
   *
   * Default: undefined (all detectors enabled)
   */
  guardrailsOptions?: import("./builder.js").GuardrailsOptions;

  /**
   * Verification strategy toggles and thresholds.
   * Passed through to `createVerificationLayer()`.
   *
   * Default: undefined (uses framework defaults)
   */
  verificationOptions?: import("./builder.js").VerificationOptions;

  /**
   * Cost tracking budget limits (USD).
   * Passed through to `createCostLayer()`.
   *
   * Default: undefined (uses framework defaults)
   */
  costTrackingOptions?: import("./builder.js").CostTrackingOptions;

  /**
   * Circuit breaker configuration for LLM provider calls.
   * When provided, wraps LLM complete/stream with circuit breaker protection.
   *
   * Default: undefined (no circuit breaker)
   */
  circuitBreakerConfig?: Partial<import("@reactive-agents/llm-provider").CircuitBreakerConfig>;

  /**
   * Required tools configuration — tools that MUST be called before the agent
   * can declare success. Supports explicit tool lists, adaptive LLM inference,
   * or both.
   *
   * @example
   * ```typescript
   * // Explicit tools only
   * { requiredTools: { tools: ["web_search", "file_write"] } }
   *
   * // Adaptive inference — LLM determines required tools
   * { requiredTools: { adaptive: true } }
   *
   * // Both — explicit tools + LLM infers additional ones
   * { requiredTools: { tools: ["web_search"], adaptive: true, maxRetries: 3 } }
   * ```
   */
  requiredTools?: {
    /** Tool names that must be called during execution */
    readonly tools?: readonly string[];
    /** When true, the LLM analyzes task + available tools to infer required tools */
    readonly adaptive?: boolean;
    /** Max redirects when required tools are missing (default: 2) */
    readonly maxRetries?: number;
  };

  /**
   * Whitelist of tool names to expose. When set, only these tools are available —
   * all others (built-in, MCP, custom) are filtered out at the ToolService level.
   * All consumers (reasoning strategies, execution engine) see the filtered set.
   *
   * @example
   * ```typescript
   * { allowedTools: ["web-search", "file-read"] }
   * ```
   *
   * Default: undefined (all tools available)
   */
  allowedTools?: readonly string[];

  /**
   * Enable adaptive tool filtering. When true, only task-relevant tools are shown
   * to the agent at reasoning time — reducing context noise for small models.
   * All tools remain callable by exact name even if not shown.
   *
   * Uses heuristic keyword + description matching to identify relevant tools.
    * Any tools listed in `ALWAYS_INCLUDE_TOOLS` (from `@reactive-agents/tools`) are always merged into the filtered set.
   *
   * @example
   * ```typescript
   * { adaptiveToolFiltering: true }
   * ```
   *
   * Default: false (all tools shown)
   */
  adaptiveToolFiltering?: boolean;

  /**
   * Enable ExperienceStore cross-agent learning.
   * Records tool-use patterns and queries them at bootstrap to surface tips from prior runs.
   *
   * Default: false
   */
  enableExperienceLearning?: boolean;

  /**
   * Enable MemoryConsolidatorService background memory intelligence.
   * Periodically consolidates episodic entries, decays semantic importance, and prunes stale entries.
   *
   * Default: false
   */
  enableMemoryConsolidation?: boolean;

  /**
   * Configuration for MemoryConsolidatorService.
   *
   * Default: undefined (uses framework defaults)
   */
  consolidationConfig?: {
    threshold?: number;
    decayFactor?: number;
    pruneThreshold?: number;
  };

  /** Per-execution timeout in milliseconds. If set, execution is aborted after this duration. */
  executionTimeoutMs?: number;

  /** LLM call retry policy for transient errors (rate limits, network failures). */
  retryPolicy?: {
    maxRetries: number;
    backoffMs: number;
  };

  /** Semantic cache TTL in milliseconds. Cached responses older than this are evicted. */
  cacheTimeoutMs?: number;

  /** Minimum iterations before final-answer is permitted. */
  minIterations?: number;

  /** Background data injected into reasoning memory context (not system prompt). */
  taskContext?: Record<string, string>;

  /** Save a progress checkpoint every N iterations. */
  progressCheckpoint?: { every: number; autoResume?: boolean };

  /** Verification pass after initial reasoning result. "reflect" = one extra LLM call (cheap); "loop" = re-enters ReAct with tools (thorough). */
  verificationStep?: { mode: "reflect" | "loop"; prompt?: string };

  /** Validate output before accepting — retry with feedback on failure. */
  outputValidator?: (output: string) => { valid: boolean; feedback?: string };

  /** Controls retry behavior for outputValidator. maxRetries defaults to 2 when omitted. */
  outputValidatorOptions?: { maxRetries?: number };

  /** Custom termination predicate. Agent re-runs until it returns true, up to 3 times maximum. */
  customTermination?: (state: { output: string }) => boolean;

  /**
   * Enable SQLite-backed session persistence via SessionStoreLive.
   * Requires the memory layer to be active (`enableMemory: true` or `memoryTier` set).
   * When false (default), `agent.session({ persist: true })` silently no-ops.
   *
   * Default: `false`
   */
  sessionPersist?: boolean;

  /**
   * Max age of sessions to retain in days when session persistence is enabled.
   * Sessions older than this will be eligible for cleanup.
   *
   * Default: undefined (no automatic cleanup)
   */
  sessionMaxAgeDays?: number;

  /**
   * Structured logging configuration. When provided, a logger tap is wired into the
   * EventBus and emits structured log entries for all agent lifecycle events in real time.
   *
   * Supports `"console"`, `"file"` (with rotation), or a custom `WritableStream`.
   *
   * Default: undefined (no structured logging)
   */
  loggingConfig?: import("@reactive-agents/observability").LoggingConfig;

  /**
   * Enable the health check service. Exposes `agent.health()` to return subsystem
   * readiness status across LLM, memory, tools, and guardrails layers.
   *
   * Default: `false`
   */
  enableHealthCheck?: boolean;

  /** Enable the Reactive Intelligence layer (entropy sensing). */
  enableReactiveIntelligence?: boolean;

  /** Configuration for reactive intelligence. */
  reactiveIntelligenceOptions?: Record<string, unknown>;

  /**
   * Living skills: directories that contain subfolders with `SKILL.md` (agentskills.io layout).
   * When `paths` is non-empty, registers `SkillResolverService` so the execution engine can
   * inject `<available_skills>` and resolve filesystem skills alongside optional SQLite skills.
   */
  skills?: {
    readonly paths?: readonly string[];
    readonly evolution?: {
      mode?: string;
      refinementThreshold?: number;
      rollbackOnRegression?: boolean;
    };
  };

  /**
   * Project root used when resolving relative skill scan paths in the skill registry
   * (default: `process.cwd()` at runtime creation).
   */
  skillDiscoveryRoot?: string;

  /**
   * Graceful degradation configuration. When provided, the runtime creates a
   * composite LLM service that automatically falls back to the next provider
   * if the current one fails. Providers are tried in order; the primary
   * `provider` is always first.
   *
   * @example
   * ```typescript
   * createRuntime({
   *   provider: "anthropic",
   *   fallbackConfig: { providers: ["anthropic", "openai"], errorThreshold: 2 },
   * })
   * ```
   *
   * Default: undefined (no fallback, single provider)
   */
  fallbackConfig?: { providers?: string[]; models?: string[]; errorThreshold?: number };

  /**
   * Rate limiter configuration. When provided, wraps LLM complete/stream/completeStructured
   * with a sliding-window rate limiter to prevent 429 errors before they occur.
   *
   * Default: undefined (no rate limiting)
   */
  rateLimiterConfig?: import("@reactive-agents/llm-provider").RateLimiterConfig;

  /**
   * Custom pricing registry for calculating token costs.
   * Maps model identifiers to input/output token costs per 1 million tokens.
   */
  readonly pricingRegistry?: Record<string, { readonly input: number; readonly output: number }>;

  /**
   * Meta-tools configuration for the Conductor's Suite (brief, find, pulse, recall).
   * When provided, these tools are injected into the agent's tool registry for the execution.
   */
  metaTools?: KernelMetaToolsConfig;
  /**
   * Per-model calibration mode. "auto" loads pre-baked or cached calibration for the
   * resolved modelId. "skip" (default) uses pure tier-based adapters. A `ModelCalibration`
   * object bypasses lookup entirely.
   */
  calibration?: import("./types.js").CalibrationMode;
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
  // Note: empty strings are treated as unset (env vars can be "" after unsetting)
  const resolvedModel =
    options.model ||
    process.env.LLM_DEFAULT_MODEL ||
    (options.provider
      ? getProviderDefaultModel(options.provider)
      : undefined) ||
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
    environmentContext: options.environmentContext,
    observabilityVerbosity: options.observabilityOptions?.verbosity,
    logModelIO: options.observabilityOptions?.logModelIO,
    logPrefix: options.observabilityOptions?.logPrefix,
    contextProfile: options.contextProfile,
    defaultStrategy: options.reasoningOptions?.defaultStrategy,
    resultCompression: options.resultCompression,
    requiredTools: options.requiredTools
      ? {
          tools: options.requiredTools.tools ? [...options.requiredTools.tools] : undefined,
          adaptive: options.requiredTools.adaptive,
          maxRetries: options.requiredTools.maxRetries,
        }
      : undefined,
    adaptiveToolFiltering: options.adaptiveToolFiltering,
    allowedTools: options.allowedTools,
    enableMemory: options.enableMemory ?? false,
    enableExperienceLearning: options.enableExperienceLearning,
    enableMemoryConsolidation: options.enableMemoryConsolidation,
    consolidationConfig: options.consolidationConfig,
    executionTimeoutMs: options.executionTimeoutMs,
    retryPolicy: options.retryPolicy,
    cacheTimeoutMs: options.cacheTimeoutMs,
    minIterations: options.minIterations,
    taskContext: options.taskContext,
    progressCheckpoint: options.progressCheckpoint,
    verificationStep: options.verificationStep,
    outputValidator: options.outputValidator,
    outputValidatorOptions: options.outputValidatorOptions,
    customTermination: options.customTermination,
    session: options.sessionPersist
      ? {
          persist: options.sessionPersist,
          maxAgeDays: options.sessionMaxAgeDays,
        }
      : undefined,
    strategySwitching: options.reasoningOptions?.enableStrategySwitching
      ? {
          enabled: true,
          maxSwitches: options.reasoningOptions.maxStrategySwitches,
          fallbackStrategy: options.reasoningOptions.fallbackStrategy,
        }
      : undefined,
    enableReactiveIntelligence: options.enableReactiveIntelligence,
    reactiveIntelligenceOptions: options.reactiveIntelligenceOptions,
    reasoningOptions: options.reasoningOptions,
    metaTools: options.metaTools,
    calibration: options.calibration,
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
    options.testScenario,
    resolvedModel,
    {
      thinking: options.thinking,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    },
    options.circuitBreakerConfig,
    options.pricingRegistry,
  );

  // Build effectiveLlmLayer: if fallbackConfig has additional providers, wrap
  // the primary layer with Effect.catchAll chains so failures cascade through
  // fallback providers automatically.
  const fallbackProviders = (options.fallbackConfig?.providers ?? []).slice(1);
  const effectiveLlmLayer: Layer.Layer<LLMService> =
    fallbackProviders.length > 0
      ? Layer.effect(
          LLMService,
          Effect.gen(function* () {
            const primary = yield* LLMService.pipe(
              Effect.provide(llmLayer as Layer.Layer<LLMService, never, never>),
            );
            const fallbacks = yield* Effect.all(
              fallbackProviders.map((fp) =>
                LLMService.pipe(
                  Effect.provide(
                    createLLMProviderLayer(fp as Parameters<typeof createLLMProviderLayer>[0], undefined, undefined, {
                        temperature: options.temperature,
                        maxTokens: options.maxTokens,
                      }) as Layer.Layer<LLMService, never, never>,
                  ),
                ),
              ),
              { concurrency: "unbounded" },
            );
            const all = [primary, ...fallbacks];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return {
              complete: (req: Parameters<typeof primary.complete>[0]) => {
                const fallbackTransitions: Array<{
                  fromProvider: string;
                  toProvider: string;
                  reason: string;
                  attemptNumber: number;
                }> = [];
                const fallbackChain = new FallbackChain(
                  {
                    providers: [options.provider ?? "test", ...fallbackProviders],
                    errorThreshold: options.fallbackConfig?.errorThreshold,
                  },
                  (fromProvider, toProvider, reason, attemptNumber) => {
                    fallbackTransitions.push({
                      fromProvider,
                      toProvider,
                      reason,
                      attemptNumber,
                    });
                  },
                );
                let effect = primary.complete(req);
                for (const fb of fallbacks) {
                  const captured = fb;
                  effect = effect.pipe(
                    Effect.catchAllCause(() =>
                      Effect.sync(() => {
                        fallbackChain.recordError(options.provider ?? "test");
                      }).pipe(Effect.zipRight(captured.complete(req))),
                    ),
                  );
                }
                return effect.pipe(
                  Effect.flatMap((response) =>
                    Effect.gen(function* () {
                      const transitions = [...fallbackTransitions];

                      return transitions.length > 0
                        ? ({
                            ...response,
                            fallbackTransitions: transitions,
                          } as typeof response & {
                            fallbackTransitions: Array<{
                              fromProvider: string;
                              toProvider: string;
                              reason: string;
                              attemptNumber: number;
                            }>;
                          })
                        : response;
                    }),
                  ),
                );
              },
              stream: (req: Parameters<typeof primary.stream>[0]) => primary.stream(req),
              completeStructured: (req: Parameters<typeof primary.completeStructured>[0]) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                let effect = primary.completeStructured(req as any) as any;
                for (const fb of fallbacks) {
                  const captured = fb;
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  effect = effect.pipe(Effect.catchAll(() => captured.completeStructured(req as any)));
                }
                return effect;
              },
              embed: (texts: Parameters<typeof primary.embed>[0], model: Parameters<typeof primary.embed>[1]) => {
                let effect = primary.embed(texts, model);
                for (const fb of all.slice(1)) {
                  const captured = fb;
                  effect = effect.pipe(Effect.catchAll(() => captured.embed(texts, model)));
                }
                return effect;
              },
              countTokens: (msgs: Parameters<typeof primary.countTokens>[0]) => primary.countTokens(msgs),
              getModelConfig: () => primary.getModelConfig(),
              getStructuredOutputCapabilities: () => primary.getStructuredOutputCapabilities(),
            } as Context.Tag.Service<LLMService>;
          }),
        )
      : (llmLayer as Layer.Layer<LLMService>);

  // Apply retry policy: wrap complete() with Effect.retry so transient LLM
  // failures (rate limits, network errors) automatically back off and retry.
  const finalLlmLayer: Layer.Layer<LLMService> =
    options.retryPolicy
      ? Layer.effect(
          LLMService,
          Effect.gen(function* () {
            const svc = yield* LLMService.pipe(
              Effect.provide(effectiveLlmLayer as Layer.Layer<LLMService, never, never>),
            );
            const retrySchedule = Schedule.recurs(options.retryPolicy!.maxRetries).pipe(
              Schedule.intersect(Schedule.spaced(Duration.millis(options.retryPolicy!.backoffMs))),
            );
            return {
              ...svc,
              complete: (req: Parameters<typeof svc.complete>[0]) =>
                svc.complete(req).pipe(Effect.retry(retrySchedule)),
            } as Context.Tag.Service<LLMService>;
          }),
        )
      : effectiveLlmLayer;

  // Apply rate limiting: wrap LLM calls with a sliding-window rate limiter
  // so requests are throttled BEFORE hitting the API (prevents 429 errors).
  // Rate limiting is applied after retry policy so retried requests also
  // respect the rate limit.
  const rateLimitedLlmLayer: Layer.Layer<LLMService> =
    options.rateLimiterConfig
      ? makeRateLimitedProvider(options.rateLimiterConfig).pipe(
          Layer.provide(finalLlmLayer as Layer.Layer<LLMService, never, never>),
        ) as Layer.Layer<LLMService>
      : finalLlmLayer;

  const memoryOverrides: Record<string, unknown> = { agentId: options.agentId };
  if (options.memoryOptions) {
    const mo = options.memoryOptions;
    if (mo.dbPath) memoryOverrides.dbPath = mo.dbPath;
    if (mo.capacity || mo.evictionPolicy) {
      memoryOverrides.working = {
        capacity: mo.capacity ?? 7,
        evictionPolicy: mo.evictionPolicy ?? "fifo",
      };
    }
    if (mo.importanceThreshold !== undefined) {
      memoryOverrides.semantic = {
        maxMarkdownLines: 200,
        importanceThreshold: mo.importanceThreshold,
      };
    }
    if (mo.retainDays !== undefined) {
      memoryOverrides.episodic = {
        retainDays: mo.retainDays,
        maxSnapshotsPerSession: 3,
      };
    }
    if (mo.maxEntries !== undefined) {
      memoryOverrides.compaction = {
        strategy: "progressive",
        maxEntries: mo.maxEntries,
        intervalMs: 86_400_000,
        similarityThreshold: 0.92,
        decayFactor: 0.05,
      };
    }
  }
  // Bridge LLMService.embed into MemoryLLM so semantic memory auto-generates embeddings
  const memoryLayer = Layer.unwrapEffect(
    Effect.gen(function* () {
      const llm = yield* LLMService;
      const bridgedLLM: MemoryLLM = {
        complete: (req) =>
          llm.complete({
            messages: req.messages.map((m) => ({
              role: m.role as "user" | "assistant" | "system",
              content: m.content,
            })),
            temperature: req.temperature,
            maxTokens: req.maxTokens,
          }).pipe(
            Effect.map((r) => ({
              content: r.content,
              usage: r.usage ? { totalTokens: r.usage.totalTokens } : undefined,
            })),
          ),
        embed: (texts, model) => llm.embed(texts, model),
      };
      return createMemoryLayer(
        config.memoryTier,
        memoryOverrides as Parameters<typeof createMemoryLayer>[1],
        bridgedLLM,
      );
    }),
  ).pipe(Layer.provide(Layer.merge(rateLimitedLlmLayer, eventBusLayer)));
  const hookLayer = LifecycleHookRegistryLive;
  const engineLayer = ExecutionEngineLive(config).pipe(
    Layer.provide(hookLayer),
    Layer.provide(metricsCollectorLayer), // Now has EventBusLive already provided
  );

  let runtime = Layer.mergeAll(
    coreLayer,
    eventBusLayer,
    rateLimitedLlmLayer,
    memoryLayer,
    hookLayer,
    engineLayer,
  );

  // ── Optional layers ──

  if (options.enableGuardrails) {
    const gc = options.guardrailsOptions;
    const guardrailConfig = gc
      ? {
          enableInjectionDetection: gc.injection ?? true,
          enablePiiDetection: gc.pii ?? true,
          enableToxicityDetection: gc.toxicity ?? true,
          ...(gc.customBlocklist
            ? { customBlocklist: [...gc.customBlocklist] }
            : {}),
        }
      : undefined;
    runtime = Layer.merge(runtime, createGuardrailsLayer(guardrailConfig)) as any;
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
    const vc = options.verificationOptions;
    const verificationConfig = {
      enableSemanticEntropy: vc?.semanticEntropy ?? true,
      enableFactDecomposition: vc?.factDecomposition ?? true,
      enableMultiSource: vc?.multiSource ?? false,
      enableSelfConsistency: vc?.selfConsistency ?? true,
      enableNli: vc?.nli ?? true,
      enableHallucinationDetection: vc?.hallucinationDetection,
      hallucinationThreshold: vc?.hallucinationThreshold,
      passThreshold: vc?.passThreshold ?? 0.7,
      riskThreshold: vc?.riskThreshold ?? 0.5,
      useLLMTier: vc?.useLLMTier !== false,
    };
    const verificationLayer =
      verificationConfig.useLLMTier === true
        ? createVerificationLayerWithRuntimeLlm(verificationConfig).pipe(
            // Same pattern as memoryLayer: satisfy LLM here so merge order does not
            // leave VerificationService construction without LLMService.
            Layer.provide(rateLimitedLlmLayer as Layer.Layer<LLMService>),
          )
        : createVerificationLayer({ ...verificationConfig, useLLMTier: false });
    runtime = Layer.merge(runtime, verificationLayer) as any;
  }

  if (options.enableCostTracking) {
    runtime = Layer.merge(runtime, createCostLayer(options.costTrackingOptions)) as any;
  }

  // Build tools layer first — reasoning may depend on it
  // MCP servers implicitly enable tools
  let toolsLayer: Layer.Layer<any, any> | null = null;
  const shouldEnableTools =
    options.enableTools ||
    (options.mcpServers && options.mcpServers.length > 0);
  if (shouldEnableTools) {
    // ToolService requires EventBus; ToolResultCache enables opt-in tool result caching
    const baseToolsLayer = createToolsLayer().pipe(Layer.provide(eventBusLayer));

    // If allowedTools is specified, wrap the ToolService with a filtering layer
    // that restricts listTools, getTool, and toFunctionCallingFormat to only
    // the whitelisted tool names. execute() also rejects non-allowed tools.
    if (options.allowedTools && options.allowedTools.length > 0) {
      const allowed = new Set(options.allowedTools);
      toolsLayer = Layer.effect(
        ToolService,
        Effect.gen(function* () {
          // Get the underlying ToolService from the base layer
          const base = yield* ToolService.pipe(Effect.provide(baseToolsLayer));

          return {
            execute: (input: import("@reactive-agents/tools").ToolInput) => {
              if (!allowed.has(input.toolName)) {
                return Effect.fail(
                  new ToolNotFoundError({
                    message: `Tool "${input.toolName}" is not in the allowed tools list`,
                    toolName: input.toolName,
                  }),
                );
              }
              return base.execute(input);
            },
            register: base.register,
            connectMCPServer: base.connectMCPServer,
            disconnectMCPServer: base.disconnectMCPServer,
            listTools: (filter?: { category?: string; source?: string; riskLevel?: string }) =>
              base.listTools(filter).pipe(
                Effect.map((tools) => tools.filter((t) => allowed.has(t.name))),
              ),
            getTool: (name: string) => {
              if (!allowed.has(name)) {
                return Effect.fail(
                  new ToolNotFoundError({
                    message: `Tool "${name}" is not in the allowed tools list`,
                    toolName: name,
                  }),
                );
              }
              return base.getTool(name);
            },
            toFunctionCallingFormat: () =>
              base.toFunctionCallingFormat().pipe(
                Effect.map((tools) => tools.filter((t) => allowed.has(t.name))),
              ),
            listMCPServers: base.listMCPServers,
            unregisterTool: base.unregisterTool,
          };
        }),
      ).pipe(Layer.provide(baseToolsLayer));
    } else {
      toolsLayer = baseToolsLayer;
    }

    const toolResultCacheLayer = ToolResultCacheLive();
    runtime = Layer.merge(runtime, toolsLayer) as any;
    runtime = Layer.merge(runtime, toolResultCacheLayer) as any;
  }

  // ── Experience learning layer (requires MemoryDatabase from memoryLayer) ──
  if (options.enableExperienceLearning) {
    runtime = Layer.merge(
      runtime,
      ExperienceStoreLive.pipe(Layer.provide(memoryLayer)),
    ) as any;
  }

  // ── Memory consolidation layer (requires MemoryDatabase from memoryLayer) ──
  if (options.enableMemoryConsolidation) {
    runtime = Layer.merge(
      runtime,
      MemoryConsolidatorServiceLive(options.consolidationConfig).pipe(Layer.provide(memoryLayer)),
    ) as any;
  }

  // ── Session persistence layer (requires MemoryDatabase from memoryLayer) ──
  // Only wired when sessionPersist is true. Without memory, SessionStoreService will not be
  // in the runtime and agent.session({ persist: true }) will silently no-op via Effect.serviceOption.
  if (options.sessionPersist) {
    runtime = Layer.merge(
      runtime,
      SessionStoreLive.pipe(Layer.provide(memoryLayer)),
    ) as any;
  }

  // Create PromptLayer once — shared by reasoning deps and the main runtime
  const promptLayer = options.enablePrompts ? createPromptLayer() : null;

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
              ...withoutStrategyIcsOverrides(options.reasoningOptions.strategies?.reactive),
              ...(options.maxIterations !== undefined
                ? { maxIterations: options.maxIterations }
                : {}),
              ...(options.reasoningOptions.parallelToolCalls === false
                ? { nextMovesPlanning: { ...defaultReasoningConfig.strategies.reactive.nextMovesPlanning, enabled: false } }
                : {}),
            },
            planExecute: {
              ...defaultReasoningConfig.strategies.planExecute,
              ...withoutStrategyIcsOverrides(options.reasoningOptions.strategies?.planExecute),
            },
            treeOfThought: {
              ...defaultReasoningConfig.strategies.treeOfThought,
              ...withoutStrategyIcsOverrides(options.reasoningOptions.strategies?.treeOfThought),
            },
            reflexion: {
              ...defaultReasoningConfig.strategies.reflexion,
              ...withoutStrategyIcsOverrides(options.reasoningOptions.strategies?.reflexion),
            },
          },
        }
      : defaultReasoningConfig;

    // ReasoningService requires LLMService, optionally ToolService + PromptService
    let reasoningDeps = rateLimitedLlmLayer;
    if (toolsLayer) {
      reasoningDeps = Layer.merge(rateLimitedLlmLayer, toolsLayer) as any;
    }
    if (promptLayer) {
      reasoningDeps = Layer.merge(reasoningDeps, promptLayer) as any;
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

  if (options.telemetryConfig) {
    const telemetryLayer = TelemetryCollectorLive(options.telemetryConfig).pipe(
      Layer.provide(eventBusLayer),
    );
    runtime = Layer.merge(runtime, telemetryLayer) as any;
  }

  // ── Structured logging tap — subscribes to EventBus and writes to configured output ──
  if (options.loggingConfig) {
    const { makeLoggerService } =
      require("@reactive-agents/observability") as typeof import("@reactive-agents/observability");
    const loggerCfg = options.loggingConfig;
    const loggerTapLayer = Layer.effectDiscard(
      Effect.gen(function* () {
        const logger = makeLoggerService(loggerCfg);
        const eb = yield* EventBus;

        type E<T extends AgentEvent["_tag"]> = Extract<AgentEvent, { _tag: T }>;

        yield* eb.on("AgentStarted", (event: E<"AgentStarted">) =>
          Effect.sync(() =>
            logger.info("[agent:started]", { agentId: event.agentId, taskId: event.taskId }),
          ),
        );

        yield* eb.on("AgentCompleted", (event: E<"AgentCompleted">) =>
          Effect.sync(() =>
            event.success
              ? logger.info("[agent:completed]", {
                  agentId: event.agentId,
                  taskId: event.taskId,
                  durationMs: event.durationMs,
                  totalTokens: event.totalTokens,
                  totalIterations: event.totalIterations,
                })
              : logger.warn("[agent:failed]", {
                  agentId: event.agentId,
                  taskId: event.taskId,
                  durationMs: event.durationMs,
                }),
          ),
        );

        yield* eb.on("ExecutionPhaseCompleted", (event: E<"ExecutionPhaseCompleted">) =>
          Effect.sync(() =>
            logger.debug(`[phase:${event.phase}]`, {
              taskId: event.taskId,
              durationMs: event.durationMs,
            }),
          ),
        );

        yield* eb.on("ToolCallCompleted", (event: E<"ToolCallCompleted">) =>
          Effect.sync(() => {
            if (event.success) {
              logger.info(`[tool:${event.toolName}]`, {
                taskId: event.taskId,
                durationMs: event.durationMs,
              });
            } else {
              logger.warn(`[tool:${event.toolName}:error]`, {
                taskId: event.taskId,
                durationMs: event.durationMs,
              });
            }
          }),
        );

        yield* eb.on("LLMRequestCompleted", (event: E<"LLMRequestCompleted">) =>
          Effect.sync(() =>
            logger.debug("[llm:completed]", {
              taskId: event.taskId,
              model: event.model,
              tokensUsed: event.tokensUsed,
              durationMs: event.durationMs,
            }),
          ),
        );

        yield* eb.on("GuardrailViolationDetected", (event: E<"GuardrailViolationDetected">) =>
          Effect.sync(() =>
            logger.warn("[guardrail:violation]", {
              taskId: event.taskId,
              blocked: event.blocked,
              violations: event.violations,
            }),
          ),
        );
      }),
    ).pipe(Layer.provide(eventBusLayer));
    runtime = Layer.merge(runtime, loggerTapLayer) as any;
  }

  // ── Health check service ──
  if (options.enableHealthCheck) {
    const { Health, makeHealthService } =
      require("@reactive-agents/health") as typeof import("@reactive-agents/health");
    const healthLayer = Layer.effect(
      Health,
      makeHealthService({ port: 0, agentName: options.agentId }),
    );
    runtime = Layer.merge(runtime, healthLayer) as any;
  }

  // ── Reactive Intelligence (entropy sensing) + optional skill resolver ──
  const skillResolverPaths =
    options.skills?.paths?.filter(
      (p): p is string => typeof p === "string" && p.trim().length > 0,
    ).map((p) => p.trim()) ?? [];
  const skillLayerForRi: SkillLayerConfig | undefined =
    skillResolverPaths.length > 0
      ? {
          resolver: {
            customPaths: skillResolverPaths,
            agentId: options.agentId,
            projectRoot: options.skillDiscoveryRoot ?? process.cwd(),
          },
        }
      : undefined;

  if (options.enableReactiveIntelligence) {
    runtime = Layer.merge(
      runtime,
      createReactiveIntelligenceLayer(
        options.reactiveIntelligenceOptions as any,
        undefined,
        skillLayerForRi,
      ),
    ) as any;
  } else if (skillLayerForRi?.resolver) {
    runtime = Layer.merge(runtime, makeSkillResolverService(skillLayerForRi.resolver)) as any;
  }

  if (options.enableInteraction) {
    // InteractionManager requires EventBus
    const interactionLayer = createInteractionLayer().pipe(
      Layer.provide(eventBusLayer),
    );
    runtime = Layer.merge(runtime, interactionLayer) as any;
  }

  if (promptLayer) {
    runtime = Layer.merge(runtime, promptLayer) as any;
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

// ── Light Runtime Options ───

/**
 * Configuration for a lightweight sub-agent runtime.
 *
 * By default, only Core, EventBus, LLM, ExecutionEngine (minimal), and optionally
 * Tools + Reasoning are included. The parent agent can toggle heavier layers
 * (memory, guardrails, observability, cost tracking) for sub-agents that need them.
 */
export interface LightRuntimeOptions {
  agentId: string;
  provider?: "anthropic" | "openai" | "ollama" | "gemini" | "litellm" | "test";
  model?: string;
  thinking?: boolean;
  temperature?: number;
  maxTokens?: number;
  maxIterations?: number;
  systemPrompt?: string;
  environmentContext?: Record<string, string>;
  testScenario?: TestTurn[];

  // Always-on for sub-agents
  enableReasoning?: boolean;
  enableTools?: boolean;
  allowedTools?: readonly string[];
  requiredTools?: { readonly tools?: readonly string[]; readonly adaptive?: boolean; readonly maxRetries?: number };
  reasoningOptions?: ReasoningOptions;
  contextProfile?: Partial<ContextProfile>;
  resultCompression?: ResultCompressionConfig;

  // Optional heavy layers — parent can toggle
  enableMemory?: boolean;
  enableGuardrails?: boolean;
  enableObservability?: boolean;
  enableCostTracking?: boolean;
  observabilityOptions?: ObservabilityOptions;
  guardrailsOptions?: import("./builder.js").GuardrailsOptions;
}

/**
 * Create a lightweight runtime for sub-agents and simple use cases.
 *
 * Compared to `createRuntime()`, this skips:
 * - MetricsCollector (auto-subscribed EventBus listener — overhead for short-lived agents)
 * - LifecycleHookRegistry (sub-agents don't fire lifecycle hooks)
 * - Memory system (unless parent explicitly enables it)
 * - All optional layers: Identity, Interaction, Prompts, Orchestration, Gateway, A2A,
 *   Health, ReactiveIntelligence, Telemetry, Logging, KillSwitch, BehavioralContracts
 *
 * The parent can toggle heavier layers (memory, guardrails, observability, cost tracking)
 * for sub-agents that need more capabilities.
 *
 * @param options - Light runtime configuration
 * @returns A composed Effect-TS Layer with minimal services
 */
export const createLightRuntime = (options: LightRuntimeOptions) => {
  const resolvedModel =
    options.model ||
    process.env.LLM_DEFAULT_MODEL ||
    (options.provider ? getProviderDefaultModel(options.provider) : undefined) ||
    "claude-sonnet-4-20250514";

  const config: ReactiveAgentsConfig = {
    ...defaultReactiveAgentsConfig(options.agentId),
    defaultModel: resolvedModel,
    provider: options.provider,
    thinking: options.thinking,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    memoryTier: "1",
    maxIterations: options.maxIterations ?? 4,
    enableGuardrails: options.enableGuardrails ?? false,
    enableVerification: false,
    enableCostTracking: options.enableCostTracking ?? false,
    enableAudit: false,
    enableKillSwitch: false,
    enableBehavioralContracts: false,
    enableSelfImprovement: false,
    systemPrompt: options.systemPrompt,
    environmentContext: options.environmentContext,
    observabilityVerbosity: options.observabilityOptions?.verbosity,
    logModelIO: options.observabilityOptions?.logModelIO,
    logPrefix: options.observabilityOptions?.logPrefix,
    contextProfile: options.contextProfile,
    defaultStrategy: options.reasoningOptions?.defaultStrategy,
    resultCompression: options.resultCompression,
    requiredTools: options.requiredTools
      ? {
          tools: options.requiredTools.tools ? [...options.requiredTools.tools] : undefined,
          adaptive: options.requiredTools.adaptive,
          maxRetries: options.requiredTools.maxRetries,
        }
      : undefined,
    adaptiveToolFiltering: false,
    allowedTools: options.allowedTools,
    enableMemory: options.enableMemory ?? false,
    enableExperienceLearning: false,
    enableMemoryConsolidation: false,
    reasoningOptions: options.reasoningOptions,
  };

  // ── Minimal required layers ──
  const eventBusLayer = EventBusLive;
  const coreLayer = CoreServicesLive;
  const llmLayer = createLLMProviderLayer(
    options.provider ?? "test",
    options.testScenario,
    resolvedModel,
    {
      thinking: options.thinking,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    },
  ) as Layer.Layer<LLMService>;

  // Lightweight memory — working memory only, no SQLite, no embeddings
  const memoryLayer = options.enableMemory
    ? Layer.unwrapEffect(
        Effect.gen(function* () {
          const llm = yield* LLMService;
          const bridgedLLM: MemoryLLM = {
            complete: (req) =>
              llm.complete({
                messages: req.messages.map((m) => ({
                  role: m.role as "user" | "assistant" | "system",
                  content: m.content,
                })),
                temperature: req.temperature,
                maxTokens: req.maxTokens,
              }).pipe(
                Effect.map((r) => ({
                  content: r.content,
                  usage: r.usage ? { totalTokens: r.usage.totalTokens } : undefined,
                })),
              ),
            embed: (texts, model) => llm.embed(texts, model),
          };
          return createMemoryLayer("1", { agentId: options.agentId }, bridgedLLM);
        }),
      ).pipe(Layer.provide(llmLayer))
    : createMemoryLayer("1", { agentId: options.agentId });

  // Minimal hooks layer (required by ExecutionEngine)
  const hookLayer = LifecycleHookRegistryLive;

  // MetricsCollector is still needed by ExecutionEngine but we skip the EventBus subscription
  // by providing it with an isolated EventBus (no listeners accumulating in the parent's bus)
  const metricsCollectorLayer = MetricsCollectorLive.pipe(
    Layer.provide(eventBusLayer),
  );

  const engineLayer = ExecutionEngineLive(config).pipe(
    Layer.provide(hookLayer),
    Layer.provide(metricsCollectorLayer),
  );

  let runtime = Layer.mergeAll(
    coreLayer,
    eventBusLayer,
    llmLayer,
    memoryLayer,
    hookLayer,
    engineLayer,
  );

  // ── Optional tools layer ──
  let toolsLayer: Layer.Layer<any, any> | null = null;
  if (options.enableTools) {
    const baseToolsLayer = createToolsLayer().pipe(Layer.provide(eventBusLayer));
    if (options.allowedTools && options.allowedTools.length > 0) {
      const allowed = new Set(options.allowedTools);
      toolsLayer = Layer.effect(
        ToolService,
        Effect.gen(function* () {
          const base = yield* ToolService.pipe(Effect.provide(baseToolsLayer));
          return {
            execute: (input: import("@reactive-agents/tools").ToolInput) => {
              if (!allowed.has(input.toolName)) {
                return Effect.fail(
                  new ToolNotFoundError({
                    message: `Tool "${input.toolName}" is not in the allowed tools list`,
                    toolName: input.toolName,
                  }),
                );
              }
              return base.execute(input);
            },
            register: base.register,
            connectMCPServer: base.connectMCPServer,
            disconnectMCPServer: base.disconnectMCPServer,
            listTools: (filter?: { category?: string; source?: string; riskLevel?: string }) =>
              base.listTools(filter).pipe(
                Effect.map((tools) => tools.filter((t) => allowed.has(t.name))),
              ),
            getTool: (name: string) => {
              if (!allowed.has(name)) {
                return Effect.fail(
                  new ToolNotFoundError({
                    message: `Tool "${name}" is not in the allowed tools list`,
                    toolName: name,
                  }),
                );
              }
              return base.getTool(name);
            },
            toFunctionCallingFormat: () =>
              base.toFunctionCallingFormat().pipe(
                Effect.map((tools) => tools.filter((t) => allowed.has(t.name))),
              ),
            listMCPServers: base.listMCPServers,
            unregisterTool: base.unregisterTool,
          };
        }),
      ).pipe(Layer.provide(baseToolsLayer));
    } else {
      toolsLayer = baseToolsLayer;
    }
    const toolResultCacheLayer = ToolResultCacheLive();
    runtime = Layer.merge(runtime, toolsLayer) as any;
    runtime = Layer.merge(runtime, toolResultCacheLayer) as any;
  }

  // ── Optional reasoning layer ──
  if (options.enableReasoning) {
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
              ...withoutStrategyIcsOverrides(options.reasoningOptions.strategies?.reactive),
              ...(options.maxIterations !== undefined
                ? { maxIterations: options.maxIterations }
                : {}),
              ...(options.reasoningOptions.parallelToolCalls === false
                ? { nextMovesPlanning: { ...defaultReasoningConfig.strategies.reactive.nextMovesPlanning, enabled: false } }
                : {}),
            },
            planExecute: {
              ...defaultReasoningConfig.strategies.planExecute,
              ...withoutStrategyIcsOverrides(options.reasoningOptions.strategies?.planExecute),
            },
            treeOfThought: {
              ...defaultReasoningConfig.strategies.treeOfThought,
              ...withoutStrategyIcsOverrides(options.reasoningOptions.strategies?.treeOfThought),
            },
            reflexion: {
              ...defaultReasoningConfig.strategies.reflexion,
              ...withoutStrategyIcsOverrides(options.reasoningOptions.strategies?.reflexion),
            },
          },
        }
      : defaultReasoningConfig;

    let reasoningDeps = llmLayer as Layer.Layer<any>;
    if (toolsLayer) {
      reasoningDeps = Layer.merge(llmLayer, toolsLayer) as any;
    }
    const reasoningLayer = createReasoningLayer(reasoningConfig).pipe(
      Layer.provide(reasoningDeps),
    );
    runtime = Layer.merge(runtime, reasoningLayer) as any;
  }

  // ── Optional heavy layers (parent-toggleable) ──

  if (options.enableGuardrails) {
    const gc = options.guardrailsOptions;
    const guardrailConfig = gc
      ? {
          enableInjectionDetection: gc.injection ?? true,
          enablePiiDetection: gc.pii ?? true,
          enableToxicityDetection: gc.toxicity ?? true,
        }
      : undefined;
    runtime = Layer.merge(runtime, createGuardrailsLayer(guardrailConfig)) as any;
  }

  if (options.enableCostTracking) {
    runtime = Layer.merge(runtime, createCostLayer()) as any;
  }

  if (options.enableObservability) {
    const obsExporterConfig = {
      verbosity: options.observabilityOptions?.verbosity,
      live: options.observabilityOptions?.live,
    };
    const obsLayer = createObservabilityLayer(
      obsExporterConfig,
      metricsCollectorLayer,
    );
    runtime = Layer.merge(runtime, obsLayer) as any;
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
