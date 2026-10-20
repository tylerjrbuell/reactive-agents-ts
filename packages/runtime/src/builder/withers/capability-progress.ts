/**
 * Capability / progress-control withers for ReactiveAgentBuilder
 * (2026-10-20 builder decomp, GH #218 / HS-248).
 *
 * Class methods on the builder are thin delegates that mutate state via these
 * helpers and return `this` for chaining; public-contract JSDoc moved verbatim.
 */
import type { CostTrackingOptions } from '../types.js'
import type { BuilderState } from './_state.js'

/**
 * Enable cost tracking to monitor token consumption and estimate USD costs.
 *
 * Optionally provide budget limits to enforce spending caps.
 *
 * @param options - Optional budget limit configuration (USD)
 * @param options.perRequest - Maximum cost per single LLM request (USD). Default: $1.00
 * @param options.perSession - Maximum cost per session (USD). Default: $5.00
 * @param options.daily - Maximum daily spend (USD). Default: $25.00
 * @param options.monthly - Maximum monthly spend (USD). Default: $200.00
 * @returns `this` for chaining
 * Composable equivalent: `.withObservability({ costs: ... })` for the
 *   tracking, `.withBudget(...)` for spend caps (master plan §11.4).
 *   Cost tracking also rides the observability stack.
 */
export const applyWithCostTracking = (state: BuilderState, options?: CostTrackingOptions) => {
    state._enableCostTracking = true
    if (options) state._costTrackingOptions = options
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
export const applyWithSelfImprovement = (state: BuilderState, ) => {
    state._enableSelfImprovement = true
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
export const applyWithExperienceLearning = (state: BuilderState, ) => {
    state._enableExperienceLearning = true
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
export const applyWithHealthCheck = (state: BuilderState, ) => {
    state._enableHealthCheck = true
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
export const applyWithMinIterations = (state: BuilderState, n: number) => {
    state._minIterations = n
}


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
export const applyWithMaxIterations = (state: BuilderState, n: number) => {
    state._maxIterations = n
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
export const applyWithTaskContext = (state: BuilderState, context: Record<string, string>) => {
    state._taskContext = context
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
export const applyWithOutputValidator = (state: BuilderState,     validator: (output: string) => { valid: boolean; feedback?: string },
    options?: { maxRetries?: number }) => {
    state._outputValidator = validator
    state._outputValidatorOptions = options
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
export const applyWithCustomTermination = (state: BuilderState, fn: (state: { output: string }) => boolean) => {
    state._customTermination = fn
}


/**
 * Override `agent.chat()`'s automatic tool-need detection for this agent.
 *
 * By default, `chat()` routes each message through the built-in
 * `requiresTools()` heuristic (`chat.ts`) to decide between the direct-LLM
 * path and the tool-capable path. That heuristic is domain-agnostic and can
 * misclassify messages whose phrasing is common in one agent's domain but
 * ambiguous in general (e.g. "tell me about X" defaults to chat-only, but
 * for an agent whose "X" is always a live lookup, that's a false negative).
 * Use this to replace the default classifier for every `chat()` call on
 * this agent, without having to reimplement or fork the whole heuristic.
 *
 * Precedence per call: explicit `chat(msg, { useTools })` always wins,
 * then this agent-level classifier (if set), then the default
 * `requiresTools()`.
 * @param classifier - Receives the raw chat message; return true to route to the tool-capable path
 * @returns `this` for chaining
 */
export const applyWithToolIntent = (state: BuilderState, classifier: (message: string) => boolean) => {
    state._toolIntentClassifier = classifier
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
export const applyWithSkillPersistence = (state: BuilderState, enabled: boolean = true) => {
    state._skillPersistence = enabled
}


/**
 * Register Living Skills directories. Each path must contain subfolders
 * with a `SKILL.md` (agentskills.io layout); matching skills are resolved
 * per task and injected as `<available_skills>`.
 *
 * `paths` is REQUIRED and must be non-empty — a path-less call has no
 * effect, so it throws instead of silently no-opping (v0.14, DEBT-REGISTER
 * P0-10). The former `packages` / `evolution` / `overrides` keys were
 * accepted-but-ignored and were removed in v0.14; passing them throws.
 *
 * @param config.paths - Skill directories to resolve from (non-empty)
 * @param config.activate - Skill names to ALWAYS load: their full
 *   instructions are injected into the agent's context at bootstrap so the
 *   procedure is present before it acts, instead of being merely
 *   discoverable. Task-relevant skills are also auto-activated; this is the
 *   deterministic override.
 * @see {@link HarnessProfile.intelligent} — composable preset where
 *   skills graduate as part of the compounding-intelligence stack.
 */
export const applyWithSkills = (state: BuilderState, config: {
    paths: readonly string[]
    activate?: readonly string[]
}) => {
    const cfg = config as {
        paths?: readonly string[]
        activate?: readonly string[]
    } & Record<string, unknown>
    for (const removed of ['packages', 'evolution', 'overrides']) {
        if (cfg && removed in cfg) {
            throw new Error(
                `.withSkills({ ${removed} }) was a no-op (the key was accepted but never read) and was removed in v0.14; see DEBT-REGISTER P0-10. Pass { paths: [...] } only.`
            )
        }
    }
    if (!cfg?.paths?.length) {
        throw new Error(
            '.withSkills() requires { paths: [...] } with at least one skill directory — a path-less call was a silent no-op and now throws (v0.14, DEBT-REGISTER P0-10).'
        )
    }
    state._skillsConfig = {
        paths: [...cfg.paths],
        ...(cfg.activate?.length ? { activate: [...cfg.activate] } : {}),
    }
}
