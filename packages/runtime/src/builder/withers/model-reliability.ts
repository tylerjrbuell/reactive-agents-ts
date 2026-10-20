/**
 * Model-reliability + runtime-layer withers for ReactiveAgentBuilder
 * (2026-10-20 builder decomp, GH #218 / HS-248).
 *
 * Class methods on the builder are thin delegates that mutate state via these
 * helpers and return `this` for chaining; public-contract JSDoc moved verbatim.
 */
import { Layer } from 'effect'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { OpenInferenceTracerLayer } from '@reactive-agents/observe'
import type { LLMService } from '@reactive-agents/llm-provider'
import type { BuilderState } from './_state.js'

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
export const applyWithModelPricing = (state: BuilderState,     registry: Record<
        string,
        { readonly input: number; readonly output: number }
    >) => {
    state._pricingRegistry = { ...state._pricingRegistry, ...registry }
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
export const applyWithDynamicPricing = (state: BuilderState,     provider: import('@reactive-agents/llm-provider').PricingProvider) => {
    state._pricingProvider = provider
}


/**
 * Enable circuit breaker for LLM provider calls.
 *
 * After `failureThreshold` consecutive failures, the breaker opens and fast-fails
 * without hitting the provider. After `cooldownMs`, it enters half-open state
 * to test if the provider has recovered.
 *
 * @param config - Optional circuit breaker thresholds
 * @param config.failureThreshold - Consecutive failures before opening the breaker. Default: 5
 * @param config.cooldownMs - Cooldown ms before half-open. Default: 30000
 * @param config.halfOpenRequests - Requests to allow in half-open state. Default: 1
 * @returns `this` for chaining
 * @see {@link HarnessProfile.balanced} — composable preset that ships
 *   the breaker enabled with sensible thresholds. Use this method (or
 *   `.compose(...)` / environment config) to override those thresholds.
 */
export const applyWithCircuitBreaker = (state: BuilderState,     config?: Partial<
        import('@reactive-agents/llm-provider').CircuitBreakerConfig
    >) => {
    state._circuitBreakerConfig = config ?? {}
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
export const applyWithoutCircuitBreaker = (state: BuilderState, ) => {
    state._circuitBreakerConfig = false
}


/**
 * Enable rate limiting for LLM requests. Throttles outbound API calls using
 * a sliding window algorithm to prevent 429 errors before they occur.
 *
 * Configurable per-minute request limits, per-minute token limits (estimated),
 * and maximum concurrent in-flight requests.
 *
 * @param config - Optional rate limiter thresholds
 * @param config.requestsPerMinute - Max requests per minute. Default: 60
 * @param config.tokensPerMinute - Max estimated input tokens per minute. Default: 100000
 * @param config.maxConcurrent - Max concurrent in-flight requests. Default: 10
 * @returns `this` for chaining
 * @example .withRateLimiting({ requestsPerMinute: 30, tokensPerMinute: 50_000 })
 * Limits are also resolved from provider metadata + `CapabilityRegistry`
 * defaults; use this explicit override to pin a per-deployment policy.
 */
export const applyWithRateLimiting = (state: BuilderState,     config?: import('@reactive-agents/llm-provider').RateLimiterConfig) => {
    state._rateLimiterConfig = config ?? {}
}


/**
 * Configure provider fallbacks for graceful degradation.
 *
 * The providers are tried in order: the primary first, then each fallback
 * on ANY error, until one succeeds or all are exhausted. Each real switch
 * emits a `ProviderFallbackActivated` event.
 *
 * NOTE: this is an IMMEDIATE cascade — the first error on a provider moves to
 * the next. There is no consecutive-error threshold and no per-model
 * (cheaper-model-on-429) chain; those options were removed in v0.14 (P0-3)
 * because they were never wired. Model fallback within a provider is not
 * supported here — configure distinct providers instead.
 *
 * @param config - `{ providers }`: ordered provider names (primary first).
 * @param config.providers - Ordered provider names to try on failure (primary first).
 * @returns `this` for chaining
 * Fallback order also resolves from `CapabilityRegistry` provider tiers;
 * use this explicit override to pin a multi-provider deployment chain.
 */
export const applyWithFallbacks = (state: BuilderState, config: {
    providers?: string[]
}) => {
    state._fallbackConfig = config
}


/**
 * Compose additional Effect-TS layers into the runtime.
 *
 * Advanced feature for adding custom services or dependencies.
 * Layers are merged into the main runtime layer stack.
 *
 * Does NOT reach `LLMService`: this merges at terminal composition and only
 * overrides late-bound tags, but `LLMService` is captured upstream of that,
 * at construction time, for every builder (kernel arm, since Move 1,
 * 2026-08-13). A layer providing `LLMService` here silently binds nothing —
 * the real configured provider still answers every call. Use
 * `withReplayLLM()` to override `LLMService` (e.g. for deterministic
 * replay/recording in tests).
 *
 * @param layers - Effect-TS Layer(s) to add
 * @returns `this` for chaining
 */
export const applyWithLayers = (state: BuilderState, layers: Layer.Layer<never, unknown, unknown>) => {
    state._extraLayers = layers
}


/**
 * Export OpenInference spans for this agent's runs (Wave 6.7).
 *
 * One glue over the existing `OpenInferenceTracerLayer`: subscribes the
 * agent's EventBus to an OpenTelemetry tracer with OpenInference semantic
 * attributes (agent/LLM/tool spans). Merges with any `.withLayers()` layers
 * rather than replacing them.
 *
 * Destination is configured once per process, NOT per agent — via
 * `setupOpenInferenceExporter()` or the standard
 * `OTEL_EXPORTER_OTLP_ENDPOINT` env var (see `@reactive-agents/observe`).
 * There is deliberately no `endpoint` option here: exporter setup
 * registers a process-global provider, so per-agent endpoints would stack
 * providers and leak exporters. Without a configured exporter the spans
 * still build against the global tracer (observable via any registered
 * provider, e.g. an in-memory exporter in tests).
 *
 * Ordering vs `.withLayers()`: this wither MERGES into any existing
 * extra layers, but `.withLayers()` ASSIGNS (replaces). Call
 * `.withOpenInference()` AFTER `.withLayers()` to keep both; the reverse
 * order drops the tracer layer. Idempotent — calling twice subscribes once.
 *
 * @returns `this` for chaining
 */
export const applyWithOpenInference = (state: BuilderState, ) => {
    // Idempotent: a second call is a no-op (merging the same layer twice
    // would double-subscribe EventBus → duplicate spans).
    if (state._openInferenceAdded === true) return
    state._openInferenceAdded = true
    state._extraLayers = state._extraLayers
        ? Layer.mergeAll(state._extraLayers, OpenInferenceTracerLayer)
        : OpenInferenceTracerLayer
}


/**
 * Replace the base LLMService the whole runtime builds on (reasoning,
 * engine, memory) with a custom layer — the deterministic-replay keystone.
 *
 * Unlike `withLayers()`, which merges at the terminal composition and so
 * can only override late-bound tags (ToolService), this swaps in upstream
 * of every consumer that captures LLMService at construction. Pass a replay
 * LLM layer to run the entire harness against recorded model responses with
 * no live provider.
 *
 * @param layer - an Effect Layer providing LLMService, with no unresolved
 * requirements or errors — it must be able to run standalone as the
 * whole-runtime replacement for the base `LLMService` layer.
 */
export const applyWithReplayLLM = (state: BuilderState, layer: Layer.Layer<LLMService>) => {
    state._llmOverrideLayer = layer
}


/**
 * Enable JSONL trace persistence.
 *
 * Each run writes a `<runId>.jsonl` file to `dir` containing all trace events
 * (entropy scores, reactive decisions, strategy switches).
 *
 * @param opts.dir - Directory to write JSONL files (default: `~/.reactive-agents/traces` —
 *   same canonical location `defaultTracingConfig()` uses when tracing is
 *   left on its implicit default, and the one `rax diagnose` reads by
 *   default. Previously defaulted to the cwd-relative `.reactive-agents/traces`,
 *   which silently diverged from that location — every trace written by an
 *   explicit `.withTracing()` call was invisible to `rax diagnose` unless
 *   the agent happened to run from the CLI's own cwd. Fixed 2026-09-04.)
 *
 * Composable equivalent: `.withObservability({ tracing: { dir } })` or
 *   the `REACTIVE_AGENTS_TRACE` env config (process-wide) — tracing also
 *   rides the observability stack.
 */
export const applyWithTracing = (state: BuilderState, opts: { dir?: string } = {}) => {
    state._tracingConfig = { dir: opts.dir ?? join(homedir(), '.reactive-agents', 'traces') }
}
