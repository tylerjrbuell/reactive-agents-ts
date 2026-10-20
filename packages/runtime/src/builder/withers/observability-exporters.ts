/**
 * Observability / tracing / logging / prompts withers for ReactiveAgentBuilder
 * (2026-10-20 builder decomp, GH #218 / HS-248).
 *
 * Class methods on the builder are thin delegates that mutate state via these
 * helpers and return `this` for chaining; public-contract JSDoc moved verbatim.
 */
import type { ObservabilityOptions, PromptsOptions } from '../types.js'
import type { StreamDensity } from '../../stream-types.js'
import type { BuilderState } from './_state.js'

/**
 * Enable observability — metrics collection, structured logging, and tracing.
 *
 * Automatically displays a metrics dashboard on completion showing execution timeline,
 * tool usage, costs, and alerts. Configure verbosity and live streaming via options.
 *
 * @param options - Observability configuration
 * @param options.verbosity - "minimal" | "normal" | "verbose" | "debug". Default: "normal"
 * @param options.live - Stream logs in real-time. Default: false
 * @param options.file - Path for JSONL file export. Default: undefined
 * @param options.logModelIO - Log full model prompts and responses. Default: false
 * @param options.cortex - Cortex event reporting: true or { url }. Default: false
 * @param options.telemetry - Anonymous telemetry: true or TelemetryConfig. Default: false
 * @param options.logging - Structured logging: { level?, format?, output?, filePath? }
 * @param options.tracing - JSONL trace persistence: true | false | { dir? }
 * @param options.health - Enable health checks. Default: false
 * @param options.audit - Per-tool-call rationale auditing. Default: false
 * @param options.costs - Cost tracking: true or CostTrackingOptions. Default: false
 * @param options.streaming - Event streaming. Default: false
 * @returns `this` for chaining
 * @see {@link ObservabilityOptions} — the full named type with all field docs.
 */
export const applyWithObservability = (state: BuilderState, options?: ObservabilityOptions) => {
    state._enableObservability = true
    if (options) {
        state._observabilityOptions = options
        // DX wave (v0.12) — fan sub-options out to the same state the
        // dedicated convenience methods set, so this one method configures
        // the whole observability stack. Last call wins (a later
        // `.withCortex()` / `.withObservability({cortex})` overrides).
        if (options.cortex !== undefined) {
            state._cortexUrl =
                (typeof options.cortex === 'object' ? options.cortex.url : undefined) ??
                process.env.CORTEX_URL ??
                'http://localhost:4321'
        }
        if (options.telemetry !== undefined) {
            state._telemetryConfig =
                typeof options.telemetry === 'object' ? options.telemetry : { mode: 'isolated' }
        }
        if (options.logging !== undefined) {
            state._loggingConfig = options.logging
        }
        if (options.tracing !== undefined) {
            state._tracingConfig =
                options.tracing === false
                    ? null
                    : { dir: (typeof options.tracing === 'object' ? options.tracing.dir : undefined) ?? `.reactive-agents/traces` }
        }
        if (options.health) state._enableHealthCheck = true
        if (options.audit) state._enableAudit = true
        if (options.costs !== undefined) {
            state._enableCostTracking = true
            if (typeof options.costs === 'object') state._costTrackingOptions = options.costs
        }
        // Streaming fold (audit #8): route to the same `_streamDensity` slot
        // `.withStreaming()` sets (serializes under `features.streaming`).
        if (options.streaming) state._streamDensity = 'tokens'
    }
}


/**
 * Disable observability layer wiring and console exporters.
 *
 * Use for CI, scripted smoke tests, or hosts that should not print the
 * metrics dashboard on completion. Tracing remains governed separately by
 * `.withTracing()` / `.withObservability({ tracing: false })` and
 * `REACTIVE_AGENTS_TRACE`.
 */
export const applyWithoutObservability = (state: BuilderState, ) => {
    state._enableObservability = false
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
export const applyWithCortex = (state: BuilderState, url?: string) => {
    state._cortexUrl =
        url ?? process.env.CORTEX_URL ?? 'http://localhost:4321'
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
export const applyWithStreaming = (state: BuilderState, options?: { density?: StreamDensity }) => {
    state._streamDensity = options?.density ?? 'tokens'
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
export const applyWithLogging = (state: BuilderState, config: {
    level?: 'debug' | 'info' | 'warn' | 'error'
    format?: 'text' | 'json'
    output?: 'console' | 'file' | WritableStream
    filePath?: string
    maxFileSizeBytes?: number
    maxFiles?: number
}) => {
    state._loggingConfig = config
}


/**
 * Enable the prompt template service for prompt management and A/B experiments.
 *
 * Allows registering and selecting from a library of prompts, with support for
 * model-tier-specific variants and experiment tracking.
 *
 * @param options - Custom prompt template definitions
 * @param options.templates - Array of custom prompt templates to register (id, content, optional tier)
 * @returns `this` for chaining
 * Composable equivalent: `.compose(h => h.on('prompt.system', ...))` /
 *   the `@reactive-agents/prompts` template registry — prompt templates
 *   also flow through the compose chokepoint.
 */
export const applyWithPrompts = (state: BuilderState, options?: PromptsOptions) => {
    state._enablePrompts = true
    if (options) state._promptsOptions = options
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
export const applyWithAudit = (state: BuilderState, ) => {
    state._enableAudit = true
}
