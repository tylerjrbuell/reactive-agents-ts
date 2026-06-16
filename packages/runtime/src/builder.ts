import { Effect, Layer } from 'effect'
import { join } from 'node:path'
import { homedir } from 'node:os'
// createRuntime usage extracted to ./builder/build-effect/runtime-construction.ts (W25-B step 7)
// createLightRuntime is no longer used directly from builder.ts.
import { durableConfigHash } from './services/run-store.js'
import type { MCPServerConfig } from './runtime.js'
import {
    defaultTracingConfig,
    deriveGoalAchieved,
    buildSubAgentSystemPrompt,
} from './builder/helpers.js'

// Re-export deriveGoalAchieved (public surface — was exported from builder.ts pre-W25).
export { deriveGoalAchieved } from './builder/helpers.js'
import { serializeBuilder } from './builder/to-config.js'
import type { HarnessProfilePatch } from './capabilities/profile.js'
import { composeHealthLayer } from './builder/build-effect/health-layer.js'
import { composeTracingLayer } from './builder/build-effect/tracing-layer.js'
import { ingestRagDocuments } from './builder/build-effect/rag-ingestion.js'
import { fetchAndMergePricing } from './builder/build-effect/pricing-fetch.js'
import { setupParentContext } from './builder/build-effect/parent-context.js'
import { buildToolMcpRegistrations } from './builder/build-effect/tool-mcp-registrations.js'
import { instantiateAgent } from './builder/build-effect/agent-instantiation.js'
import {
    reactiveAgentsFromConfig,
    reactiveAgentsFromJSON,
} from './builder/api-surface.js'
import {
    applyReactiveIntelligenceOptions,
    applyMemoryOptions,
    applyHookRegistration,
} from './builder/wither-applies.js'
import {
    applyWithoutMemory,
    applyWithLearning,
    applyWithLeanHarness,
    applyWithMemoryConsolidation,
} from './builder/withers/memory.js'
import {
    applyWithModel,
    applyWithBudget,
} from './builder/withers/model-budget.js'
import {
    applyWithTools,
    applyWithTerminalTools,
    applyWithDocuments,
    applyWithRequiredTools,
    applyWithMCP,
    applyWithMetaTools,
} from './builder/withers/tools.js'
import {
    applyWithProfile,
    applyWithErrorHandler,
} from './builder/withers/profile-error.js'
import {
    applyWithSystemPrompt,
    applyWithReasoning,
    applyWithVerificationStep,
} from './builder/withers/prompt-reasoning.js'
import { wireRiHooks, type RiHooks } from './builder/ri-wiring.js'
import {
    buildBaseRuntimeAndEngine,
    type BuilderRuntimeStateView,
} from './builder/build-effect/runtime-construction.js'
import type { TestTurn } from '@reactive-agents/llm-provider'
import type { TaskContract } from '@reactive-agents/core'
import type {
    LifecycleHook,
    ExecutionContext,
    ModelParamsInput,
    ReasoningOptions,
} from './types.js'
import type { RuntimeErrors } from './errors.js'
import { unwrapError } from './errors.js'
import type { ContextProfile } from '@reactive-agents/reasoning'
import type { StrategySynthesisFields } from './reasoning-synthesis-fields.js'
import type { CalibrationMode } from './types.js'
import type {
    ResultCompressionConfig,
    ShellExecuteConfig,
} from '@reactive-agents/tools'
import type { RemoteAgentClient } from '@reactive-agents/tools'
import type { PromptTemplate } from '@reactive-agents/prompts'
import type { StreamDensity } from './stream-types.js'
import type { Redactor, TelemetryConfig } from '@reactive-agents/observability'
import type { DocumentSpec } from './context-ingestion.js'
import type { ChannelsConfig } from "@reactive-agents/channels";
import { Schema } from 'effect'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { toSchemaContract } from '@reactive-agents/reasoning'
import type { SchemaContract } from '@reactive-agents/reasoning'
import type { OutputSchemaOptions } from './builder/types.js'

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

/**
 * Declarative budget caps consulted by the Arbitrator's pre-intent guard.
 *
 * When `tokenLimit` or `costLimit` is reached on the running kernel state,
 * the Arbitrator returns exit-failure with
 * `terminatedBy="budget_exceeded"`, dominating every other intent branch.
 *
 * Structural mirror of the canonical `BudgetLimits` interface in
 * `@reactive-agents/reasoning` (`kernel/capabilities/decide/arbitrator.ts`).
 * Re-declared locally because the canonical type isn't currently re-exported
 * from the reasoning package index; keep field shapes in sync.
 *
 * @see KernelInput.budgetLimits in `packages/reasoning/src/kernel/state/kernel-state.ts`.
 */
export interface BudgetLimits {
    /** Hard cap on cumulative tokens (sum of `state.tokens`). */
    readonly tokenLimit?: number
    /** Hard cap on cumulative cost in USD (sum of `state.cost`). */
    readonly costLimit?: number
    /**
     * Override the warning threshold (default 0.80 = warn at ≥80% of any
     * declared limit). Useful for tighter budgets where the warn band should
     * be wider.
     */
    readonly warningRatio?: number
}

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
 */
export const ReactiveAgents = {
    /**
     * Create a new agent builder with defaults.
     * All builder methods are optional; no configuration is required at creation time.
     */
    create: (): ReactiveAgentBuilder => new ReactiveAgentBuilder(),
    /** Reconstruct a builder from an AgentConfig object. */
    fromConfig: reactiveAgentsFromConfig,
    /** Reconstruct a builder from a JSON string containing an AgentConfig. */
    fromJSON: reactiveAgentsFromJSON,
}

/**
 * Fluent builder for configuring and instantiating Reactive Agents.
 *
 * All builder methods return `this` for method chaining. Call `.build()` or `.buildEffect()`
 * when configuration is complete to instantiate the agent.
 *
 */
export class ReactiveAgentBuilder<TOut = unknown> {
    private _name: string = 'agent'
    private _stableAgentId?: string
    private _provider: ProviderName = 'test'
    private _model?: string
    private _thinking?: boolean
    private _temperature?: number
    private _maxTokens?: number
    private _memoryTier: '1' | '2' = '1'
    /**
     * Memory + skill persistence default-on (GH #122). Lightweight tier-1
     * working memory + SQLite cross-session store ship by default so the
     * compounding-intelligence promise activates without explicit opt-in.
     * Clear control via `.withoutMemory()` (explicit disable) or
     * `.withLeanHarness()` (force-disables memory as part of the
     * latency/cost-sensitive bundle). When the user calls `.withMemory()`
     * explicitly, the option preserves the project-local cwd dbPath; only
     * default-on builds resolve to `~/.reactive-agents/<agentId>/memory.db`.
     */
    private _enableMemory: boolean = true
    /**
     * Explicit-disable flag set by `.withoutMemory()` / `.withLeanHarness()`.
     * Distinguishes "user opted out" from "user did not specify". Wardens
     * and downstream auto-enable rules (e.g. `.withLearning()` re-enable
     * after a lean opt-out) consult this to avoid silently re-enabling
     * something the user explicitly turned off.
     */
    private _memoryExplicitlyDisabled: boolean = false
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
    /**
     * Optional TaskContract declared via {@link withContract}. Enforced at
     * `build()` (build-time): required tools must be exposed, forbidden tools
     * absent, and the resolved model capability must meet `modelFloor`.
     * Violations merge into the existing build-validation errors/warnings path
     * (strict → throw, non-strict → warn). Realization-plan P2 / Drift S7.
     */
    private _taskContract?: TaskContract
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
    private _circuitBreakerConfig?:
        | Partial<import('@reactive-agents/llm-provider').CircuitBreakerConfig>
        | false
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
    private _skillPersistence?: boolean = undefined
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
    /**
     * Declarative budget caps consumed by the Arbitrator's pre-intent guard
     * (Issue #128 / North Star v5.0 Pillar 6). Set via `.withBudget()`;
     * threaded through `RuntimeOptions.budgetLimits` →
     * `ReactiveAgentsConfig.budgetLimits` → `KernelInput.budgetLimits`.
     */
    private _budgetLimits: BudgetLimits | undefined = undefined
    /** Opt-in numeric evidence-grounding config. Absent = off (default). */
    private _groundingConfig: import('./builder/types.js').GroundingOptions | undefined = undefined
    /** Opt-in typed structured output config. Absent = off (default). */
    private _outputSchemaConfig:
        | { readonly contract: SchemaContract<unknown>; readonly options: OutputSchemaOptions }
        | undefined = undefined
    /** Opt-in durable run persistence config. Absent = off (zero overhead, default). */
    private _durableRuns: import('./builder/types.js').DurableRunsOptions | undefined = undefined
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
     * Calibration mode is also resolved automatically from the model id;
     * explicit override here is most useful with the calibration probe
     * harness. Composable equivalent: `HarnessProfile.balanced()` ships
     * registry-driven calibration defaults.
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
     * @see {@link compose} — the composable equivalent (architecture-model
     *   §11.3). The two methods are identical (`compose` is defined as
     *   `this.withHarness(fn)`); use whichever reads more clearly at the
     *   call site.
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
     */
    withSystemPrompt(prompt: string): this {
        return this.withHarness(applyWithSystemPrompt(this, prompt))
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
     * Composable equivalent: `.compose(h => h.on('prompt.system', ...))`
     *   reaches the same prompt-augmentation chokepoint when you need
     *   full control over the injected text.
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
     */
    withModel(model: string): this
    withModel(params: ModelParamsInput): this
    withModel(modelOrParams: string | ModelParamsInput): this {
        applyWithModel(this, modelOrParams)
        return this
    }

    /**
     * Set the LLM provider for the agent.
     *
     * @param provider - One of: `"anthropic"`, `"openai"`, `"ollama"`, `"gemini"`, `"litellm"`, or `"test"`
     * @returns `this` for chaining
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
     */
    withMemory(tierOrOptions?: '1' | '2' | MemoryOptions): this {
        applyMemoryOptions(this, tierOrOptions)
        return this
    }

    /**
     * Persist learned skills across sessions via `@reactive-agents/memory`
     * `SkillStoreService`.
     *
     * Requires memory to be enabled (via `.withMemory()`). When unset, defaults
     * to `true` when memory is enabled — graduates M6 "learning transfers within
     * session but doesn't persist" verdict to KEEP by activating the existing
     * skill-persistence write path in the reactive-intelligence learning engine.
     *
     * Without memory, this flag is ignored: `SkillStoreService` is not in the
     * layer and `agent.skills()` silently returns `[]` via
     * `Effect.serviceOption` at `reactive-agent.ts:370`.
     *
     * @param enabled - When `true` (default), wire `SkillStoreServiceLive`;
     *                  when `false`, explicitly disable even if memory is on.
     * @returns `this` for chaining
     * @see {@link HarnessProfile.intelligent} — composable preset that
     *   bundles this (`enableSkillPersistence: true`) with compounding
     *   cross-session learning. `HarnessProfile.lean()` is the opt-out.
     */
    withSkillPersistence(enabled: boolean = true): this {
        this._skillPersistence = enabled
        return this
    }

    /**
     * Explicit opt-out from default-on memory + cross-session skill persistence
     * (GH #122 control surface).
     *
     * As of v0.12, agent builds include lightweight SQLite memory + skill
     * persistence by default — the compounding-intelligence promise activates
     * without explicit `.withMemory()`. Call `.withoutMemory()` to disable
     * the full memory stack (memory layer, skill persistence, session store,
     * experience learning, memory consolidation) and prevent the runtime
     * from touching the OS-default memory database.
     *
     * Common reasons to call this:
     *   - stateless agents (chat-only, no learning needed)
     *   - tests that mock LLMs and don't want SQLite side effects
     *   - environments without a writable home directory
     *   - workloads where the ~100ms-per-task memory overhead matters
     *
     * Composes cleanly with `.withLeanHarness()` — both force memory off.
     *
     * @returns `this` for chaining
     */
    withoutMemory(): this {
        applyWithoutMemory(this)
        return this
    }

    /**
     * Bundle helper: enable the full compounding-intelligence stack — memory
     * + skill persistence + reactive intelligence — with sensible defaults
     * (GH #122 recommended path).
     *
     * Equivalent to:
     * ```typescript
     *   .withMemory({ tier: 'standard' })
     *   .withSkillPersistence(true)
     *   .withReactiveIntelligence()  // already on by default
     * ```
     *
     * The OS-default dbPath (`~/.reactive-agents/<agentId>/memory.db`)
     * applies when no explicit `opts.dbPath` is provided. Useful as a
     * single-line opt-in to make `agent.skills()` cross-session by default
     * even when the user wants to be explicit about it.
     *
     * @param opts - Memory tier + path overrides
     * @returns `this` for chaining
     * @see {@link HarnessProfile.intelligent} — composable preset that
     *   bundles memory + skill persistence + reactive intelligence. For
     *   memory path overrides, compose:
     *   `.withProfile(HarnessProfile.intelligent()).withMemory({ dbPath })`.
     */
    withLearning(opts?: { tier?: 'standard' | 'enhanced'; dbPath?: string }): this {
        applyWithLearning(this, opts)
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
     * @default 10
     */
    withMaxIterations(n: number): this {
        this._maxIterations = n
        return this
    }

    /**
     * Set declarative budget limits consulted by the Arbitrator's pre-intent
     * guard (Issue #128 / North Star v5.0 Pillar 6).
     *
     * When the running kernel state's `tokens` or `cost` reaches a declared
     * limit, the Arbitrator returns exit-failure with
     * `terminatedBy="budget_exceeded"` — dominating every other termination
     * intent (final-answer, max-iterations, kernel-error, oracle-decision).
     *
     * Routes through the canonical Arbitrator decision instead of a
     * side-channel termination (cf. `compose/killswitches/budget-limit.ts`).
     *
     * @param limits - Budget caps. At least one of `tokenLimit` or `costLimit`
     *                 is required; `warningRatio` is optional (default 0.80).
     * @returns `this` for chaining
     * @throws When neither `tokenLimit` nor `costLimit` is supplied.
     */
    withBudget(limits: BudgetLimits): this {
        applyWithBudget(this, limits)
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
     * Composable equivalent: `.compose(h => h.before(phase, fn) /
     *   h.after(phase, fn))` — lifecycle phase chokepoints are also
     *   first-class on the `Harness` compose API (master plan §11.3).
     */
    withHook(hook: LifecycleHook): this {
        return this.withHarness(applyHookRegistration(this, hook))
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
     * @see {@link HarnessProfile.balanced} — composable preset with the
     *   verifier default-on; `HarnessProfile.lean()` opts out. For
     *   configuration overrides, compose:
     *   `.withProfile(HarnessProfile.balanced()).compose(...)`.
     */
    withVerification(options?: VerificationOptions): this {
        this._enableVerification = true
        if (options) this._verificationOptions = options
        return this
    }

    /**
     * Enable opt-in numeric evidence-grounding. Off by default.
     *
     * When on, figures in the final answer are checked against the FULL tool
     * data (resolved via storedKey to bypass compression) with rounding
     * tolerance. `mode: "warn"` = advisory; `mode: "block"` = one corrective
     * retry then degrade to warn (never hard-fails the run).
     *
     * @param options - Grounding configuration
     * @returns `this` for chaining
     */
    withGrounding(options: import('./builder/types.js').GroundingOptions): this {
        this._groundingConfig = options
        return this
    }

    /**
     * Declare a typed structured output schema (Standard Schema or Effect Schema).
     * `run()` then populates `result.object`. Default lenient: on parse-fail,
     * `object` is undefined and `objectError` is set (use `{ onParseFail: "throw" }` for strict).
     *
     * @param schema - An Effect Schema or any Standard Schema v1-compliant schema
     * @param options - Structured output options (mode, onParseFail, abstainBelow)
     * @returns `this` for chaining
     */
    withOutputSchema<A>(
        schema: StandardSchemaV1<unknown, A> | Schema.Schema<A>,
        options: OutputSchemaOptions = {},
    ): ReactiveAgentBuilder<A> {
        this._outputSchemaConfig = { contract: toSchemaContract(schema) as SchemaContract<unknown>, options }
        return this as unknown as ReactiveAgentBuilder<A>
    }

    /**
     * Opt in to durable run persistence (off by default).
     *
     * When enabled, the runtime generates a stable `runId` for each run,
     * records it in a SQLite `RunStore` (`runs.db` under `dir`, default
     * `~/.reactive-agents/<agentId>/`), and persists a lossless serialized
     * kernel-state snapshot every `checkpointEvery` iterations (default 1).
     * Writes are fire-and-forget — they never block or fail the run. This is
     * the write half of crash-resume; Phase C's `resume(runId)` reads these
     * checkpoints back. Zero cost when not called: no store, no run row, no
     * db file.
     *
     * @param options - Durable run configuration (dir, checkpointEvery)
     * @returns `this` for chaining
     */
    withDurableRuns(options?: import('./builder/types.js').DurableRunsOptions): this {
        this._durableRuns = options ?? {}
        return this
    }

    /**
     * Enable cost tracking to monitor token consumption and estimate USD costs.
     *
     * Optionally provide budget limits to enforce spending caps.
     *
     * @param options - Optional budget limit configuration (USD)
     * @returns `this` for chaining
     * Composable equivalent: `.withObservability({ costs: ... })` for the
     *   tracking, `.withBudget(...)` for spend caps (master plan §11.4).
     *   Cost tracking also rides the observability stack.
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
     * The `CapabilityRegistry` also resolves model pricing automatically
     * from the provider's published rates; use this explicit override for
     * custom / proxied models whose pricing the registry can't infer.
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
     * Dynamic pricing providers can also register with the
     * `CapabilityRegistry` directly; this explicit builder wiring is handy
     * for ad-hoc overrides scoped to a single agent.
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
     * @see {@link HarnessProfile.balanced} — composable preset that ships
     *   the breaker enabled with sensible thresholds. Use this method (or
     *   `.compose(...)` / environment config) to override those thresholds.
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
     * Disable the default-on circuit breaker for non-test providers. Useful for
     * chaos tests that intentionally fault the provider in tight loops (otherwise
     * the breaker would trip after 5 consecutive failures and the test would see
     * fast-fail errors instead of the underlying fault).
     *
     * @returns `this` for chaining
     * @example .withoutCircuitBreaker()
     * @see {@link HarnessProfile.lean} — composable preset that disables
     *   registry default-on capabilities (including the breaker) wholesale.
     *   Use this method when you want to drop only the breaker.
     */
    withoutCircuitBreaker(): this {
        this._circuitBreakerConfig = false
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
     * Limits are also resolved from provider metadata + `CapabilityRegistry`
     * defaults; use this explicit override to pin a per-deployment policy.
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
     * Composable equivalent: `.withObservability({ audit: true })` /
     *   `@reactive-agents/observe` exporters — audit is also a verbosity
     *   tier on the observability stack.
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
     * @see {@link HarnessProfile.balanced} — composable preset with
     *   reasoning + strategy switching default-on; `HarnessProfile.lean()`
     *   opts out entirely. For strategy overrides, compose:
     *   `.withProfile(HarnessProfile.balanced()).compose(...)`.
     */
    withReasoning(options?: ReasoningOptions): this {
        applyWithReasoning(this, options)
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
     * @see {@link HarnessProfile.lean} — composable preset for the
     *   truly-lean composition (MOVE-6 also disables reactive intelligence,
     *   which the standalone `.withLeanHarness()` flag historically left on).
     *   Both wire the same `_leanHarness` substrate flag; use the preset when
     *   you also want RI off.
     */
    withLeanHarness(): this {
        applyWithLeanHarness(this)
        return this
    }

    /**
     * Apply a `HarnessProfile` composition preset (MOVE-6).
     *
     * Three named presets compose default-on capability sets from the
     * `CapabilityRegistry` (MOVE-2):
     *
     *   - `HarnessProfile.lean()` — disable ALL default-on capabilities
     *     (memory + RI + verifier + strategy-switching + skill
     *     persistence). Closes the historical `.withLeanHarness()` leak
     *     that did not disable RI.
     *   - `HarnessProfile.balanced()` — today's production defaults
     *     (no-op patch).
     *   - `HarnessProfile.intelligent()` — balanced + skill persistence
     *     (compounding cross-session learning).
     *
     * Patch fields are applied additively; `undefined` means "no change",
     * boolean values explicitly set the corresponding capability. Later
     * `.withX()` calls override patch fields (e.g.,
     * `.withProfile(HarnessProfile.lean()).withMemory()` re-enables
     * memory on the lean base).
     *
     * @example
     * ```typescript
     * import { ReactiveAgents, HarnessProfile } from 'reactive-agents'
     *
     * const lean = await ReactiveAgents.create()
     *   .withName('lean')
     *   .withProvider('anthropic')
     *   .withProfile(HarnessProfile.lean())  // model + nothing else
     *   .build()
     * ```
     */
    withProfile(profile: HarnessProfilePatch): this {
        applyWithProfile(this, profile)
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
     */
    withTools(options?: ToolsOptions): this {
        applyWithTools(this, options)
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
     * Composable equivalent: `.withTools({ terminal: options ?? true })` —
     *   terminal access is also a `ToolsOptions` field.
     */
    withTerminalTools(options?: ShellExecuteConfig): this {
        applyWithTerminalTools(this, options)
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
     * Composable equivalent: `.withTools({ rag: { documents: docs } })` —
     *   RAG ingestion is also reachable as a tool-layer concern.
     */
    withDocuments(docs: DocumentSpec[]): this {
        applyWithDocuments(this, docs)
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
     */
    withRequiredTools(config: {
        /** Tool names that must be called during execution */
        tools?: readonly string[]
        /** Enable adaptive LLM inference of required tools */
        adaptive?: boolean
        /** Max redirect attempts before failing (default: 2) */
        maxRetries?: number
    }): this {
        applyWithRequiredTools(this, config)
        return this
    }

    /**
     * Enable agent identity and identity verification via Ed25519 certificates.
     *
     * Allows the agent to sign messages and verify the identity of other agents in a network.
     *
     * @returns `this` for chaining
     * Pair with `.withA2A()` / `.withGateway()` for cross-agent
     * verification; identity is also available as a registry-driven
     * capability.
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
     *
     * Composable equivalent: `.withObservability({ cortex: { url } })` —
     *   Cortex is also one of the observability exporters.
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
     * Per-call equivalent: pass `density` directly to
     *   `agent.runStream({ density })`. Use this method to set a build-time
     *   default that every `runStream()` call inherits.
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
     * Composable equivalent: `.withObservability({ telemetry: ... })` —
     *   telemetry is also a verbosity tier on the observability stack.
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
     * Composable equivalent: `.withObservability({ logging: ... })` —
     *   structured logging is also a verbosity tier on the observability
     *   stack.
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
     * Composable equivalent: `.compose(requireApprovalFor(...))` killswitch
     *   (master plan §11.4) — approval gates also compose through the
     *   killswitch set.
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
     * Composable equivalent: `.compose(h => h.on('prompt.system', ...))` /
     *   the `@reactive-agents/prompts` template registry — prompt templates
     *   also flow through the compose chokepoint.
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
     * Related primitives: `.withAgentTool()` / `.withDynamicSubAgents()` /
     *   `.compose(...)` workflow composition can build orchestration from
     *   the sub-agent + compose primitives directly.
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
     * Composable equivalent: the 5 shipped killswitches (master plan §11.4 —
     *   `budgetLimit`, `maxIterations`, `timeoutAfter`, `watchdog`,
     *   `requireApprovalFor`) via `.compose(killSwitch(...))`.
     *   Note: `confidenceFloor` was unshipped 2026-05-19 (Tier 0 honesty sweep,
     *   GH #160) — verify-phase killswitches cannot fire at runtime per the
     *   compose pipeline contract; see `packages/compose/test/killswitches.test.ts`.
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
     * Composable equivalent: `.withGuardrails(...)` +
     *   `.compose(h => h.before('act', ...))` — behavioural contracts also
     *   compose from guardrails plus the pre-act chokepoint.
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
     * @see {@link HarnessProfile.intelligent} — composable preset that
     *   bundles this into the compounding cross-session learning surface.
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
     * @see {@link HarnessProfile.intelligent} — composable preset that
     *   bundles this into the cross-agent learning surface.
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
     * @see {@link HarnessProfile.intelligent} — composable preset that
     *   activates memory consolidation as part of the compounding-
     *   intelligence stack. Use this method for explicit threshold overrides.
     */
    withMemoryConsolidation(config?: {
        threshold?: number
        decayFactor?: number
        pruneThreshold?: number
    }): this {
        applyWithMemoryConsolidation(this, config)
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
     * Note: the EventBus is always active; this method is retained for API
     * compatibility / readability and has no functional effect. Calling
     * `agent.subscribe(...)` works whether or not `withEvents()` was called.
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
     * The model id also drives profile auto-resolution by default (see
     * `resolveProfile()` in `@reactive-agents/reasoning`); use this explicit
     * override when a specific deployment needs to deviate from the tier
     * defaults.
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
     */
    withMCP(config: MCPServerConfig | MCPServerConfig[]): this {
        applyWithMCP(this, config)
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
     *
     * Equivalent env config: `REACTIVE_AGENTS_STRICT_VALIDATION=1`.
     *   `HarnessProfile.balanced()` also enables strict build defaults.
     */
    withStrictValidation(): this {
        this._strictValidation = true
        return this
    }

    /**
     * Declare a {@link TaskContract} the agent must satisfy at build time.
     *
     * `build()` validates the contract against the statically-knowable
     * exposed-tool set and the resolved model capability:
     *   - every `required` tool must be exposed to the agent;
     *   - every `forbidden` tool must be absent;
     *   - the resolved capability must meet `modelFloor` (window / thinking /
     *     nativeFC).
     *
     * Violations route through the SAME build-validation errors/warnings path
     * as missing-API-key and capability-source checks: with
     * `.withStrictValidation()` they are hard errors (build throws); otherwise
     * they are warnings. When MCP servers are configured, a missing `required`
     * tool is downgraded to a warning (MCP tools are discovered at connect
     * time and cannot be verified statically).
     *
     * Build-time enforcement only — threading the contract into the kernel at
     * execute-time is a separate slice.
     *
     * @returns `this` for chaining
     */
    withContract(contract: TaskContract): this {
        this._taskContract = contract
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
     * The default retry policy also resolves from `CapabilityRegistry`; use
     * this explicit override to pin a per-deployment policy.
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
        return this.withHarness(applyWithErrorHandler(this, handler))
    }

    /**
     * Enable health checks for this agent.
     *
     * Adds an `agent.health()` method that returns the current health status
     * with individual check results. Useful for Kubernetes liveness/readiness probes.
     *
     * @returns `this` for chaining
     * Composable equivalent: `.withObservability({ health: true })` —
     *   health checks also ride the observability stack.
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
     * Composable equivalent: the `.compose(...)` minimum-iteration
     *   killswitch variant.
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
     * Composable equivalent: `.compose(h => h.on('prompt.system', ...))`
     *   with task-context formatting.
     */
    withTaskContext(context: Record<string, string>): this {
        this._taskContext = context
        return this
    }

    /**
     * Save a coarse progress checkpoint to PlanStore every N iterations. On
     * restart, session resumption detects the incomplete plan and injects it as
     * prior context (a soft "where was I" hint).
     *
     * **For true crash-resume, use {@link withDurableRuns} instead.** That path
     * persists a lossless serialized `KernelState` per iteration to a SQLite
     * RunStore and exposes `agent.resumeRun(runId)` / `agent.listRuns()` to
     * reconstruct and finish a crashed run from its last checkpoint. This method
     * remains a lighter-weight plan-level hint and does not reconstruct full
     * kernel state.
     * @param every - Checkpoint interval in iterations
     * @param options.autoResume - Automatically resume from last checkpoint (default: false)
     * @returns `this` for chaining
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
     * @see {@link HarnessProfile.balanced} — composable preset with the
     *   verifier default-on; use `.compose(...)` for custom prompts.
     */
    withVerificationStep(
        config: { mode?: 'reflect' | 'loop'; prompt?: string } = {}
    ): this {
        applyWithVerificationStep(this, config)
        return this
    }

    /**
     * Validate the final output before accepting it. If validation fails, the
     * feedback is injected as context and the agent retries (up to maxRetries times).
     * @param validator - Returns { valid, feedback? }; feedback is shown to the agent on retry
     * @param options.maxRetries - Max retry attempts on validation failure (default: 2)
     * @returns `this` for chaining
     * Composable equivalent: `.compose(h => h.before('finalize', validatorFn))`
     *   on the output-assembly chokepoint.
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
     * Composable equivalent: `.compose(h => h.on('arbitrator.decide', fn))`
     *   — termination predicates also compose through the arbitrator
     *   chokepoint.
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
     * @see {@link HarnessProfile.balanced} (RI default-on) /
     *   {@link HarnessProfile.lean} (RI off) — composable presets. Config
     *   overrides also flow through `.compose(...)` or the
     *   `@reactive-agents/reactive-intelligence` layer.
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
        applyReactiveIntelligenceOptions(this, arg)
        return this
    }

    /**
     * Enable the Living Skills System.
     * Skills are discovered from standard filesystem paths, loaded from packages,
     * and evolved over time based on agent performance.
     *
     * @param config - Optional skills configuration
     * @see {@link HarnessProfile.intelligent} — composable preset where
     *   skills graduate as part of the compounding-intelligence stack. Use
     *   this method for explicit path / evolution overrides.
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
     * Composable equivalent: `.withTools({ metaTools: ... })` — meta-tools
     *   are also a `ToolsOptions` field.
     */
    withMetaTools(config?: import('./types.js').MetaToolsConfig | false): this {
        applyWithMetaTools(this, config)
        return this
    }

    /**
     * Set the TTL for semantic cache entries. Cached LLM responses older than
     * this duration will be evicted.
     * @param ms - Cache TTL in milliseconds (default: 3,600,000 = 1 hour)
     * @example .withCacheTimeout(600_000) // 10 minutes
     * Cache lifetime also resolves from `CapabilityRegistry` defaults; use
     * this explicit override for per-deployment tuning.
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
     * Fallback order also resolves from `CapabilityRegistry` provider tiers;
     * use this explicit override to pin a multi-provider deployment chain.
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
     *
     * Composable equivalent: `.withObservability({ tracing: { dir } })` or
     *   the `REACTIVE_AGENTS_TRACE` env config (process-wide) — tracing also
     *   rides the observability stack.
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
     */
    async build(): Promise<ReactiveAgent<TOut>> {
        // Auto-resolve context profile from model name if not explicitly set.
        // resolveProfileWithWindow binds maxTokens to the MODEL's real window
        // (recommendedNumCtx) instead of the tier placeholder — otherwise the
        // placeholder (e.g. mid=32768) masqueraded as a caller-set cap and the
        // runner's applyCapabilityMaxTokens skipped resolution, so builder agents
        // ran at 32768 instead of e.g. haiku's 200k (createRuntime resolved fine
        // → a same-model asymmetry between the two construction paths).
        if (!this._contextProfile && this._model) {
            const { resolveProfileWithWindow } = await import(
                '@reactive-agents/reasoning'
            )
            this._contextProfile = resolveProfileWithWindow(
                this._model,
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
        let taskContractInput:
            | import('./build-validation.js').TaskContractValidationInput
            | undefined
        if (this._taskContract) {
            const { computeExposedToolNames } = await import(
                './builder/contract-tool-set.js'
            )
            taskContractInput = {
                contract: this._taskContract,
                exposedToolNames: computeExposedToolNames(
                    this._toolsOptions,
                    this._requiredToolsConfig?.tools
                ),
                hasMcpServers: this._mcpServers.length > 0,
            }
        }
        // Eager capability prime — run the provider's live discovery probe
        // (Ollama /api/show) and write through to the process-wide registry
        // BEFORE validateBuild's synchronous PreFlight resolve. Without this any
        // pulled model not in the static table resolves at the 2048-ctx
        // `source: "fallback"`, tripping the honesty gate AND under-sizing the
        // first reasoning iteration. Best-effort: never throws, no-op for
        // providers without a probe (anthropic/openai/…).
        const { primeCapability } = await import('@reactive-agents/llm-provider')
        await primeCapability(this._provider, this._model)

        const validation = validateBuild(
            this._provider,
            this._model,
            defaultModel,
            this._strictValidation,
            taskContractInput
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
     */
    buildEffect(): Effect.Effect<ReactiveAgent<TOut>, Error> {
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

            // Parent-context wiring for sub-agent registrations.
            // Extracted to ./builder/build-effect/parent-context.ts (W26-B step 2).
            const parentCtx = setupParentContext()
            const getParentContext = parentCtx.getParentContext

            if (agentTools.length > 0 || allowDynamicSubAgents) {
                yield* parentCtx.registerCaptureHook(engine)
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
            // Extracted to ./builder/build-effect/tool-mcp-registrations.ts (W26-B step 3).
            const { fullRuntime: fullRuntimeAfterTools } =
                yield* buildToolMcpRegistrations({
                    runtimeWithCortex,
                    mcpServers,
                    toolsOptions,
                    agentTools,
                    allowDynamicSubAgents,
                    dynamicSubAgentOptions,
                    agentId,
                    getParentContext,
                    parentProvider,
                    parentModel,
                    parentReasoningOptions,
                    parentEnableGuardrails,
                    parentEnableObservability,
                    parentObservabilityOptions,
                    parentContextProfile,
                    parentEnableCostTracking,
                })
            let fullRuntime: Layer.Layer<unknown, unknown, unknown> = fullRuntimeAfterTools

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

            // ManagedRuntime + ReactiveAgent construction extracted to
            // ./builder/build-effect/agent-instantiation.ts (W26-B step 4).
            return instantiateAgent({
                engine,
                fullRuntime,
                agentId,
                mcpServerNames: mcpServers.map((s) => s.name),
                gatewayOptions,
                streamDensity,
                hasParentCallbacks: agentTools.length > 0 || allowDynamicSubAgents,
                parentCtxRef: parentCtx.ref,
                errorHandler,
                sessionPersist,
                sessionMaxAgeDays,
                ragStore,
                channelsConfig: self._channelsConfig,
                capabilities: {
                    minIterations: self._minIterations,
                    taskContext: self._taskContext,
                    progressCheckpoint: self._progressCheckpoint,
                    verificationStep: self._verificationStep,
                    outputValidator: self._outputValidator,
                    outputValidatorOptions: self._outputValidatorOptions,
                    customTermination: self._customTermination,
                },
                // Phase C: when durable runs are enabled, resolve the same
                // checkpoint dir + identity configHash execute-stream computes
                // at run start, so agent.resume(runId) can open the store and
                // guard config drift. dir derivation MUST mirror
                // execute-stream.ts:175-179.
                durableResume: self._durableRuns
                    ? {
                          dir:
                              self._durableRuns.dir ??
                              join(homedir(), '.reactive-agents', agentId),
                          configHash: durableConfigHash({
                              systemPrompt: composedSystemPrompt,
                              provider: self._provider,
                          }),
                      }
                    : undefined,
                outputSchemaConfig: self._outputSchemaConfig,
                enableTools: self._enableTools,
            })
        }) as Effect.Effect<ReactiveAgent<TOut>, Error>
    }
}
