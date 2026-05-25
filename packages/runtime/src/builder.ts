import {
    Effect,
    Layer,
    ManagedRuntime,
} from 'effect'
// createRuntime usage extracted to ./builder/build-effect/runtime-construction.ts (W25-B step 7)
// createLightRuntime is no longer used directly from builder.ts.
import type { MCPServerConfig } from './runtime.js'
import {
    defaultTracingConfig,
    deriveGoalAchieved,
    buildSubAgentSystemPrompt,
} from './builder/helpers.js'

// Re-export deriveGoalAchieved (public surface — was exported from builder.ts pre-W25).
export { deriveGoalAchieved } from './builder/helpers.js'
import { serializeBuilder } from './builder/to-config.js'
import {
    buildSubAgentTask,
    type SubAgentTaskArgs as ExtractedSubAgentTaskArgs,
} from './builder/build-effect/sub-agent-executor.js'
import { createRemoteAgentToolRegistration } from './builder/build-effect/remote-agent-tools.js'
import {
    createLocalAgentToolRegistration,
    createDynamicSpawnRegistrations,
} from './builder/build-effect/local-agent-tools.js'
import { buildToolInitLayer } from './builder/build-effect/tool-init-layer.js'
import { composeHealthLayer } from './builder/build-effect/health-layer.js'
import { composeTracingLayer } from './builder/build-effect/tracing-layer.js'
import { ingestRagDocuments } from './builder/build-effect/rag-ingestion.js'
import { fetchAndMergePricing } from './builder/build-effect/pricing-fetch.js'
import { wireRiHooks, type RiHooks } from './builder/ri-wiring.js'
import {
    buildBaseRuntimeAndEngine,
    type BuilderRuntimeStateView,
} from './builder/build-effect/runtime-construction.js'
import type { TestTurn } from '@reactive-agents/llm-provider'
import type {
    LifecycleHook,
    ExecutionContext,
    ModelParams,
    ReasoningOptions,
} from './types.js'
import type { RuntimeErrors } from './errors.js'
import { unwrapError } from './errors.js'
import type { ContextProfile } from '@reactive-agents/reasoning'
import type { StrategySynthesisFields } from './reasoning-synthesis-fields.js'
import type { CalibrationMode } from './types.js'
import type {
    ToolDefinition,
    ResultCompressionConfig,
    ShellExecuteConfig,
} from '@reactive-agents/tools'
import { shellExecuteTool, shellExecuteHandler } from '@reactive-agents/tools'
import type { RemoteAgentClient } from '@reactive-agents/tools'
import type { PromptTemplate } from '@reactive-agents/prompts'
import type { StreamDensity } from './stream-types.js'
import type { Redactor, TelemetryConfig } from '@reactive-agents/observability'
import type { DocumentSpec } from './context-ingestion.js'
import type { ChannelsConfig } from "@reactive-agents/channels";

// ─── Public Option/Result Types (W25-A: lifted to ./builder/types.ts) ────────
//
// Public option/result type declarations now live in `./builder/types.ts`.
// Re-exported here so consumer imports continue to work unchanged
// (`import { ToolsOptions } from "@reactive-agents/runtime"`).

import type {
    ProviderName,
    AgentPersona,
    ToolsOptions,
    PromptsOptions,
    MemoryOptions,
    CostTrackingOptions,
    GuardrailsOptions,
    VerificationOptions,
    ObservabilityOptions,
    A2AOptions,
    GatewayOptions,
    GatewaySummary,
    GatewayHandle,
    AgentToolOptions,
    AgentResultMetadata,
    AgentResult,
} from './builder/types.js'

export type {
    ProviderName,
    AgentPersona,
    ToolsOptions,
    PromptsOptions,
    MemoryOptions,
    CostTrackingOptions,
    GuardrailsOptions,
    VerificationOptions,
    ObservabilityOptions,
    A2AOptions,
    GatewayOptions,
    GatewaySummary,
    GatewayHandle,
    AgentToolOptions,
    AgentResultMetadata,
    AgentResult,
} from './builder/types.js'

export type { StrategySynthesisFields } from './reasoning-synthesis-fields.js'
export type { ReasoningOptions } from './types.js'

// ReactiveAgent class moved to ./reactive-agent.ts (W25-E T15).
// Re-export here so consumer imports continue to work unchanged
// (`import { ReactiveAgent } from "@reactive-agents/runtime"`).
import { ReactiveAgent } from './reactive-agent.js'
export { ReactiveAgent } from './reactive-agent.js'


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

    /**
     * Reconstruct a builder from an AgentConfig object.
     *
     * The returned builder is fully configured and can be further customized
     * with additional builder methods before calling `.build()`.
     *
     * @param config - AgentConfig to reconstruct from
     * @returns A configured ReactiveAgentBuilder
     * @example
     * ```typescript
     * const builder = ReactiveAgents.fromConfig(savedConfig);
     * const agent = await builder.build();
     * ```
     */
    fromConfig: async (
        config: import('./agent-config.js').AgentConfig
    ): Promise<ReactiveAgentBuilder> => {
        const { agentConfigToBuilder } = await import('./agent-config.js')
        return agentConfigToBuilder(config)
    },

    /**
     * Reconstruct a builder from a JSON string containing an AgentConfig.
     *
     * Parses and validates the JSON before reconstructing the builder.
     * Throws a ParseError if the JSON is invalid.
     *
     * @param json - JSON string containing a serialized AgentConfig
     * @returns A configured ReactiveAgentBuilder
     * @example
     * ```typescript
     * const builder = await ReactiveAgents.fromJSON(configJson);
     * const agent = await builder.build();
     * ```
     */
    fromJSON: async (json: string): Promise<ReactiveAgentBuilder> => {
        const { agentConfigFromJSON, agentConfigToBuilder } = await import(
            './agent-config.js'
        )
        const config = agentConfigFromJSON(json)
        return agentConfigToBuilder(config)
    },
}

/**
 * Run a user lifecycle hook and route any escaping error to the builder's
 * `_errorHandler` (when set) or `console.warn` (fallback). Resolves HS-14 (#74):
 * hook errors are no longer silently discarded.
 */
async function invokeUserHookSafely(
    self: ReactiveAgentBuilder,
    hook: LifecycleHook,
    ctx: { phase: string; iteration: number },
): Promise<void> {
    const surface = (err: unknown): void => {
        const handler = (self as unknown as { _errorHandler?: (e: RuntimeErrors | Error, c: { taskId: string; phase: string; iteration: number; lastStep?: string }) => void })._errorHandler
        const normalized = err instanceof Error ? err : new Error(String(err))
        if (handler) {
            try {
                handler(normalized, { taskId: '', phase: ctx.phase, iteration: ctx.iteration })
            } catch {
                // Handler-of-handler crash: swallow to avoid recursion; preserve original via console.warn
                console.warn('[reactive-agents] error handler crashed while reporting lifecycle hook failure:', normalized)
            }
            return
        }
        console.warn('[reactive-agents] lifecycle hook threw (no errorHandler registered):', normalized)
    }
    let result: unknown
    try {
        result = hook.handler({ phase: ctx.phase, iteration: ctx.iteration } as ExecutionContext)
    } catch (err) {
        surface(err)
        return
    }
    if (result && typeof (result as { then?: unknown }).then === 'function') {
        try {
            await (result as Promise<unknown>)
        } catch (err) {
            surface(err)
        }
    }
}

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
    private _name: string = 'agent'
    private _stableAgentId?: string
    private _provider: ProviderName = 'test'
    private _model?: string
    private _thinking?: boolean
    private _temperature?: number
    private _maxTokens?: number
    private _memoryTier: '1' | '2' = '1'
    private _enableMemory: boolean = false
    private _hooks: LifecycleHook[] = []
    /**
     * Max kernel iterations override. `undefined` means "honor the
     * tier-resolved contextProfile maxIterations". Setting via
     * `withMaxIterations()` or `withReasoning({ maxIterations })` makes the
     * value an explicit cap that wins over the tier default — see
     * `packages/reasoning/src/strategies/reactive.ts` for the most-restrictive
     * resolution rule.
     */
    private _maxIterations: number | undefined = undefined
    private _enableGuardrails: boolean = false
    private _enableVerification: boolean = false
    private _enableCostTracking: boolean = false
    private _enableAudit: boolean = false
    private _enableReasoning: boolean = false
    private _reasoningOptions?: ReasoningOptions
    private _enableTools: boolean = false
    private _toolsOptions?: ToolsOptions
    private _resultCompression?: ResultCompressionConfig
    private _requiredToolsConfig?: {
        tools?: readonly string[]
        adaptive?: boolean
        maxRetries?: number
    }
    private _enableIdentity: boolean = false
    private _enableObservability: boolean = false
    private _observabilityOptions: ObservabilityOptions = {
        verbosity: 'minimal',
    }
    private _cortexUrl: string | null = null
    private _enableInteraction: boolean = false
    private _enablePrompts: boolean = false
    private _promptsOptions?: PromptsOptions
    private _enableOrchestration: boolean = false
    private _testScenario?: TestTurn[]
    private _extraLayers?: Layer.Layer<any, any, any>
    // Tracing is on by default (Sprint 3.6) so `rax diagnose <runId>` always
    // has data to inspect — a productized DX win. Disable explicitly with
    // .withoutTracing() or by setting REACTIVE_AGENTS_TRACE=off in the env.
    // Resolved lazily in defaultTracingConfig() so env changes apply per build.
    private _tracingConfig: { dir: string } | null = defaultTracingConfig()
    private _mcpServers: MCPServerConfig[] = []
    private _systemPrompt?: string
    private _environmentContext?: Record<string, string>
    private _a2aOptions?: A2AOptions
    private _gatewayOptions?: GatewayOptions
    /** Optional external channel layer (webhooks, bot adapters) wired in {@link ReactiveAgent.start}. */
    private _channelsConfig?: ChannelsConfig
    private _agentTools: AgentToolOptions[] = []
    private _contextProfile?: Partial<ContextProfile>
    private _allowDynamicSubAgents: boolean = false
    private _dynamicSubAgentOptions?: { maxIterations?: number }
    private _persona?: AgentPersona
    private _enableKillSwitch: boolean = false
    private _enableBehavioralContracts: boolean = false
    private _strictValidation: boolean = false
    private _executionTimeoutMs?: number
    private _retryPolicy?: { maxRetries: number; backoffMs: number }
    private _cacheTimeoutMs?: number
    private _behavioralContract?: import('@reactive-agents/guardrails').BehavioralContract
    private _enableSelfImprovement: boolean = false
    private _enableEvents: boolean = false
    private _streamDensity?: StreamDensity
    private _telemetryConfig?: TelemetryConfig
    private _memoryOptions?: MemoryOptions
    private _loggingConfig?: {
        level?: string
        format?: string
        output?: string | WritableStream
    }
    private _costTrackingOptions?: CostTrackingOptions
    private _guardrailsOptions?: GuardrailsOptions
    private _verificationOptions?: VerificationOptions
    private _circuitBreakerConfig?: Partial<
        import('@reactive-agents/llm-provider').CircuitBreakerConfig
    >
    private _rateLimiterConfig?: import('@reactive-agents/llm-provider').RateLimiterConfig
    private _fallbackConfig?: {
        providers?: string[]
        models?: string[]
        errorThreshold?: number
    }
    private _enableExperienceLearning: boolean = false
    private _enableMemoryConsolidation: boolean = false
    private _consolidationConfig?: {
        threshold?: number
        decayFactor?: number
        pruneThreshold?: number
    }
    private _errorHandler?: (
        error: RuntimeErrors | Error,
        context: {
            taskId: string
            phase: string
            iteration: number
            lastStep?: string
        }
    ) => void
    private _enableHealthCheck: boolean = false
    private _minIterations?: number
    private _taskContext?: Record<string, string>
    private _progressCheckpoint?: { every: number; autoResume?: boolean }
    private _verificationStep?: { mode: 'reflect' | 'loop'; prompt?: string }
    private _outputValidator?: (output: string) => {
        valid: boolean
        feedback?: string
    }
    private _outputValidatorOptions?: { maxRetries?: number }
    private _customTermination?: (state: { output: string }) => boolean
    private _enableReactiveIntelligence: boolean = true
    private _reactiveIntelligenceOptions?: Partial<
        import('@reactive-agents/reactive-intelligence').ReactiveIntelligenceConfig
    >
    private _sessionPersist: boolean = false
    private _sessionMaxAgeDays?: number
    private _documents: DocumentSpec[] = []
    private _pricingRegistry: Record<
        string,
        { readonly input: number; readonly output: number }
    > = {}
    private _pricingProvider?: import('@reactive-agents/llm-provider').PricingProvider
    private _skillsConfig?: {
        paths?: string[]
        packages?: string[]
        evolution?: {
            mode?: string
            refinementThreshold?: number
            rollbackOnRegression?: boolean
        }
        overrides?: Record<string, { evolutionMode?: string }>
    }
    private _riHooks?: RiHooks
    private _riConstraints?: {
        allowedStrategySwitch?: string[]
        maxTemperatureAdjustment?: number
        neverEarlyStop?: boolean
        neverHumanEscalate?: boolean
        protectedSkills?: string[]
        lockedSkills?: string[]
    }
    private _riAutonomy?: 'full' | 'suggest' | 'observe'
    private _metaTools?: import('./types.js').MetaToolsConfig | false
    private _calibration: CalibrationMode = 'skip'
    private _leanHarness: boolean = false
    private _harnessRegistrations: Array<(harness: import('@reactive-agents/core').Harness) => void> = []

    // ─── Calibration ───

    /**
     * Configure per-model calibration for this agent.
     *
     * - `"skip"` (default): no lookup, pure tier-based adapters.
     * - `"auto"`: load pre-baked or user-cached calibration for the resolved modelId.
     * - `ModelCalibration` object: provide calibration data directly (e.g. after running
     *   the calibration probe suite).
     *
     * @example
     * ```typescript
     * // Auto-load from pre-baked calibrations (best for supported local models)
     * builder.withCalibration("auto")
     *
     * // Provide custom calibration data
     * builder.withCalibration({ modelId: "my-model", steeringCompliance: "hybrid", ... })
     * ```
     */
    withCalibration(mode: CalibrationMode): this {
        this._calibration = mode
        return this
    }

    // ─── Harness ───

    /**
     * Register a harness composition function that shapes how the agent's kernel
     * emits content — system prompts, nudges, tool results, lifecycle events, etc.
     *
     * Multiple `.withHarness()` calls register additively in declaration order.
     * At `.build()` time all registrations are compiled into a `HarnessPipeline`
     * and attached to the agent's kernel input. Wave B wires the pipeline into
     * kernel chokepoints; Wave A makes the infrastructure available.
     *
     * @example
     * ```typescript
     * builder.withHarness((harness) => {
     *   harness.on('prompt.system', (prompt, ctx) => `${prompt}\n\n[iteration ${ctx.iteration}]`)
     *   harness.tap('lifecycle.failure', (payload) => console.error('failure:', payload))
     * })
     * ```
     */
    withHarness(fn: (harness: import('@reactive-agents/core').Harness) => void): this {
        this._harnessRegistrations = [...this._harnessRegistrations, fn]
        return this
    }

    /**
     * Compose a harness configuration block into this agent.
     *
     * Alias for `.withHarness()`. Preferred for Wave D+ killswitch and composition patterns:
     * ```ts
     * agent.compose(budgetLimit({ maxTokens: 50_000 }))
     * agent.compose(timeoutAfter({ wallClock: '60s' }))
     * agent.compose(h => h.tap('observation.tool-result', logFn))
     * ```
     */
    compose(fn: (harness: import('@reactive-agents/core').Harness) => void): this {
        return this.withHarness(fn)
    }

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
        this._name = name
        return this
    }

    /**
     * Pin a stable agent identity for this agent.
     *
     * When set, `build()` uses this value as the `agentId` instead of generating
     * a new `${name}-${Date.now()}` ID. All memory and run data keyed on `agentId`
     * will accumulate across multiple builds that share the same ID.
     *
     * @param id - The stable identifier to use (e.g. a UUID or Cortex session ID).
     */
    withAgentId(id: string): this {
        this._stableAgentId = id
        return this
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
        this._persona = persona
        return this
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
        this._systemPrompt = prompt
        // Also register as harness transform for Wave B+ pipeline integration
        return this.withHarness((h) => h.on('prompt.system', () => prompt))
    }

    // ─── Environment Context ──────────────────────────────────────────────────

    /**
     * Add custom environment context injected into the system prompt.
     *
     * The framework always injects date, time, timezone, and platform automatically.
     * Use this to add custom context the agent should know without tool calls.
     *
     * @param context - Key-value pairs (e.g., `{ "User Location": "San Francisco, CA" }`)
     * @returns `this` for chaining
     * @example
     * ```typescript
     * builder.withEnvironment({
     *   "User Location": "San Francisco, CA",
     *   "Locale": "en-US",
     *   "Project": "reactive-agents",
     * })
     * ```
     */
    withEnvironment(context: Record<string, string>): this {
        this._environmentContext = { ...this._environmentContext, ...context }
        return this
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
        this._a2aOptions = options ?? { port: 3000 }
        return this
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
        this._gatewayOptions = options ?? {}
        return this
    }

    /**
     * Register the external channel layer (`@reactive-agents/channels`) for webhook/bot ingress.
     *
     * Adapters are started when {@link ReactiveAgent.start} runs (requires `.withGateway()` so the
     * gateway policy engine can evaluate inbound channel `GatewayEvent` values. Use
     * `GatewayOptions.accessControl` for messaging allowlists — separate from this API.
     * messaging allowlists — it is separate from this API.
     *
     * @param config - Adapters, triggers, and optional default agent config
     */
    withChannels(config: ChannelsConfig): this {
        this._channelsConfig = config
        return this
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
    withAgentTool(
        name: string,
        agent: {
            name: string
            description?: string
            provider?: string
            model?: string
            tools?: readonly string[]
            maxIterations?: number
            systemPrompt?: string
            persona?: AgentPersona
        }
    ): this {
        this._agentTools.push({ name, agent })
        return this
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
        this._allowDynamicSubAgents = true
        this._dynamicSubAgentOptions = options
        return this
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
        this._agentTools.push({ name, remoteUrl })
        return this
    }

    // ─── Model & Provider ───

    /**
     * Set the LLM model to use for this agent.
     *
     * Examples: `"claude-opus-4-20250514"`, `"gpt-4-turbo"`, `"mistral-large"`, `"gemini-2.0-flash"`
     *
     * @param modelOrParams - Model identifier string, or ModelParams object with model + thinking/temperature/maxTokens
     * @returns `this` for chaining
     * @example
     * ```typescript
     * builder.withModel("claude-opus-4-20250514")
     * builder.withModel({ model: "qwen3.5", thinking: true, temperature: 0.5 })
     * ```
     */
    withModel(model: string): this
    withModel(params: ModelParams): this
    withModel(modelOrParams: string | ModelParams): this {
        if (typeof modelOrParams === 'string') {
            this._model = modelOrParams
        } else {
            this._model = modelOrParams.model
            if (modelOrParams.thinking !== undefined)
                this._thinking = modelOrParams.thinking
            if (modelOrParams.temperature !== undefined)
                this._temperature = modelOrParams.temperature
            if (modelOrParams.maxTokens !== undefined)
                this._maxTokens = modelOrParams.maxTokens
        }
        return this
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
    withProvider(provider: ProviderName): this {
        this._provider = provider
        return this
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
     * builder.withMemory({ tier: "enhanced", dbPath: "./data/memory.db", capacity: 12 })
     * ```
     */
    withMemory(tierOrOptions?: '1' | '2' | MemoryOptions): this {
        this._enableMemory = true
        if (typeof tierOrOptions === 'string') {
            const newForm =
                tierOrOptions === '2'
                    ? '.withMemory({ tier: "enhanced" })'
                    : '.withMemory()'
            console.warn(
                `⚠ withMemory("${tierOrOptions}") is deprecated. Use ${newForm} instead.`
            )
            this._memoryTier = tierOrOptions
        } else if (tierOrOptions) {
            if (tierOrOptions.tier) {
                this._memoryTier = tierOrOptions.tier === 'enhanced' ? '2' : '1'
            }
            this._memoryOptions = tierOrOptions
        }
        return this
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
        this._maxIterations = n
        return this
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
        this._hooks.push(hook)
        const self = this
        // Also register as harness phase hook for compose-side observability
        if (hook.timing === 'on-error') {
            return this.withHarness((h) => {
                h.onError(hook.phase as import('@reactive-agents/core').Phase, async (_err, ctx) => {
                    await invokeUserHookSafely(self, hook, ctx)
                })
            })
        }
        // For 'before' and 'after' timings
        const kind = hook.timing === 'before' ? 'before' : 'after'
        return this.withHarness((h) => {
            h[kind](hook.phase as import('@reactive-agents/core').Phase, async (ctx) => {
                await invokeUserHookSafely(self, hook, ctx)
            })
        })
    }

    // ─── Optional Features ───

    /**
     * Enable guardrails to protect against injection attacks and PII exposure.
     *
     * Optionally provide configuration to toggle individual detectors.
     *
     * @param options - Optional guardrail configuration
     * @returns `this` for chaining
     */
    withGuardrails(options?: GuardrailsOptions): this {
        this._enableGuardrails = true
        if (options) this._guardrailsOptions = options
        return this
    }

    /**
     * Enable semantic verification to assess confidence in agent outputs.
     *
     * Optionally provide configuration to toggle strategies and set thresholds.
     *
     * @param options - Optional verification configuration
     * @returns `this` for chaining
     */
    withVerification(options?: VerificationOptions): this {
        this._enableVerification = true
        if (options) this._verificationOptions = options
        return this
    }

    /**
     * Enable cost tracking to monitor token consumption and estimate USD costs.
     *
     * Optionally provide budget limits to enforce spending caps.
     *
     * @param options - Optional budget limit configuration (USD)
     * @returns `this` for chaining
     */
    withCostTracking(options?: CostTrackingOptions): this {
        this._enableCostTracking = true
        if (options) this._costTrackingOptions = options
        return this
    }

    /**
     * Sets programmatic pricing for specific models.
     * Useful for explicitly overriding costs for known or custom models.
     *
     * @param registry - Record mapping model IDs to input/output token cost per 1 million tokens
     * @returns `this` for chaining
     */
    withModelPricing(
        registry: Record<
            string,
            { readonly input: number; readonly output: number }
        >
    ): this {
        this._pricingRegistry = { ...this._pricingRegistry, ...registry }
        return this
    }

    /**
     * Register a remote/dynamic pricing provider.
     * Fetches latest pricing data during `.buildEffect()` or `.build()`.
     *
     * @param provider - PricingProvider implementation (e.g., `openRouterPricingProvider`)
     * @returns `this` for chaining
     * @example
     * ```typescript
     * builder.withDynamicPricing(openRouterPricingProvider)
     * ```
     */
    withDynamicPricing(
        provider: import('@reactive-agents/llm-provider').PricingProvider
    ): this {
        this._pricingProvider = provider
        return this
    }

    /**
     * Enable circuit breaker for LLM provider calls.
     *
     * After `failureThreshold` consecutive failures, the breaker opens and fast-fails
     * without hitting the provider. After `cooldownMs`, it enters half-open state
     * to test if the provider has recovered.
     *
     * @param config - Optional circuit breaker thresholds
     * @returns `this` for chaining
     */
    withCircuitBreaker(
        config?: Partial<
            import('@reactive-agents/llm-provider').CircuitBreakerConfig
        >
    ): this {
        this._circuitBreakerConfig = config ?? {}
        return this
    }

    /**
     * Enable rate limiting for LLM requests. Throttles outbound API calls using
     * a sliding window algorithm to prevent 429 errors before they occur.
     *
     * Configurable per-minute request limits, per-minute token limits (estimated),
     * and maximum concurrent in-flight requests.
     *
     * @param config - Optional rate limiter thresholds (defaults: 60 RPM, 100k TPM, 10 concurrent)
     * @returns `this` for chaining
     * @example .withRateLimiting({ requestsPerMinute: 30, tokensPerMinute: 50_000 })
     */
    withRateLimiting(
        config?: import('@reactive-agents/llm-provider').RateLimiterConfig
    ): this {
        this._rateLimiterConfig = config ?? {}
        return this
    }

    /**
     * Enable audit logging for compliance and post-execution analysis.
     *
     * Audit logs record all phase transitions, tool invocations, and decision points.
     *
     * @returns `this` for chaining
     */
    withAudit(): this {
        this._enableAudit = true
        return this
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
        this._enableReasoning = true
        if (options) this._reasoningOptions = options
        if (options?.maxIterations !== undefined)
            this._maxIterations = options.maxIterations
        return this
    }

    /**
     * Enable lean harness mode (Pruning Principle, NLAH arXiv:2603.25723 §9).
     *
     * Bypasses the terminal verifier gate (substitutes a no-op verifier) and
     * disables strategy switching. On frontier models these two mechanisms cost
     * ~13.6× tokens while producing outcomes 0.8 pp worse than the lean config.
     * Use for latency-sensitive or cost-sensitive production workloads where
     * the task does not require grounding or synthesis validation.
     *
     * @returns `this` for chaining
     */
    withLeanHarness(): this {
        this._leanHarness = true
        return this
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
        this._enableTools = true
        if (options) {
            const previous = this._toolsOptions
            this._toolsOptions = {
                ...previous,
                ...options,
                tools: options.tools
                    ? [...(previous?.tools ?? []), ...options.tools]
                    : previous?.tools,
            }
        }
        if (options?.resultCompression) {
            this._resultCompression = options.resultCompression
        }
        return this
    }

    /**
     * Enable/configure the shell-execute tool for safe terminal command execution.
     *
     * Registers the shell-execute tool which allows controlled CLI command execution with:
     * - Allowlisted safe commands (git, ls, cat, grep, find, node, bun, npm, python, curl, echo, mkdir, cp, mv, wc, head, tail, sort, jq)
     * - Blocklist patterns for dangerous operations (rm -rf, chmod 777, sudo, eval, etc.)
     * - Working directory constraint to project root or sandbox
     * - 30s timeout and 4000 char output truncation per command
     *
     * Equivalent to calling `.withTools({ terminal: options ?? true })`.
     *
     * @returns `this` for chaining
     * @example
     * ```typescript
     * const agent = await ReactiveAgents.create()
     *   .withProvider("anthropic")
     *   .withTerminalTools()
     *   .build();
     * ```
     */
    withTerminalTools(options?: ShellExecuteConfig): this {
        this._enableTools = true
        this._toolsOptions = {
            ...this._toolsOptions,
            terminal: options ?? true,
        }
        return this
    }

    /**
     * Pre-load documents into the agent's RAG memory store at build time.
     *
     * Documents are chunked and indexed so the agent can retrieve them via the
     * built-in `rag-search` tool during execution. Call multiple times to
     * accumulate documents. Automatically enables tools if not already enabled.
     *
     * @param docs - Array of document specifications to ingest
     * @returns `this` for chaining
     *
     * @example
     * ```typescript
     * const agent = await ReactiveAgents.create()
     *   .withProvider("anthropic")
     *   .withDocuments([
     *     { content: "Paris is the capital of France.", source: "facts.txt" },
     *     { content: "# API\n\n## Endpoints\n...", source: "api.md", format: "markdown" },
     *   ])
     *   .build();
     * ```
     */
    withDocuments(docs: DocumentSpec[]): this {
        this._documents = [...this._documents, ...docs]
        this._enableTools = true // rag-search needs tools enabled
        return this
    }

    /**
     * Configure tools that MUST be called before the agent can declare success.
     *
     * Supports explicit tool lists, adaptive LLM-powered inference, or both.
     * If the agent attempts to end without using all required tools, the kernel
     * redirects it back to "thinking" with feedback. After `maxRetries` redirects
     * (default: 2), the task fails with a descriptive error.
     *
     * @param config - Required tools configuration
     * @returns `this` for chaining
     *
     * @example
     * ```typescript
     * // Explicit required tools
     * builder.withRequiredTools({ tools: ["web_search", "file_write"] })
     *
     * // Adaptive — LLM infers which tools are required
     * builder.withRequiredTools({ adaptive: true })
     *
     * // Both — explicit tools + LLM infers additional ones
     * builder.withRequiredTools({ adaptive: true, tools: ["send_message"], maxRetries: 3 })
     * ```
     */
    withRequiredTools(config: {
        /** Tool names that must be called during execution */
        tools?: readonly string[]
        /** Enable adaptive LLM inference of required tools */
        adaptive?: boolean
        /** Max redirect attempts before failing (default: 2) */
        maxRetries?: number
    }): this {
        this._requiredToolsConfig = config
        return this
    }

    /**
     * Enable agent identity and identity verification via Ed25519 certificates.
     *
     * Allows the agent to sign messages and verify the identity of other agents in a network.
     *
     * @returns `this` for chaining
     */
    withIdentity(): this {
        this._enableIdentity = true
        return this
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
        this._enableObservability = true
        if (options) this._observabilityOptions = options
        return this
    }

    /**
     * Disable observability layer wiring and console exporters.
     *
     * Use for CI, scripted smoke tests, or hosts that should not print the
     * metrics dashboard on completion. Tracing remains governed separately by
     * `.withTracing()` / `.withoutTracing()` and `REACTIVE_AGENTS_TRACE`.
     */
    withoutObservability(): this {
        this._enableObservability = false
        return this
    }

    /**
     * Enable Cortex event reporting.
     *
     * URL resolution order:
     * 1) explicit `url` argument
     * 2) `CORTEX_URL` environment variable
     * 3) `http://localhost:4321`
     */
    withCortex(url?: string): this {
        this._cortexUrl =
            url ?? process.env.CORTEX_URL ?? 'http://localhost:4321'
        return this
    }

    /**
     * Configure default streaming density for `agent.runStream()` calls.
     *
     * @param options.density - `"tokens"` (default) for TextDelta only, `"full"` for all events
     * @returns `this` for chaining
     */
    withStreaming(options?: { density?: StreamDensity }): this {
        this._streamDensity = options?.density ?? 'tokens'
        return this
    }

    /**
     * Enable opt-in anonymous telemetry for collective intelligence.
     *
     * Captures anonymized per-run metrics (strategy, model tier, token counts, latency,
     * cost) with differential privacy (Laplacian noise). No raw prompts, API keys, or
     * PII ever leave the local process.
     *
     * @param config - Telemetry mode and privacy settings
     * @returns `this` for chaining
     *
     * @example
     * ```typescript
     * builder.withTelemetry({ mode: "contribute" })
     * builder.withTelemetry({ mode: "isolated" }) // local-only, no sharing
     * ```
     */
    withTelemetry(config?: TelemetryConfig): this {
        this._telemetryConfig = config ?? { mode: 'isolated' }
        return this
    }

    /**
     * Configure structured logging with level filtering, format selection, and output routing.
     *
     * The logger filters by the configured level and formats messages as plain text or JSON.
     * Output can be routed to console, files (with rotation), or custom WritableStream.
     *
     * @param config - Logging configuration
     * @param config.level - Minimum log level: "debug" | "info" | "warn" | "error" (default: "info")
     * @param config.format - Output format: "text" | "json" (default: "text")
     * @param config.output - Output destination: "console" | "file" | WritableStream (default: "console")
     * @param config.filePath - File path for file output (required when output: "file")
     * @param config.maxFileSizeBytes - Max file size before rotation (default: 10MB)
     * @param config.maxFiles - Max rotated files to keep (default: 5)
     * @returns `this` for chaining
     * @example
     * ```typescript
     * builder.withLogging({ level: "info", format: "json", output: "file", filePath: "./logs/agent.log" })
     * builder.withLogging({ level: "debug", format: "text", output: "console" })
     * ```
     */
    withLogging(config: {
        level?: 'debug' | 'info' | 'warn' | 'error'
        format?: 'text' | 'json'
        output?: 'console' | 'file' | WritableStream
        filePath?: string
        maxFileSizeBytes?: number
        maxFiles?: number
    }): this {
        this._loggingConfig = config
        return this
    }

    /**
     * Enable interactive collaboration — approval gates and user feedback loops.
     *
     * Allows the agent to pause and request human approval for critical operations.
     *
     * @returns `this` for chaining
     */
    withInteraction(): this {
        this._enableInteraction = true
        return this
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
        this._enablePrompts = true
        if (options) this._promptsOptions = options
        return this
    }

    /**
     * Enable the orchestration layer for multi-agent workflows.
     *
     * Allows defining and executing complex workflows with approval gates and task dependencies.
     *
     * @returns `this` for chaining
     */
    withOrchestration(): this {
        this._enableOrchestration = true
        return this
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
        this._enableKillSwitch = true
        return this
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
    withBehavioralContracts(
        contract: import('@reactive-agents/guardrails').BehavioralContract
    ): this {
        this._enableBehavioralContracts = true
        this._behavioralContract = contract
        return this
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
        this._enableSelfImprovement = true
        return this
    }

    /**
     * Enable ExperienceStore cross-agent learning.
     *
     * Records tool-use patterns and queries them at bootstrap to surface tips from
     * prior runs. Tips are injected into the execution context as `experienceTips`.
     *
     * @returns `this` for chaining
     */
    withExperienceLearning(): this {
        this._enableExperienceLearning = true
        return this
    }

    /**
     * Enable MemoryConsolidatorService background memory intelligence.
     *
     * Periodically consolidates episodic entries, decays semantic importance, and
     * prunes low-importance entries to keep memory manageable.
     *
     * @param config - Optional consolidation thresholds
     * @returns `this` for chaining
     */
    withMemoryConsolidation(config?: {
        threshold?: number
        decayFactor?: number
        pruneThreshold?: number
    }): this {
        this._enableMemoryConsolidation = true
        if (config) this._consolidationConfig = config
        return this
    }

    /**
     * Semantic marker for event subscription intent — no configuration effect.
     *
     * The EventBus is always active on every agent; `withEvents()` is optional and
     * exists purely for readability. Calling `.subscribe()` on the built agent works
     * whether or not `withEvents()` was called.
     *
     * @returns `this` for chaining
     * @example
     * ```typescript
     * const agent = await ReactiveAgents.create()
     *   .withProvider("anthropic")
     *   .withEvents()  // optional — subscribe() always works
     *   .build();
     *
     * agent.subscribe("ToolCallCompleted", (event) => {
     *   console.log(`Tool ${event.toolName} took ${event.durationMs}ms`);
     * });
     * ```
     */
    withEvents(): this {
        this._enableEvents = true
        return this
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
        this._contextProfile = profile
        return this
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
        const configs = Array.isArray(config) ? config : [config]
        this._mcpServers.push(...configs)
        this._enableTools = true
        return this
    }

    // ─── Testing ───

    /**
     * Configure a deterministic multi-turn scenario for the test LLM provider.
     *
     * Turns are consumed sequentially. Each turn produces one LLM response:
     * - `{ text: "..." }` — plain text, stopReason: "end_turn"
     * - `{ toolCall: { name, args } }` — single tool call, stopReason: "tool_use"
     * - `{ toolCalls: [...] }` — parallel tool calls, stopReason: "tool_use"
     * - `{ json: value }` — structured output for completeStructured(), stopReason: "end_turn"
     * - `{ error: "message" }` — throws with that message
     *
     * Add `match?: string` to any turn to guard it with a regex — the turn is only
     * consumed when the LLM input matches the pattern. End scenarios with an
     * unconditional turn as catch-all. The last turn repeats when exhausted.
     *
     * Automatically sets the provider to "test".
     *
     * @param turns - Array of test turns to consume sequentially
     * @returns `this` for chaining
     * @example
     * ```typescript
     * // Simple text response
     * .withTestScenario([{ text: "Paris is the capital of France." }])
     *
     * // Tool loop then final answer
     * .withTestScenario([
     *   { toolCall: { name: "web-search", args: { query: "AI news" } } },
     *   { text: "Here is the summary." },
     * ])
     *
     * // Error injection
     * .withTestScenario([{ error: "rate_limit_exceeded" }])
     * ```
     */
    withTestScenario(turns: TestTurn[]): this {
        this._testScenario = turns
        this._provider = 'test'
        return this
    }

    // ─── Build Options ───

    /**
     * Enable strict build-time validation. Missing API keys and model/provider
     * mismatches become hard errors instead of warnings.
     */
    withStrictValidation(): this {
        this._strictValidation = true
        return this
    }

    /**
     * Set a timeout for agent execution. If the agent doesn't complete within
     * this duration, execution is aborted and an error is thrown.
     * @param ms - Timeout in milliseconds
     * @example .withTimeout(30_000) // 30 seconds
     */
    withTimeout(ms: number): this {
        this._executionTimeoutMs = ms
        return this
    }

    /**
     * Configure retry policy for LLM calls. When an LLM call fails with a
     * transient error (rate limit, network), it will be retried with exponential backoff.
     * @param policy.maxRetries - Maximum number of retries (default: 0 = no retries)
     * @param policy.backoffMs - Base backoff duration in milliseconds (doubled each retry)
     * @example .withRetryPolicy({ maxRetries: 3, backoffMs: 1000 })
     */
    withRetryPolicy(policy: { maxRetries: number; backoffMs: number }): this {
        this._retryPolicy = policy
        return this
    }

    /**
     * Register a global error handler called whenever `agent.run()` encounters a runtime error.
     *
     * The handler is for logging/reporting only — it cannot prevent error propagation.
     * Errors still reject the `run()` promise even when a handler is registered.
     * If the handler itself throws, the exception is silently caught and ignored.
     *
     * @param handler - Callback receiving the error and execution context
     * @returns `this` for chaining
     * @example
     * ```typescript
     * agent
     *   .withErrorHandler((err, ctx) => {
     *     console.error(`[${ctx.phase}] Agent error:`, err.message);
     *     myMonitoring.capture(err);
     *   })
     * ```
     */
    withErrorHandler(
        handler: (
            error: RuntimeErrors | Error,
            context: {
                taskId: string
                phase: string
                iteration: number
                lastStep?: string
            }
        ) => void
    ): this {
        this._errorHandler = handler
        // Also register as harness onError hook for Wave D+ error handling pipeline
        return this.withHarness((h) => {
            h.onError('*', (err, ctx) => {
                handler(err as RuntimeErrors | Error, {
                    taskId: '', // taskId not available in harness ctx
                    phase: ctx.phase as string,
                    iteration: ctx.iteration,
                })
            })
        })
    }

    /**
     * Enable health checks for this agent.
     *
     * Adds an `agent.health()` method that returns the current health status
     * with individual check results. Useful for Kubernetes liveness/readiness probes.
     *
     * @returns `this` for chaining
     * @example
     * ```typescript
     * const agent = await ReactiveAgents.create()
     *   .withProvider("anthropic")
     *   .withHealthCheck()
     *   .build();
     * const health = await agent.health();
     * // { status: "healthy", checks: [...] }
     * ```
     */
    withHealthCheck(): this {
        this._enableHealthCheck = true
        return this
    }

    /**
     * Require at least N iterations before the agent can declare success.
     * Blocks the fast-path and hides the final-answer tool until the minimum
     * is reached. Only iterations that include at least one tool call count.
     * @param n - Minimum number of iterations required
     * @returns `this` for chaining
     * @example
     * ```typescript
     * const agent = await ReactiveAgents.create()
     *   .withProvider("anthropic")
     *   .withMinIterations(3)
     *   .build();
     * ```
     */
    withMinIterations(n: number): this {
        this._minIterations = n
        return this
    }

    /**
     * Provide background data injected into the reasoning memory context.
     * Unlike systemPrompt (instructions), taskContext is treated as grounding
     * data — facts about the current task, project, or environment.
     * @param context - Key-value pairs injected as a "Task Context" section
     * @returns `this` for chaining
     * @example
     * ```typescript
     * const agent = await ReactiveAgents.create()
     *   .withProvider("anthropic")
     *   .withTaskContext({ projectName: "acme", environment: "production" })
     *   .build();
     * ```
     */
    withTaskContext(context: Record<string, string>): this {
        this._taskContext = context
        return this
    }

    /**
     * Save a progress checkpoint to PlanStore every N iterations.
     * Enables resumable long-running agents — on restart, session resumption
     * detects the incomplete plan and injects it as prior context.
     *
     * **Note:** PlanStore write execution is pending (V1.1). This method stores
     * the config and the session resumption context will surface it, but
     * mid-run checkpointing requires kernel-level hooks not yet wired.
     * @param every - Checkpoint interval in iterations
     * @param options.autoResume - Automatically resume from last checkpoint (default: false)
     * @returns `this` for chaining
     * @example
     * ```typescript
     * const agent = await ReactiveAgents.create()
     *   .withProvider("anthropic")
     *   .withProgressCheckpoint(5, { autoResume: true })
     *   .build();
     * ```
     */
    withProgressCheckpoint(
        every: number,
        options?: { autoResume?: boolean }
    ): this {
        this._progressCheckpoint = { every, ...options }
        return this
    }

    /**
     * Run a verification pass after the initial reasoning result before accepting it.
     * In "reflect" mode (default), one LLM call reviews the output and confirms
     * completeness. In "loop" mode, the agent re-enters the ReAct loop with tools.
     * @param config.mode - "reflect" (default) or "loop"
     * @param config.prompt - Custom verification prompt (optional)
     * @returns `this` for chaining
     * @example
     * ```typescript
     * const agent = await ReactiveAgents.create()
     *   .withProvider("anthropic")
     *   .withVerificationStep({ mode: "reflect" })
     *   .build();
     * ```
     */
    withVerificationStep(
        config: { mode?: 'reflect' | 'loop'; prompt?: string } = {}
    ): this {
        this._verificationStep = {
            mode: config.mode ?? 'reflect',
            prompt: config.prompt,
        }
        return this
    }

    /**
     * Validate the final output before accepting it. If validation fails, the
     * feedback is injected as context and the agent retries (up to maxRetries times).
     * @param validator - Returns { valid, feedback? }; feedback is shown to the agent on retry
     * @param options.maxRetries - Max retry attempts on validation failure (default: 2)
     * @returns `this` for chaining
     * @example
     * ```typescript
     * const agent = await ReactiveAgents.create()
     *   .withProvider("anthropic")
     *   .withOutputValidator(
     *     (output) => ({ valid: output.includes("COMPLETE"), feedback: "Must include COMPLETE marker" }),
     *     { maxRetries: 3 }
     *   )
     *   .build();
     * ```
     */
    withOutputValidator(
        validator: (output: string) => { valid: boolean; feedback?: string },
        options?: { maxRetries?: number }
    ): this {
        this._outputValidator = validator
        this._outputValidatorOptions = options
        return this
    }

    /**
     * Provide a custom termination predicate. After each reasoning result, this
     * function is called with the output. If it returns false, the agent re-runs
     * with the prior output as context, up to 3 additional times.
     * @param fn - Predicate receiving { output: string }; return true to accept the result
     * @returns `this` for chaining
     * @example
     * ```typescript
     * const agent = await ReactiveAgents.create()
     *   .withProvider("anthropic")
     *   .withCustomTermination(({ output }) => output.includes("DONE"))
     *   .build();
     * ```
     */
    withCustomTermination(fn: (state: { output: string }) => boolean): this {
        this._customTermination = fn
        return this
    }

    /**
     * Configure the Reactive Intelligence Layer — entropy-based metacognitive sensing.
     *
     * The Entropy Sensor monitors reasoning quality per-iteration across 5 sources
     * (token, structural, semantic, behavioral, context pressure) and publishes
     * EntropyScored events to the EventBus for observability.
     *
     * Reactive Intelligence is enabled by default. Pass `false` to disable it.
     *
     * @example .withReactiveIntelligence(false) // disable RI
     * @example .withReactiveIntelligence({ controller: { earlyStop: true } })
     */
    withReactiveIntelligence(enabled: boolean): this
    withReactiveIntelligence(
        options?: Partial<
            import('@reactive-agents/reactive-intelligence').ReactiveIntelligenceConfig
        > &
            RiHooks & {
                constraints?: {
                    allowedStrategySwitch?: string[]
                    maxTemperatureAdjustment?: number
                    neverEarlyStop?: boolean
                    neverHumanEscalate?: boolean
                    protectedSkills?: string[]
                    lockedSkills?: string[]
                }
                autonomy?: 'full' | 'suggest' | 'observe'
            }
    ): this
    withReactiveIntelligence(
        arg?:
            | boolean
            | (Partial<
                  import('@reactive-agents/reactive-intelligence').ReactiveIntelligenceConfig
              > &
                  Record<string, any>)
    ): this {
        if (typeof arg === 'boolean') {
            this._enableReactiveIntelligence = arg
            return this
        }
        this._enableReactiveIntelligence = true
        if (arg) {
            const {
                onEntropyScored,
                onControllerDecision,
                onSkillActivated,
                onSkillRefined,
                onSkillConflict,
                onMidRunAdjustment,
                constraints,
                autonomy,
                ...riConfig
            } = arg as any
            this._reactiveIntelligenceOptions = riConfig
            if (
                onEntropyScored ||
                onControllerDecision ||
                onSkillActivated ||
                onSkillRefined ||
                onSkillConflict ||
                onMidRunAdjustment
            ) {
                this._riHooks = {
                    onEntropyScored,
                    onControllerDecision,
                    onSkillActivated,
                    onSkillRefined,
                    onSkillConflict,
                    onMidRunAdjustment,
                }
            }
            if (constraints) this._riConstraints = constraints
            if (autonomy) this._riAutonomy = autonomy
        }
        return this
    }

    /**
     * Enable the Living Skills System.
     * Skills are discovered from standard filesystem paths, loaded from packages,
     * and evolved over time based on agent performance.
     *
     * @param config - Optional skills configuration
     * @example
     * ```typescript
     * builder.withSkills({
     *   paths: ["./my-skills/"],
     *   evolution: { mode: "suggest", refinementThreshold: 10 },
     *   overrides: { "my-critical-skill": { evolutionMode: "locked" } },
     * })
     * ```
     */
    withSkills(config?: {
        paths?: string[]
        packages?: string[]
        evolution?: {
            mode?: string
            refinementThreshold?: number
            rollbackOnRegression?: boolean
        }
        overrides?: Record<string, { evolutionMode?: string }>
    }): this {
        this._skillsConfig = config ?? {}
        return this
    }

    /**
     * Enable the Conductor's Suite meta-tools: brief, find, pulse, recall.
     * Also injects the harness skill into the agent's operating context.
     *
     * @example
     * ```typescript
     * builder.withMetaTools()  // Enable all with defaults
     * builder.withMetaTools({ harnessSkill: "./my-harness.md" })
     * builder.withMetaTools({ brief: true, pulse: true })
     * ```
     */
    withMetaTools(config?: import('./types.js').MetaToolsConfig | false): this {
        if (config === false) {
            this._metaTools = false
        } else {
            this._metaTools = config ?? {
                brief: true,
                find: true,
                pulse: true,
                recall: true,
                harnessSkill: true,
            }
        }
        return this
    }

    /**
     * Set the TTL for semantic cache entries. Cached LLM responses older than
     * this duration will be evicted.
     * @param ms - Cache TTL in milliseconds (default: 3,600,000 = 1 hour)
     * @example .withCacheTimeout(600_000) // 10 minutes
     */
    withCacheTimeout(ms: number): this {
        this._cacheTimeoutMs = ms
        return this
    }

    /**
     * Configure provider and model fallbacks for graceful degradation.
     *
     * When the primary provider errors consecutively (3x by default), switches
     * to the next provider in the chain. On 429 rate limits, falls back to a
     * cheaper model from the same provider.
     *
     * @param config - Fallback chain configuration with provider, model, and error threshold
     * @returns `this` for chaining
     * @example
     * ```typescript
     * builder.withFallbacks({
     *   providers: ["anthropic", "openai"],
     *   models: ["claude-sonnet-4-20250514", "claude-haiku-3-20250520"],
     *   errorThreshold: 3,
     * })
     * ```
     */
    withFallbacks(config: {
        providers?: string[]
        models?: string[]
        errorThreshold?: number
    }): this {
        this._fallbackConfig = config
        return this
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
        this._extraLayers = layers
        return this
    }

    /**
     * Enable JSONL trace persistence.
     *
     * Each run writes a `<runId>.jsonl` file to `dir` containing all trace events
     * (entropy scores, reactive decisions, strategy switches).
     *
     * @param opts.dir - Directory to write JSONL files (default: `.reactive-agents/traces`)
     * @example
     * ```typescript
     * builder.withTracing({ dir: "./traces" })
     * ```
     */
    withTracing(opts: { dir?: string } = {}): this {
        this._tracingConfig = { dir: opts.dir ?? `.reactive-agents/traces` }
        return this
    }

    /**
     * Disable JSONL trace persistence (Sprint 3.6).
     *
     * Tracing is on by default at `~/.reactive-agents/traces`. Use this when
     * you don't want disk writes (CI, ephemeral containers, sensitive runs
     * where you'd rather rely on in-memory observability only). For a
     * process-wide off switch, set `REACTIVE_AGENTS_TRACE=off` in the env.
     */
    withoutTracing(): this {
        this._tracingConfig = null
        return this
    }

    // ─── Serialization ───

    /**
     * Serialize the builder's current configuration to an `AgentConfig` object.
     *
     * The returned config is a plain JSON-serializable object that can be stored,
     * transmitted, and later reconstructed via `ReactiveAgents.fromConfig()` or
     * `ReactiveAgents.fromJSON()`.
     *
     * @returns AgentConfig representing the current builder state
     * @example
     * ```typescript
     * const config = builder.toConfig();
     * const json = JSON.stringify(config);
     * // Later:
     * const agent = await ReactiveAgents.fromConfig(config).build();
     * ```
     */
    toConfig(): import('./agent-config.js').AgentConfig {
        return serializeBuilder(this as unknown as import('./builder/to-config.js').BuilderStateForSerialization)
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
        // Auto-resolve context profile from model name if not explicitly set
        if (!this._contextProfile && this._model) {
            const { resolveProfile } = await import(
                '@reactive-agents/reasoning'
            )
            this._contextProfile = resolveProfile(
                this._model,
                undefined,
                this._provider
            )
        }

        // Build-time validation
        const { validateBuild, validateProviderConnection, logBuildInfo } =
            await import('./build-validation.js')
        let defaultModel = 'unknown'
        try {
            const { getProviderDefaultModel } = await import(
                '@reactive-agents/llm-provider'
            )
            defaultModel = getProviderDefaultModel(this._provider) ?? 'unknown'
        } catch {
            // ignore — provider defaults unavailable
        }
        const validation = validateBuild(
            this._provider,
            this._model,
            defaultModel,
            this._strictValidation
        )
        for (const warning of validation.warnings) {
            console.warn(`⚠ ${warning}`)
        }
        if (validation.errors.length > 0) {
            throw new Error(
                `Build validation failed:\n${validation.errors
                    .map((e) => `  • ${e}`)
                    .join('\n')}`
            )
        }

        // Pre-flight connection check for local providers
        const conn = await validateProviderConnection(this._provider)
        if (!conn.ok) {
            throw new Error(`Provider connection failed: ${conn.error}`)
        }

        logBuildInfo(this._provider, validation.resolvedModel)

        const agent = await Effect.runPromise(this.buildEffect()).catch((e) => {
            throw unwrapError(e)
        })

        // RI hook subscription — extracted to ./builder/ri-wiring.ts (W25-C step 1)
        if (this._riHooks) {
            await wireRiHooks(agent, this._riHooks)
        }

        return agent
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
        const agent = await this.build()
        try {
            return await agent.run(input)
        } finally {
            await agent.dispose()
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
        const self = this

        return Effect.gen(function* () {
            // Validate provider API key exists at build time (fast fail in strict mode, warn in non-strict)
            // Non-strict warnings are already emitted by build() before calling buildEffect().
            if (self._strictValidation) {
                const keyMap: Record<string, string | undefined> = {
                    anthropic: 'ANTHROPIC_API_KEY',
                    openai: 'OPENAI_API_KEY',
                    gemini: 'GOOGLE_API_KEY',
                }
                const requiredKey = keyMap[self._provider]
                if (requiredKey && !process.env[requiredKey]) {
                    return yield* Effect.fail(
                        new Error(
                            `Missing API key: ${requiredKey} is not set. Provider "${self._provider}" requires it.`
                        )
                    )
                }
            }

            // Automatically fetch remote pricing if a provider was configured.
            // Extracted to ./builder/build-effect/pricing-fetch.ts (W26-B step 1).
            {
                const { registry } = yield* fetchAndMergePricing({
                    pricingProvider: self._pricingProvider,
                    pricingRegistry: self._pricingRegistry,
                    strict: self._strictValidation,
                })
                self._pricingRegistry = registry
            }

            const agentId = self._stableAgentId ?? `${self._name}-${Date.now()}`

            // Compose persona into system prompt if provided
            const composedSystemPrompt = buildSubAgentSystemPrompt(
                self._persona,
                self._systemPrompt,
                self._name
            )

            // Base runtime + cortex + meta-tools + engine resolution — extracted to
            // ./builder/build-effect/runtime-construction.ts (W25-B step 7).
            const { baseRuntime, runtimeWithCortex, engine, kernelMetaTools } =
                yield* buildBaseRuntimeAndEngine({
                    agentId,
                    composedSystemPrompt,
                    state: self as unknown as BuilderRuntimeStateView,
                })

            const hooks = [...self._hooks]
            const mcpServers = [...self._mcpServers]
            const toolsOptions = self._toolsOptions
            const promptsOptions = self._promptsOptions
            const a2aOptions = self._a2aOptions
            const gatewayOptions = self._gatewayOptions
            const agentTools = self._agentTools
            const allowDynamicSubAgents = self._allowDynamicSubAgents
            const dynamicSubAgentOptions = self._dynamicSubAgentOptions
            const parentProvider = self._provider
            const parentModel = self._model
            const streamDensity = self._streamDensity
            const errorHandler = self._errorHandler
            const enableHealthCheck = self._enableHealthCheck
            const sessionPersist = self._sessionPersist
            const sessionMaxAgeDays = self._sessionMaxAgeDays
            const documents = [...self._documents]
            const agentIdCapture = agentId

            // Capture parent config for sub-agent inheritance — sub-agents get
            // the same infrastructure as the parent without explicit configuration.
            const parentReasoningOptions = self._reasoningOptions
            const parentEnableGuardrails = self._enableGuardrails
            const parentEnableObservability = self._enableObservability
            const parentObservabilityOptions = self._observabilityOptions
            const parentContextProfile = self._contextProfile
            const parentEnableCostTracking = self._enableCostTracking

            for (const hook of hooks) {
                yield* engine.registerHook(hook)
            }

            // Mutable ref for parent execution context — updated by the execution
            // engine during the ACT phase so sub-agent handlers can read the parent's
            // accumulated tool results and forward them as context.
            let parentExecutionContextRef: {
                toolResults: Array<{ toolName: string; result: string }>
                taskDescription?: string
            } | null = null

            /** Lazily read parent context from the mutable ref. */
            const getParentContext = ():
                | import('@reactive-agents/tools').ParentContext
                | undefined => {
                if (!parentExecutionContextRef) return undefined
                const ctx = parentExecutionContextRef
                const items: Array<{ toolName: string; result: string }> =
                    ctx.toolResults ?? []
                if (items.length === 0 && !ctx.taskDescription) return undefined
                return {
                    toolResults: items.map((tr) => ({
                        toolName: tr.toolName,
                        result: tr.result,
                    })),
                    taskDescription: ctx.taskDescription,
                }
            }

            // Register internal hook to capture parent context for sub-agent forwarding.
            // Task description is pre-set by runEffect() before execution starts.
            // This hook updates tool results after each ACT phase.
            if (agentTools.length > 0 || allowDynamicSubAgents) {
                yield* engine.registerHook({
                    phase: 'act' as const,
                    timing: 'after' as const,
                    handler: (ctx: ExecutionContext) =>
                        Effect.sync(() => {
                            const toolResults = (ctx.toolResults ?? []).map(
                                (tr: any) => ({
                                    toolName: String(
                                        tr.toolName ?? tr.name ?? 'unknown'
                                    ),
                                    result: String(
                                        tr.result ?? tr.output ?? ''
                                    ).slice(0, 200),
                                })
                            )
                            // Preserve task description set by runEffect(), update tool results
                            parentExecutionContextRef = {
                                toolResults,
                                taskDescription:
                                    parentExecutionContextRef?.taskDescription,
                            }
                            return ctx
                        }),
                })
            }

            // Register custom prompt templates if configured
            if (
                promptsOptions?.templates &&
                promptsOptions.templates.length > 0
            ) {
                const { PromptService } = yield* Effect.promise(
                    () => import('@reactive-agents/prompts')
                )
                const promptService = yield* (PromptService as any).pipe(
                    Effect.provide(baseRuntime)
                )
                for (const template of promptsOptions.templates) {
                    yield* (promptService as any).register(template)
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
            let fullRuntime: Layer.Layer<unknown, unknown, unknown> =
                runtimeWithCortex

            if (
                agentTools.length > 0 ||
                allowDynamicSubAgents ||
                mcpServers.length > 0 ||
                (toolsOptions?.tools?.length ?? 0) > 0 ||
                toolsOptions?.terminal !== undefined
            ) {
                const toolsMod = yield* Effect.promise(
                    () => import('@reactive-agents/tools')
                )

                const {
                    createAgentTool,
                    createRemoteAgentTool,
                    executeRemoteAgentTool,
                } = toolsMod

                // Collect (definition, handler) pairs — no registration yet.
                type RegEntry = {
                    def: ToolDefinition
                    handler: (
                        args: Record<string, unknown>
                    ) => Effect.Effect<unknown, Error>
                }
                const registrations: RegEntry[] = []

                for (const agentTool of agentTools) {
                    if (agentTool.remoteUrl) {
                        registrations.push(
                            createRemoteAgentToolRegistration(
                                {
                                    name: agentTool.name,
                                    remoteUrl: agentTool.remoteUrl,
                                },
                                {
                                    createRemoteAgentTool,
                                    executeRemoteAgentTool,
                                }
                            )
                        )
                    } else if (agentTool.agent) {
                        registrations.push(
                            createLocalAgentToolRegistration(agentTool, {
                                toolsMod: {
                                    createAgentTool,
                                    createSubAgentExecutor:
                                        toolsMod.createSubAgentExecutor,
                                },
                                agentId,
                                getParentContext,
                            })
                        )
                    }
                }

                // Mutable ref for the parent's ToolService — set during agentToolInitEffect,
                // read by spawn handler at call time. This avoids duplicate MCP containers
                // by letting sub-agents proxy tool calls through the parent's live connections.
                let parentToolServiceRef: any = null

                /** Per-task arguments for a single sub-agent dispatch. */
                type SubAgentTaskArgs = {
                    task: string
                    name: string
                    role?: string
                    instructions?: string
                    tone?: string
                    tools?: string[]
                }

                // Register the built-in spawn-agent tool when dynamic sub-agents are enabled.
                // The handler captures parentProvider/parentModel so spawned agents inherit
                // the parent's LLM config without any extra wiring required.
                if (allowDynamicSubAgents) {
                    const defaultMaxIter =
                        dynamicSubAgentOptions?.maxIterations ?? 4

                    /**
                     * Build and execute a single sub-agent task.
                     * Shared by spawnHandler (singular) and spawnAgentsHandler (batch).
                     *
                     * Body lifted to ./builder/build-effect/sub-agent-executor.ts
                     * (W25-T4). This wrapper captures local closure refs and
                     * delegates — no behavior change.
                     */
                    const buildSingleSubAgentTask = (
                        t: SubAgentTaskArgs
                    ): Promise<
                        import('@reactive-agents/tools').SubAgentResult
                    > =>
                        buildSubAgentTask(
                            t as ExtractedSubAgentTaskArgs,
                            {
                                parentProvider,
                                parentModel,
                                defaultMaxIter,
                                getParentToolService: () =>
                                    parentToolServiceRef,
                                mcpServers,
                                parentReasoningOptions,
                                parentEnableGuardrails,
                                parentEnableObservability,
                                parentObservabilityOptions,
                                parentContextProfile,
                                parentEnableCostTracking,
                                getParentContext,
                                toolsMod: {
                                    createSubAgentExecutor:
                                        toolsMod.createSubAgentExecutor,
                                    ALWAYS_INCLUDE_TOOLS:
                                        toolsMod.ALWAYS_INCLUDE_TOOLS,
                                },
                            }
                        )

                    for (const reg of createDynamicSpawnRegistrations({
                        toolsMod: {
                            createSpawnAgentTool: toolsMod.createSpawnAgentTool,
                            createSpawnAgentsTool:
                                toolsMod.createSpawnAgentsTool,
                        },
                        buildSubAgentTask: buildSingleSubAgentTask,
                    })) {
                        registrations.push(reg)
                    }
                }

                // agentToolInitEffect body extracted to ./builder/build-effect/tool-init-layer.ts (W25-B step 3c)
                const toolInitLayer = buildToolInitLayer(
                    runtimeWithCortex,
                    {
                        toolsMod: {
                            ToolService: toolsMod.ToolService,
                        },
                        mcpServers,
                        toolsOptions,
                        registrations,
                        shellExecuteTool,
                        shellExecuteHandler,
                        onToolServiceResolved: (ts) => {
                            parentToolServiceRef = ts
                        },
                    }
                )

                fullRuntime = Layer.merge(runtimeWithCortex, toolInitLayer)
            }

            // RAG ingestion + meta-tool back-fill — extracted to ./builder/build-effect/rag-ingestion.ts (W25-B step 4)
            const ragStore = yield* ingestRagDocuments({
                documents,
                toolsOptions,
                agentTools,
                allowDynamicSubAgents,
                mcpServers,
                kernelMetaTools,
            })

            // Wire health layer when enabled — extracted to ./builder/build-effect/health-layer.ts (W25-B step 5)
            fullRuntime = composeHealthLayer(fullRuntime, {
                enableHealthCheck,
                agentName: agentIdCapture,
            })

            // Wire tracing layers when .withTracing() was called — extracted to ./builder/build-effect/tracing-layer.ts (W25-B step 6)
            fullRuntime = yield* composeTracingLayer(fullRuntime, {
                tracingConfig: self._tracingConfig,
            })

            // Create a ManagedRuntime so all facade calls (run, subscribe, pause, etc.)
            // share the same layer scope and the same service instances
            // (EventBus, KillSwitch, etc.).
            //
            // The cast to `Layer<any, never, never>` collapses three boundary
            // facts that TS can't see through the `unknown` triple:
            //   • RIn = never — every dynamically-merged sub-layer in
            //     createRuntime has had its requirements satisfied internally
            //     (see runtime.ts), so the composed layer has no unprovided
            //     deps.
            //   • E   = never — layer construction is total at this point;
            //     init failures throw, not flow through E.
            //   • ROut = any — the materialised service union is opaque (15+
            //     conditional optional services). ReactiveAgent stores it as
            //     `ManagedRuntime<any, never>` and resolves services
            //     on-demand at the `runPromise` boundary.
            // This single cast replaces the 6× `Layer<any, any>` casts that
            // previously papered over the same boundary mismatch.
            const managedRuntime = ManagedRuntime.make(
                fullRuntime as unknown as Layer.Layer<any, never, never>,
            )
            return new ReactiveAgent(
                engine,
                agentId,
                managedRuntime,
                mcpServers.map((s) => s.name),
                !!gatewayOptions,
                gatewayOptions?.heartbeat?.intervalMs,
                !!gatewayOptions?.heartbeat?.instruction,
                gatewayOptions?.persistMemoryAcrossRuns === true,
                streamDensity,
                // Pass a callback so run() can set the task description before execution starts.
                // This ensures sub-agents spawned on the very first iteration have the full user prompt.
                agentTools.length > 0 || allowDynamicSubAgents
                    ? (desc: string) => {
                          if (parentExecutionContextRef) {
                              parentExecutionContextRef.taskDescription = desc
                          } else {
                              parentExecutionContextRef = {
                                  toolResults: [],
                                  taskDescription: desc,
                              }
                          }
                      }
                    : undefined,
                errorHandler,
                sessionPersist,
                sessionMaxAgeDays,
                ragStore,
                self._channelsConfig,
                {
                    minIterations: self._minIterations,
                    taskContext: self._taskContext,
                    progressCheckpoint: self._progressCheckpoint,
                    verificationStep: self._verificationStep,
                    outputValidator: self._outputValidator,
                    outputValidatorOptions: self._outputValidatorOptions,
                    customTermination: self._customTermination,
                }
            )
        }) as Effect.Effect<ReactiveAgent, Error>
    }
}
