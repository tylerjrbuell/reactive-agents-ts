/**
 * ReactiveAgent — the runtime agent class returned by
 * `ReactiveAgentBuilder.build()`. Owns the engine, runtime, and
 * gateway lifecycle. Exposes facade methods for run/subscribe/pause/
 * resume/stop/cancel/dispose/start/refineSkills/ingest.
 *
 * Lifted from builder.ts pre-W25 (6,232-LOC checkpoint) so builder.ts
 * can focus on the fluent-API builder while reactive-agent.ts owns
 * the runtime surface.
 */

// ── Imports ──
import {
    Effect,
    Schema,
    ManagedRuntime,
    Runtime,
    Stream as EStream,
    Context,
    Fiber,
} from 'effect'
import { deriveGoalAchieved } from './builder/helpers.js'
import { bootstrapGateway } from './agent/gateway-bootstrap.js'
import { makeExecuteEvent } from './agent/execute-event.js'
import { makeGatewayTick } from './agent/gateway-tick.js'
import {
    subscribeChannelHandler,
    buildGatewayHandle,
} from './agent/gateway-driver.js'
import type { ExecutionContext } from './types.js'
import type { RuntimeErrors } from './errors.js'
import { unwrapError } from './errors.js'
import type { ToolDefinition } from '@reactive-agents/tools'
import type { Task, TaskResult } from '@reactive-agents/core'
import type { TaskError } from '@reactive-agents/core'
import { generateTaskId, AgentId, TaskId } from '@reactive-agents/core'
import type {
    AgentEvent,
    OutputFormat,
    TerminatedBy,
} from '@reactive-agents/core'
import { EventBus } from '@reactive-agents/core'
import { KillSwitchService } from '@reactive-agents/guardrails'
import type { AgentStreamEvent, StreamDensity } from './stream-types.js'
import { RunController } from './run-controller.js'
import type { RunHandle } from './run-controller.js'
import {
    AgentSession,
    directChat,
    requiresTools,
    buildChatSystemContext,
    publishChatTurnEvents,
    type ChatMessage,
    type ChatOptions,
    type ChatReply,
    type SessionOptions,
} from './chat.js'
import type { AgentDebrief } from './debrief.js'
import { Health } from '@reactive-agents/health'
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import {
  GatewayChatManager,
  channelOutboundToolGuidance,
} from "./gateway-context-formatting.js";
import { createChatManager } from "./agent/chat-manager-factory.js";
import type { ChannelsConfig } from "@reactive-agents/channels";
import type {
    GatewaySummary,
    GatewayHandle,
    AgentResultMetadata,
    AgentResult,
} from './builder/types.js'

// ── Class ──
export class ReactiveAgent {
    constructor(
        private readonly engine: {
            execute: (
                task: Task
            ) => Effect.Effect<TaskResult, RuntimeErrors | TaskError>
            executeStream: (
                task: Task,
                options?: { density?: StreamDensity }
            ) => Effect.Effect<EStream.Stream<AgentStreamEvent, Error>>
            cancel: (taskId: string) => Effect.Effect<void, RuntimeErrors>
            getContext: (
                taskId: string
            ) => Effect.Effect<ExecutionContext | null, never>
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
        /** @internal Whether gateway was configured via .withGateway(). */
        private readonly _gatewayEnabled: boolean = false,
        /** @internal Gateway heartbeat interval (ms). Defaults to 60000. */
        private readonly _gatewayIntervalMs: number = 60_000,
        /** @internal Whether a custom heartbeat instruction was configured. */
        private readonly _hasCustomHeartbeatInstruction: boolean = false,
        /** @internal When true, gateway runs share the stable agent id for memory continuity. */
        private readonly _gatewayPersistMemory: boolean = false,
        /** @internal Default stream density set via `.withStreaming()`. */
        private readonly _defaultStreamDensity?: StreamDensity,
        /** @internal Callback to set task description for parent context forwarding. */
        private readonly _setTaskDescription?: (desc: string) => void,
        /** @internal Optional error handler registered via .withErrorHandler(). */
        private readonly _errorHandler?: (
            error: RuntimeErrors | Error,
            context: {
                taskId: string
                phase: string
                iteration: number
                lastStep?: string
            }
        ) => void,
        /** @internal Whether session persistence was enabled at build time. */
        private readonly _sessionPersist: boolean = false,
        /** @internal Max age of sessions in days at build time. */
        private readonly _sessionMaxAgeDays?: number,
        /** @internal Reference to the shared RAG memory store for runtime ingestion via ingest(). */
        private readonly _ragStore?: import('@reactive-agents/tools').RagMemoryStore,
        /** @internal Optional external channels (webhooks, bots) from `.withChannels()`. */
        private readonly _channelsConfig?: ChannelsConfig,
        /** @internal Harness improvement config fields exposed for testing. */
        private readonly _config?: {
            minIterations?: number
            taskContext?: Record<string, string>
            progressCheckpoint?: { every: number; autoResume?: boolean }
            verificationStep?: { mode: 'reflect' | 'loop'; prompt?: string }
            outputValidator?: (output: string) => {
                valid: boolean
                feedback?: string
            }
            outputValidatorOptions?: { maxRetries?: number }
            customTermination?: (state: { output: string }) => boolean
        }
    ) {}

    /** @internal Last debrief from a completed run — used as context in chat() calls. */
    private _lastDebrief?: AgentDebrief
    /** @internal Tool observations from the last run — gives chat access to actual data. */
    private _lastRunObservations: string[] = []
    /** @internal Conversation history for the agent-level chat context. */
    private _chatHistory: ChatMessage[] = []

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
        const serverNames = this._mcpServerNames
        if (serverNames.length > 0) {
            await this.runtime.runPromise(
                Effect.gen(function* () {
                    const toolsMod = yield* Effect.promise(
                        () => import('@reactive-agents/tools')
                    )
                    const ts =
                        yield* toolsMod.ToolService as unknown as import('effect').Context.Tag<
                            any,
                            any
                        >
                    for (const name of serverNames) {
                        yield* (ts as any)
                            .disconnectMCPServer(name)
                            .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/builder.ts:4182", tag: errorTag(err) })))
                    }
                }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/builder.ts:4184", tag: errorTag(err) })))
            )
        }
        await this.runtime.dispose()
    }

    /**
     * Check the health status of this agent and its dependencies.
     *
     * Returns a structured health response with individual check results.
     * When health checks are not enabled (.withHealthCheck() not called),
     * returns a basic "healthy" response with no checks.
     *
     * @example
     * ```typescript
     * const health = await agent.health();
     * if (health.status === "unhealthy") {
     *   console.error("Agent unhealthy:", health.checks.filter(c => !c.healthy));
     * }
     * ```
     */
    async health(): Promise<{
        status: 'healthy' | 'degraded' | 'unhealthy'
        checks: Array<{
            name: string
            healthy: boolean
            durationMs: number
            lastError?: string
        }>
    }> {
        return this.runtime.runPromise(
            Effect.gen(function* () {
                const healthOpt = yield* Effect.serviceOption(Health)
                if (healthOpt._tag !== 'Some') {
                    return { status: 'healthy' as const, checks: [] }
                }
                const response = yield* healthOpt.value.check()
                return {
                    status: response.status,
                    checks: response.checks.map((c) => ({
                        name: c.name,
                        healthy: c.healthy,
                        durationMs: c.durationMs,
                        lastError: c.message,
                    })),
                }
            }).pipe(
                Effect.catchAll(() =>
                    Effect.succeed({ status: 'healthy' as const, checks: [] })
                )
            )
        )
    }

    /**
     * Ingest a document into the agent's RAG memory store at runtime.
     *
     * The document is chunked and indexed so the agent can retrieve it via the
     * `rag-search` tool on subsequent `run()` calls. This is the runtime counterpart
     * of the builder's `.withDocuments()` method.
     *
     * @param content - The full document content to ingest
     * @param options - Source identifier, optional format, chunk strategy, and max chunk size
     * @throws Error if tools are not enabled (no RAG store available)
     *
     * @example
     * ```typescript
     * await agent.ingest("The population of Tokyo is 14 million.", {
     *   source: "city-facts.txt",
     * });
     * await agent.ingest("# API Reference\n\n## GET /users\n...", {
     *   source: "api-docs.md",
     *   format: "markdown",
     *   chunkStrategy: "markdown-sections",
     * });
     * const result = await agent.run("What is the population of Tokyo?");
     * ```
     */
    async ingest(
        content: string,
        options: {
            source: string
            format?: string
            chunkStrategy?: string
            maxChunkSize?: number
        }
    ): Promise<void> {
        if (!this._ragStore) {
            throw new Error(
                'ingest() requires tools to be enabled. Call .withTools() or .withDocuments() on the builder.'
            )
        }
        const { ingestDocuments } = await import('./context-ingestion.js')
        await Effect.runPromise(
            ingestDocuments([{ content, ...options }], this._ragStore)
        )
    }

    /**
     * Register a custom tool at runtime, after the agent has been built.
     *
     * This is useful for dynamically extending the agent's tool set without
     * rebuilding. The tool is immediately available on the next `run()` call.
     *
     * @param definition - Tool metadata (name, description, parameters, riskLevel, etc.)
     * @param handler - Effect-returning function that receives validated arguments
     *
     * @example
     * ```typescript
     * await agent.registerTool(
     *   {
     *     name: "my-tool",
     *     description: "Does something useful",
     *     parameters: [{ name: "input", type: "string", description: "Input value", required: true }],
     *     category: "custom",
     *     riskLevel: "low",
     *     source: "function",
     *     timeoutMs: 5000,
     *     requiresApproval: false,
     *   },
     *   (args) => Effect.succeed({ result: args.input }),
     * );
     * ```
     */
    async registerTool(
        definition: ToolDefinition,
        handler: (args: Record<string, unknown>) => Effect.Effect<unknown, any>
    ): Promise<void> {
        return this.runtime.runPromise(
            Effect.gen(function* () {
                const toolsMod = yield* Effect.promise(
                    () => import('@reactive-agents/tools')
                )
                const ts =
                    yield* toolsMod.ToolService as unknown as import('effect').Context.Tag<
                        any,
                        any
                    >
                yield* (ts as any).register(definition, handler)
            })
        )
    }

    /**
     * Unregister a previously registered custom tool at runtime.
     *
     * Built-in tools are protected and cannot be removed. Attempting to unregister
     * an unknown tool name is a no-op.
     *
     * @param name - Exact tool name to remove
     *
     * @example
     * ```typescript
     * await agent.unregisterTool("my-tool");
     * ```
     */
    async unregisterTool(name: string): Promise<void> {
        return this.runtime.runPromise(
            Effect.gen(function* () {
                const toolsMod = yield* Effect.promise(
                    () => import('@reactive-agents/tools')
                )
                const ts =
                    yield* toolsMod.ToolService as unknown as import('effect').Context.Tag<
                        any,
                        any
                    >
                yield* (ts as any).unregisterTool(name)
            })
        )
    }

    /**
     * List all loaded skills for this agent.
     */
    async skills(): Promise<import('@reactive-agents/core').SkillRecord[]> {
        try {
            const agentId = this.agentId
            return await this.runtime.runPromise(
                Effect.gen(function* () {
                    const store = yield* Effect.serviceOption(
                        Context.GenericTag<{
                            listAll: (
                                agentId: string
                            ) => Effect.Effect<any[], unknown>
                        }>('SkillStoreService')
                    )
                    if (store._tag !== 'Some') return []
                    return yield* store.value.listAll(agentId)
                })
            )
        } catch {
            return []
        }
    }

    /**
     * Export a skill to SKILL.md format.
     */
    async exportSkill(name: string, outputPath?: string): Promise<string> {
        const allSkills = await this.skills()
        const skill = allSkills.find((s: any) => s.name === name)
        if (!skill) throw new Error(`Skill "${name}" not found`)

        const fs = await import('node:fs')
        const path = await import('node:path')
        const dir = outputPath ?? path.join('.', '.agents', 'skills', name)
        fs.mkdirSync(dir, { recursive: true })

        const frontmatter = [
            '---',
            `name: ${skill.name}`,
            `description: ${skill.description}`,
            `# source: ${skill.source}`,
            `# confidence: ${skill.confidence}`,
            `# version: ${skill.version}`,
            '---',
        ].join('\n')

        const content = `${frontmatter}\n\n${skill.instructions}\n`
        const filePath = path.join(dir, 'SKILL.md')
        fs.writeFileSync(filePath, content)
        return filePath
    }

    /**
     * Load a SKILL.md skill at runtime.
     */
    async loadSkill(skillPath: string): Promise<void> {
        const { parseSKILLmd } = await import(
            '@reactive-agents/reactive-intelligence'
        )
        const fs = await import('node:fs')
        const path = await import('node:path')

        const skillMdPath = fs.statSync(skillPath).isDirectory()
            ? path.join(skillPath, 'SKILL.md')
            : skillPath

        const parsed = (parseSKILLmd as any)(skillMdPath)
        if (!parsed)
            throw new Error(`Failed to parse SKILL.md at ${skillMdPath}`)

        const agentId = this.agentId
        await this.runtime.runPromise(
            Effect.gen(function* () {
                const store = yield* Effect.serviceOption(
                    Context.GenericTag<{
                        store: (record: any) => Effect.Effect<string, unknown>
                    }>('SkillStoreService')
                )
                if (store._tag !== 'Some') return
                yield* store.value.store({
                    id: `installed-${parsed.name}`,
                    name: parsed.name,
                    description: parsed.description,
                    agentId,
                    source: 'installed',
                    instructions: parsed.instructions,
                    version: 1,
                    versionHistory: [],
                    config: {
                        strategy: 'reactive',
                        temperature: 0.7,
                        maxIterations: 5,
                        promptTemplateId: 'default',
                        systemPromptTokens: 0,
                        compressionEnabled: false,
                    },
                    evolutionMode: 'locked',
                    confidence: 'trusted',
                    successRate: 0,
                    useCount: 0,
                    refinementCount: 0,
                    taskCategories: [],
                    modelAffinities: [],
                    base: parsed.instructions,
                    avgPostActivationEntropyDelta: 0,
                    avgConvergenceIteration: 0,
                    convergenceSpeedTrend: [],
                    conflictsWith: [],
                    lastActivatedAt: null,
                    lastRefinedAt: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    contentVariants: {
                        full: parsed.instructions,
                        summary: null,
                        condensed: null,
                    },
                })
            })
        )
    }

    /**
     * Manually trigger a skill refinement pass.
     */
    async refineSkills(): Promise<{ refined: number }> {
        try {
            const agentId = this.agentId
            return await this.runtime.runPromise(
                Effect.gen(function* () {
                    const distiller = yield* Effect.serviceOption(
                        Context.GenericTag<{
                            distill: (
                                agentId: string
                            ) => Effect.Effect<{ refined: number }, unknown>
                        }>('SkillDistillerService')
                    )
                    if (distiller._tag !== 'Some') return { refined: 0 }
                    return yield* distiller.value.distill(agentId)
                })
            )
        } catch {
            return { refined: 0 }
        }
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
        await this.dispose()
    }

    /**
     * Execute a task and return the result (simple async version).
     *
     * Blocks until the agent completes or fails. Returns full metadata including duration,
     * cost, tokens used, and reasoning strategy/iteration count.
     *
     * @param input - The task prompt or question
     * @param options.taskId - Optional stable task id (e.g. Cortex desk pre-registers a DB row before `run()`).
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
    async run(
        input: string,
        options?: { readonly taskId?: string }
    ): Promise<AgentResult> {
        // Run the task on ManagedRuntime only — do not wrap in Effect.runPromise(Effect.promise(...)),
        // which nests the default runtime with ManagedRuntime and can yield pure interruption
        // ("All fibers interrupted without errors") on first execution (e.g. with Cortex + reasoning).
        return this.runtime
            .runPromise(this.buildRunTaskEffect(input, options))
            .catch((e) => {
                const unwrapped = unwrapError(e)
                if (this._errorHandler) {
                    try {
                        this._errorHandler(unwrapped as RuntimeErrors | Error, {
                            taskId: 'unknown',
                            phase: 'execution',
                            iteration: 0,
                        })
                    } catch {
                        // Handler exceptions are silently ignored — never replace the original error
                    }
                }
                throw unwrapped
            })
    }

    /**
     * Execute a task as an Effect (advanced async version).
     *
     * Returns an Effect that, when run, performs the task execution. Useful for composing
     * task execution into larger Effect workflows or for custom error handling.
     *
     * @param input - The task prompt or question
     * @param options.taskId - Optional stable task id (same as `run()`).
     * @returns Effect that produces an AgentResult
     * @example
     * ```typescript
     * const effect = agent.runEffect("What is 2+2?");
     * const result = await Effect.runPromise(effect.pipe(
     *   Effect.tapError(err => Effect.logError(err))
     * ));
     * ```
     */
    runEffect(
        input: string,
        options?: { readonly taskId?: string }
    ): Effect.Effect<AgentResult, Error> {
        const pipeline = this.buildRunTaskEffect(input, options)
        const self = this
        return Effect.gen(function* () {
            const rt = yield* Effect.promise(() => self.runtime.runtime())
            return yield* Effect.tryPromise({
                try: () => Runtime.runPromise(rt, pipeline),
                catch: (e) => (e instanceof Error ? e : new Error(String(e))),
            })
        })
    }

    /**
     * Core task execution Effect (requires services from the agent's ManagedRuntime).
     */
    private buildRunTaskEffect(
        input: string,
        options?: { readonly taskId?: string }
    ): Effect.Effect<AgentResult, Error> {
        // Pre-set the task description so sub-agents spawned on the first iteration
        // have access to the full user prompt (including phone numbers, URLs, etc.)
        this._setTaskDescription?.(input.slice(0, 500))

        const taskId = options?.taskId
            ? Schema.decodeSync(TaskId)(options.taskId)
            : generateTaskId()

        const task: Task = {
            id: taskId,
            agentId: Schema.decodeSync(AgentId)(this.agentId),
            type: 'query' as const,
            input: { question: input },
            priority: 'medium' as const,
            status: 'pending' as const,
            metadata: { tags: [] },
            createdAt: new Date(),
        }

        return this.engine.execute(task).pipe(
            Effect.map((result: TaskResult) => {
                const r = result as TaskResult & {
                    format?: OutputFormat
                    terminatedBy?: TerminatedBy
                    debrief?: AgentDebrief
                }
                // Derive toolCalls from reasoning steps so consumers don't
                // have to filter `metadata.reasoningSteps` themselves. The
                // public AgentResult never exposed steps until now — task
                // gate / eval scripts were reading `result.steps` (undefined)
                // and seeing empty toolCalls arrays even when tools ran.
                const rawMetadata = r.metadata as AgentResultMetadata
                const reasoningSteps = (rawMetadata as { reasoningSteps?: ReadonlyArray<{
                    readonly id?: string
                    readonly type: string
                    readonly content: string
                    readonly metadata?: Record<string, unknown>
                }> }).reasoningSteps
                const derivedToolCalls = (reasoningSteps ?? [])
                    .filter((s) => s.type === 'action')
                    .map((s) => {
                        const tc = s.metadata?.toolCall as
                            | { name?: string; arguments?: unknown; id?: string }
                            | undefined
                        return tc?.name
                            ? {
                                  name: tc.name,
                                  ...(tc.arguments !== undefined ? { arguments: tc.arguments } : {}),
                                  ...(tc.id !== undefined ? { id: tc.id } : {}),
                              }
                            : null
                    })
                    .filter((x): x is { name: string; arguments?: unknown; id?: string } => x !== null)
                const enrichedMetadata: AgentResultMetadata = {
                    ...rawMetadata,
                    ...(reasoningSteps !== undefined ? { reasoningSteps } : {}),
                    ...(derivedToolCalls.length > 0 ? { toolCalls: derivedToolCalls } : {}),
                }
                const agentResult: AgentResult = {
                    output: String(r.output ?? ''),
                    success: r.success,
                    taskId: String(r.taskId),
                    agentId: String(r.agentId),
                    metadata: enrichedMetadata,
                    ...(r.format !== undefined ? { format: r.format } : {}),
                    ...(r.terminatedBy !== undefined
                        ? { terminatedBy: r.terminatedBy }
                        : {}),
                    goalAchieved: deriveGoalAchieved(r.terminatedBy),
                    ...(r.debrief !== undefined ? { debrief: r.debrief } : {}),
                    ...(r.error !== undefined ? { error: r.error } : {}),
                }
                // Capture debrief for use as context in subsequent chat() calls
                if (agentResult.debrief) this._lastDebrief = agentResult.debrief
                // Capture reasoning context so chat() has access to actual data.
                // Includes: tool observations + agent analysis thoughts (which contain
                // the synthesized data from tool results, not just compressed previews).
                const steps = ((r.metadata as any)?.reasoningSteps ??
                    []) as Array<{
                    type: string
                    content: string
                    metadata?: {
                        observationResult?: { success?: boolean }
                        toolUsed?: string
                    }
                }>
                const contextParts: string[] = []
                for (let i = 0; i < steps.length; i++) {
                    const s = steps[i]!
                    if (s.type === 'observation') {
                        // Include successful observations (tool results)
                        if (
                            s.metadata?.observationResult?.success !== false &&
                            s.content.length > 10 &&
                            !s.content.startsWith('⚠️') &&
                            !s.content.startsWith('✓ final-answer')
                        ) {
                            contextParts.push(`[Tool result]: ${s.content}`)
                        }
                    } else if (s.type === 'thought' && i > 0) {
                        // Include analysis thoughts that follow observations — these contain
                        // the actual synthesized data (e.g. commit summaries, parsed results).
                        const prev = steps[i - 1]
                        if (
                            prev?.type === 'observation' &&
                            s.content.length > 50
                        ) {
                            contextParts.push(`[Agent analysis]: ${s.content}`)
                        }
                    }
                }
                this._lastRunObservations = contextParts
                return agentResult
            }),
            Effect.mapError(
                (e: RuntimeErrors | TaskError) =>
                    new Error('message' in e ? e.message : String(e))
            )
        ) as Effect.Effect<AgentResult, Error>
    }

    /**
     * Execute a task and return a stream of events.
     *
     * Returns an AsyncIterable that yields `AgentStreamEvent` objects as the agent works.
     * Text tokens arrive as `TextDelta` events. The stream always ends with either
     * `StreamCompleted` (success), `StreamError` (failure), or `StreamCancelled` (aborted).
     *
     * @param input - The task prompt or question
     * @param options - Optional streaming configuration
     * @param options.density - `"tokens"` (default) for text deltas only, `"full"` for phase/tool events too
     * @param options.signal - Optional AbortSignal for cancelling the stream
     * @returns AsyncGenerator of AgentStreamEvent
     * @example
     * ```typescript
     * const ctrl = new AbortController();
     * for await (const event of agent.runStream("Write a haiku", { signal: ctrl.signal })) {
     *   if (event._tag === "TextDelta") process.stdout.write(event.text);
     *   if (event._tag === "StreamCompleted") console.log("\nDone!");
     * }
     * // Cancel from outside: ctrl.abort();
     * ```
     */
    /**
     * Execute a task and return a RunHandle — an AsyncGenerator extended with
     * runtime control verbs (pause/resume/stop/terminate/status).
     *
     * Fully backward-compatible: `for await (const ev of agent.runStream(...))` and
     * `handle.next()` both work unchanged. The added verbs give callers control over
     * the run without a separate AbortController.
     *
     * terminate() — hard abort (StreamCancelled), same as passing an AbortSignal.
     * stop()      — graceful: runs synthesis, emits StreamCompleted.
     * pause()     — freeze at next iteration boundary; await resume().
     * resume()    — continue from paused state.
     * status()    — current RunStatus.
     */
    runStream(
        input: string,
        options?: { density?: StreamDensity; signal?: AbortSignal }
    ): RunHandle {
        const internalAbort = new AbortController();
        const userSignal = options?.signal;
        if (userSignal) {
            if (userSignal.aborted) {
                internalAbort.abort();
            } else {
                userSignal.addEventListener('abort', () => internalAbort.abort(), { once: true });
            }
        }
        const controller = new RunController(internalAbort);
        const gen = this._runStreamImpl(input, { ...options, signal: controller.signal }, controller);
        return Object.assign(gen, {
            pause: () => controller.pause(),
            resume: () => controller.resume(),
            stop: (_opts?: { reason?: string }) => controller.stop(),
            terminate: (_opts?: { reason?: string }) => controller.terminate(),
            status: () => controller.status(),
        }) as RunHandle;
    }

    private async *_runStreamImpl(
        input: string,
        options: { density?: StreamDensity; signal?: AbortSignal },
        controller: RunController
    ): AsyncGenerator<AgentStreamEvent> {
        const signal = options?.signal

        // Pre-start guard: if already aborted, emit StreamCancelled immediately.
        if (signal?.aborted) {
            yield {
                _tag: 'StreamCancelled',
                reason: 'Aborted before start',
                iterationsCompleted: 0,
            } satisfies AgentStreamEvent
            return
        }

        // Pre-set the task description for parent context forwarding.
        this._setTaskDescription?.(input.slice(0, 500))

        const task: Task = {
            id: generateTaskId(),
            agentId: Schema.decodeSync(AgentId)(this.agentId),
            type: 'query' as const,
            input: { question: input },
            priority: 'medium' as const,
            status: 'pending' as const,
            metadata: { tags: [] },
            createdAt: new Date(),
        }

        const density =
            options?.density ?? this._defaultStreamDensity ?? 'tokens'

        // Post-runPromise guard: re-check signal after async acquisition so that
        // abort() fired during the await is not silently missed.
        const stream = await this.runtime.runPromise(
            this.engine.executeStream(task, { density, runController: controller })
        )
        if (signal?.aborted) {
            yield {
                _tag: 'StreamCancelled',
                reason: 'Aborted during setup',
                iterationsCompleted: 0,
            } satisfies AgentStreamEvent
            return
        }

        // Fiber-interruption bridge: fork the Effect stream into an interruptible
        // fiber, push events into a JS queue, and interrupt the fiber when the
        // AbortSignal fires. This ensures abort() stops the Effect fiber
        // immediately — not just between yields.
        type Item =
            | { done: false; value: AgentStreamEvent }
            | { done: true; error?: unknown }

        const itemQueue: Item[] = []
        let resolve: (() => void) | null = null

        const push = (item: Item): void => {
            itemQueue.push(item)
            const r = resolve
            resolve = null
            r?.()
        }

        // Fork the stream consumption as an interruptible Effect fiber.
        const consumeEffect = EStream.runForEach(stream, (event) =>
            Effect.sync(() => push({ done: false, value: event }))
        ).pipe(
            Effect.andThen(Effect.sync(() => push({ done: true }))),
            Effect.catchAll((err) =>
                Effect.sync(() => push({ done: true, error: err }))
            )
        )

        const fiber = this.runtime.runFork(consumeEffect)

        // Interrupt the fiber when the signal fires, and also unblock any waiting
        // promise so the while loop can observe the abort.
        const onAbort = (): void => {
            Effect.runFork(Fiber.interrupt(fiber))
            const r = resolve
            resolve = null
            r?.()
        }
        signal?.addEventListener('abort', onAbort)

        let iterationsCompleted = 0

        try {
            while (true) {
                // Wait for the next item if the queue is empty.
                if (itemQueue.length === 0) {
                    // If the signal is already aborted (fiber interrupted), stop waiting.
                    if (signal?.aborted) break
                    await new Promise<void>((res) => {
                        resolve = res
                    })
                    // After waking, check again if abort fired while we were waiting.
                    if (signal?.aborted && itemQueue.length === 0) break
                }

                const item = itemQueue.shift()
                if (item === undefined) continue

                if (item.done) {
                    if (item.error !== undefined) {
                        // The fiber errored — let the stream end (StreamError was already pushed).
                    }
                    break
                }

                const event = item.value

                // Track iteration progress.
                if (event._tag === 'IterationProgress') {
                    iterationsCompleted =
                        (event as { iteration?: number }).iteration ??
                        iterationsCompleted
                }

                yield event

                // Check signal after yield returns (covers between-event abort).
                if (signal?.aborted) {
                    yield {
                        _tag: 'StreamCancelled',
                        reason: signal.reason ?? 'Cancelled',
                        iterationsCompleted,
                    } satisfies AgentStreamEvent
                    return
                }
            }

            // If the signal is aborted and the fiber was interrupted (no terminal
            // StreamCompleted/StreamError was pushed), emit StreamCancelled.
            if (signal?.aborted) {
                yield {
                    _tag: 'StreamCancelled',
                    reason: signal.reason ?? 'Cancelled',
                    iterationsCompleted,
                } satisfies AgentStreamEvent
            }
        } finally {
            signal?.removeEventListener('abort', onAbort)
            // Ensure the fiber is interrupted on generator early exit (break/throw/return).
            Effect.runFork(Fiber.interrupt(fiber))
            controller.markCompleted()
        }
    }

    /**
     * Send a conversational message to the agent.
     *
     * Automatically routes between two paths based on message intent:
     * - **Direct LLM path** (fast, no tools): conversational/factual questions, simple queries
     * - **Tool-capable path**: messages requiring search, file ops, computation, etc.
     *
     * Use `options.useTools` to override the automatic routing.
     *
     * @param message - The user's conversational message
     * @param options - Optional routing overrides and iteration limits
     * @returns Promise resolving to a ChatReply with `message` (and optional `toolsUsed`)
     * @example
     * ```typescript
     * const reply = await agent.chat("What did you find earlier?");
     * console.log(reply.message);
     *
     * // Force tool path:
     * const reply2 = await agent.chat("Search for latest news", { useTools: true });
     * ```
     */
    async chat(
        message: string,
        options?: ChatOptions,
        _history?: ChatMessage[],
        _sessionId?: string
    ): Promise<ChatReply> {
        const useTools = options?.useTools ?? requiresTools(message)
        const contextSummary = buildChatSystemContext(
            this._config?.taskContext,
            this._lastDebrief,
            this._lastRunObservations
        )
        const sessionId = _sessionId ?? `chat_${Date.now()}`
        const publishChatTurns = async (
            routedVia: 'direct-llm' | 'react-loop',
            assistantMessage: string,
            tokensUsed?: number,
            taskId: string = 'chat'
        ): Promise<void> => {
            await publishChatTurnEvents({
                taskId,
                sessionId,
                routedVia,
                userMessage: message,
                assistantMessage,
                tokensUsed,
                publish: async (event) => {
                    await this.runtime.runPromise(
                        EventBus.pipe(
                            Effect.flatMap((bus) => bus.publish(event)),
                            Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/builder.ts:4916", tag: errorTag(err) }))
                        )
                    )
                },
            })
        }

        if (!useTools) {
            // Direct LLM path — fast, no tool overhead
            // Use caller-supplied history (session context) or fall back to agent-level history
            const reply = await this.runtime.runPromise(
                directChat(
                    message,
                    _history ?? this._chatHistory,
                    contextSummary,
                    options?.extraContext
                )
            )
            // Accumulate into agent-level history when called outside a session
            if (!_history) {
                this._chatHistory.push({
                    role: 'user',
                    content: message,
                    timestamp: Date.now(),
                })
                this._chatHistory.push({
                    role: 'assistant',
                    content: reply.message,
                    timestamp: Date.now(),
                })
            }
            await publishChatTurns(
                'direct-llm',
                reply.message,
                reply.tokens,
                'chat'
            )
            return reply
        }

        // Tool-capable path — full agent run with capped iterations
        // Prepend prior run context so the agent knows what happened before
        const enrichedMessage = contextSummary
            ? `Context from prior run:\n${contextSummary}\n\nNew request: ${message}`
            : message
        const result = await this.run(enrichedMessage)
        await publishChatTurns(
            'react-loop',
            result.output,
            result.metadata.tokensUsed,
            result.taskId
        )
        return {
            message: result.output,
            toolsUsed: result.debrief?.toolsUsed.map((t) => t.name),
            tokens: result.metadata.tokensUsed,
            steps: result.metadata.stepsCount,
            cost: result.metadata.cost,
        }
    }

    /**
     * Create a stateful chat session backed by this agent.
     *
     * Returns an `AgentSession` with `chat()`, `history()`, and `end()` methods.
     * The session maintains conversation history automatically.
     *
     * @param options - Optional session configuration
     * @returns A new AgentSession instance
     * @example
     * ```typescript
     * const session = agent.session();
     * const r1 = await session.chat("Hello!");
     * const r2 = await session.chat("What did I just say?");
     * console.log(session.history()); // [{role:"user",...}, {role:"assistant",...}, ...]
     * await session.end();
     * ```
     */
    session(
        options?: SessionOptions & {
            persist?: boolean
            id?: string
            maxAgeDays?: number
        }
    ): AgentSession {
        const persist = options?.persist ?? this._sessionPersist
        const _maxAgeDays = options?.maxAgeDays ?? this._sessionMaxAgeDays
        const sessionId =
            options?.id ??
            `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        const self = this

        const onSave = persist
            ? async (history: ChatMessage[]) => {
                  await self.runtime.runPromise(
                      Effect.gen(function* () {
                          const memMod = yield* Effect.promise(
                              () => import('@reactive-agents/memory')
                          )
                          const storeOpt = yield* Effect.serviceOption(
                              memMod.SessionStoreService
                          )
                          if (storeOpt._tag !== 'Some') return
                          yield* storeOpt.value.save({
                              sessionId,
                              agentId: self.agentId,
                              messages: history,
                          })
                      }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/builder.ts:5023", tag: errorTag(err) })))
                  )
              }
            : undefined

        return new AgentSession(
            (msg, history, opts) => this.chat(msg, opts, history, sessionId),
            undefined,
            onSave
        )
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
                Effect.mapError(
                    (e: RuntimeErrors) =>
                        new Error('message' in e ? e.message : String(e))
                ),
                Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/builder.ts:5057", tag: errorTag(err) }))
            ) as Effect.Effect<void>
        )
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
            this.engine.getContext(
                taskId
            ) as Effect.Effect<ExecutionContext | null>
        )
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
                Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/builder.ts:5105", tag: errorTag(err) }))
            ) as Effect.Effect<void>
        )
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
                Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/builder.ts:5129", tag: errorTag(err) }))
            ) as Effect.Effect<void>
        )
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
    async stop(reason = 'stop() called'): Promise<void> {
        return this.runtime.runPromise(
            KillSwitchService.pipe(
                Effect.flatMap((ks) => ks.stop(this.agentId, reason)),
                Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/builder.ts:5152", tag: errorTag(err) }))
            ) as Effect.Effect<void>
        )
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
    async terminate(reason = 'terminate() called'): Promise<void> {
        return this.runtime.runPromise(
            KillSwitchService.pipe(
                Effect.flatMap((ks) => ks.terminate(this.agentId, reason)),
                Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/builder.ts:5175", tag: errorTag(err) }))
            ) as Effect.Effect<void>
        )
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
    subscribe<T extends AgentEvent['_tag']>(
        tag: T,
        handler: (event: Extract<AgentEvent, { _tag: T }>) => void
    ): Promise<() => void>

    /**
     * Subscribe to all agent events (catch-all).
     * The handler receives the full `AgentEvent` union — use `event._tag` to discriminate.
     *
     * @example
     * const unsub = await agent.subscribe((event) => {
     *   if (event._tag === "ToolCallStarted") console.log(event.toolName);
     * });
     */
    subscribe(handler: (event: AgentEvent) => void): Promise<() => void>

    async subscribe<T extends AgentEvent['_tag']>(
        tagOrHandler: T | ((event: AgentEvent) => void),
        handler?: (event: Extract<AgentEvent, { _tag: T }>) => void
    ): Promise<() => void> {
        if (typeof tagOrHandler === 'function') {
            // Catch-all overload
            return this.runtime.runPromise(
                EventBus.pipe(
                    Effect.flatMap((eb) =>
                        eb.subscribe((event) =>
                            Effect.sync(() =>
                                (tagOrHandler as (event: AgentEvent) => void)(
                                    event
                                )
                            )
                        )
                    ),
                    Effect.catchAll(() => Effect.succeed(() => {}))
                ) as Effect.Effect<() => void>
            )
        }
        // Tag-filtered overload — delegates to the typed eb.on()
        return this.runtime.runPromise(
            EventBus.pipe(
                Effect.flatMap((eb) =>
                    eb.on(tagOrHandler, (event) =>
                        Effect.sync(() => handler!(event))
                    )
                ),
                Effect.catchAll(() => Effect.succeed(() => {}))
            ) as Effect.Effect<() => void>
        )
    }

    /**
     * Subscribe to agent events with a plain callback (no Effect required).
     *
     * A convenience wrapper over `.subscribe()` that accepts a plain function instead of
     * an Effect handler. Returns an unsubscribe function synchronously (after initial setup).
     *
     * @param tag - Event type to listen for (e.g., "TextDelta", "ToolCallCompleted")
     * @param callback - Plain callback function receiving the typed event
     * @returns Promise resolving to an unsubscribe function
     *
     * @example
     * ```typescript
     * const unsub = await agent.on("TextDelta", (event) => {
     *   process.stdout.write(event.text);
     * });
     *
     * await agent.run("Hello");
     * unsub();
     * ```
     */
    async on<T extends AgentEvent['_tag']>(
        tag: T,
        callback: (event: Extract<AgentEvent, { _tag: T }>) => void
    ): Promise<() => void> {
        return this.subscribe(tag, callback)
    }

    /**
     * Query the current gateway status (stats, uptime, state).
     *
     * Returns the `GatewayStatus` snapshot from GatewayService, or `null` if the gateway
     * is not configured. Safe to call at any time — does not start the loop.
     *
     * @returns Promise resolving to GatewayStatus or null
     * @example
     * ```typescript
     * const status = await agent.gatewayStatus();
     * if (status) {
     *   console.log(`Heartbeats: ${status.stats.heartbeatsFired}`);
     *   console.log(`Uptime: ${status.uptime}ms`);
     * }
     * ```
     */
    async gatewayStatus(): Promise<
        import('@reactive-agents/gateway').GatewayStatus | null
    > {
        try {
            return await this.runtime.runPromise(
                Effect.gen(function* () {
                    const gwMod = yield* Effect.promise(
                        () => import('@reactive-agents/gateway')
                    )
                    const gw = yield* gwMod.GatewayService as any
                    return yield* gw.status()
                }) as Effect.Effect<any>
            )
        } catch {
            return null
        }
    }

    /**
     * Start the persistent gateway loop (heartbeats + crons).
     *
     * Requires `.withGateway()` to be configured during build. The loop emits heartbeat events
     * on a timer, passes them through the policy engine, and executes `agent.run()` when the
     * policy decides to act. Cron entries are also checked each tick.
     *
     * Returns a `GatewayHandle` with `.stop()` to end the loop and `.done` that resolves
     * when the loop stops.
     *
     * **`.withChannels()`:** adapter registration runs on the gateway loop's first async tick.
     * Before inbound webhook traffic, wait briefly (e.g. a short `setTimeout`) so `registerAdapter`
     * has completed unless your caller already runs after the first gateway tick.
     *
     * @throws Error if gateway is not configured (no `.withGateway()` call)
     * @returns GatewayHandle with stop() and done promise
     * @example
     * ```typescript
     * const handle = agent.start();
     * // ... later
     * const summary = await handle.stop();
     * console.log(`${summary.totalRuns} runs, ${summary.heartbeatsFired} heartbeats`);
     * ```
     */
    start(): GatewayHandle {
        if (!this._gatewayEnabled) {
            throw new Error(
                'Gateway not configured. Call .withGateway() before .start()'
            )
        }

        const self = this
        let stopped = false
        let isExecuting = false // concurrency guard — prevents overlapping agent runs
        let timer: ReturnType<typeof setInterval> | null = null
        let heartbeatsFired = 0
        let totalRuns = 0
        let cronChecks = 0
        let chatTurns = 0
        let lastCompactionAt = 0
        let resolveStop: ((summary: GatewaySummary) => void) | null = null
        let unsubChannel: (() => void) | null = null
        let chatManagerRef: GatewayChatManager | null = null
        let channelAdaptersCleanup: (() => Promise<void>) | null = null

        const stopPromise = new Promise<GatewaySummary>((resolve) => {
            resolveStop = resolve
        })

        // Start the loop asynchronously
        const loopPromise = (async () => {
            const channelsCfg = self._channelsConfig
            const bootstrap = await bootstrapGateway({
                runtime: self.runtime,
                channelsConfig: channelsCfg,
                gatewayIntervalMs: self._gatewayIntervalMs,
                createSession: (sessionId) =>
                    self.session({
                        id: sessionId,
                        persist: self._sessionPersist,
                    }),
            })

            if (!bootstrap.ok) {
                const summary: GatewaySummary = {
                    heartbeatsFired,
                    totalRuns,
                    cronChecks,
                    chatTurns,
                    error: bootstrap.error.message,
                }
                ;(resolveStop as ((s: GatewaySummary) => void) | null)?.(
                    summary
                )
                throw bootstrap.error
            }

            const { gw, sched, eb, glog } = bootstrap
            channelAdaptersCleanup = bootstrap.channelAdaptersCleanup

            // Helper to publish events safely
            const publish = async (event: any) => {
                if (!eb) return
                try {
                    await self.runtime.runPromise(eb.publish(event))
                } catch {
                    /* observability errors don't kill the loop */
                }
            }

            // Helper to run an event through the gateway and execute if approved.
            // Guarded by `isExecuting` to prevent overlapping agent runs.
            // Each execution uses a unique agentId suffix so it bootstraps with empty
            // memory — gateway runs are stateless and don't carry context from prior runs.
            const executeEvent = makeExecuteEvent({
                publish,
                glog,
                engine: self.engine,
                runtime: self.runtime,
                gw,
                agentId: self.agentId ?? 'unknown',
                persistMemory: self._gatewayPersistMemory ?? false,
                getIsExecuting: () => isExecuting,
                setIsExecuting: (v) => {
                    isExecuting = v
                },
                incrementTotalRuns: () => {
                    totalRuns++
                },
            })

            // ─── Gateway chat mode ────────────────────────────────────────
            const gwOpts = (self as any)._gatewayOptions as
                | { accessControl?: { mode?: 'chat' | 'task'; sessionTtlDays?: number } }
                | undefined
            const channelMode = gwOpts?.accessControl?.mode ?? 'chat'
            const sessionTtlDays: number =
                gwOpts?.accessControl?.sessionTtlDays ?? 30

            const chatManager = createChatManager({
                agentId: self.agentId ?? 'gateway',
                gatewayOptions: gwOpts,
                runtime: self.runtime as ManagedRuntime.ManagedRuntime<
                    unknown,
                    unknown
                >,
                executeEvent,
            })
            chatManagerRef = chatManager

            const tick = makeGatewayTick({
                runtime: self.runtime,
                agentId: self.agentId ?? 'gateway',
                hasCustomHeartbeatInstruction:
                    self._hasCustomHeartbeatInstruction ?? false,
                sessionTtlDays,
                gw,
                sched,
                glog,
                executeEvent,
                chatManager,
                getStopped: () => stopped,
                incrementHeartbeats: () => ++heartbeatsFired,
                incrementCronChecks: () => ++cronChecks,
                getLastCompactionAt: () => lastCompactionAt,
                setLastCompactionAt: (v) => {
                    lastCompactionAt = v
                },
            })

            // Subscribe to channel messages from MCP servers for push-based messaging
            unsubChannel = await subscribeChannelHandler({
                eb,
                gw,
                glog,
                channelMode,
                channelOutboundToolGuidance,
                executeEvent,
                chatManager,
                runtime: self.runtime as ManagedRuntime.ManagedRuntime<
                    any,
                    never
                >,
                agentId: self.agentId ?? 'unknown',
                getStopped: () => stopped,
                incrementChatTurns: () => {
                    chatTurns++
                },
            })

            timer = setInterval(tick, self._gatewayIntervalMs)

            // Run first tick — skip immediate execution when using default heartbeat
            // instruction (avoids confused first run with no context)
            const hasCustomInstruction = self._hasCustomHeartbeatInstruction
            if (hasCustomInstruction) {
                await tick()
            }
        })()

        // If loopPromise rejects (gateway not configured), propagate
        loopPromise.catch(() => {})

        return buildGatewayHandle({
            setStopped: (v) => {
                stopped = v
            },
            getTimer: () => timer,
            getUnsubChannel: () => unsubChannel,
            getChannelAdaptersCleanup: () => channelAdaptersCleanup,
            getChatManager: () => chatManagerRef,
            resolveStop: (s) => {
                resolveStop?.(s)
            },
            stopPromise,
            getCounters: () => ({
                heartbeatsFired,
                totalRuns,
                cronChecks,
                chatTurns,
            }),
        })
    }
}
