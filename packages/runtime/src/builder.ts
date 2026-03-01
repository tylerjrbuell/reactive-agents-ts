import { Effect, Layer, Schema, ManagedRuntime } from "effect";
import { createRuntime } from "./runtime.js";
import type { MCPServerConfig } from "./runtime.js";
import { ExecutionEngine } from "./execution-engine.js";
import type { LifecycleHook, ExecutionContext } from "./types.js";
import type { RuntimeErrors } from "./errors.js";
import type { ReasoningConfig, ContextProfile } from "@reactive-agents/reasoning";
import type { ToolDefinition, ResultCompressionConfig } from "@reactive-agents/tools";
import type { RemoteAgentClient } from "@reactive-agents/tools";
import type { PromptTemplate } from "@reactive-agents/prompts";
import type { Task, TaskResult } from "@reactive-agents/core";
import type { TaskError } from "@reactive-agents/core";
import { generateTaskId, AgentId } from "@reactive-agents/core";
import type { AgentEvent } from "@reactive-agents/core";
import { EventBus } from "@reactive-agents/core";
import { KillSwitchService } from "@reactive-agents/guardrails";

// ─── Provider Types ──────────────────────────────────────────────────────────

/**
 * Name of the LLM provider to use.
 *
 * - `"anthropic"` — Claude models via Anthropic API (requires `ANTHROPIC_API_KEY`)
 * - `"openai"` — GPT models via OpenAI API (requires `OPENAI_API_KEY`)
 * - `"ollama"` — Local models via Ollama (no API key needed)
 * - `"gemini"` — Google Gemini models (requires `GOOGLE_API_KEY`)
 * - `"litellm"` — LiteLLM proxy for 40+ provider models
 * - `"test"` — Mock LLM for testing (uses `withTestResponses()`)
 */
export type ProviderName = "anthropic" | "openai" | "ollama" | "gemini" | "litellm" | "test";

// ─── Optional Parameter Types ─────────────────────────────────────────────────

/**
 * Agent persona for steering behavior — a structured alternative to raw system prompts.
 *
 * Provides a type-safe way to define agent characteristics (role, background, instructions, tone)
 * that get composed into the system prompt. When both persona and system prompt are provided,
 * the persona is prepended to the system prompt.
 *
 * @example
 * ```typescript
 * const agent = await ReactiveAgents.create()
 *   .withPersona({
 *     role: "Data Analyst",
 *     background: "Expert in statistical analysis and data visualization",
 *     instructions: "Always check data quality before analysis",
 *     tone: "professional and technical"
 *   })
 *   .build();
 * ```
 */
export interface AgentPersona {
  /** Display name of the agent (defaults to builder `.withName()` value). Default: undefined */
  readonly name?: string;
  /** What this agent does — injected as "Role:" section of system prompt. Default: undefined */
  readonly role?: string;
  /** Background context or expertise description — injected as "Background:" section. Default: undefined */
  readonly background?: string;
  /** Explicit behavioral instructions — injected as "Instructions:" section. Default: undefined */
  readonly instructions?: string;
  /** Tone/style guidance (e.g., "professional", "concise", "friendly") — injected as "Tone:" section. Default: undefined */
  readonly tone?: string;
}

/**
 * Options for `.withReasoning()` — all fields optional, merged with framework defaults.
 *
 * Allows fine-tuning of the reasoning layer, including strategy selection and per-strategy parameters.
 *
 * @example
 * ```typescript
 * agent
 *   .withReasoning({
 *     defaultStrategy: "tree-of-thought",
 *     adaptive: { confidenceThreshold: 0.75 }
 *   })
 * ```
 */
export interface ReasoningOptions {
  /** Default reasoning strategy — one of: `"reactive"`, `"plan-execute-reflect"`, `"tree-of-thought"`, `"reflexion"`, `"adaptive"`. Default: "reactive" */
  readonly defaultStrategy?: ReasoningConfig["defaultStrategy"];
  /** Per-strategy configuration overrides (partial, merged with defaults). Default: {} */
  readonly strategies?: Partial<ReasoningConfig["strategies"]>;
  /** Adaptive reasoning settings (e.g., confidence thresholds, backoff strategies). Default: {} */
  readonly adaptive?: Partial<ReasoningConfig["adaptive"]>;
}

/**
 * Options for `.withTools()` — register custom tools with the agent.
 *
 * Custom tools are registered in addition to built-in tools (file-write, file-read, web-search, etc.).
 * Tools can also be connected via MCP servers.
 *
 * @example
 * ```typescript
 * agent
 *   .withTools({
 *     tools: [
 *       {
 *         definition: { name: "my-tool", description: "...", parameters: [...] },
 *         handler: (args) => Effect.succeed({ result: "done" })
 *       }
 *     ]
 *   })
 * ```
 */
export interface ToolsOptions {
  /** Array of custom tool definitions and handlers to register. Each entry includes the tool definition (name, description, parameters) and an async handler function. Default: [] */
  readonly tools?: ReadonlyArray<{
    readonly definition: ToolDefinition;
    readonly handler: (args: Record<string, unknown>) => Effect.Effect<unknown>;
  }>;
  /** Tool result compression config — controls preview size, scratchpad overflow, and pipe transforms. */
  readonly resultCompression?: ResultCompressionConfig;
}

/**
 * Options for `.withPrompts()` — register custom prompt templates.
 *
 * Custom templates are registered in addition to built-in prompt library templates.
 * Templates can be referenced by name in reasoning strategies and tool descriptions.
 *
 * @example
 * ```typescript
 * agent
 *   .withPrompts({
 *     templates: [
 *       { id: "custom-analysis", content: "Analyze the following...", tier: "frontier" }
 *     ]
 *   })
 * ```
 */
export interface PromptsOptions {
  /** Array of custom prompt templates to register. Each template includes an ID, content, and optionally a tier specification. Default: [] */
  readonly templates?: ReadonlyArray<PromptTemplate>;
}

/**
 * Options for `.withObservability()` — configure observability verbosity, live streaming, and exporters.
 *
 * Controls how much output is displayed during agent execution and whether logs are streamed in real-time
 * or exported to a file. The metrics dashboard automatically shows on completion at "normal" verbosity or higher.
 *
 * @example
 * ```typescript
 * agent
 *   .withObservability({
 *     verbosity: "verbose",
 *     live: true,
 *     file: "./logs/agent.jsonl"
 *   })
 * ```
 */
export interface ObservabilityOptions {
  /**
   * Output verbosity level:
   * - `"minimal"` — no output except final result
   * - `"normal"` — metrics dashboard only (recommended)
   * - `"verbose"` — dashboard + structured phase logs
   * - `"debug"` — everything without truncation, full context dumps
   *
   * Default: `"normal"`
   */
  readonly verbosity?: "minimal" | "normal" | "verbose" | "debug";
  /**
   * Stream logs in real-time as the agent executes each phase.
   * When enabled, phase logs appear immediately; otherwise they are buffered until the final dashboard.
   *
   * Default: `false`
   */
  readonly live?: boolean;
  /**
   * Path for JSONL file export. Each log entry is written as a JSON object on a separate line.
   * Useful for post-processing or long-term metric archival.
   *
   * Default: undefined (no file export)
   */
  readonly file?: string;
}

/**
 * Options for `.withA2A()` — configure the Agent-to-Agent (A2A) protocol server.
 *
 * When enabled, the agent exposes a JSON-RPC 2.0 HTTP server that allows other agents
 * to invoke it remotely. The agent becomes discoverable via Agent Cards at `/.well-known/agent.json`.
 *
 * @example
 * ```typescript
 * agent
 *   .withA2A({ port: 8000, basePath: "/api/agents" })
 * ```
 */
export interface A2AOptions {
  /**
   * HTTP port for the A2A server.
   *
   * Default: `3000`
   */
  readonly port?: number;
  /**
   * Base path for A2A endpoints (e.g., `/api/agents` → `http://localhost:3000/api/agents/rpc`).
   *
   * Default: `/` (root)
   */
  readonly basePath?: string;
}

/**
 * Options for `.withGateway()` — configure the persistent autonomous agent harness.
 *
 * Enables heartbeats, crons, webhooks, and a composable policy engine for proactive agent behavior.
 * The gateway operates as deterministic infrastructure — LLM calls only happen when intelligence is needed.
 *
 * @example
 * ```typescript
 * agent.withGateway({
 *   heartbeat: { intervalMs: 1800000, policy: "adaptive" },
 *   crons: [{ schedule: "0 9 * * MON", instruction: "Review PRs" }],
 *   policies: { dailyTokenBudget: 50000, maxActionsPerHour: 20 },
 * })
 * ```
 */
export interface GatewayOptions {
  readonly heartbeat?: {
    readonly intervalMs?: number;
    readonly policy?: "always" | "adaptive" | "conservative";
    readonly instruction?: string;
    readonly maxConsecutiveSkips?: number;
  };
  readonly crons?: readonly {
    readonly schedule: string;
    readonly instruction: string;
    readonly agentId?: string;
    readonly priority?: "low" | "normal" | "high" | "critical";
    readonly enabled?: boolean;
  }[];
  readonly webhooks?: readonly {
    readonly path: string;
    readonly adapter: string;
    readonly secret?: string;
    readonly events?: readonly string[];
  }[];
  readonly policies?: {
    readonly dailyTokenBudget?: number;
    readonly maxActionsPerHour?: number;
    readonly heartbeatPolicy?: "always" | "adaptive" | "conservative";
    readonly mergeWindowMs?: number;
    readonly requireApprovalFor?: readonly string[];
  };
  readonly port?: number;
}

/**
 * Options for `.withAgentTool()` — register a local or remote agent as a callable tool.
 *
 * Allows this agent to spawn sub-agents (either locally or via remote A2A invocation) that
 * run in isolated contexts and return results. Sub-agents inherit the parent's provider/model by default
 * but can override them. Local sub-agents do NOT inherit the spawn-agent tool unless explicitly given it.
 *
 * @example
 * ```typescript
 * agent
 *   .withAgentTool("researcher", {
 *     name: "Research Agent",
 *     description: "Gathers information and synthesizes findings",
 *     provider: "anthropic",
 *     model: "claude-opus-4-20250514",
 *     tools: ["web-search", "file-write"],
 *     maxIterations: 15
 *   })
 * ```
 */
export interface AgentToolOptions {
  /**
   * Name of the tool as it appears in the agent's tool registry.
   * The LLM can invoke it by name, e.g., `web_search` or `researcher`.
   */
  readonly name: string;
  /**
   * Configuration for a local sub-agent (mutually exclusive with `remoteUrl`).
   * If provided, a new agent instance is created and run in this process.
   */
  readonly agent?: {
    /** Name of the sub-agent (displayed in logs). */
    readonly name: string;
    /** Description of what this sub-agent does (shown to the parent LLM). Default: auto-generated from name */
    readonly description?: string;
    /** LLM provider for the sub-agent (inherits parent's if omitted). Default: parent's provider */
    readonly provider?: string;
    /** Model for the sub-agent (inherits parent's if omitted). Default: parent's model */
    readonly model?: string;
    /** List of tool names this sub-agent can use (e.g., `["web-search", "file-write"]`). Default: no tools */
    readonly tools?: readonly string[];
    /** Maximum reasoning iterations for the sub-agent. Default: 5 */
    readonly maxIterations?: number;
    /** System prompt for the sub-agent. Default: empty */
    readonly systemPrompt?: string;
    /** Persona to steer the sub-agent's behavior (composed into system prompt). Default: undefined */
    readonly persona?: AgentPersona;
  };
  /**
   * URL of a remote A2A server (mutually exclusive with `agent`).
   * If provided, tool invocations are sent as JSON-RPC calls to the remote agent.
   *
   * Default: undefined (local agent)
   */
  readonly remoteUrl?: string;
}

// ─── Result Types ────────────────────────────────────────────────────────────

/**
 * Metadata about an agent execution result.
 *
 * Captures timing, costs, token usage, and execution details for observability and analysis.
 */
export interface AgentResultMetadata {
  /** Total wall-clock duration in milliseconds. */
  readonly duration: number;
  /** Estimated cost in USD (calculated from token count). */
  readonly cost: number;
  /** Total tokens consumed by the LLM for this execution. */
  readonly tokensUsed: number;
  /** Name of the reasoning strategy that was used (e.g., "reactive", "tree-of-thought"). Default: undefined */
  readonly strategyUsed?: string;
  /** Number of reasoning iterations/steps taken to complete the task. */
  readonly stepsCount: number;
}

/**
 * Result of a completed agent execution.
 *
 * Includes the final output, success status, task ID, and execution metadata
 * for full observability of what the agent did and how long it took.
 *
 * @example
 * ```typescript
 * const result = await agent.run("What is 2+2?");
 * console.log(result.output);           // "4"
 * console.log(result.success);          // true
 * console.log(result.metadata.duration); // 1250 (ms)
 * console.log(result.metadata.cost);    // 0.00123 (USD)
 * ```
 */
export interface AgentResult {
  /** The final output/answer produced by the agent. */
  readonly output: string;
  /** Whether the execution completed successfully (true) or failed (false). */
  readonly success: boolean;
  /** Unique ID for this execution task. */
  readonly taskId: string;
  /** ID of the agent that performed the execution. */
  readonly agentId: string;
  /** Metadata about the execution (duration, cost, tokens, strategy, steps). */
  readonly metadata: AgentResultMetadata;
}

// ─── Persona Composition Helper ───────────────────────────────────────────────

/**
 * Compose an AgentPersona into a structured system prompt.
 *
 * Builds a multi-section prompt with Role, Background, Instructions, and Tone (if provided).
 * Empty sections are omitted. This is used internally during agent build to merge persona
 * configuration with explicit system prompts.
 *
 * @param persona - The agent persona to compose
 * @param agentName - Name of the agent (for logging/reference, not included in output)
 * @returns A formatted system prompt string with persona sections
 */
function composePersonaToSystemPrompt(persona: AgentPersona, agentName: string): string {
  const sections: string[] = [];

  // Role (required-ish for personas, but we'll include if set)
  if (persona.role) {
    sections.push(`Role: ${persona.role}`);
  }

  // Background
  if (persona.background) {
    sections.push(`Background: ${persona.background}`);
  }

  // Instructions
  if (persona.instructions) {
    sections.push(`Instructions: ${persona.instructions}`);
  }

  // Tone
  if (persona.tone) {
    sections.push(`Tone: ${persona.tone}`);
  }

  return sections.join("\n\n");
}

// ─── ReactiveAgents Namespace ────────────────────────────────────────────────

/**
 * Factory for creating agent builders.
 * Entry point for the Reactive Agents builder API.
 *
 * @example
 * ```typescript
 * const agent = await ReactiveAgents.create()
 *   .withName("my-assistant")
 *   .withProvider("anthropic")
 *   .withModel("claude-opus-4-20250514")
 *   .withReasoning()
 *   .withTools()
 *   .build();
 * ```
 */
export const ReactiveAgents = {
  /**
   * Create a new agent builder with defaults.
   * All builder methods are optional; no configuration is required at creation time.
   *
   * @returns A new `ReactiveAgentBuilder` instance
   */
  create: (): ReactiveAgentBuilder => new ReactiveAgentBuilder(),
};

/**
 * Fluent builder for configuring and instantiating Reactive Agents.
 *
 * All builder methods return `this` for method chaining. Call `.build()` or `.buildEffect()`
 * when configuration is complete to instantiate the agent.
 *
 * @example
 * ```typescript
 * const agent = await ReactiveAgents.create()
 *   .withName("analyzer")
 *   .withProvider("anthropic")
 *   .withModel("claude-opus-4-20250514")
 *   .withReasoning({ defaultStrategy: "tree-of-thought" })
 *   .withTools()
 *   .withGuardrails()
 *   .withObservability({ verbosity: "normal", live: true })
 *   .build();
 * ```
 */
export class ReactiveAgentBuilder {
  private _name: string = "agent";
  private _provider: ProviderName = "test";
  private _model?: string;
  private _memoryTier: "1" | "2" = "1";
  private _hooks: LifecycleHook[] = [];
  private _maxIterations: number = 10;
  private _enableGuardrails: boolean = false;
  private _enableVerification: boolean = false;
  private _enableCostTracking: boolean = false;
  private _enableAudit: boolean = false;
  private _enableReasoning: boolean = false;
  private _reasoningOptions?: ReasoningOptions;
  private _enableTools: boolean = false;
  private _toolsOptions?: ToolsOptions;
  private _resultCompression?: ResultCompressionConfig;
  private _enableIdentity: boolean = false;
  private _enableObservability: boolean = false;
  private _observabilityOptions?: ObservabilityOptions;
  private _enableInteraction: boolean = false;
  private _enablePrompts: boolean = false;
  private _promptsOptions?: PromptsOptions;
  private _enableOrchestration: boolean = false;
  private _testResponses?: Record<string, string>;
  private _extraLayers?: Layer.Layer<any, any>;
  private _mcpServers: MCPServerConfig[] = [];
  private _systemPrompt?: string;
  private _a2aOptions?: A2AOptions;
  private _gatewayOptions?: GatewayOptions;
  private _agentTools: AgentToolOptions[] = [];
  private _contextProfile?: Partial<ContextProfile>;
  private _allowDynamicSubAgents: boolean = false;
  private _dynamicSubAgentOptions?: { maxIterations?: number };
  private _persona?: AgentPersona;
  private _enableKillSwitch: boolean = false;
  private _enableBehavioralContracts: boolean = false;
  private _behavioralContract?: import("@reactive-agents/guardrails").BehavioralContract;
  private _enableSelfImprovement: boolean = false;
  private _enableEvents: boolean = false;

  // ─── Identity ───

  /**
   * Set the agent's name — used for identification and logging.
   *
   * @param name - Display name for the agent
   * @returns `this` for chaining
   * @example
   * ```typescript
   * builder.withName("my-assistant")
   * ```
   */
  withName(name: string): this {
    this._name = name;
    return this;
  }

  /**
   * Set the agent's persona — a structured way to define behavior and characteristics.
   *
   * The persona is composed into the system prompt, providing guidance on role, background,
   * instructions, and tone. When combined with an explicit system prompt, the persona
   * is prepended before the custom prompt.
   *
   * @param persona - AgentPersona with role, background, instructions, and/or tone
   * @returns `this` for chaining
   * @example
   * ```typescript
   * builder.withPersona({
   *   role: "Data Scientist",
   *   background: "Expert in statistical analysis",
   *   instructions: "Always validate assumptions",
   *   tone: "professional and rigorous"
   * })
   * ```
   */
  withPersona(persona: AgentPersona): this {
    this._persona = persona;
    return this;
  }

  // ─── System Prompt ───

  /**
   * Set a custom system prompt to guide the agent's behavior.
   *
   * If both system prompt and persona are provided, the persona is prepended to the system prompt.
   * The system prompt is passed to the LLM with every request.
   *
   * @param prompt - Custom system prompt text
   * @returns `this` for chaining
   * @example
   * ```typescript
   * builder.withSystemPrompt("You are a helpful coding assistant...")
   * ```
   */
  withSystemPrompt(prompt: string): this {
    this._systemPrompt = prompt;
    return this;
  }

  // ─── A2A ────────────────────────────────────────────────────────────────────

  /**
   * Enable Agent-to-Agent (A2A) protocol server for remote agent invocation.
   *
   * When enabled, the agent exposes a JSON-RPC 2.0 HTTP endpoint at `/.well-known/agent.json`
   * that allows other agents or services to discover and invoke this agent remotely.
   *
   * @param options - A2A configuration (port, basePath)
   * @returns `this` for chaining
   * @example
   * ```typescript
   * builder.withA2A({ port: 8000 })
   * ```
   */
  withA2A(options?: A2AOptions): this {
    this._a2aOptions = options ?? { port: 3000 };
    return this;
  }

  // ─── Gateway ────────────────────────────────────────────────────────────────

  /**
   * Enable the persistent gateway for autonomous agent behavior.
   *
   * Configures heartbeats (adaptive by default), cron schedules, webhook endpoints,
   * and a composable policy engine. The gateway is deterministic infrastructure —
   * it only invokes the LLM when intelligence is genuinely needed.
   *
   * @param options - Gateway configuration (heartbeat, crons, webhooks, policies)
   * @returns `this` for chaining
   * @example
   * ```typescript
   * builder.withGateway({
   *   heartbeat: { intervalMs: 1800000, policy: "adaptive" },
   *   crons: [{ schedule: "0 9 * * MON", instruction: "Review PRs" }],
   *   policies: { dailyTokenBudget: 50000 },
   * })
   * ```
   */
  withGateway(options?: GatewayOptions): this {
    this._gatewayOptions = options ?? {};
    return this;
  }

  // ─── Agent Tools ─────────────────────────────────────────────────────────────

  /**
   * Register a local agent as a callable tool for real sub-agent delegation.
   *
   * The sub-agent runs in an isolated context with its own reasoning loop.
   * It inherits the parent's provider and model by default but can override them.
   * Sub-agents do NOT automatically inherit the spawn-agent tool.
   *
   * @param name - Name of the tool (how the LLM invokes it)
   * @param agent - Sub-agent configuration
   * @returns `this` for chaining
   * @example
   * ```typescript
   * builder.withAgentTool("researcher", {
   *   name: "Research Agent",
   *   description: "Gathers and synthesizes information",
   *   maxIterations: 15
   * })
   * ```
   */
  withAgentTool(name: string, agent: {
    name: string;
    description?: string;
    provider?: string;
    model?: string;
    tools?: readonly string[];
    maxIterations?: number;
    systemPrompt?: string;
    persona?: AgentPersona;
  }): this {
    this._agentTools.push({ name, agent });
    return this;
  }

  /**
   * Allow this agent to dynamically spawn sub-agents at runtime via the `spawn-agent` tool.
   *
   * Sub-agents run in a clean context window (no parent history) using the parent's provider
   * and model by default. The parent LLM can generate parameters to steer spawned agents.
   * Recursion depth is capped at 3; spawned agents do NOT inherit the spawn-agent tool
   * unless explicitly given it.
   *
   * @param options - Optional configuration (maxIterations for spawned agents)
   * @returns `this` for chaining
   * @example
   * ```typescript
   * builder.withDynamicSubAgents({ maxIterations: 8 })
   * ```
   */
  withDynamicSubAgents(options?: { maxIterations?: number }): this {
    this._allowDynamicSubAgents = true;
    this._dynamicSubAgentOptions = options;
    return this;
  }

  /**
   * Register a remote A2A agent as a callable tool for distributed agent networks.
   *
   * The tool invocations are sent as JSON-RPC 2.0 POST requests to the remote agent's
   * endpoint. Responses are unpacked and returned to the parent agent.
   *
   * @param name - Name of the tool (how the LLM invokes it)
   * @param remoteUrl - Base URL of the remote A2A agent (e.g., `http://localhost:8000`)
   * @returns `this` for chaining
   * @example
   * ```typescript
   * builder.withRemoteAgent("remote-analyst", "http://remote-agent:8000")
   * ```
   */
  withRemoteAgent(name: string, remoteUrl: string): this {
    this._agentTools.push({ name, remoteUrl });
    return this;
  }

  // ─── Model & Provider ───

  /**
   * Set the LLM model to use for this agent.
   *
   * Examples: `"claude-opus-4-20250514"`, `"gpt-4-turbo"`, `"mistral-large"`, `"gemini-2.0-flash"`
   *
   * @param model - Model identifier (provider-specific)
   * @returns `this` for chaining
   * @example
   * ```typescript
   * builder.withModel("claude-opus-4-20250514")
   * ```
   */
  withModel(model: string): this {
    this._model = model;
    return this;
  }

  /**
   * Set the LLM provider for the agent.
   *
   * @param provider - One of: `"anthropic"`, `"openai"`, `"ollama"`, `"gemini"`, `"litellm"`, or `"test"`
   * @returns `this` for chaining
   * @example
   * ```typescript
   * builder.withProvider("anthropic")
   * ```
   */
  withProvider(
    provider: ProviderName,
  ): this {
    this._provider = provider;
    return this;
  }

  // ─── Memory ───

  /**
   * Set the memory tier for the agent.
   *
   * - `"1"` — Lightweight memory (working memory only, minimal episodic storage)
   * - `"2"` — Full memory system (working, episodic, procedural, semantic with embeddings)
   *
   * @param tier - Memory tier (`"1"` or `"2"`)
   * @returns `this` for chaining
   * @example
   * ```typescript
   * builder.withMemory("2")
   * ```
   */
  withMemory(tier: "1" | "2"): this {
    this._memoryTier = tier;
    return this;
  }

  // ─── Execution ───

  /**
   * Set the maximum number of reasoning iterations the agent can perform.
   *
   * Higher values allow more complex reasoning but increase execution time and token cost.
   * The agent stops earlier if it finds a final answer.
   *
   * @param n - Maximum iterations (typically 5-15)
   * @returns `this` for chaining
   * @example
   * ```typescript
   * builder.withMaxIterations(20)
   * ```
   * @default 10
   */
  withMaxIterations(n: number): this {
    this._maxIterations = n;
    return this;
  }

  // ─── Lifecycle Hooks ───

  /**
   * Register a lifecycle hook to be invoked at a specific phase and timing.
   *
   * Hooks can inspect/modify execution context before or after phases, or handle errors.
   * Multiple hooks can be registered; they execute in registration order.
   *
   * @param hook - Lifecycle hook configuration
   * @returns `this` for chaining
   * @example
   * ```typescript
   * builder.withHook({
   *   phase: "think",
   *   timing: "after",
   *   handler: (ctx) => Effect.sync(() => {
   *     console.log(`Thought: ${ctx.metadata.thinking}`);
   *     return ctx;
   *   })
   * })
   * ```
   */
  withHook(hook: LifecycleHook): this {
    this._hooks.push(hook);
    return this;
  }

  // ─── Optional Features ───

  /**
   * Enable guardrails to protect against injection attacks and PII exposure.
   *
   * Guardrails check user input for prompt injection attempts and mask personally identifiable information.
   *
   * @returns `this` for chaining
   */
  withGuardrails(): this {
    this._enableGuardrails = true;
    return this;
  }

  /**
   * Enable semantic verification to assess confidence in agent outputs.
   *
   * Verification uses semantic entropy, fact decomposition, and multi-source checking
   * to estimate answer quality and flag uncertain outputs.
   *
   * @returns `this` for chaining
   */
  withVerification(): this {
    this._enableVerification = true;
    return this;
  }

  /**
   * Enable cost tracking to monitor token consumption and estimate USD costs.
   *
   * @returns `this` for chaining
   */
  withCostTracking(): this {
    this._enableCostTracking = true;
    return this;
  }

  /**
   * Enable audit logging for compliance and post-execution analysis.
   *
   * Audit logs record all phase transitions, tool invocations, and decision points.
   *
   * @returns `this` for chaining
   */
  withAudit(): this {
    this._enableAudit = true;
    return this;
  }

  /**
   * Enable the reasoning layer to activate multi-step reasoning strategies.
   *
   * Without this, the agent performs single-step LLM calls. With it enabled,
   * the agent can use strategies like ReAct (tool use loops), tree-of-thought, or plan-execute.
   *
   * @param options - Reasoning configuration overrides
   * @returns `this` for chaining
   * @example
   * ```typescript
   * builder.withReasoning({
   *   defaultStrategy: "tree-of-thought"
   * })
   * ```
   */
  withReasoning(options?: ReasoningOptions): this {
    this._enableReasoning = true;
    if (options) this._reasoningOptions = options;
    return this;
  }

  /**
   * Enable the tools layer to allow tool invocation (built-in or custom).
   *
   * Built-in tools include: file-write, file-read, web-search, http-get, code-execute.
   * Additional tools can be provided via the options or via MCP servers.
   *
   * @param options - Custom tool definitions and handlers
   * @returns `this` for chaining
   * @example
   * ```typescript
   * builder.withTools({
   *   tools: [
   *     {
   *       definition: { name: "my-tool", description: "...", parameters: [...] },
   *       handler: async (args) => ({ result: "..." })
   *     }
   *   ]
   * })
   * ```
   */
  withTools(options?: ToolsOptions): this {
    this._enableTools = true;
    if (options) this._toolsOptions = options;
    if (options?.resultCompression) {
      this._resultCompression = options.resultCompression;
    }
    return this;
  }

  /**
   * Enable agent identity and identity verification via Ed25519 certificates.
   *
   * Allows the agent to sign messages and verify the identity of other agents in a network.
   *
   * @returns `this` for chaining
   */
  withIdentity(): this {
    this._enableIdentity = true;
    return this;
  }

  /**
   * Enable observability — metrics collection, structured logging, and tracing.
   *
   * Automatically displays a metrics dashboard on completion showing execution timeline,
   * tool usage, costs, and alerts. Configure verbosity and live streaming via options.
   *
   * @param options - Observability configuration (verbosity, live, file)
   * @returns `this` for chaining
   * @example
   * ```typescript
   * builder.withObservability({
   *   verbosity: "normal",
   *   live: true
   * })
   * ```
   */
  withObservability(options?: ObservabilityOptions): this {
    this._enableObservability = true;
    if (options) this._observabilityOptions = options;
    return this;
  }

  /**
   * Enable interactive collaboration — approval gates and user feedback loops.
   *
   * Allows the agent to pause and request human approval for critical operations.
   *
   * @returns `this` for chaining
   */
  withInteraction(): this {
    this._enableInteraction = true;
    return this;
  }

  /**
   * Enable the prompt template service for prompt management and A/B experiments.
   *
   * Allows registering and selecting from a library of prompts, with support for
   * model-tier-specific variants and experiment tracking.
   *
   * @param options - Custom prompt template definitions
   * @returns `this` for chaining
   * @example
   * ```typescript
   * builder.withPrompts({
   *   templates: [...]
   * })
   * ```
   */
  withPrompts(options?: PromptsOptions): this {
    this._enablePrompts = true;
    if (options) this._promptsOptions = options;
    return this;
  }

  /**
   * Enable the orchestration layer for multi-agent workflows.
   *
   * Allows defining and executing complex workflows with approval gates and task dependencies.
   *
   * @returns `this` for chaining
   */
  withOrchestration(): this {
    this._enableOrchestration = true;
    return this;
  }

  /**
   * Enable the kill switch service — allows pausing, resuming, stopping, and terminating agents.
   *
   * Provides fine-grained control over agent execution at phase boundaries.
   * Required for `.pause()`, `.resume()`, `.stop()`, and `.terminate()` methods on ReactiveAgent.
   *
   * @returns `this` for chaining
   */
  withKillSwitch(): this {
    this._enableKillSwitch = true;
    return this;
  }

  /**
   * Enable behavioral contracts — enforce constraints on tool usage, outputs, and iterations.
   *
   * Contracts can enforce that certain tools must/must not be used, iterations cannot exceed
   * a threshold, or output must conform to specific patterns. Violations trigger guardrail violations.
   *
   * @param contract - Behavioral contract specification
   * @returns `this` for chaining
   * @example
   * ```typescript
   * builder.withBehavioralContracts({
   *   maxIterations: 10,
   *   allowedTools: ["file-write", "web-search"],
   *   forbiddenTools: ["code-execute"]
   * })
   * ```
   */
  withBehavioralContracts(contract: import("@reactive-agents/guardrails").BehavioralContract): this {
    this._enableBehavioralContracts = true;
    this._behavioralContract = contract;
    return this;
  }

  /**
   * Enable cross-task self-improvement — the agent learns from past execution outcomes.
   *
   * Requires memory tier 2. When enabled, the agent logs which reasoning strategies
   * succeeded or failed on similar tasks and biases future strategy selection toward
   * strategies with higher success rates.
   *
   * @returns `this` for chaining
   */
  withSelfImprovement(): this {
    this._enableSelfImprovement = true;
    return this;
  }

  /**
   * Enable agent lifecycle events — allows subscribing to agent execution events.
   *
   * Enables the `.subscribe()` method on ReactiveAgent to listen for events like
   * `"AgentStarted"`, `"LLMRequestStarted"`, `"ToolCallStarted"`, `"AgentCompleted"`, etc.
   *
   * @returns `this` for chaining
   * @example
   * ```typescript
   * const unsub = await agent.subscribe("ToolCallCompleted", (event) => {
   *   console.log(`Tool ${event.toolName} took ${event.durationMs}ms`);
   * });
   * ```
   */
  withEvents(): this {
    this._enableEvents = true;
    return this;
  }

  /**
   * Set model-adaptive context profile overrides — controls compaction, truncation, and tool result handling.
   *
   * Profiles define per-model-tier thresholds for context budget, tool result size, and compaction
   * level. Use this to tune the agent for specific model capabilities or task requirements.
   *
   * @param profile - Partial context profile with overrides
   * @returns `this` for chaining
   * @example
   * ```typescript
   * builder.withContextProfile({
   *   budgetTokens: 4000,
   *   toolResultMaxChars: 1000,
   *   compactionLevel: "grouped"
   * })
   * ```
   */
  withContextProfile(profile: Partial<ContextProfile>): this {
    this._contextProfile = profile;
    return this;
  }

  // ─── MCP Servers ───

  /**
   * Connect one or more Model Context Protocol (MCP) servers.
   *
   * MCP servers expose tools via a standardized protocol (stdio, SSE, or WebSocket).
   * Tools are automatically discovered and added to the agent's tool registry.
   * Implicitly enables the tools layer.
   *
   * @param config - MCP server configuration(s) — can be a single config or array
   * @returns `this` for chaining
   * @example
   * ```typescript
   * builder.withMCP({
   *   name: "filesystem",
   *   transport: "stdio",
   *   command: "mcp-server-filesystem",
   *   args: ["/home/user/data"]
   * })
   * ```
   */
  withMCP(config: MCPServerConfig | MCPServerConfig[]): this {
    const configs = Array.isArray(config) ? config : [config];
    this._mcpServers.push(...configs);
    this._enableTools = true;
    return this;
  }

  // ─── Testing ───

  /**
   * Configure mock LLM responses for testing (provider: "test" only).
   *
   * Maps input patterns to predefined outputs. Useful for testing agent behavior
   * without hitting real LLM APIs.
   *
   * @param responses - Map of input pattern → output string
   * @returns `this` for chaining
   * @example
   * ```typescript
   * builder.withTestResponses({
   *   "What is 2+2?": "4",
   *   ".*search.*": "No results found"
   * })
   * ```
   */
  withTestResponses(responses: Record<string, string>): this {
    this._testResponses = responses;
    return this;
  }

  // ─── Extra Layers ───

  /**
   * Compose additional Effect-TS layers into the runtime.
   *
   * Advanced feature for adding custom services or dependencies.
   * Layers are merged into the main runtime layer stack.
   *
   * @param layers - Effect-TS Layer(s) to add
   * @returns `this` for chaining
   */
  withLayers(layers: Layer.Layer<any, any>): this {
    this._extraLayers = layers;
    return this;
  }

  // ─── Build ───

  /**
   * Build and instantiate the agent (simple async version).
   *
   * Validates configuration, creates layers, and returns a ready-to-use ReactiveAgent.
   * Throws an error if required API keys are missing.
   *
   * @returns Promise resolving to a ReactiveAgent instance
   * @throws Error if configuration is invalid or API keys are missing
   * @example
   * ```typescript
   * const agent = await ReactiveAgents.create()
   *   .withModel("claude-opus-4-20250514")
   *   .build();
   * ```
   */
  async build(): Promise<ReactiveAgent> {
    return Effect.runPromise(this.buildEffect());
  }

  /**
   * Build, run once, and automatically dispose — all in a single chain.
   *
   * The agent is created, the task is executed, and resources are cleaned up
   * regardless of success or failure. Perfect for one-shot scripts.
   *
   * @param input - The task prompt or question
   * @returns Promise resolving to an AgentResult
   * @example
   * ```typescript
   * const result = await ReactiveAgents.create()
   *   .withProvider("anthropic")
   *   .withReasoning()
   *   .runOnce("Summarize the README in one paragraph");
   * console.log(result.output);
   * ```
   */
  async runOnce(input: string): Promise<AgentResult> {
    const agent = await this.build();
    try {
      return await agent.run(input);
    } finally {
      await agent.dispose();
    }
  }

  /**
   * Build the agent as an Effect (advanced async version).
   *
   * Returns an Effect that, when run, instantiates the agent.
   * Useful for composing agent creation into larger Effect workflows.
   *
   * @returns Effect that produces a ReactiveAgent
   * @example
   * ```typescript
   * const buildEffect = ReactiveAgents.create()
   *   .withModel("claude-opus-4-20250514")
   *   .buildEffect();
   * const agent = await Effect.runPromise(buildEffect);
   * ```
   */
  buildEffect(): Effect.Effect<ReactiveAgent, Error> {
    // Validate provider API key exists at build time (fast fail)
    const keyMap: Record<string, string | undefined> = {
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
      gemini: "GOOGLE_API_KEY",
    };
    const requiredKey = keyMap[this._provider];
    if (requiredKey && !process.env[requiredKey]) {
      return Effect.fail(
        new Error(
          `Missing API key: ${requiredKey} is not set. Provider "${this._provider}" requires it.`,
        ),
      );
    }

    const agentId = `${this._name}-${Date.now()}`;

    // Compose persona into system prompt if provided
    let composedSystemPrompt = this._systemPrompt;
    if (this._persona) {
      const personaPrompt = composePersonaToSystemPrompt(this._persona, this._name);
      composedSystemPrompt = composedSystemPrompt
        ? `${personaPrompt}\n\n${composedSystemPrompt}`
        : personaPrompt;
    }

    const baseRuntime = createRuntime({
      agentId,
      provider: this._provider,
      model: this._model,
      memoryTier: this._memoryTier,
      maxIterations: this._maxIterations,
      enableGuardrails: this._enableGuardrails,
      enableVerification: this._enableVerification,
      enableCostTracking: this._enableCostTracking,
      enableAudit: this._enableAudit,
      enableReasoning: this._enableReasoning,
      enableTools: this._enableTools,
      enableIdentity: this._enableIdentity,
      enableObservability: this._enableObservability,
      observabilityOptions: this._observabilityOptions,
      enableInteraction: this._enableInteraction,
      enablePrompts: this._enablePrompts,
      enableOrchestration: this._enableOrchestration,
      enableKillSwitch: this._enableKillSwitch,
      enableBehavioralContracts: this._enableBehavioralContracts,
      behavioralContract: this._behavioralContract,
      enableSelfImprovement: this._enableSelfImprovement,
      testResponses: this._testResponses,
      extraLayers: this._extraLayers,
      systemPrompt: composedSystemPrompt,
      mcpServers: this._mcpServers.length > 0 ? this._mcpServers : undefined,
      reasoningOptions: this._reasoningOptions,
      enableA2A: !!this._a2aOptions,
      a2aPort: this._a2aOptions?.port,
      a2aBasePath: this._a2aOptions?.basePath,
      enableGateway: !!this._gatewayOptions,
      gatewayOptions: this._gatewayOptions,
      contextProfile: this._contextProfile,
      resultCompression: this._resultCompression,
    });

    const hooks = [...this._hooks];
    const mcpServers = [...this._mcpServers];
    const toolsOptions = this._toolsOptions;
    const promptsOptions = this._promptsOptions;
    const a2aOptions = this._a2aOptions;
    const agentTools = this._agentTools;
    const allowDynamicSubAgents = this._allowDynamicSubAgents;
    const dynamicSubAgentOptions = this._dynamicSubAgentOptions;
    const parentProvider = this._provider;
    const parentModel = this._model;

    return Effect.gen(function* () {
      const engine = yield* ExecutionEngine.pipe(Effect.provide(baseRuntime));

      for (const hook of hooks) {
        yield* engine.registerHook(hook);
      }

      // Register custom prompt templates if configured
      if (promptsOptions?.templates && promptsOptions.templates.length > 0) {
        const { PromptService } = yield* Effect.promise(() =>
          import("@reactive-agents/prompts"),
        );
        const promptService = yield* (PromptService as any).pipe(Effect.provide(baseRuntime));
        for (const template of promptsOptions.templates) {
          yield* (promptService as any).register(template);
        }
      }

      // ── MCP servers, custom tools, agent tools: bake into the runtime layer ────
      //
      // Root cause of the scope bug: registrations done via `Effect.provide(runtime)`
      // inside buildEffect() wrote into a ToolService from a throwaway scope. The
      // ManagedRuntime used by run()/subscribe() creates a fresh scope on first use —
      // so those registrations were invisible at execution time.
      //
      // Fix: Compose a Layer.effectDiscard into the runtime. The effectDiscard runs
      // connectMCPServer() / register() during layer evaluation, INSIDE the
      // ManagedRuntime scope. Because Layer.merge uses reference-identity memoization,
      // the same ToolService instance (from baseRuntime) receives all registrations
      // AND serves the engine — MCP tools are visible to the LLM.
      let fullRuntime: Layer.Layer<any, any> = baseRuntime as Layer.Layer<any, any>;

      if (agentTools.length > 0 || allowDynamicSubAgents || mcpServers.length > 0 || (toolsOptions?.tools?.length ?? 0) > 0) {
        const toolsMod = yield* Effect.promise(() =>
          import("@reactive-agents/tools"),
        );

        const {
          createAgentTool,
          createRemoteAgentTool,
          executeRemoteAgentTool,
        } = toolsMod;

        // Collect (definition, handler) pairs — no registration yet.
        type RegEntry = {
          def: ToolDefinition;
          handler: (args: Record<string, unknown>) => Effect.Effect<unknown, Error>;
        };
        const registrations: RegEntry[] = [];

        for (const agentTool of agentTools) {
          if (agentTool.remoteUrl) {
            // Remote A2A agent tool
            const toolDef = createRemoteAgentTool(
              agentTool.name,
              `${agentTool.remoteUrl}/.well-known/agent.json`,
              agentTool.remoteUrl,
            );
            const remoteUrl = agentTool.remoteUrl;
            const remoteClient: RemoteAgentClient = {
              sendMessage: (params: { message: { role: string; content: string }; agentCardUrl: string }) =>
                Effect.tryPromise({
                  try: () =>
                    fetch(remoteUrl, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        jsonrpc: "2.0",
                        method: "message/send",
                        params: {
                          message: {
                            role: params.message.role,
                            parts: [{ kind: "text", text: params.message.content }],
                          },
                        },
                        id: crypto.randomUUID(),
                      }),
                    }).then((r) => r.json()).then((d: Record<string, unknown>) =>
                      d.result as { taskId: string },
                    ),
                  catch: (e) => new Error(String(e)),
                }),
              getTask: (params: { id: string }) =>
                Effect.tryPromise({
                  try: () =>
                    fetch(remoteUrl, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        jsonrpc: "2.0",
                        method: "tasks/get",
                        params: { id: params.id },
                        id: crypto.randomUUID(),
                      }),
                    }).then((r) => r.json()).then((d: Record<string, unknown>) =>
                      d.result as { status: string; result: unknown },
                    ),
                  catch: (e) => new Error(String(e)),
                }),
            };
            const handler = (args: Record<string, unknown>) =>
              Effect.tryPromise({
                try: () =>
                  executeRemoteAgentTool(
                    toolDef,
                    args,
                    remoteClient,
                    `${remoteUrl}/.well-known/agent.json`,
                  ),
                catch: (e) => new Error(String(e)),
              });
            registrations.push({ def: toolDef, handler });
          } else if (agentTool.agent) {
            // Local agent tool — real sub-agent delegation
            const agentConfig: import("@reactive-agents/core").AgentConfig = {
              name: agentTool.agent.name,
              description: agentTool.agent.description ?? `Agent: ${agentTool.agent.name}`,
              capabilities: [],
            };
            const toolDef = createAgentTool(agentTool.name, agentConfig);

            const subAgentExec = toolsMod.createSubAgentExecutor(
              {
                name: agentTool.agent!.name,
                description: agentTool.agent!.description,
                provider: agentTool.agent!.provider,
                model: agentTool.agent!.model,
                tools: agentTool.agent!.tools,
                maxIterations: agentTool.agent!.maxIterations,
                systemPrompt: agentTool.agent!.systemPrompt,
                persona: agentTool.agent!.persona,
              },
              async (opts) => {
                const _subLabel = agentTool.agent!.name;
                const _taskPreview = opts.task.length > 80 ? opts.task.slice(0, 80) + "…" : opts.task;
                process.stdout.write(`\n  \x1b[36m┌─ [sub-agent: ${_subLabel}]\x1b[0m → "${_taskPreview}"\n`);
                const _subStart = Date.now();

                // Compose persona with system prompt
                let composedSystemPrompt = opts.systemPrompt;
                if (opts.persona) {
                  const personaPrompt = composePersonaToSystemPrompt(opts.persona, opts.name);
                  composedSystemPrompt = composedSystemPrompt
                    ? `${personaPrompt}\n\n${composedSystemPrompt}`
                    : personaPrompt;
                }

                const subRuntime = createRuntime({
                  agentId: opts.agentId,
                  provider: (opts.provider ?? "test") as ProviderName,
                  model: opts.model,
                  maxIterations: opts.maxIterations,
                  systemPrompt: composedSystemPrompt,
                  enableReasoning: opts.enableReasoning,
                  enableTools: opts.enableTools,
                });
                const subEngine = await Effect.runPromise(
                  ExecutionEngine.pipe(Effect.provide(subRuntime)),
                );
                const taskObj: Task = {
                  id: generateTaskId(),
                  agentId: Schema.decodeSync(AgentId)(opts.agentId),
                  type: "query" as const,
                  input: { question: opts.task },
                  priority: "medium" as const,
                  status: "pending" as const,
                  metadata: { tags: [] },
                  createdAt: new Date(),
                };
                const result: TaskResult = await Effect.runPromise(
                  subEngine.execute(taskObj).pipe(
                    Effect.provide(subRuntime as unknown as Layer.Layer<never>),
                  ),
                );
                const _subElapsed = ((Date.now() - _subStart) / 1000).toFixed(1);
                const _subIcon = result.success ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
                process.stdout.write(`  \x1b[36m└─ [sub-agent: ${_subLabel}]\x1b[0m ${_subIcon} done | ${result.metadata.tokensUsed} tok | ${_subElapsed}s\n\n`);
                return {
                  output: String(result.output ?? ""),
                  success: result.success,
                  tokensUsed: result.metadata.tokensUsed,
                };
              },
              0,
            );

            const handler = (args: Record<string, unknown>) =>
              Effect.tryPromise({
                try: () => {
                  const task = typeof args.input === "string"
                    ? args.input
                    : typeof args.message === "string"
                      ? args.message
                      : JSON.stringify(args);
                  return subAgentExec(task);
                },
                catch: (e) => new Error(String(e)),
              });
            registrations.push({ def: toolDef, handler });
          }
        }

        // Register the built-in spawn-agent tool when dynamic sub-agents are enabled.
        // The handler captures parentProvider/parentModel so spawned agents inherit
        // the parent's LLM config without any extra wiring required.
        if (allowDynamicSubAgents) {
          const spawnToolDef = toolsMod.createSpawnAgentTool();
          const defaultMaxIter = dynamicSubAgentOptions?.maxIterations ?? 5;

          const spawnHandler = (args: Record<string, unknown>) =>
            Effect.tryPromise({
              try: () => {
                const task =
                  typeof args.task === "string"
                    ? args.task
                    : JSON.stringify(args.task ?? "");
                const subName =
                  typeof args.name === "string" ? args.name : "dynamic-agent";
                const subModel =
                  typeof args.model === "string" ? args.model : undefined;
                const subMaxIter =
                  typeof args.maxIterations === "number"
                    ? args.maxIterations
                    : defaultMaxIter;

                // Extract optional persona parameters
                const subPersona = {
                  role: typeof args.role === "string" ? args.role : undefined,
                  instructions: typeof args.instructions === "string" ? args.instructions : undefined,
                  tone: typeof args.tone === "string" ? args.tone : undefined,
                };

                const executor = toolsMod.createSubAgentExecutor(
                  {
                    name: subName,
                    provider: parentProvider,
                    model: subModel ?? parentModel,
                    maxIterations: subMaxIter,
                    persona: (subPersona.role || subPersona.instructions || subPersona.tone) ? subPersona : undefined,
                  },
                  async (opts) => {
                    const _taskPreview = opts.task.length > 80 ? opts.task.slice(0, 80) + "…" : opts.task;
                    process.stdout.write(`\n  \x1b[36m┌─ [sub-agent: ${subName}]\x1b[0m → "${_taskPreview}"\n`);
                    const _subStart = Date.now();

                    // Compose persona with system prompt
                    let composedSystemPrompt = opts.systemPrompt;
                    if (opts.persona) {
                      const personaPrompt = composePersonaToSystemPrompt(opts.persona as AgentPersona, opts.name);
                      composedSystemPrompt = composedSystemPrompt
                        ? `${personaPrompt}\n\n${composedSystemPrompt}`
                        : personaPrompt;
                    }

                    const subRuntime = createRuntime({
                      agentId: opts.agentId,
                      provider: (opts.provider ?? "test") as ProviderName,
                      model: opts.model,
                      maxIterations: opts.maxIterations,
                      systemPrompt: composedSystemPrompt,
                      enableReasoning: opts.enableReasoning,
                      enableTools: opts.enableTools,
                    });
                    const subEngine = await Effect.runPromise(
                      ExecutionEngine.pipe(Effect.provide(subRuntime)),
                    );
                    const taskObj: Task = {
                      id: generateTaskId(),
                      agentId: Schema.decodeSync(AgentId)(opts.agentId),
                      type: "query" as const,
                      input: { question: opts.task },
                      priority: "medium" as const,
                      status: "pending" as const,
                      metadata: { tags: [] },
                      createdAt: new Date(),
                    };
                    const result: TaskResult = await Effect.runPromise(
                      subEngine.execute(taskObj).pipe(
                        Effect.provide(subRuntime as unknown as Layer.Layer<never>),
                      ),
                    );
                    const _subElapsed = ((Date.now() - _subStart) / 1000).toFixed(1);
                    const _subIcon = result.success ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
                    process.stdout.write(`  \x1b[36m└─ [sub-agent: ${subName}]\x1b[0m ${_subIcon} done | ${result.metadata.tokensUsed} tok | ${_subElapsed}s\n\n`);
                    return {
                      output: String(result.output ?? ""),
                      success: result.success,
                      tokensUsed: result.metadata.tokensUsed,
                    };
                  },
                  0,
                );

                return executor(task);
              },
              catch: (e) => new Error(String(e)),
            });

          registrations.push({ def: spawnToolDef, handler: spawnHandler });
        }

        // Build an init effect that connects MCP servers, registers custom tools,
        // and registers agent tools — all into the ToolService found in the
        // execution environment. No Effect.provide() here — the ToolService comes
        // from the layer environment at evaluation time (same instance as the engine).
        const agentToolInitEffect = Effect.gen(function* () {
          const ts = yield* (toolsMod.ToolService as unknown as import("effect").Context.Tag<any, any>);
          // Connect MCP servers inside the managed runtime scope so the engine's
          // ToolService and the MCP-connected ToolService are the same instance.
          for (const mcp of mcpServers) {
            yield* (ts as any).connectMCPServer(mcp);
          }
          // Register custom tools
          if (toolsOptions?.tools) {
            for (const tool of toolsOptions.tools) {
              yield* (ts as any).register(tool.definition, tool.handler);
            }
          }
          // Register agent tools
          for (const { def, handler } of registrations) {
            yield* (ts as any).register(def, handler);
          }
        });

        // Layer.effectDiscard wraps the init as a side-effect layer (no service output).
        // Layer.provide(baseRuntime) satisfies the ToolService requirement.
        // Layer.merge combines baseRuntime + initLayer: Effect memoizes baseRuntime by
        // reference so both the engine and the init effect share the same ToolService.
        const agentToolInitLayer = Layer.effectDiscard(
          agentToolInitEffect as Effect.Effect<unknown, never, never>,
        ).pipe(
          Layer.provide(baseRuntime as unknown as Layer.Layer<any>),
        );

        fullRuntime = Layer.merge(
          baseRuntime as unknown as Layer.Layer<any>,
          agentToolInitLayer,
        );
      }

      // Create a ManagedRuntime so all facade calls (run, subscribe, pause, etc.)
      // share the same layer scope and the same service instances (EventBus, KillSwitch, etc.).
      const managedRuntime = ManagedRuntime.make(fullRuntime as unknown as Layer.Layer<any>);
      return new ReactiveAgent(engine, agentId, managedRuntime, mcpServers.map((s) => s.name));
    }) as Effect.Effect<ReactiveAgent, Error>;
  }
}

/**
 * Reactive Agent — the main facade for executing tasks and controlling agent behavior.
 *
 * Create instances via `ReactiveAgents.create().build()`. The agent provides simple async
 * methods (`run()`, `pause()`, `resume()`) and advanced Effect-based methods (`runEffect()`, `subscribe()`).
 *
 * All execution methods share a single managed runtime, so lifecycle state (pause/resume),
 * event subscriptions, and service instances are properly maintained across calls.
 *
 * @example
 * ```typescript
 * const agent = await ReactiveAgents.create()
 *   .withProvider("anthropic")
 *   .withModel("claude-opus-4-20250514")
 *   .withReasoning()
 *   .build();
 *
 * const result = await agent.run("What is the capital of France?");
 * console.log(result.output); // "Paris"
 * ```
 */
export class ReactiveAgent {
  constructor(
    private readonly engine: {
      execute: (task: Task) => Effect.Effect<TaskResult, RuntimeErrors | TaskError>;
      cancel: (taskId: string) => Effect.Effect<void, RuntimeErrors>;
      getContext: (taskId: string) => Effect.Effect<ExecutionContext | null, never>;
    },
    /**
     * Unique identifier for this agent instance — set at instantiation and remains constant
     * across all executions, pause/resume cycles, and subscriptions.
     */
    readonly agentId: string,
    // ManagedRuntime evaluates the layer once; all facade calls share service instances.
    private readonly runtime: ManagedRuntime.ManagedRuntime<any, never>,
    /** Names of connected MCP servers — needed for cleanup on dispose(). */
    private readonly _mcpServerNames: readonly string[] = [],
  ) {}

  /**
   * Release all resources held by this agent.
   *
   * Disconnects any MCP stdio servers (killing their subprocesses) and closes
   * the managed runtime scope. Call this after your last `agent.run()` to
   * prevent the process from hanging on open subprocess pipes.
   *
   * @example
   * ```typescript
   * const result = await agent.run("...");
   * await agent.dispose();
   * ```
   */
  async dispose(): Promise<void> {
    const serverNames = this._mcpServerNames;
    if (serverNames.length > 0) {
      await this.runtime.runPromise(
        Effect.gen(function* () {
          const toolsMod = yield* Effect.promise(() => import("@reactive-agents/tools"));
          const ts = yield* (toolsMod.ToolService as unknown as import("effect").Context.Tag<any, any>);
          for (const name of serverNames) {
            yield* (ts as any).disconnectMCPServer(name).pipe(
              Effect.catchAll(() => Effect.void),
            );
          }
        }).pipe(Effect.catchAll(() => Effect.void)),
      );
    }
    await this.runtime.dispose();
  }

  /**
   * Automatic cleanup via the Explicit Resource Management protocol (TypeScript 5.2+).
   *
   * Enables `await using` syntax so the agent is disposed automatically when the
   * enclosing block exits — no manual `dispose()` call required.
   *
   * @example
   * ```typescript
   * await using agent = await ReactiveAgents.create()
   *   .withProvider("anthropic")
   *   .build();
   * const result = await agent.run("Hello");
   * // agent.dispose() is called automatically here
   * ```
   */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose();
  }

  /**
   * Execute a task and return the result (simple async version).
   *
   * Blocks until the agent completes or fails. Returns full metadata including duration,
   * cost, tokens used, and reasoning strategy/iteration count.
   *
   * @param input - The task prompt or question
   * @returns Promise resolving to an AgentResult with output, success status, and metadata
   * @throws Error if the task fails or required services are unavailable
   * @example
   * ```typescript
   * const result = await agent.run("Write a haiku about programming");
   * console.log(result.output);
   * console.log(`Took ${result.metadata.duration}ms`);
   * console.log(`Cost: $${result.metadata.cost}`);
   * ```
   */
  async run(input: string): Promise<AgentResult> {
    return Effect.runPromise(this.runEffect(input));
  }

  /**
   * Execute a task as an Effect (advanced async version).
   *
   * Returns an Effect that, when run, performs the task execution. Useful for composing
   * task execution into larger Effect workflows or for custom error handling.
   *
   * @param input - The task prompt or question
   * @returns Effect that produces an AgentResult
   * @example
   * ```typescript
   * const effect = agent.runEffect("What is 2+2?");
   * const result = await Effect.runPromise(effect.pipe(
   *   Effect.tapError(err => Effect.logError(err))
   * ));
   * ```
   */
  runEffect(input: string): Effect.Effect<AgentResult, Error> {
    const task: Task = {
      id: generateTaskId(),
      agentId: Schema.decodeSync(AgentId)(this.agentId),
      type: "query" as const,
      input: { question: input },
      priority: "medium" as const,
      status: "pending" as const,
      metadata: { tags: [] },
      createdAt: new Date(),
    };

    return Effect.promise(() =>
      this.runtime.runPromise(
        this.engine.execute(task).pipe(
          Effect.map((result: TaskResult) => ({
            output: String(result.output ?? ""),
            success: result.success,
            taskId: String(result.taskId),
            agentId: String(result.agentId),
            metadata: result.metadata as AgentResultMetadata,
          })),
          Effect.mapError(
            (e: RuntimeErrors | TaskError) =>
              new Error("message" in e ? e.message : String(e)),
          ),
        ) as Effect.Effect<AgentResult, Error>,
      ),
    );
  }

  /**
   * Cancel a running task by its ID (graceful shutdown).
   *
   * Signals the ExecutionEngine to stop processing the specified task.
   * The agent will finish the current phase before stopping.
   *
   * @param taskId - ID of the task to cancel
   * @returns Promise that resolves when cancellation is complete
   * @example
   * ```typescript
   * const result = agent.run("long-running-task");
   * // Later...
   * await agent.cancel(taskId);
   * ```
   */
  async cancel(taskId: string): Promise<void> {
    return this.runtime.runPromise(
      this.engine.cancel(taskId).pipe(
        Effect.mapError((e: RuntimeErrors) => new Error("message" in e ? e.message : String(e))),
        Effect.catchAll(() => Effect.void),
      ) as Effect.Effect<void>,
    );
  }

  /**
   * Inspect the current execution context of a running task.
   *
   * Returns the current ExecutionContext (messages, metadata, phase, iteration count, etc.)
   * or null if the task is not currently running.
   *
   * @param taskId - ID of the task to inspect
   * @returns Promise resolving to ExecutionContext or null
   * @example
   * ```typescript
   * const ctx = await agent.getContext(taskId);
   * if (ctx) {
   *   console.log(`Phase: ${ctx.phase}, Iteration: ${ctx.iteration}`);
   * }
   * ```
   */
  async getContext(taskId: string): Promise<ExecutionContext | null> {
    return this.runtime.runPromise(
      this.engine.getContext(taskId) as Effect.Effect<ExecutionContext | null>,
    );
  }

  /**
   * Pause agent execution at the next phase boundary.
   *
   * The agent will pause gracefully after the current phase completes,
   * allowing later resumption via `.resume()`.
   * Requires `.withKillSwitch()` to be enabled during build.
   *
   * @returns Promise that resolves when the pause signal is sent
   * @example
   * ```typescript
   * await agent.pause();
   * console.log("Agent paused");
   * await agent.resume();
   * ```
   */
  async pause(): Promise<void> {
    return this.runtime.runPromise(
      KillSwitchService.pipe(
        Effect.flatMap((ks) => ks.pause(this.agentId)),
        Effect.catchAll(() => Effect.void),
      ) as Effect.Effect<void>,
    );
  }

  /**
   * Resume a paused agent.
   *
   * Signals the agent to resume execution after a pause.
   * Has no effect if the agent is not currently paused.
   * Requires `.withKillSwitch()` to be enabled during build.
   *
   * @returns Promise that resolves when the resume signal is sent
   * @example
   * ```typescript
   * await agent.pause();
   * // Later...
   * await agent.resume();
   * ```
   */
  async resume(): Promise<void> {
    return this.runtime.runPromise(
      KillSwitchService.pipe(
        Effect.flatMap((ks) => ks.resume(this.agentId)),
        Effect.catchAll(() => Effect.void),
      ) as Effect.Effect<void>,
    );
  }

  /**
   * Signal the agent to stop gracefully at the next phase boundary.
   *
   * Similar to `.cancel()` but intended for user-initiated stops.
   * The agent will finish the current phase and transition to a stopped state.
   * Requires `.withKillSwitch()` to be enabled during build.
   *
   * @param reason - Optional reason for stopping (for logging/audit)
   * @returns Promise that resolves when the stop signal is sent
   * @example
   * ```typescript
   * await agent.stop("User interrupted");
   * ```
   */
  async stop(reason = "stop() called"): Promise<void> {
    return this.runtime.runPromise(
      KillSwitchService.pipe(
        Effect.flatMap((ks) => ks.stop(this.agentId, reason)),
        Effect.catchAll(() => Effect.void),
      ) as Effect.Effect<void>,
    );
  }

  /**
   * Immediately terminate agent execution without waiting for phase completion.
   *
   * Forcefully stops the agent. This is more abrupt than `.stop()` and should be used
   * when immediate shutdown is required.
   * Requires `.withKillSwitch()` to be enabled during build.
   *
   * @param reason - Optional reason for termination (for logging/audit)
   * @returns Promise that resolves when the termination signal is sent
   * @example
   * ```typescript
   * await agent.terminate("Resource exhausted");
   * ```
   */
  async terminate(reason = "terminate() called"): Promise<void> {
    return this.runtime.runPromise(
      KillSwitchService.pipe(
        Effect.flatMap((ks) => ks.terminate(this.agentId, reason)),
        Effect.catchAll(() => Effect.void),
      ) as Effect.Effect<void>,
    );
  }

  /**
   * Subscribe to a specific event type with automatic type narrowing.
   * The handler receives the narrowed event — no `_tag` check needed.
   *
   * @example
   * const unsub = await agent.subscribe("AgentCompleted", (event) => {
   *   // event is { _tag: "AgentCompleted"; taskId: string; totalTokens: number; ... }
   *   console.log(event.totalTokens);
   * });
   * unsub(); // stop listening
   */
  subscribe<T extends AgentEvent["_tag"]>(
    tag: T,
    handler: (event: Extract<AgentEvent, { _tag: T }>) => void,
  ): Promise<() => void>;

  /**
   * Subscribe to all agent events (catch-all).
   * The handler receives the full `AgentEvent` union — use `event._tag` to discriminate.
   *
   * @example
   * const unsub = await agent.subscribe((event) => {
   *   if (event._tag === "ToolCallStarted") console.log(event.toolName);
   * });
   */
  subscribe(handler: (event: AgentEvent) => void): Promise<() => void>;

  async subscribe<T extends AgentEvent["_tag"]>(
    tagOrHandler: T | ((event: AgentEvent) => void),
    handler?: (event: Extract<AgentEvent, { _tag: T }>) => void,
  ): Promise<() => void> {
    if (typeof tagOrHandler === "function") {
      // Catch-all overload
      return this.runtime.runPromise(
        EventBus.pipe(
          Effect.flatMap((eb) =>
            eb.subscribe((event) =>
              Effect.sync(() => (tagOrHandler as (event: AgentEvent) => void)(event)),
            ),
          ),
          Effect.catchAll(() => Effect.succeed(() => {})),
        ) as Effect.Effect<() => void>,
      );
    }
    // Tag-filtered overload — delegates to the typed eb.on()
    return this.runtime.runPromise(
      EventBus.pipe(
        Effect.flatMap((eb) =>
          eb.on(tagOrHandler, (event) => Effect.sync(() => handler!(event))),
        ),
        Effect.catchAll(() => Effect.succeed(() => {})),
      ) as Effect.Effect<() => void>,
    );
  }
}
