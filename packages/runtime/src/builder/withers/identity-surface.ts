/**
 * Identity + external-surface withers for ReactiveAgentBuilder
 * (2026-10-20 builder decomp, GH #218 / HS-248).
 *
 * Class methods on the builder are thin delegates that mutate state via these
 * helpers and return `this` for chaining; public-contract JSDoc moved verbatim.
 */
import type { AgentPersona, A2AOptions, GatewayOptions } from '../types.js'
import type { ProviderName } from '../types.js'
import type { ChannelsConfig } from '@reactive-agents/channels'
import type { ToolParameter } from '@reactive-agents/tools'
import type { BuilderState } from './_state.js'

/**
 * Set the agent's name — used for identification and logging.
 *
 * @param name - Display name for the agent
 * @returns `this` for chaining
 */
export const applyWithName = (state: BuilderState, name: string) => {
    state._name = name
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
export const applyWithAgentId = (state: BuilderState, id: string) => {
    state._stableAgentId = id
}


/**
 * Set the agent's persona — a structured way to define behavior and characteristics.
 *
 * The persona is composed into the system prompt, providing guidance on role, background,
 * instructions, and tone. When combined with an explicit system prompt, the persona
 * is prepended before the custom prompt.
 *
 * @param persona - AgentPersona with role, background, instructions, and/or tone
 * @param persona.name - Display name of the agent (defaults to `.withName()` value). Default: undefined
 * @param persona.role - What this agent does — injected as the "Role:" section of the system prompt. Default: undefined
 * @param persona.background - Background context or expertise — injected as the "Background:" section. Default: undefined
 * @param persona.instructions - Explicit behavioral instructions — injected as the "Instructions:" section. Default: undefined
 * @param persona.tone - Tone/style guidance (e.g., "professional", "concise", "friendly") — injected as the "Tone:" section. Default: undefined
 * @returns `this` for chaining
 * @see {@link AgentPersona} — the full named type with the same field docs.
 */
export const applyWithPersona = (state: BuilderState, persona: AgentPersona) => {
    state._persona = persona
}


/**
 * Add custom environment context injected into the system prompt.
 *
 * The framework always injects date, time, timezone, and platform automatically.
 * Use this to add custom context the agent should know without tool calls.
 *
 * @param context - Key-value pairs (e.g., `{ "User Location": "San Francisco, CA" }`)
 * @returns `this` for chaining
 * No composable equivalent yet: the `Environment:` block (auto date/time/
 *   timezone/platform + whatever you pass here) is assembled from a
 *   separate `environmentContext` channel (assembly/stages/system-prompt.ts),
 *   not the `input.systemPrompt` that `.compose(h => h.on('prompt.system',
 *   ...))` sees — that hook cannot see or override this block today.
 */
export const applyWithEnvironment = (state: BuilderState, context: Record<string, string>) => {
    state._environmentContext = { ...state._environmentContext, ...context }
}


/**
 * Enable Agent-to-Agent (A2A) protocol server for remote agent invocation.
 *
 * When enabled, the agent exposes a JSON-RPC 2.0 HTTP endpoint at `/.well-known/agent.json`
 * that allows other agents or services to discover and invoke this agent remotely.
 *
 * @param options - A2A configuration
 * @param options.port - HTTP port for the A2A server. Default: 3000
 * @param options.basePath - Base path prefix for all A2A routes. Default: "/"
 * @returns `this` for chaining
 */
export const applyWithA2A = (state: BuilderState, options?: A2AOptions) => {
    state._a2aOptions = options ?? { port: 3000 }
}


/**
 * Enable the persistent gateway for autonomous agent behavior.
 *
 * Configures heartbeats (adaptive by default), cron schedules, webhook endpoints,
 * and a composable policy engine. The gateway is deterministic infrastructure —
 * it only invokes the LLM when intelligence is genuinely needed.
 *
 * @param options - Gateway configuration
 * @param options.timezone - Timezone for cron schedules
 * @param options.heartbeat - { intervalMs?, policy?, instruction?, maxConsecutiveSkips? }
 * @param options.crons - Scheduled jobs: { schedule, instruction, agentId?, priority?, timezone?, enabled? }[]
 * @param options.webhooks - Webhook endpoints: { path, adapter, secret?, events? }[]
 * @param options.policies - Policy limits: { dailyTokenBudget?, maxActionsPerHour?, heartbeatPolicy?, mergeWindowMs?, requireApprovalFor? }
 * @param options.persistMemoryAcrossRuns - Share stable agent id across gateway runs for memory continuity
 * @param options.port - Gateway HTTP server port
 * @param options.accessControl - Channel access control: { accessPolicy?, allowedSenders?, blockedSenders?, mode?, sessionTtlDays? }
 * @returns `this` for chaining
 */
export const applyWithGateway = (state: BuilderState, options?: GatewayOptions) => {
    state._gatewayOptions = options ?? {}
}


/**
 * Register the external channel layer (`@reactive-agents/channels`) for webhook/bot ingress.
 *
 * Adapters are started when {@link ReactiveAgent.start} runs (requires `.withGateway()` so the
 * gateway policy engine can evaluate inbound channel `GatewayEvent` values.
 *
 * @param config - Channel configuration
 * @param config.adapters - Message channel adapters (webhooks, bot transports)
 * @param config.triggers - Trigger definitions for channel ingress
 * @param config.defaultAgent - Default agent config for triggered channels
 * @param config.sessions - Session settings: { compactionThreshold?, idleTimeoutMs? }
 * @returns `this` for chaining
 * Use `GatewayOptions.accessControl` for messaging allowlists — separate from this API.
 */
export const applyWithChannels = (state: BuilderState, config: ChannelsConfig) => {
    state._channelsConfig = config
}


/**
 * Set the LLM provider for the agent.
 *
 * The `config` argument (OpenAI-compatible endpoint override) applies to
 * the whole OpenAI-compatible provider family — `"openai"`, `"groq"`,
 * `"xai"`, and `"litellm"` — which all speak the same Chat Completions
 * wire protocol. Use it to point at a LiteLLM proxy, a llama.cpp server's
 * `/v1` API, Deepseek, or any other OpenAI-compatible endpoint at
 * runtime, without predefining `LITELLM_BASE_URL`/`OPENAI_API_KEY`/etc.
 * Silently ignored for `"anthropic"`, `"gemini"`, and `"ollama"` — those
 * speak a different wire protocol.
 *
 * @param provider - One of: `"anthropic"`, `"openai"`, `"ollama"`, `"gemini"`, `"litellm"`, `"groq"`, `"xai"`, or `"test"`
 * @param config - Optional OpenAI-compatible endpoint override
 * @param config.baseUrl - Base URL for the OpenAI-compatible endpoint (e.g. `"http://localhost:8080/v1"`)
 * @param config.apiKey - API key for the endpoint
 * @param config.headers - Additional HTTP headers to send with requests
 * @returns `this` for chaining
 *
 * @example
 * ```typescript
 * agent.withProvider("litellm", {
 *   baseUrl: "http://localhost:8080/v1", // llama.cpp server
 *   apiKey: process.env.MY_KEY,
 *   headers: { "X-Custom": "value" },
 * })
 * ```
 */
export const applyWithProvider = (state: BuilderState, provider: ProviderName, config?: { baseUrl?: string; apiKey?: string; headers?: Record<string, string> }) => {
    state._provider = provider
    state._providerExplicit = true
    state._providerConfig = config
}


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
export const applyWithAgentTool = (state: BuilderState,     name: string,
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
    }) => {
    state._agentTools.push({ name, agent })
}


/**
 * Allow this agent to dynamically spawn sub-agents at runtime via the `spawn-agent` tool.
 *
 * Sub-agents run in a clean context window (no parent history) using the parent's provider
 * and model by default. The parent LLM can generate parameters to steer spawned agents.
 * Recursion depth is capped at 3; spawned agents do NOT inherit the spawn-agent tool
 * unless explicitly given it.
 *
 * @param options - Optional configuration
 * @param options.maxIterations - Max iterations for spawned agents (default: inherits parent's cap)
 * @param options.maxRecursionDepth - Max recursion depth for nested spawning (default: 3)
 * @returns `this` for chaining
 */
export const applyWithDynamicSubAgents = (state: BuilderState, options?: {
    maxIterations?: number
    maxRecursionDepth?: number
}) => {
    state._allowDynamicSubAgents = true
    state._dynamicSubAgentOptions = options
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
export const applyWithRemoteAgent = (state: BuilderState, name: string, remoteUrl: string) => {
    state._agentTools.push({ name, remoteUrl })
}
