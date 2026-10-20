import { Effect, Layer } from 'effect'
import { join } from 'node:path'
import { homedir } from 'node:os'
// createRuntime usage extracted to ./builder/build-effect/runtime-construction.ts (W25-B step 7)
// createLightRuntime is no longer used directly from builder.ts.
// build()/buildEffect() bodies extracted to ./builder/build/ (2026-10-20 decomp).
import type { MCPServerConfig } from './runtime.js'
import { serializeBuilder } from './builder/to-config.js'
// MCP toolkit scaffolding (2026-09-19) — type-only import, matching the
// existing ResultCompressionConfig/RemoteAgentClient style below; the
// runtime value (`defaultRegistries`) is dynamically imported inside
// `build()` alongside this file's other `@reactive-agents/tools` runtime
// access (see tool-mcp-registrations.ts for the established pattern).
import type { MCPToolkitRequest, MCPVolumeMount, ToolParameter } from '@reactive-agents/tools'
import { buildAgent } from './builder/build/build-agent.js'
import { runBuilderBuildEffect } from './builder/build/build-effect.js'
import { asBuilderState } from './builder/withers/_state.js'
import {
    defaultTracingConfig,
    deriveGoalAchieved,
} from './builder/helpers.js'

// Re-export deriveGoalAchieved (public surface — was exported from builder.ts pre-W25).
export { deriveGoalAchieved } from './builder/helpers.js'
import {
    reactiveAgentsFromConfig,
    reactiveAgentsFromJSON,
} from './builder/api-surface.js'
import type { HarnessProfilePatch } from './capabilities/profile.js'
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
    applyWithThinking,
} from './builder/withers/model-budget.js'
import {
    applyWithTools,
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
import {
    applyWithName,
    applyWithAgentId,
    applyWithPersona,
    applyWithEnvironment,
    applyWithA2A,
    applyWithGateway,
    applyWithChannels,
    applyWithProvider,
    applyWithAgentTool,
    applyWithDynamicSubAgents,
    applyWithRemoteAgent,
} from './builder/withers/identity-surface.js'
import {
    applyWithGuardrails,
    applyWithVerification,
    applyWithJudgment,
    applyWithGrounding,
    applyWithReceiptSigning,
    applyWithFabricationGuard,
    applyWithStallPolicy,
    applyWithKillSwitch,
    applyWithBehavioralContracts,
} from './builder/withers/quality-guardrails.js'
import {
    applyWithLongHorizon,
    applyWithAdaptiveHarness,
    applyWithModelRouting,
    applyWithDurableRuns,
    applyWithUserInteraction,
    applyWithApprovalPolicy,
    applyWithContract,
    applyWithTimeout,
    applyWithLlmTimeout,
    applyWithRetryPolicy,
} from './builder/withers/horizon-contract.js'
import {
    applyWithObservability,
    applyWithoutObservability,
    applyWithCortex,
    applyWithStreaming,
    applyWithLogging,
    applyWithPrompts,
    applyWithAudit,
} from './builder/withers/observability-exporters.js'
import {
    applyWithModelPricing,
    applyWithDynamicPricing,
    applyWithCircuitBreaker,
    applyWithoutCircuitBreaker,
    applyWithRateLimiting,
    applyWithFallbacks,
    applyWithLayers,
    applyWithOpenInference,
    applyWithReplayLLM,
    applyWithTracing,
} from './builder/withers/model-reliability.js'
import {
    applyWithCostTracking,
    applyWithSelfImprovement,
    applyWithExperienceLearning,
    applyWithHealthCheck,
    applyWithMinIterations,
    applyWithMaxIterations,
    applyWithTaskContext,
    applyWithOutputValidator,
    applyWithCustomTermination,
    applyWithToolIntent,
    applyWithSkillPersistence,
    applyWithSkills,
} from './builder/withers/capability-progress.js'
import {
    applyWithTestScenario,
    applyWithStrictValidation,
    applyWithLazyValidation,
} from './builder/withers/validation-testing.js'
import type { BuilderRuntimeStateView } from './builder/build-effect/runtime-construction.js'
import type { RiHooks } from './builder/ri-wiring.js'
import type { TestTurn, LLMService } from '@reactive-agents/llm-provider'
import type { TaskContract } from '@reactive-agents/core'
import type {
    LifecycleHook,
    ExecutionContext,
    ModelParamsInput,
    ReasoningOptions,
} from './types.js'
import type { RuntimeErrors } from './errors.js'
import { unwrapError } from './errors.js'
import type { ContextProfile, HarnessConfig } from '@reactive-agents/reasoning'
import type { StrategySynthesisFields } from './reasoning-synthesis-fields.js'
import type { CalibrationMode } from './types.js'
import type { ResultCompressionConfig } from '@reactive-agents/tools'
import type { RemoteAgentClient } from '@reactive-agents/tools'
import type { PromptTemplate } from '@reactive-agents/prompts'
import type { StreamDensity } from './stream-types.js'
import type { Redactor, TelemetryConfig } from '@reactive-agents/observability'
import { OpenInferenceTracerLayer } from '@reactive-agents/observe'
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
    RequiredToolsOptions,
    PromptsOptions,
    MemoryOptions,
    CostTrackingOptions,
    GuardrailsOptions,
    VerificationOptions,
    JudgmentBuilderOptions,
    JudgmentSites,
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
    RequiredToolsOptions,
    PromptsOptions,
    MemoryOptions,
    CostTrackingOptions,
    GuardrailsOptions,
    VerificationOptions,
    JudgmentBuilderOptions,
    JudgmentSites,
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

    // ── Execution-cap folds (audit #9): the budget domain opener also carries
    // the iteration/timeout caps. Each routes to the SAME state slot as its
    // standalone wither (one slot, one serialization path). Absent = unchanged.
    /** Iteration cap — equivalent to `.withMaxIterations(n)`. */
    readonly maxIterations?: number
    /** Minimum iterations before termination — equivalent to `.withMinIterations(n)`. */
    readonly minIterations?: number
    /** Whole-run timeout in ms — equivalent to `.withTimeout(ms)`. */
    readonly timeout?: number
    /** Per-LLM-call timeout in ms (local providers) — equivalent to `.withLlmTimeout(ms)`. */
    readonly llmTimeout?: number
}

// Keystone (spec §6.5 G13) — budget cluster. BudgetLimits lives here (not
// builder/types.ts), so its schema-coverage assertion lives here too: every
// BudgetConfigSchema field must be present on BudgetLimits with a compatible
// type, else this fails to compile.
type _AssertTrue<T extends true> = T
type _BudgetCovers<S, O> = keyof S extends keyof O
    ? S extends Pick<O, keyof S & keyof O>
        ? true
        : false
    : false
type _KeystoneBudget = _AssertTrue<
    _BudgetCovers<import('./agent-config.js').BudgetConfig, BudgetLimits>
>

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
/**
 * Options for {@link ReactiveAgents.quick}. Every field falls back to an
 * environment variable and then a sensible default, so `quick()` with no
 * arguments works out of the box.
 */
export interface QuickOptions {
    /** Provider override. Default: `REACTIVE_AGENTS_PROVIDER`, else the first of anthropic/openai/gemini whose key is present, else `ollama`. */
    readonly provider?: ProviderName
    /** Model override. Default: `REACTIVE_AGENTS_MODEL`, else the provider's default model. */
    readonly model?: string
    /** Kernel iteration cap. Default: `REACTIVE_AGENTS_MAX_ITERATIONS`, else `10`. */
    readonly maxIterations?: number
}

const QUICK_KEYED_PROVIDERS: readonly ProviderName[] = [
    'anthropic',
    'openai',
    'gemini',
    'groq',
    'xai',
]

/**
 * Resolve a ready-to-build builder from the environment for {@link ReactiveAgents.quick}.
 * Provider precedence: explicit option → `REACTIVE_AGENTS_PROVIDER` → first
 * keyed provider with a key present → `ollama` (keyless local fallback).
 */
async function resolveQuickBuilder(
    options?: QuickOptions,
): Promise<ReactiveAgentBuilder> {
    const { readProviderApiKey } = await import('./build-validation.js')
    const envProvider = process.env.REACTIVE_AGENTS_PROVIDER as
        | ProviderName
        | undefined
    const provider: ProviderName =
        options?.provider ??
        envProvider ??
        QUICK_KEYED_PROVIDERS.find((p) => readProviderApiKey(p)) ??
        'ollama'

    let model = options?.model ?? process.env.REACTIVE_AGENTS_MODEL
    if (!model) {
        try {
            const { getProviderDefaultModel } = await import(
                '@reactive-agents/llm-provider'
            )
            model = getProviderDefaultModel(provider) ?? undefined
        } catch {
            // Provider defaults unavailable — leave model unset so the provider
            // layer resolves its own baked-in default.
        }
    }

    const maxIterations =
        options?.maxIterations ??
        (process.env.REACTIVE_AGENTS_MAX_ITERATIONS
            ? Number(process.env.REACTIVE_AGENTS_MAX_ITERATIONS)
            : 10)

    let builder = new ReactiveAgentBuilder()
        .withProvider(provider)
        .withMaxIterations(maxIterations)
    if (model) builder = builder.withModel(model)
    return builder
}

export const ReactiveAgents = {
    /**
     * Create a new agent builder with defaults.
     * All builder methods are optional; no configuration is required at creation time.
     */
    create: (): ReactiveAgentBuilder => new ReactiveAgentBuilder(),
    /**
     * Two-line first-touch entry point: resolve provider + model +
     * maxIterations from the environment (and sensible defaults), then build a
     * ready-to-run agent.
     *
     * ```ts
     * const agent = await ReactiveAgents.quick()
     * const result = await agent.run('Say hello')
     * ```
     *
     * Provider is picked from `REACTIVE_AGENTS_PROVIDER`, else the first of
     * anthropic/openai/gemini with a key in the environment, else `ollama`.
     * Override any field via {@link QuickOptions}. A misconfigured environment
     * (missing key) warns at build and surfaces a clean typed error at run()
     * time; add {@link withStrictValidation} to fail fast at build instead.
     */
    quick: async (options?: QuickOptions): Promise<ReactiveAgent> => {
        const builder = await resolveQuickBuilder(options)
        return builder.build()
    },
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
    /**
     * True once the user has expressed an explicit provider intent, via
     * `.withProvider(...)` or the dedicated test-scaffolding arm
     * `.withTestScenario(...)`. `build()` uses this to warn when the provider
     * would silently resolve to the `"test"` default (W0.3 front-door truth:
     * canned output reporting success without ever calling a model).
     */
    private _providerExplicit: boolean = false
    private _providerConfig?: { baseUrl?: string; apiKey?: string; headers?: Record<string, string> }
    private _model?: string
    private _thinking?: boolean
    private _thinkingOptions?: import('@reactive-agents/llm-provider').ThinkingOptions
    private _temperature?: number
    private _maxTokens?: number
    /**
     * Context window declared via `.withModel({ numCtx })`. Written by
     * `applyWithModel` through the wither state view; declared here because
     * `build()` reads it directly to register a caller-supplied capability when
     * the live probe cannot run.
     */
    private _numCtx?: number
    private _memoryTier: '1' | '2' = '1'
    /**
     * Memory is OFF by default (v0.12 — "Durable & Honest"). A bare
     * `.create()....build()` is stateless: no `~/.reactive-agents/memory/<agentId>/`
     * SQLite writes, predictable in CI, no surprise cross-session state.
     * Opt in with one line — `.withMemory()` (tier-1 working memory + SQLite
     * cross-session store) — or via `HarnessProfile.balanced()` /
     * `.intelligent()`, both of which enable it explicitly. A bare
     * `.withMemory()` (no `dbPath`) resolves to a stable user-scope store at
     * `~/.reactive-agents/memory/<agentId>/memory.db`; pass `.withMemory({ dbPath })`
     * to use a custom path. Under `test` provider / `NODE_ENV=test`
     * it resolves to SQLite `:memory:` so runs never write to disk.
     *
     * Migration from v0.11 (memory was default-on, GH #122): add `.withMemory()`
     * to any agent that relied on implicit cross-session memory.
     */
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
    /** `.withJudgment()` — opts the runtime into a resolvable `JudgmentService`. Off by default. */
    private _enableJudgment: boolean = false
    private _judgmentShadowDbPath?: string
    private _enableCostTracking: boolean = false
    private _enableAudit: boolean = false
    private _enableReasoning: boolean = false
    private _reasoningOptions?: ReasoningOptions
    private _enableTools: boolean = false
    private _toolsOptions?: ToolsOptions
    private _scratchpad: Map<string, string> = new Map()
    private _resultCompression?: ResultCompressionConfig
    private _requiredToolsConfig?: {
        tools?: readonly string[]
        adaptive?: boolean
        maxRetries?: number
    }
    private _enableObservability: boolean = false
    private _observabilityOptions: ObservabilityOptions = {
        verbosity: 'minimal',
    }
    private _cortexUrl: string | null = null
    private _enablePrompts: boolean = false
    private _promptsOptions?: PromptsOptions
    private _testScenario?: TestTurn[]
    // ROut is contravariant on `Layer` (`in ROut`), so `never` — not `unknown`
    // — is the maximally-permissive success-channel type here: it accepts a
    // layer providing ANY service. `unknown` would reject every concrete
    // layer (see withLayers() below for why `any` was replaced with this
    // rather than `unknown`).
    private _extraLayers?: Layer.Layer<never, unknown, unknown>
    private _openInferenceAdded?: boolean
    // Exact target type: this is force-cast to `Layer.Layer<LLMService>` at
    // the sole consumption site (runtime-construction.ts, RuntimeOptions
    // .llmOverrideLayer). Typing it precisely here removes that cast.
    private _llmOverrideLayer?: Layer.Layer<LLMService>
    // Tracing is on by default (Sprint 3.6) so `rax diagnose <runId>` always
    // has data to inspect — a productized DX win. Disable explicitly with
    // .withObservability({ tracing: false }) or REACTIVE_AGENTS_TRACE=off.
    // Resolved lazily in defaultTracingConfig() so env changes apply per build.
    private _tracingConfig: { dir: string } | null = defaultTracingConfig()
    private _mcpServers: MCPServerConfig[] = []
    // MCP toolkit scaffolding (2026-09-19) — `.withMCP(catalogName, options?)`
    // requests, stored synchronously here (mirroring `_mcpServers`'s own
    // sync-storage pattern) and resolved via the id-keyed `defaultRegistries`
    // lookup (`MCPToolkitRequest.registry`, defaults to `"docker-hub"`)
    // inside `.build()`, then merged into `_mcpServers` before the runtime
    // layer reads it.
    private _mcpToolkitRequests: MCPToolkitRequest[] = []
    private _systemPrompt?: string
    private _environmentContext?: Record<string, string>
    private _a2aOptions?: A2AOptions
    private _gatewayOptions?: GatewayOptions
    /** Optional external channel layer (webhooks, bot adapters) wired in {@link ReactiveAgent.start}. */
    private _channelsConfig?: ChannelsConfig
    private _agentTools: AgentToolOptions[] = []
    private _contextProfile?: Partial<ContextProfile>
    private _allowDynamicSubAgents: boolean = false
    private _dynamicSubAgentOptions?: { maxIterations?: number; maxRecursionDepth?: number }
    private _persona?: AgentPersona
    private _enableKillSwitch: boolean = false
    private _enableBehavioralContracts: boolean = false
    private _strictValidation: boolean = false
    /**
     * When true, keeps the missing-API-key and unknown-for-provider-model gates
     * as warnings even under {@link withStrictValidation}. These gates warn by
     * default (build succeeds; run() surfaces a clean typed error), so this is
     * only meaningful alongside strict mode. Set by {@link withLazyValidation}
     * or the `REACTIVE_AGENTS_LAZY_VALIDATION` env var.
     */
    private _lazyValidation: boolean =
        process.env.REACTIVE_AGENTS_LAZY_VALIDATION === '1' ||
        process.env.REACTIVE_AGENTS_LAZY_VALIDATION === 'true'
    /**
     * Optional TaskContract declared via {@link withContract}. Enforced at
     * `build()` (build-time): required tools must be exposed, forbidden tools
     * absent, and the resolved model capability must meet `modelFloor`.
     * Violations merge into the existing build-validation errors/warnings path
     * (strict → throw, non-strict → warn). Realization-plan P2 / Drift S7.
     */
    private _taskContract?: TaskContract
    private _executionTimeoutMs?: number
    private _ollamaTimeoutMs?: number
    private _retryPolicy?: { maxRetries: number; backoffMs: number }
    private _behavioralContract?: import('@reactive-agents/guardrails').BehavioralContract
    private _enableSelfImprovement: boolean = false
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
    private _judgmentOptions?: JudgmentBuilderOptions
    private _circuitBreakerConfig?:
        | Partial<import('@reactive-agents/llm-provider').CircuitBreakerConfig>
        | false
    private _rateLimiterConfig?: import('@reactive-agents/llm-provider').RateLimiterConfig
    private _fallbackConfig?: {
        providers?: string[]
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
    private _verificationStep?: { mode: 'reflect'; prompt?: string }
    private _outputValidator?: (output: string) => {
        valid: boolean
        feedback?: string
    }
    private _outputValidatorOptions?: { maxRetries?: number }
    private _customTermination?: (state: { output: string }) => boolean
    private _toolIntentClassifier?: (message: string) => boolean
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
        paths: readonly string[]
        activate?: readonly string[]
    }
    private _riHooks?: RiHooks
    private _metaTools?: import('./types.js').MetaToolsConfig | false
    // `undefined` = never set (auto-enabled when reasoning is on). An explicit
    // `.withCalibration("skip")` is honored as a real opt-out. See P0-9.
    private _calibration?: CalibrationMode
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
    /** Opt-in Ed25519 receipt-signing private key (Arc 1 Task 9). Absent = unsigned receipt (default). */
    private _receiptSigningKey: JsonWebKey | undefined = undefined
    /** Fabrication-guard mode. Absent = "block" (always-on default). */
    private _fabricationGuard: import('@reactive-agents/reasoning').FabricationGuardMode | undefined = undefined
    /** Stall/no-progress policy override. Absent = sensible defaults. */
    private _stallPolicy: import('@reactive-agents/reasoning').StallPolicy | undefined = undefined
    /** Opt-in long-horizon guard profile. false = today's absolute-count guards (default). */
    private _longHorizon: boolean = false
    /** Opt-in adaptive harness (Phase 6 / G1). false = no plan compiled, config byte-identical (default). */
    private _adaptiveHarness: boolean = false
    /** Opt-in cost-aware model routing. Absent = off (default). */
    private _modelRouting: import('./builder/types.js').ModelRoutingOptions | undefined = undefined
    /** Opt-in typed structured output config. Absent = off (default). */
    private _outputSchemaConfig:
        | { readonly contract: SchemaContract<unknown>; readonly options: OutputSchemaOptions }
        | undefined = undefined
    /** Opt-in durable run persistence config. Absent = off (zero overhead, default). */
    private _durableRuns: import('./builder/types.js').DurableRunsOptions | undefined = undefined
    /** Opt-in durable HITL approval policy (Phase D). Absent = off (default). */
    private _approvalPolicy: import('./builder/types.js').ApprovalPolicyConfig | undefined = undefined
    /** Agentic-UI (Task 11): opt-in agent-initiated user interaction (request_user_input). Requires durable runs. */
    private _userInteraction = false
    private _harnessRegistrations: Array<(harness: import('@reactive-agents/core').Harness) => void> = []

    // ─── Calibration ───

    /**
     * Configure per-model calibration for this agent.
     *
     * - `"skip"`: no lookup, pure tier-based adapters. Honored even when
     *   reasoning is enabled — an explicit opt-out (P0-9).
     * - `"auto"`: load pre-baked or user-cached calibration for the resolved modelId.
     * - `ModelCalibration` object: provide calibration data directly (e.g. after running
     *   the calibration probe suite).
     *
     * Default when unset: calibration auto-enables (`"auto"`) if reasoning is
     * active, otherwise none.
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
    withHarness(fn: (harness: import('@reactive-agents/core').Harness) => void): this
    /**
     * Configure harness mechanisms directly — the switches that decide how much
     * the harness spends per model turn and how much it hides from the model.
     *
     * This is the second, unrelated overload of `.withHarness()`: the pipeline-
     * composition overload above registers a `Harness` callback, this one
     * merges a plain data object. They are distinguished at the call site by
     * argument shape (function vs plain config object) and never collide in
     * practice — no `HarnessConfig` field is itself callable.
     *
     * Precedence: this config wins over the matching `RA_`-prefixed
     * environment variable, which wins over the built-in default. Calls
     * merge, so `.withHarness({a}).withHarness({b})` keeps both.
     *
     * @example
     * // Small-model profile: show everything, no discovery round trips:
     * .withHarness({ lazyDisclosure: false, toolDiscovery: false, verboseRules: true })
     *
     * @see {@link HarnessProfile} — capability presets (memory/RI/verifier).
     *   `.withHarness()` is the mechanism layer beneath them.
     * @returns `this` for chaining
     */
    withHarness(config: HarnessConfig): this
    withHarness(
        arg: ((harness: import('@reactive-agents/core').Harness) => void) | HarnessConfig,
    ): this {
        if (typeof arg === 'function') {
            this._harnessRegistrations = [...this._harnessRegistrations, arg]
            return this
        }
        this._reasoningOptions = {
            ...this._reasoningOptions,
            harness: { ...this._reasoningOptions?.harness, ...arg },
        }
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
     * Delegates to `applyWithName` in `builder/withers/identity-surface.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withName(name: string): this {
        applyWithName(asBuilderState(this), name)
        return this
    }

    /**
     * Pin a stable agent identity for this agent.
     * Delegates to `applyWithAgentId` in `builder/withers/identity-surface.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withAgentId(id: string): this {
        applyWithAgentId(asBuilderState(this), id)
        return this
    }

    /**
     * Set the agent's persona — a structured way to define behavior and characteristics.
     * Delegates to `applyWithPersona` in `builder/withers/identity-surface.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withPersona(persona: AgentPersona): this {
        applyWithPersona(asBuilderState(this), persona)
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
     * Delegates to `applyWithEnvironment` in `builder/withers/identity-surface.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withEnvironment(context: Record<string, string>): this {
        applyWithEnvironment(asBuilderState(this), context)
        return this
    }

    // ─── A2A ────────────────────────────────────────────────────────────────────

    /**
     * Enable Agent-to-Agent (A2A) protocol server for remote agent invocation.
     * Delegates to `applyWithA2A` in `builder/withers/identity-surface.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withA2A(options?: A2AOptions): this {
        applyWithA2A(asBuilderState(this), options)
        return this
    }

    // ─── Gateway ────────────────────────────────────────────────────────────────

    /**
     * Enable the persistent gateway for autonomous agent behavior.
     * Delegates to `applyWithGateway` in `builder/withers/identity-surface.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withGateway(options?: GatewayOptions): this {
        applyWithGateway(asBuilderState(this), options)
        return this
    }

    /**
     * Register the external channel layer (`@reactive-agents/channels`) for webhook/bot ingress.
     * Delegates to `applyWithChannels` in `builder/withers/identity-surface.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withChannels(config: ChannelsConfig): this {
        applyWithChannels(asBuilderState(this), config)
        return this
    }

    // ─── Agent Tools ─────────────────────────────────────────────────────────────

    /**
     * Register a local agent as a callable tool for real sub-agent delegation.
     * Delegates to `applyWithAgentTool` in `builder/withers/identity-surface.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
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
            parameters?: ReadonlyArray<ToolParameter>
            requiresApproval?: boolean
            timeoutMs?: number
        }
    ): this {
        applyWithAgentTool(asBuilderState(this), name, agent)
        return this
    }

    /**
     * Allow this agent to dynamically spawn sub-agents at runtime via the `spawn-agent` tool.
     * Delegates to `applyWithDynamicSubAgents` in `builder/withers/identity-surface.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withDynamicSubAgents(options?: {
        maxIterations?: number
        maxRecursionDepth?: number
    }): this {
        applyWithDynamicSubAgents(asBuilderState(this), options)
        return this
    }

    /**
     * Register a remote A2A agent as a callable tool for distributed agent networks.
     * Delegates to `applyWithRemoteAgent` in `builder/withers/identity-surface.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withRemoteAgent(name: string, remoteUrl: string): this {
        applyWithRemoteAgent(asBuilderState(this), name, remoteUrl)
        return this
    }

    // ─── Model & Provider ───

    /**
     * Set the LLM model to use for this agent.
     *
     * Examples: `"claude-opus-4-20250514"`, `"gpt-4-turbo"`, `"mistral-large"`, `"gemini-2.0-flash"`
     *
     * @param model - Model identifier string
     * @param params - ModelParams object with model + thinking/temperature/maxTokens/numCtx
     * @param params.model - Model identifier (provider-specific). Examples: `"claude-opus-4-20250514"`, `"gpt-4-turbo"`, `"gemini-2.0-flash"`
     * @param params.thinking - Enable/disable thinking mode (auto-detect if omitted). Default: undefined
     * @param params.temperature - Sampling temperature 0.0-1.0. Default: undefined (provider default)
     * @param params.maxTokens - Maximum output tokens. Default: undefined (provider default)
     * @param params.numCtx - Context window size for local providers (Ollama `options.num_ctx`); ignored by hosted providers. Default: undefined
     * @returns `this` for chaining
     */
    withModel(model: string): this
    withModel(params: ModelParamsInput): this
    withModel(modelOrParams: string | ModelParamsInput): this {
        applyWithModel(this, modelOrParams)
        return this
    }

    /**
     * Enable native thinking / reasoning mode with optional effort + budget.
     * Rich-config home; `.withModel({thinking})` remains the quick boolean.
     * @param options `true`/absent enable, `false` disable, or `{ effort, budgetTokens }`.
     */
    withThinking(options?: boolean | import('@reactive-agents/llm-provider').ThinkingOptions): this {
        applyWithThinking(this, options)
        return this
    }

    /**
     * Set the LLM provider for the agent.
     * Delegates to `applyWithProvider` in `builder/withers/identity-surface.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withProvider(provider: ProviderName, config?: { baseUrl?: string; apiKey?: string; headers?: Record<string, string> }): this {
        applyWithProvider(asBuilderState(this), provider, config)
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
     * Persist learned skills across sessions via `@reactive-agents/memory`.
     * Delegates to `applyWithSkillPersistence` in `builder/withers/capability-progress.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withSkillPersistence(enabled: boolean = true): this {
        applyWithSkillPersistence(asBuilderState(this), enabled)
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
     * The OS-default dbPath (`~/.reactive-agents/memory/<agentId>/memory.db`)
     * applies when no explicit `opts.dbPath` is provided. Useful as a
     * single-line opt-in to make `agent.skills()` cross-session by default
     * even when the user wants to be explicit about it.
     *
     * @param opts - Memory tier + path overrides
     * @param opts.tier - `"standard"` (FTS5 keyword search) or `"enhanced"` (FTS5 + vector search). Default: `"standard"`
     * @param opts.dbPath - Custom SQLite database path. Default: `.reactive-agents/memory/{agentId}/memory.db`
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
     * Delegates to `applyWithMaxIterations` in `builder/withers/capability-progress.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withMaxIterations(n: number): this {
        applyWithMaxIterations(asBuilderState(this), n)
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
     * @param hook - Lifecycle hook configuration (`phase`, `timing`, `handler`)
     * @param hook.phase - Lifecycle phase to hook into (e.g. `"act"`, `"think"`, `"finalize"`)
     * @param hook.timing - When to invoke: `"before"` or `"after"` the phase
     * @param hook.handler - Receives the execution context; return a modified context or nothing to observe. Plain values, Promises, and Effects are all accepted.
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
     * Delegates to `applyWithGuardrails` in `builder/withers/quality-guardrails.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withGuardrails(options?: GuardrailsOptions): this {
        applyWithGuardrails(asBuilderState(this), options)
        return this
    }

    /**
     * Enable semantic verification to assess confidence in agent outputs.
     * Delegates to `applyWithVerification` in `builder/withers/quality-guardrails.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withVerification(options?: VerificationOptions): this {
        applyWithVerification(asBuilderState(this), options)
        return this
    }

    /**
     * Enable the optional `JudgmentService` (calibrated Choice/Score/Noul.
     * Delegates to `applyWithJudgment` in `builder/withers/quality-guardrails.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withJudgment(options?: JudgmentBuilderOptions): this {
        applyWithJudgment(asBuilderState(this), options)
        return this
    }

    /**
     * Enable opt-in numeric evidence-grounding. Off by default.
     * Delegates to `applyWithGrounding` in `builder/withers/quality-guardrails.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withGrounding(options: import('./builder/types.js').GroundingOptions): this {
        applyWithGrounding(asBuilderState(this), options)
        return this
    }

    /**
     * Opt in to an Ed25519 provenance signature on the trust receipt.
     * Delegates to `applyWithReceiptSigning` in `builder/withers/quality-guardrails.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withReceiptSigning(options: import('./builder/types.js').ReceiptSigningOptions): this {
        applyWithReceiptSigning(asBuilderState(this), options)
        return this
    }

    /**
     * Configure the fabrication guard — the always-on verifier check that.
     * Delegates to `applyWithFabricationGuard` in `builder/withers/quality-guardrails.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withFabricationGuard(mode: import('@reactive-agents/reasoning').FabricationGuardMode = 'block'): this {
        applyWithFabricationGuard(asBuilderState(this), mode)
        return this
    }

    /**
     * Tune the stall / no-progress policy — how the harness reacts when the.
     * Delegates to `applyWithStallPolicy` in `builder/withers/quality-guardrails.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withStallPolicy(policy: import('@reactive-agents/reasoning').StallPolicy): this {
        applyWithStallPolicy(asBuilderState(this), policy)
        return this
    }

    /**
     * Opt in to the **long-horizon guard profile** (off by default). A mode.
     * Delegates to `applyWithLongHorizon` in `builder/withers/horizon-contract.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withLongHorizon(): this {
        applyWithLongHorizon(asBuilderState(this))
        return this
    }

    /**
     * Opt in to the **adaptive harness** (off by default) — the Phase 6 policy.
     * Delegates to `applyWithAdaptiveHarness` in `builder/withers/horizon-contract.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withAdaptiveHarness(): this {
        applyWithAdaptiveHarness(asBuilderState(this))
        return this
    }

    /**
     * Opt in to cost-aware model routing (off by default). Routes each run to.
     * Delegates to `applyWithModelRouting` in `builder/withers/horizon-contract.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withModelRouting(options: import('./builder/types.js').ModelRoutingOptions = {}): this {
        applyWithModelRouting(asBuilderState(this), options)
        return this
    }

    /**
     * Declare a typed structured output schema (Standard Schema or Effect Schema).
     * `run()` then populates `result.object`. Default lenient: on parse-fail,
     * `object` is undefined and `objectError` is set (use `{ onParseFail: "throw" }` for strict).
     *
     * @param schema - An Effect Schema or any Standard Schema v1-compliant schema
     * @param options - Structured output options
     * @param options.mode - "auto" | "fast" | "grounded". Default: "auto"
     * @param options.onParseFail - "degrade" | "throw". Default: "degrade"
     * @param options.abstainBelow - Grounded engine only: omit fields below this confidence. Default: off
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
     * Delegates to `applyWithDurableRuns` in `builder/withers/horizon-contract.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withDurableRuns(options?: import('./builder/types.js').DurableRunsOptions): this {
        applyWithDurableRuns(asBuilderState(this), options)
        return this
    }

    /**
     * Agentic-UI (Task 11): enable agent-initiated user interaction. When set, the.
     * Delegates to `applyWithUserInteraction` in `builder/withers/horizon-contract.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withUserInteraction(): this {
        applyWithUserInteraction(asBuilderState(this))
        return this
    }

    /**
     * Enable cost tracking to monitor token consumption and estimate USD costs.
     * Delegates to `applyWithCostTracking` in `builder/withers/capability-progress.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withCostTracking(options?: CostTrackingOptions): this {
        applyWithCostTracking(asBuilderState(this), options)
        return this
    }

    /**
     * Sets programmatic pricing for specific models.
     * Delegates to `applyWithModelPricing` in `builder/withers/model-reliability.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withModelPricing(
        registry: Record<
            string,
            { readonly input: number; readonly output: number }
        >
    ): this {
        applyWithModelPricing(asBuilderState(this), registry)
        return this
    }

    /**
     * Register a remote/dynamic pricing provider.
     * Delegates to `applyWithDynamicPricing` in `builder/withers/model-reliability.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withDynamicPricing(
        provider: import('@reactive-agents/llm-provider').PricingProvider
    ): this {
        applyWithDynamicPricing(asBuilderState(this), provider)
        return this
    }

    /**
     * Enable circuit breaker for LLM provider calls.
     * Delegates to `applyWithCircuitBreaker` in `builder/withers/model-reliability.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withCircuitBreaker(
        config?: Partial<
            import('@reactive-agents/llm-provider').CircuitBreakerConfig
        >
    ): this {
        applyWithCircuitBreaker(asBuilderState(this), config)
        return this
    }

    /**
     * Disable the default-on circuit breaker for non-test providers. Useful for.
     * Delegates to `applyWithoutCircuitBreaker` in `builder/withers/model-reliability.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withoutCircuitBreaker(): this {
        applyWithoutCircuitBreaker(asBuilderState(this))
        return this
    }

    /**
     * Enable rate limiting for LLM requests. Throttles outbound API calls using.
     * Delegates to `applyWithRateLimiting` in `builder/withers/model-reliability.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withRateLimiting(
        config?: import('@reactive-agents/llm-provider').RateLimiterConfig
    ): this {
        applyWithRateLimiting(asBuilderState(this), config)
        return this
    }

    /**
     * Enable audit logging for compliance and post-execution analysis.
     * Delegates to `applyWithAudit` in `builder/withers/observability-exporters.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withAudit(): this {
        applyWithAudit(asBuilderState(this))
        return this
    }

    /**
     * Enable the reasoning layer to activate multi-step reasoning strategies.
     *
     * Without this, the agent performs single-step LLM calls. With it enabled,
     * the agent can use strategies like ReAct (tool use loops), tree-of-thought, or plan-execute.
     *
     * @param options - Reasoning configuration overrides — see {@link ReasoningOptions} for all fields
     * @param options.defaultStrategy - Default strategy name (e.g. "reactive", "plan-execute-reflect", "tree-of-thought", "blueprint")
     * @param options.strategies - Per-strategy config overrides (reactive, planExecute, treeOfThought, reflexion)
     * @param options.adaptive - Adaptive strategy switching: { enabled, learning }
     * @param options.enableStrategySwitching - Allow automatic strategy switching on loop detection
     * @param options.maxStrategySwitches - Max strategy switches per run
     * @param options.fallbackStrategy - Fallback strategy name when switching
     * @param options.maxIterations - Max reasoning iterations
     * @param options.parallelToolCalls - Execute tool calls in parallel (default: true)
     * @param options.observationSummary - LLM-based observation fact extraction: true | false | "auto"
     * @param options.auditRationale - Emit per-tool-call rationale blocks for debrief audit
     * @param options.harness - Harness mechanism switches (lazy disclosure, tool discovery, verbose rules)
     * @param options.synthesis - Synthesis mode: "auto" | "fast" | "deep" | "custom" | "off"
     * @param options.synthesisModel - Model used for synthesis
     * @param options.synthesisProvider - Provider used for synthesis
     * @param options.synthesisTemperature - Temperature for synthesis
     * @param options.synthesisStrategy - Custom synthesis pipeline (runtime-only, not persisted)
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
     * The `required` option is the config-shaped spelling of
     * `.withRequiredTools()` — both write the same underlying state.
     * When both are used, tool lists union; `adaptive`/`maxRetries` are
     * last-call-wins (see {@link ToolsOptions.required}).
     *
     * @param options - Custom tool definitions and handlers
     * @param options.tools - Array of custom tool definitions and handlers
     * @param options.resultCompression - Tool result compression config
     * @param options.allowedTools - Whitelist of tool names to expose
     * @param options.focusedTools - Tools to show in the LLM prompt (doesn't block execution)
     * @param options.adaptive - Enable adaptive tool filtering. Default: false
     * @param options.builtins - Built-in tools to include: false | true | string[]
     * @param options.required - Required tools (same as .withRequiredTools())
     * @returns `this` for chaining
     */
    withTools(options?: ToolsOptions): this {
        applyWithTools(this, options)
        return this
    }

    /**
     * Pre-load documents into the agent's RAG memory store at build time.
     *
     * Documents are chunked and indexed so the agent can retrieve them via the
     * built-in `find` tool during execution. Call multiple times to
     * accumulate documents. Automatically enables tools if not already enabled.
     *
     * @param docs - Array of document specifications to ingest
     * @returns `this` for chaining
     *
     * This is the sole entry point for RAG ingestion (there is no
     * `withTools({ rag })` option; a fold candidate — see
     * wither-surface-consolidation.md).
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
     * A non-empty static `tools` list also suppresses the adaptive tool
     * classifier — the caller stated their requirements, so no LLM
     * relevance-inference round-trip runs.
     *
     * Composable equivalent: `.withTools({ required: config })` — both
     * spellings write the same underlying state. Across calls (either
     * spelling), `tools` lists are UNIONED (deduped, first-seen order);
     * `adaptive` / `maxRetries` are last-call-wins.
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
     * Enable observability — metrics collection, structured logging, and tracing.
     * Delegates to `applyWithObservability` in `builder/withers/observability-exporters.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withObservability(options?: ObservabilityOptions): this {
        applyWithObservability(asBuilderState(this), options)
        return this
    }

    /**
     * Disable observability layer wiring and console exporters.
     * Delegates to `applyWithoutObservability` in `builder/withers/observability-exporters.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withoutObservability(): this {
        applyWithoutObservability(asBuilderState(this))
        return this
    }

    /**
     * Enable Cortex event reporting.
     * Delegates to `applyWithCortex` in `builder/withers/observability-exporters.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withCortex(url?: string): this {
        applyWithCortex(asBuilderState(this), url)
        return this
    }

    /**
     * Configure default streaming density for `agent.runStream()` calls.
     * Delegates to `applyWithStreaming` in `builder/withers/observability-exporters.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withStreaming(options?: { density?: StreamDensity }): this {
        applyWithStreaming(asBuilderState(this), options)
        return this
    }

    /**
     * Configure structured logging with level filtering, format selection, and output routing.
     * Delegates to `applyWithLogging` in `builder/withers/observability-exporters.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withLogging(config: {
        level?: 'debug' | 'info' | 'warn' | 'error'
        format?: 'text' | 'json'
        output?: 'console' | 'file' | WritableStream
        filePath?: string
        maxFileSizeBytes?: number
        maxFiles?: number
    }): this {
        applyWithLogging(asBuilderState(this), config)
        return this
    }

    /**
     * Configure durable human-in-the-loop approval gates (Phase D).
     * Delegates to `applyWithApprovalPolicy` in `builder/withers/horizon-contract.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withApprovalPolicy(policy: import('./builder/types.js').ApprovalPolicyConfig): this {
        applyWithApprovalPolicy(asBuilderState(this), policy)
        return this
    }

    /**
     * Enable the prompt template service for prompt management and A/B experiments.
     * Delegates to `applyWithPrompts` in `builder/withers/observability-exporters.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withPrompts(options?: PromptsOptions): this {
        applyWithPrompts(asBuilderState(this), options)
        return this
    }

    /**
     * Enable the kill switch service — allows pausing, resuming, stopping, and terminating agents.
     * Delegates to `applyWithKillSwitch` in `builder/withers/quality-guardrails.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withKillSwitch(): this {
        applyWithKillSwitch(asBuilderState(this))
        return this
    }

    /**
     * Enable behavioral contracts — enforce constraints on tool usage, outputs, and iterations.
     * Delegates to `applyWithBehavioralContracts` in `builder/withers/quality-guardrails.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withBehavioralContracts(
        contract: import('@reactive-agents/guardrails').BehavioralContract
    ): this {
        applyWithBehavioralContracts(asBuilderState(this), contract)
        return this
    }

    /**
     * Enable cross-task self-improvement — the agent learns from past execution outcomes.
     * Delegates to `applyWithSelfImprovement` in `builder/withers/capability-progress.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withSelfImprovement(): this {
        applyWithSelfImprovement(asBuilderState(this))
        return this
    }

    /**
     * Enable ExperienceStore cross-agent learning.
     * Delegates to `applyWithExperienceLearning` in `builder/withers/capability-progress.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withExperienceLearning(): this {
        applyWithExperienceLearning(asBuilderState(this))
        return this
    }

    /**
     * Enable MemoryConsolidatorService background memory intelligence.
     *
     * Consolidation cycles (REPLAY → CONNECT → COMPRESS: count recent episodic
     * entries, decay semantic importance, prune below-threshold entries) are
     * triggered from the post-run memory-flush phase: each completed
     * non-trivial run counts one pending entry, and when `threshold` entries
     * accumulate (default: 10) a full `consolidate()` cycle runs. Requires
     * `.withMemory()` (the consolidator persists into the memory database).
     *
     * @param config - Optional consolidation thresholds
     * @param config.threshold - Pending runs before a cycle triggers (default: 10)
     * @param config.decayFactor - Importance decay multiplier per cycle (default: 0.95)
     * @param config.pruneThreshold - Minimum importance before pruning (default: 0.1)
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
        // No-op: the EventBus is always active on every agent. This method is
        // retained for API compatibility / readability only. (v0.14: the former
        // write-only `_enableEvents` flag was removed — it gated no branch.)
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
     * MCP servers expose tools via a standardized protocol (stdio, SSE/streamable-HTTP,
     * or WebSocket). Tools are automatically discovered and added to the agent's tool
     * registry. Implicitly enables the tools layer.
     *
     * HTTP-transport servers (`streamable-http`/`sse`) that require OAuth 2.1 accept an
     * `auth` config. Unattended/production agents should use `client_credentials` or
     * `private_key_jwt` (no user interaction, no browser). Delegated user access uses
     * `authorization_code` — run `rax mcp login <name>` once beforehand; `interactive`
     * defaults to `false` so a scheduled/production run never unexpectedly tries to open
     * a browser. `tokenStore` defaults to a file store under `~/.reactive-agents/mcp-auth`
     * (permissions 0700/0600); pass `createMemoryTokenStore()` for tests/CI. `auth` on a
     * `stdio` server is a startup error — stdio servers take credentials via `env`.
     *
     * @param config - MCP server configuration(s) — can be a single config or array
     * @returns `this` for chaining
     * @example
     * ```typescript
     * import { createFileTokenStore } from "@reactive-agents/tools"
     *
     * const agent = await ReactiveAgents.create()
     *   .withMCP({
     *     name: "billing",
     *     endpoint: "https://mcp.example.com/mcp",
     *     auth: {
     *       type: "client_credentials",
     *       clientId: process.env.MCP_CLIENT_ID!,
     *       clientSecret: process.env.MCP_CLIENT_SECRET!,
     *     },
     *     tokenStore: createFileTokenStore(), // omit to use the same default
     *   })
     *   .build()
     * ```
     *
     * ---
     *
     * A bare `string` (or `string[]`) instead scaffolds a curated server from
     * a public registry catalog (Docker Hub's `mcp/*` catalog by default) by
     * name, instead of hand-writing a config. The two input shapes are
     * unambiguous at the JS *type* level — a string can never be mistaken for
     * an `MCPServerConfig` object — so there is no guessing involved. Design
     * spec: `wiki/Architecture/Design-Specs/2026-09-19-mcp-toolkit-scaffolding.md`.
     *
     * Like the object form, this is synchronous — it only stores the
     * request(s). Resolution (network fetch, env validation, the digest-keyed
     * approval gate) happens inside `.build()`, and a resolved config is
     * merged into the same server list the object form populates. A registry
     * rejection (e.g. `MCPApprovalRequiredError`, `MCPMissingEnvVarError`)
     * propagates out of `.build()` untransformed — catch and act on it there.
     *
     * A `string[]` batches multiple catalog names with no per-entry options —
     * call `.withMCP()` once per name if you need per-entry `env`/`volumes`.
     * A single mixed array of strings and objects in one call is not
     * supported and throws synchronously (call `.withMCP()` separately for
     * each input shape instead of guessing which one you meant).
     *
     * @param catalogName - a catalog entry name (or names) to resolve via a registry
     * @param options.registry - registry id to resolve against (defaults to `"docker-hub"`)
     * @param options.env - env vars the resolver validates against the catalog entry's declared requirements
     * @param options.volumes - dynamic bind mounts (filesystem/git-style servers that need host access)
     * @param options.requireApproval - whether the digest-keyed approval gate applies to this call.
     * Defaults to `true` (gate on) — an unapproved image fails closed. Pass `false` as an explicit,
     * per-call trust decision (e.g. CI, or a registry already vetted out-of-band) — never a default,
     * and never auto-records an approval; a later call without this flag still gates normally.
     * @example
     * ```typescript
     * const agent = await ReactiveAgents.create()
     *   .withMCP("brave-search", { env: { BRAVE_API_KEY: process.env.BRAVE_API_KEY! } })
     *   .build()
     * ```
     */
    withMCP(catalogName: string, options?: {
        registry?: string
        env?: Record<string, string>
        volumes?: MCPVolumeMount[]
        requireApproval?: boolean
    }): this
    withMCP(catalogNames: string[]): this
    withMCP(config: MCPServerConfig | MCPServerConfig[]): this
    /**
     * @deprecated Not supported. A single `.withMCP()` call cannot mix catalog
     * names (`string`) with hand-written `MCPServerConfig` objects in one array —
     * call `.withMCP()` once for the string(s) and once for the object(s); both
     * merge into the same server list at `.build()` time. Throws synchronously
     * if called this way.
     */
    withMCP(mixed: ReadonlyArray<string | MCPServerConfig>): never
    withMCP(
        input: MCPServerConfig | MCPServerConfig[] | string | string[] | ReadonlyArray<string | MCPServerConfig>,
        options?: {
            registry?: string
            env?: Record<string, string>
            volumes?: MCPVolumeMount[]
            requireApproval?: boolean
        }
    ): this {
        if (typeof input === 'string') {
            this._mcpToolkitRequests.push({
                name: input,
                ...(options?.registry !== undefined ? { registry: options.registry } : {}),
                ...(options?.env !== undefined ? { env: options.env } : {}),
                ...(options?.volumes !== undefined ? { volumes: options.volumes } : {}),
                ...(options?.requireApproval !== undefined ? { requireApproval: options.requireApproval } : {}),
            })
            return this
        }
        if (Array.isArray(input) && input.length > 0 && input.every((entry) => typeof entry === 'string')) {
            for (const name of input as string[]) {
                this._mcpToolkitRequests.push({ name })
            }
            return this
        }
        if (Array.isArray(input) && input.some((entry) => typeof entry === 'string')) {
            throw new Error(
                '.withMCP(): a single call cannot mix catalog names (string) with ' +
                'MCPServerConfig objects in one array — call .withMCP() once for the ' +
                'registry-resolved names (string[]) and once for the hand-written configs (object[]).'
            )
        }
        applyWithMCP(this, input as MCPServerConfig | MCPServerConfig[])
        return this
    }

    // ─── Testing ───

    /**
     * Configure a deterministic multi-turn scenario for the test LLM provider.
     * Delegates to `applyWithTestScenario` in `builder/withers/validation-testing.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withTestScenario(turns: TestTurn[]): this {
        applyWithTestScenario(asBuilderState(this), turns)
        return this
    }

    // ─── Build Options ───

    /**
     * Enable strict build-time validation. Missing API keys and model/provider.
     * Delegates to `applyWithStrictValidation` in `builder/withers/validation-testing.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withStrictValidation(): this {
        applyWithStrictValidation(asBuilderState(this))
        return this
    }

    /**
     * Force the missing-API-key and unknown-for-provider-model checks to stay.
     * Delegates to `applyWithLazyValidation` in `builder/withers/validation-testing.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withLazyValidation(): this {
        applyWithLazyValidation(asBuilderState(this))
        return this
    }

    /**
     * Declare a {@link TaskContract} the agent must satisfy at build time.
     * Delegates to `applyWithContract` in `builder/withers/horizon-contract.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withContract(contract: TaskContract): this {
        applyWithContract(asBuilderState(this), contract)
        return this
    }

    /**
     * Set a timeout for agent execution. If the agent doesn't complete within.
     * Delegates to `applyWithTimeout` in `builder/withers/horizon-contract.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withTimeout(ms: number): this {
        applyWithTimeout(asBuilderState(this), ms)
        return this
    }

    /**
     * Set the per-LLM-call timeout for local (Ollama) providers. This bounds a.
     * Delegates to `applyWithLlmTimeout` in `builder/withers/horizon-contract.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withLlmTimeout(ms: number): this {
        applyWithLlmTimeout(asBuilderState(this), ms)
        return this
    }

    /**
     * Configure retry policy for LLM calls. When an LLM call fails with a.
     * Delegates to `applyWithRetryPolicy` in `builder/withers/horizon-contract.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withRetryPolicy(policy: { maxRetries: number; backoffMs: number }): this {
        applyWithRetryPolicy(asBuilderState(this), policy)
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
     * Delegates to `applyWithHealthCheck` in `builder/withers/capability-progress.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withHealthCheck(): this {
        applyWithHealthCheck(asBuilderState(this))
        return this
    }

    /**
     * Require at least N iterations before the agent can declare success.
     * Delegates to `applyWithMinIterations` in `builder/withers/capability-progress.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withMinIterations(n: number): this {
        applyWithMinIterations(asBuilderState(this), n)
        return this
    }

    /**
     * Provide background data injected into the reasoning memory context.
     * Delegates to `applyWithTaskContext` in `builder/withers/capability-progress.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withTaskContext(context: Record<string, string>): this {
        applyWithTaskContext(asBuilderState(this), context)
        return this
    }

    /**
     * Run a verification pass after the initial reasoning result before accepting it.
     * In "reflect" mode (the only supported mode), one LLM call reviews the output
     * and confirms completeness.
     * @param config.mode - "reflect" (default)
     * @param config.prompt - Custom verification prompt (optional)
     * @returns `this` for chaining
     * @see {@link HarnessProfile.balanced} — composable preset with the
     *   verifier default-on; use `.compose(...)` for custom prompts.
     */
    withVerificationStep(
        config: { mode?: 'reflect'; prompt?: string } = {}
    ): this {
        applyWithVerificationStep(this, config)
        return this
    }

    /**
     * Validate the final output before accepting it. If validation fails, the.
     * Delegates to `applyWithOutputValidator` in `builder/withers/capability-progress.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withOutputValidator(
        validator: (output: string) => { valid: boolean; feedback?: string },
        options?: { maxRetries?: number }
    ): this {
        applyWithOutputValidator(asBuilderState(this), validator, options)
        return this
    }

    /**
     * Provide a custom termination predicate. After each reasoning result, this.
     * Delegates to `applyWithCustomTermination` in `builder/withers/capability-progress.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withCustomTermination(fn: (state: { output: string }) => boolean): this {
        applyWithCustomTermination(asBuilderState(this), fn)
        return this
    }

    /**
     * Override `agent.chat()`'s automatic tool-need detection for this agent.
     * Delegates to `applyWithToolIntent` in `builder/withers/capability-progress.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withToolIntent(classifier: (message: string) => boolean): this {
        applyWithToolIntent(asBuilderState(this), classifier)
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
     * @example .withReactiveIntelligence({ notice: false }) // silence the one-time telemetry banner (telemetry itself still runs)
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
            RiHooks
    ): this
    withReactiveIntelligence(
        arg?:
            | boolean
            | (Partial<
                  import('@reactive-agents/reactive-intelligence').ReactiveIntelligenceConfig
              > &
                  RiHooks)
    ): this {
        applyReactiveIntelligenceOptions(this, arg)
        return this
    }

    /**
     * Register Living Skills directories. Each path must contain subfolders.
     * Delegates to `applyWithSkills` in `builder/withers/capability-progress.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withSkills(config: {
        paths: readonly string[]
        activate?: readonly string[]
    }): this {
        applyWithSkills(asBuilderState(this), config)
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
     * Configure provider fallbacks for graceful degradation.
     * Delegates to `applyWithFallbacks` in `builder/withers/model-reliability.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withFallbacks(config: {
        providers?: string[]
    }): this {
        applyWithFallbacks(asBuilderState(this), config)
        return this
    }

    // ─── Extra Layers ───

    /**
     * Compose additional Effect-TS layers into the runtime.
     * Delegates to `applyWithLayers` in `builder/withers/model-reliability.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withLayers(layers: Layer.Layer<never, unknown, unknown>): this {
        applyWithLayers(asBuilderState(this), layers)
        return this
    }

    /**
     * Export OpenInference spans for this agent's runs (Wave 6.7).
     * Delegates to `applyWithOpenInference` in `builder/withers/model-reliability.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withOpenInference(): this {
        applyWithOpenInference(asBuilderState(this))
        return this
    }

    /**
     * Replace the base LLMService the whole runtime builds on (reasoning.
     * Delegates to `applyWithReplayLLM` in `builder/withers/model-reliability.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withReplayLLM(layer: Layer.Layer<LLMService>): this {
        applyWithReplayLLM(asBuilderState(this), layer)
        return this
    }

    /**
     * Enable JSONL trace persistence.
     * Delegates to `applyWithTracing` in `builder/withers/model-reliability.ts` (#218 decomp) —
     * full public-contract JSDoc moved verbatim there.
     */
    withTracing(opts: { dir?: string } = {}): this {
        applyWithTracing(asBuilderState(this), opts)
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
     * Delegates to `builder/build/build-agent.ts` (moved for #218 / HS-248) —
     * see `buildAgent` there for the orchestration body, moved verbatim.
     * Validates configuration, creates layers, and returns a ready-to-use
     * ReactiveAgent.
     *
     * @returns Promise resolving to a ReactiveAgent instance
     * @throws Error if configuration is invalid or API keys are missing
     */
    async build(): Promise<ReactiveAgent<TOut>> {
        return buildAgent({
            state: asBuilderState(this),
            // Fresh closure: `buildEffect()` re-reads mutable class state live.
            buildEffect: () => this.buildEffect(),
        })
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
     * Delegates to `builder/build/build-effect.ts` (moved for #218 / HS-248) —
     * see `runBuilderBuildEffect` there for the generator body (and the
     * moved `warnIfImplicitTestProvider()` precondition), both moved verbatim.
     *
     * @returns Effect that produces a ReactiveAgent
     */
    buildEffect(): Effect.Effect<ReactiveAgent<TOut>, Error> {
        return runBuilderBuildEffect(asBuilderState(this))
    }

    /**
     * Compile-time drift guard for {@link BuilderRuntimeStateView}
     * (packages/runtime/src/builder/build-effect/runtime-construction.ts),
     * which `build()` reaches via `self as unknown as BuilderRuntimeStateView`
     * above. That cast is a genuine structural (not nominal) relationship —
     * TypeScript's class-privacy branding otherwise blocks a class from ever
     * being assignable to a plain interface, and `keyof`/`Pick` over a class
     * type always exclude its private members, so neither can express this
     * check. Naming each field explicitly, from *inside* the class body
     * (where private access is legal), is the only mechanism that actually
     * reaches them: if a field referenced by `BuilderRuntimeStateView` is
     * renamed or removed here, the corresponding `self._field` access below
     * fails to compile (TS2339); if its type narrows incompatibly, the
     * object-literal-to-`BuilderRuntimeStateView` assignment fails (TS2322/
     * TS2741). Never constructed at runtime — type-checked only.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private static readonly _assertRuntimeStateViewShape = (
        self: ReactiveAgentBuilder<any>
    ): BuilderRuntimeStateView => ({
        _adaptiveHarness: self._adaptiveHarness,
        _approvalPolicy: self._approvalPolicy,
        _behavioralContract: self._behavioralContract,
        _budgetLimits: self._budgetLimits,
        _calibration: self._calibration,
        _circuitBreakerConfig: self._circuitBreakerConfig,
        _consolidationConfig: self._consolidationConfig,
        _contextProfile: self._contextProfile,
        _cortexUrl: self._cortexUrl,
        _costTrackingOptions: self._costTrackingOptions,
        _customTermination: self._customTermination,
        _documents: self._documents,
        _durableRuns: self._durableRuns,
        _enableAudit: self._enableAudit,
        _enableBehavioralContracts: self._enableBehavioralContracts,
        _enableCostTracking: self._enableCostTracking,
        _enableExperienceLearning: self._enableExperienceLearning,
        _enableGuardrails: self._enableGuardrails,
        _enableHealthCheck: self._enableHealthCheck,
        _enableJudgment: self._enableJudgment,
        _judgmentShadowDbPath: self._judgmentShadowDbPath,
        _enableKillSwitch: self._enableKillSwitch,
        _enableMemory: self._enableMemory,
        _enableMemoryConsolidation: self._enableMemoryConsolidation,
        _enableObservability: self._enableObservability,
        _enablePrompts: self._enablePrompts,
        _enableReactiveIntelligence: self._enableReactiveIntelligence,
        _enableReasoning: self._enableReasoning,
        _enableSelfImprovement: self._enableSelfImprovement,
        _enableTools: self._enableTools,
        _enableVerification: self._enableVerification,
        _environmentContext: self._environmentContext,
        _executionTimeoutMs: self._executionTimeoutMs,
        _extraLayers: self._extraLayers,
        _fabricationGuard: self._fabricationGuard,
        _fallbackConfig: self._fallbackConfig,
        _gatewayOptions: self._gatewayOptions,
        _groundingConfig: self._groundingConfig,
        _guardrailsOptions: self._guardrailsOptions,
        _harnessRegistrations: self._harnessRegistrations,
        _judgmentOptions: self._judgmentOptions,
        _leanHarness: self._leanHarness,
        _llmOverrideLayer: self._llmOverrideLayer,
        _loggingConfig: self._loggingConfig,
        _longHorizon: self._longHorizon,
        _maxIterations: self._maxIterations,
        _maxTokens: self._maxTokens,
        _mcpServers: self._mcpServers,
        _memoryOptions: self._memoryOptions,
        _memoryTier: self._memoryTier,
        _metaTools: self._metaTools,
        _minIterations: self._minIterations,
        _model: self._model,
        _modelRouting: self._modelRouting,
        _numCtx: self._numCtx,
        _observabilityOptions: self._observabilityOptions,
        _ollamaTimeoutMs: self._ollamaTimeoutMs,
        _outputValidator: self._outputValidator,
        _outputValidatorOptions: self._outputValidatorOptions,
        _pricingRegistry: self._pricingRegistry,
        _provider: self._provider,
        _providerConfig: self._providerConfig,
        _rateLimiterConfig: self._rateLimiterConfig,
        _reactiveIntelligenceOptions: self._reactiveIntelligenceOptions,
        _reasoningOptions: self._reasoningOptions,
        _receiptSigningKey: self._receiptSigningKey,
        _requiredToolsConfig: self._requiredToolsConfig,
        _resultCompression: self._resultCompression,
        _retryPolicy: self._retryPolicy,
        _sessionMaxAgeDays: self._sessionMaxAgeDays,
        _sessionPersist: self._sessionPersist,
        _skillPersistence: self._skillPersistence,
        _skillsConfig: self._skillsConfig,
        _stallPolicy: self._stallPolicy,
        _taskContext: self._taskContext,
        _taskContract: self._taskContract,
        _telemetryConfig: self._telemetryConfig,
        _temperature: self._temperature,
        _testScenario: self._testScenario,
        _thinking: self._thinking,
        _thinkingOptions: self._thinkingOptions,
        _toolsOptions: self._toolsOptions,
        _tracingConfig: self._tracingConfig,
        _userInteraction: self._userInteraction,
        _verificationOptions: self._verificationOptions,
        _verificationStep: self._verificationStep,
    })
}
