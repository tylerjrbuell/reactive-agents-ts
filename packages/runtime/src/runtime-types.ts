/**
 * Public runtime type definitions for createRuntime + createLightRuntime.
 *
 * Hoisted from runtime.ts (W26-C redo) so the host file stays below the
 * 1500-LOC threshold from #76 and so the type surface can be imported
 * without pulling in the createRuntime factory's transitive dependencies.
 *
 * runtime.ts re-exports `MCPServerConfig`, `RuntimeOptions`, and
 * `LightRuntimeOptions` for backward compatibility with all existing
 * import sites (builder.ts and external consumers).
 */
import type { Layer } from "effect";
import type { TestTurn } from "@reactive-agents/llm-provider";
import type { ReasoningOptions } from "./types.js";
import type { ObservabilityOptions } from "./builder.js";
import type { ContextProfile } from "@reactive-agents/reasoning";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import type { TelemetryConfig } from "@reactive-agents/observability";
import type { KernelMetaToolsConfig } from "@reactive-agents/reasoning";

/**
 * Configuration for connecting to a Model Context Protocol (MCP) server.
 *
 * MCP servers expose tools via a standardized protocol. The transport type determines
 * how the agent communicates with the server (process stdio, HTTP SSE, or WebSocket).
 *
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
   * Context window size (in tokens) for local providers (Ollama `options.num_ctx`).
   *
   * Provider-agnostic: only Ollama/local maps this to its request; hosted
   * providers (Anthropic/OpenAI/Gemini) have a fixed model context and ignore
   * it. Ranks above the capability-resolved default (32K for known local
   * models), so set this to widen the window when you have GPU headroom, or
   * narrow it on a constrained machine.
   *
   * Default: undefined (capability-driven resolution wins)
   */
  numCtx?: number;

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
   * Declarative budget caps consulted by the Arbitrator's pre-intent guard
   * (Issue #128 / North Star v5.0 Pillar 6). Populated by the builder's
   * `.withBudget()` method; threaded into `ReactiveAgentsConfig.budgetLimits`
   * and ultimately `KernelInput.budgetLimits`. When `tokenLimit` or
   * `costLimit` is reached, the Arbitrator returns exit-failure with
   * `terminatedBy="budget_exceeded"`.
   *
   * Default: undefined (no budget guard).
   */
  budgetLimits?: import("./builder.js").BudgetLimits;

  /**
   * Opt-in numeric evidence-grounding. Absent ⇒ grounding off (default).
   * Populated by `.withGrounding()`; threaded into `KernelInput.grounding`.
   * When on, figures in the final answer are checked against the FULL tool
   * data with rounding tolerance.
   *
   * Default: undefined (grounding off).
   */
  grounding?: import("./builder/types.js").GroundingOptions;

  /**
   * Fabrication-guard mode. Absent ⇒ `"block"` (always-on). Populated by
   * `.withFabricationGuard()`; threaded into `KernelInput.fabricationGuard`.
   * The verifier rejects (or warns on) empirical performance measurements
   * (benchmark timings / % speed-ups) absent from the tool-observation corpus.
   */
  fabricationGuard?: import("@reactive-agents/reasoning").FabricationGuardMode;

  /**
   * Stall / no-progress policy — bounds wasted iterations when the model
   * ignores required-tool nudges. Absent ⇒ sensible defaults
   * (tolerate 2 ignored nudges, escalate nudge wording). Set via
   * `.withStallPolicy()`; threaded into `KernelInput.stallPolicy`.
   */
  stallPolicy?: import("@reactive-agents/reasoning").StallPolicy;

  /**
   * Opt-in durable run persistence. Absent ⇒ off (zero overhead, default).
   * Populated by `.withDurableRuns()`; threaded into
   * `ReactiveAgentsConfig.durableRuns`. When set, the runtime persists a
   * serialized kernel-state snapshot to a SQLite RunStore every
   * `checkpointEvery` iterations (the write half of crash-resume).
   *
   * Default: undefined (no persistence).
   */
  durableRuns?: import("./builder/types.js").DurableRunsOptions;

  /**
   * Opt-in durable HITL approval policy (Phase D). Resolved from
   * `.withApprovalPolicy()`: `tools` is the explicit gated-name list, `requireFor`
   * an optional predicate, `mode` "detach" (durable pause) or "block" (in-process).
   * Threaded into `KernelInput.approvalPolicy` by `reasoning-think.ts`. Absent ⇒
   * no durable approval gate.
   */
  approvalPolicy?: {
    readonly mode: "detach" | "block";
    readonly tools: readonly string[];
    readonly requireFor?: (ctx: { toolName: string; iteration: number }) => boolean;
  };

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
    accessControl?: {
      accessPolicy?: string;
      allowedSenders?: readonly string[];
      blockedSenders?: readonly string[];
      unknownSenderAction?: string;
      replyToUnknown?: string;
      mode?: string;
      sessionTtlDays?: number;
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
   * Default: enabled with `defaultCircuitBreakerConfig` (5 failures → 30s
   * cooldown). Pass `false` to disable entirely; pass a partial config to
   * override specific thresholds while keeping the breaker active.
   */
  circuitBreakerConfig?: Partial<import("@reactive-agents/llm-provider").CircuitBreakerConfig> | false;

  /**
   * Required tools configuration — tools that MUST be called before the agent
   * can declare success. Supports explicit tool lists, adaptive LLM inference,
   * or both.
   *
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
   *
   * Default: undefined (all tools available)
   */
  allowedTools?: readonly string[];

  /**
   * Soft-focus list of tool names. When set, only these tools are shown in the
   * LLM-facing prompt schema — but execution of other tools is NOT blocked
   * (unlike `allowedTools`, which is a hard restriction). Priority:
   * focusedTools (soft guidance) → allowedTools (hard restriction) → all tools.
   *
   * Default: undefined (no soft focus)
   */
  focusedTools?: readonly string[];

  /**
   * Tool names a `.withContract({ tools: [{ kind: "forbidden", name }] })`
   * declares MUST NOT be visible to the LLM (TaskContract definition,
   * task-contract.ts:33-34). EXCLUDED from the execute-time exposed tool
   * schema in `prepareReasoningToolSchemas`, applied AFTER MCP/discover-tools
   * discovery so discovered forbidden tools are also removed. Derived at
   * construction via `contractForbiddenTools` (realization-plan P2b).
   *
   * Default: undefined (no contract-forbidden tools)
   */
  forbiddenTools?: readonly string[];

  /**
   * Enable adaptive tool filtering. When true, only task-relevant tools are shown
   * to the agent at reasoning time — reducing context noise for small models.
   * All tools remain callable by exact name even if not shown.
   *
   * Uses heuristic keyword + description matching to identify relevant tools.
    * Any tools listed in `ALWAYS_INCLUDE_TOOLS` (from `@reactive-agents/tools`) are always merged into the filtered set.
   *
   *
   * Default: false (all tools shown)
   */
  adaptiveToolFiltering?: boolean;

  /**
   * Opt-in for built-in tools in the LLM-facing schema. Built-ins
   * (file-write, file-read, web-search, http-get, code-execute, git-cli,
   * gh-cli, gws-cli, crypto-price) are registered unconditionally so
   * `discover-tools` can surface them at runtime, but excluded from the
   * base schema by default. Set to `true` for legacy behavior (all
   * built-ins shown), or pass an array of names for an explicit subset.
   *
   *
   * Default: undefined (no built-ins in base schema)
   */
  builtins?: boolean | readonly string[];

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

  /** Verification pass after the initial reasoning result. "reflect" = one extra LLM review call (the only supported mode). */
  verificationStep?: { mode: "reflect"; prompt?: string };

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
   * Persist learned skills across sessions via the memory package's
   * `SkillStoreServiceLive` layer. When wired, `agent.skills()` returns
   * stored `SkillRecord[]` and the reactive-intelligence learning engine's
   * skill-persistence write path (`learning-engine.ts:170`) activates.
   *
   * Policy: wire-when-memory-enabled. The service requires `MemoryDatabase`
   * from the memory layer, so this flag is honored only when
   * `enableMemory: true` (or `.withMemory(...)`). When memory is enabled
   * and `skillPersistence` is unset, the layer is wired by default
   * (graduates M6 "learning transfers within session but doesn't persist"
   * to KEEP). Pass `false` to disable explicitly.
   *
   * Without memory, this flag is ignored and `agent.skills()` returns `[]`
   * via the existing `Effect.serviceOption` fallback at
   * `reactive-agent.ts:370`.
   *
   * Default: `true` when memory is enabled, otherwise off.
   *
   */
  skillPersistence?: boolean;

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

  /**
   * Enable lean harness mode (Pruning Principle, NLAH arXiv:2603.25723 §9).
   *
   * Bypasses the terminal verifier gate (substitutes a no-op verifier) and
   * disables strategy switching. On frontier models these two mechanisms cost
   * ~13.6× tokens while producing outcomes 0.8 pp worse than lean config.
   *
   * Default: `false`
   */
  leanHarness?: boolean;

  /**
   * Compiled harness pipeline for Wave B chokepoints.
   * Produced by `new HarnessPipeline(registrationHarness._collected)` in
   * `runtime-construction.ts` when `.withHarness()` registrations are present.
   */
  harnessPipeline?: import("@reactive-agents/core").HarnessPipeline;
}

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
  /** Context window size for local providers (Ollama `options.num_ctx`). */
  numCtx?: number;
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
