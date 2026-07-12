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
import { resolveGoalAchieved, deriveReceiptToolCalls, deriveReceiptModelId, deriveReceiptDeliverables } from './builder/helpers.js'
import { resolveReceiptSigningKey, signReceipt } from './receipt-signing.js'
import {
    CapabilityRegistry,
    type CapabilityAuditReport,
} from './capabilities/registry.js'
import {
    startGateway,
    queryGatewayStatus,
} from './agent/gateway-runner.js'
import type { ExecutionContext } from './types.js'
import type { RuntimeErrors } from './errors.js'
import { unwrapError, toRunBoundaryError, KillSwitchTriggeredError } from './errors.js'
import type { ToolDefinition } from '@reactive-agents/tools'
import type { Task, TaskResult } from '@reactive-agents/core'
import type { TaskError } from '@reactive-agents/core'
import { generateTaskId, AgentId, TaskId, ResumeStateRef, ModelOverrideRef, ApprovalDecisionRef, InteractionResponseRef, RunControllerRef, computeTrustReceipt, deriveInterventionsFromSteps, type TrustReceipt } from '@reactive-agents/core'
import { join } from 'node:path'
import {
    loadResumePayload,
    loadForkPayload,
    listDurableRuns,
    markRunStatus,
    decideApprovalRecord,
    getPendingApprovalAt,
    createDurableRun,
    persistApprovalPauseAt,
    persistInteractionPauseAt,
    decideInteractionRecord,
    getPendingInteractionAt,
} from './engine/durable-resume.js'
import type { RunRecord, RunStatus } from './services/run-store.js'
import type {
    AgentEvent,
    OutputFormat,
    TerminatedBy,
    RunControllerLike,
} from '@reactive-agents/core'
import { EventBus } from '@reactive-agents/core'
import { KillSwitchService } from '@reactive-agents/guardrails'
import type { AgentStreamEvent, StreamDensity } from './stream-types.js'
import { RunController, installDurableCheckpointing } from './run-controller.js'
import { RunStoreLive } from './services/run-store.js'
import { applyHistoryWindow, formatHistoryBlock } from './gateway-context-formatting.js'

/**
 * Fold prior conversation turns into the task as a labeled reference block —
 * the same presentation the gateway uses (gateway-context-formatting.ts). This
 * keeps the kernel's native-FC tool thread clean: seeding plain-text prior
 * "assistant" final-answers directly into `state.messages` made the model treat
 * them as its own tool-orchestration turns and re-run tools / conflate context.
 * History as labeled text in the task avoids that while staying history-aware.
 */
export const withHistoryBlock = (input: string, history?: readonly ChatMessage[]): string => {
    if (!history || history.length === 0) return input
    const block = formatHistoryBlock(applyHistoryWindow(history))
    if (!block) return input
    return `${block}\n\n--- Current message ---\n${input}`
}
// The abstention projection moved to `engine/abstention-projection.ts` so the
// STREAMING path can share it. It used to live only here, which is why
// `StreamCompleted.abstention` was declared and never written.
import { projectAbstention } from "./engine/abstention-projection.js"
export { projectAbstention }

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
import { streamObjectFrom } from './engine/stream-object.js'
import type { DeepPartial } from './builder/types.js'
import type { ChannelsConfig } from "@reactive-agents/channels";
import type {
    GatewayHandle,
    AgentResultMetadata,
    AgentResult,
    OutputSchemaOptions,
} from './builder/types.js'
import type { SchemaContract } from '@reactive-agents/reasoning'
import { groundedExtract, buildEvidenceCorpusFromSteps, parsePartial, stripThinking, groundFields } from '@reactive-agents/reasoning'
import type { ReasoningStep } from '@reactive-agents/reasoning'
import { LLMService } from '@reactive-agents/llm-provider'
import { extractObjectFromAnswer } from './engine/finalize/extract-object.js'
import { chooseStructuredEngine } from './engine/finalize/structured-route.js'
import { StructuredOutputError } from './errors/structured-output-error.js'

/**
 * Narrow widening for the dynamically-imported `ToolService` tag.
 *
 * `@reactive-agents/tools` is loaded via `Effect.promise(() => import(...))`
 * to avoid a static dependency edge into the tools layer at module-eval time.
 * The dynamic import returns the tag as `unknown`-shaped at the runtime layer
 * boundary; this helper concentrates the widening cast in one place so the
 * three call sites (`dispose`, `registerTool`, `unregisterTool`) share a
 * single reviewable widening surface.
 *
 * See `packages/runtime/test/as-unknown-as-ceiling.test.ts` for the §5.5
 * anti-regression ceiling that feeds off this consolidation.
 */
type ToolServiceTag = import('effect').Context.Tag<any, any>
const asToolServiceTag = (tag: unknown): ToolServiceTag =>
    tag as unknown as ToolServiceTag

/** Parse stored approval args JSON, falling back to the raw string on malformed input. */
const safeParseJson = (s: string): unknown => {
    try {
        return JSON.parse(s)
    } catch {
        return s
    }
}

// ── Class ──
export class ReactiveAgent<TOut = unknown> {
    constructor(
        public readonly engine: {
            execute: (
                task: Task
            ) => Effect.Effect<TaskResult, RuntimeErrors | TaskError>
            executeStream: (
                task: Task,
                options?: { density?: StreamDensity; runController?: RunControllerLike }
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
        public readonly runtime: ManagedRuntime.ManagedRuntime<any, never>,
        /** Names of connected MCP servers — needed for cleanup on dispose(). */
        private readonly _mcpServerNames: readonly string[] = [],
        /** @internal Whether gateway was configured via .withGateway(). */
        public readonly _gatewayEnabled: boolean = false,
        /** @internal Gateway heartbeat interval (ms). Defaults to 60000. */
        public readonly _gatewayIntervalMs: number = 60_000,
        /** @internal Whether a custom heartbeat instruction was configured. */
        public readonly _hasCustomHeartbeatInstruction: boolean = false,
        /** @internal When true, gateway runs share the stable agent id for memory continuity. */
        public readonly _gatewayPersistMemory: boolean = false,
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
        public readonly _sessionPersist: boolean = false,
        /** @internal Max age of sessions in days at build time. */
        private readonly _sessionMaxAgeDays?: number,
        /** @internal Reference to the shared RAG memory store for runtime ingestion via ingest(). */
        private readonly _ragStore?: import('@reactive-agents/tools').RagMemoryStore,
        /** @internal Optional external channels (webhooks, bots) from `.withChannels()`. */
        public readonly _channelsConfig?: ChannelsConfig,
        /** @internal Harness improvement config fields exposed for testing. */
        private readonly _config?: {
            minIterations?: number
            taskContext?: Record<string, string>
            progressCheckpoint?: { every: number; autoResume?: boolean }
            verificationStep?: { mode: 'reflect'; prompt?: string }
            outputValidator?: (output: string) => {
                valid: boolean
                feedback?: string
            }
            outputValidatorOptions?: { maxRetries?: number }
            customTermination?: (state: { output: string }) => boolean
            modelRouting?: { tierModels?: Partial<Record<'haiku' | 'sonnet' | 'opus', string>>; minTier?: 'haiku' | 'sonnet' | 'opus' }
        },
        /** @internal Durable resume context from `.withDurableRuns()` — checkpoint dir + identity configHash. */
        private readonly _durableResume?: { readonly dir: string; readonly configHash: string },
        /** @internal Opt-in typed structured output config from `.withOutputSchema()`. Absent = off. */
        private readonly _outputSchemaConfig?: {
            readonly contract: SchemaContract<unknown>
            readonly options: OutputSchemaOptions
        },
        /**
         * @internal Whether `.withTools()` (or `.withDocuments()`) was called during build.
         * Forwarded from `AgentInstantiationDeps.enableTools`. Used by the structured-output
         * router (Task 1.5) to prefer the grounded path when tools are present.
         */
        private readonly _enableTools: boolean = false,
        /** @internal Runtime configuration snapshot (tests + diagnostics). Not part of the public API. */
        private readonly config: Record<string, unknown> = {}
    ) {}

    /**
     * Build the "respond ONLY with JSON matching this schema" suffix from the
     * schema contract. Returns `""` when the contract has no JSON schema.
     *
     * Used by both `streamObject` (to steer streaming) and `buildRunTaskEffect`
     * (to steer the run() task so the agent emits JSON that parse-first can read).
     */
    private buildSchemaSteering(contract: SchemaContract<unknown>): string {
        const jsonSchema = contract.toJsonSchema()
        const jsonSchemaString = jsonSchema !== undefined
            ? JSON.stringify(jsonSchema, null, 2)
            : undefined
        const schemaBlock = jsonSchemaString !== undefined
            ? `\n\n${jsonSchemaString}`
            : ""
        // Shape-aware: a top-level array schema must be steered to emit a JSON array,
        // not an object — otherwise the model wraps it (e.g. {items:[...]}) and
        // validation/parse-first fails.
        const isArray = (jsonSchema as { type?: unknown } | undefined)?.type === "array"
        return isArray
            ? (
                `\n\nRespond with ONLY a JSON array that exactly matches this JSON Schema` +
                ` — no prose, no markdown fences, no explanation, no wrapping object:${schemaBlock}`
            )
            : (
                `\n\nRespond with ONLY a single JSON object that exactly matches this JSON Schema` +
                ` — no prose, no markdown fences, no explanation.` +
                ` Use exactly these top-level keys; do not nest or wrap:${schemaBlock}`
            )
    }

    /**
     * Loosely parse the first complete JSON value (object `{…}` or array `[…]`)
     * from `text` after stripping thinking tags, markdown fences, and leading prose.
     *
     * Returns the parsed value (object or array) on success, or `null` if no
     * top-level JSON structure can be found or parsed.
     */
    private static parseJsonLoose(text: string): unknown {
        const cleaned = stripThinking(text).trim()
        // Strip markdown code fences: ```json … ``` or ``` … ```
        const defenced = cleaned
            .replace(/^```(?:json)?\s*\n?/i, "")
            .replace(/\n?```\s*$/, "")
            .trim()

        // Try to find first `{` (object) or `[` (array) and parse from there.
        const braceIdx = defenced.indexOf("{")
        const bracketIdx = defenced.indexOf("[")
        // Pick the earlier of the two (or whichever is present)
        let startIdx: number
        if (braceIdx === -1 && bracketIdx === -1) return null
        if (braceIdx === -1) startIdx = bracketIdx
        else if (bracketIdx === -1) startIdx = braceIdx
        else startIdx = Math.min(braceIdx, bracketIdx)

        const candidate = defenced.slice(startIdx)
        try {
            return JSON.parse(candidate)
        } catch {
            // Try parsePartial for objects — handles truncated/fenced input
            if (candidate.startsWith("{")) {
                const partial = parsePartial(candidate)
                // parsePartial returns {} on failure; treat empty as failure
                if (Object.keys(partial).length > 0) return partial
            }
            return null
        }
    }

    /**
     * MOVE-2 M2.1 — read the agent's active capability registry.
     *
     * Returns a structured `CapabilityAuditReport` covering every registered
     * capability: which default-on, cost signature, lift evidence pointer,
     * owner warden, last ablation date, plus flagged stale + gate-violating
     * entries. Single user-facing answer to "what's running and why" —
     * addresses master plan §3 root cause #3 ("Users can't enumerate what's
     * on by default and why") in one method call. Vision pillar 1 — control
     * over magic.
     *
     * @example
     * ```typescript
     * const report = await agent.capabilities.audit();
     * console.log(`${report.defaultOnCount} capabilities active by default`);
     * for (const violation of report.violations) {
     *   console.warn(`  ${violation.name}: defaultOn but no lift evidence`);
     * }
     * ```
     */
    readonly capabilities = {
        audit: (): Promise<CapabilityAuditReport> =>
            this.runtime.runPromise(
                Effect.gen(function* () {
                    const reg = yield* CapabilityRegistry
                    return yield* reg.audit()
                }),
            ),
    }

    /** @internal Last debrief from a completed run — used as context in chat() calls. */
    private _lastDebrief?: AgentDebrief
    /**
     * @internal In-flight forked debrief fibers (one per run that produced a
     * debrief). The rich LLM debrief synthesizes off the critical path; dispose()
     * joins these so a short-lived `run(); dispose()` never drops the persist.
     */
    private _pendingDebriefs = new Set<
        Fiber.RuntimeFiber<{ debrief?: AgentDebrief; tokensUsed: number }, never>
    >()
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
        // Join any in-flight forked debrief fibers BEFORE tearing down the
        // runtime — disposing the ManagedRuntime interrupts daemon fibers, which
        // would drop the debrief persist on a short-lived `run(); dispose()`.
        if (this._pendingDebriefs.size > 0) {
            const fibers = [...this._pendingDebriefs]
            this._pendingDebriefs.clear()
            await Promise.allSettled(
                fibers.map((f) => this.runtime.runPromise(Fiber.join(f))),
            )
        }
        const serverNames = this._mcpServerNames
        if (serverNames.length > 0) {
            await this.runtime.runPromise(
                Effect.gen(function* () {
                    const toolsMod = yield* Effect.promise(
                        () => import('@reactive-agents/tools')
                    )
                    const ts = yield* asToolServiceTag(toolsMod.ToolService)
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
                const ts = yield* asToolServiceTag(toolsMod.ToolService)
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
                const ts = yield* asToolServiceTag(toolsMod.ToolService)
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
        options?: {
            readonly taskId?: string
            readonly history?: readonly ChatMessage[]
            /**
             * Durable HITL (Phase D) convenience: when a gated tool call pauses the
             * run, this callback is invoked with the pending action. Return `true`
             * to approve (the agent executes the call and continues), `false` to
             * deny, or `{ approve, reason }`. `run()` handles the pause→decide→resume
             * loop and returns the FINAL result — you never touch the runId. Requires
             * `.withDurableRuns()` + `.withApprovalPolicy({ mode: "detach" })`. Without
             * this callback, a paused run returns `status: "awaiting-approval"` +
             * `pendingApproval` for you to handle (e.g. cross-process).
             */
            readonly onApproval?: (pending: {
                readonly runId: string
                readonly gateId: string
                readonly toolName: string
                readonly args: unknown
            }) => boolean | { approve: boolean; reason?: string } | Promise<boolean | { approve: boolean; reason?: string }>
        }
    ): Promise<AgentResult & { object?: TOut }> {
        // Run the task on ManagedRuntime only — do not wrap in Effect.runPromise(Effect.promise(...)),
        // which nests the default runtime with ManagedRuntime and can yield pure interruption
        // ("All fibers interrupted without errors") on first execution (e.g. with Cortex + reasoning).
        const taskInput = withHistoryBlock(input, options?.history)
        const taskIdOpt = options?.taskId ? { taskId: options.taskId } : undefined

        // Killswitch AbortSignal for the run fiber: threading it into runPromise
        // lets terminate() interrupt the fiber (and thus any in-flight provider
        // HTTP request that forwards the signal, e.g. Ollama) rather than only
        // halting at the next phase boundary. undefined without .withKillSwitch()
        // (the service is Layer.empty, so acquisition swallows to undefined).
        const runSignal = await this.acquireRunSignal()

        const execute = async (): Promise<AgentResult> => {
            // Durable agents create a run row + checkpoint so a pause survives the
            // process; non-durable agents take the plain path.
            let result: AgentResult = this._durableResume
                ? await this.runDurable({
                      input: taskInput,
                      runId: crypto.randomUUID(),
                      task: taskInput,
                      ...(options?.taskId ? { taskId: options.taskId } : {}),
                  })
                : await this.runtime.runPromise(
                      this.buildRunTaskEffect(taskInput, taskIdOpt),
                      runSignal ? { signal: runSignal } : undefined,
                  )

            // Tier 2 — same-process convenience: drive pause→decide→resume in one
            // call. Loops so multi-gate runs (a resume that pauses again) are handled.
            const onApproval = options?.onApproval
            while (onApproval && result.status === 'awaiting-approval' && result.pendingApproval) {
                const decision = await onApproval(result.pendingApproval)
                const approve = typeof decision === 'boolean' ? decision : decision.approve
                const reason = typeof decision === 'object' ? decision.reason : undefined
                result = approve
                    ? await this.approveRun(result.pendingApproval.runId)
                    : await this.denyRun(result.pendingApproval.runId, reason ?? 'denied by onApproval')
            }
            return result
        }

        return execute().catch(async (e) => {
            // terminate() aborted the fiber mid-flight: the engine's phase-boundary
            // lifecycle check never ran, so emit AgentTerminated here (parity with
            // the phase-boundary terminate branch) and surface a clean terminal
            // error rather than the raw interruption.
            if (runSignal?.aborted) {
                const tid = taskIdOpt?.taskId ?? 'unknown'
                await this.emitAgentTerminated(tid, 'terminate() called')
                throw toRunBoundaryError(
                    new KillSwitchTriggeredError({
                        message: `Agent ${this.agentId} terminated`,
                        taskId: tid,
                        agentId: this.agentId,
                        reason: 'terminate() called',
                    }),
                )
            }
            const unwrapped = unwrapError(e)
            if (this._errorHandler) {
                try {
                    // The error handler receives the full unwrapped error for
                    // programmatic inspection; only the console-facing throw is
                    // slimmed to one line (stack behind RA_DEBUG_ERRORS).
                    this._errorHandler(unwrapped as RuntimeErrors | Error, {
                        taskId: 'unknown',
                        phase: 'execution',
                        iteration: 0,
                    })
                } catch {
                    // Handler exceptions are silently ignored — never replace the original error
                }
            }
            throw toRunBoundaryError(unwrapped)
        }) as Promise<AgentResult & { object?: TOut }>
    }

    /**
     * Resolve this agent's run-fiber AbortSignal from the KillSwitchService.
     * Returns undefined when the service is absent (never built into the layer).
     * The signal is stable per agentId, so terminate() — which aborts the same
     * controller — interrupts whatever fiber is currently running it.
     */
    private async acquireRunSignal(): Promise<AbortSignal | undefined> {
        // serviceOption (NOT bare `KillSwitchService.pipe`): a missing service is
        // an Effect DEFECT that catchAll does not catch, and this runs on EVERY
        // run — without .withKillSwitch() the layer is empty, so we must degrade
        // to undefined rather than die.
        return this.runtime.runPromise(
            Effect.serviceOption(KillSwitchService).pipe(
                Effect.flatMap((opt) =>
                    opt._tag === 'Some'
                        ? opt.value.signal(this.agentId)
                        : Effect.succeed(undefined),
                ),
                Effect.catchAll(() => Effect.succeed(undefined)),
            ) as Effect.Effect<AbortSignal | undefined>,
        )
    }

    /**
     * Publish AgentTerminated for a mid-flight abort. The engine only emits this
     * at a phase boundary; when terminate() interrupts an in-flight LLM call the
     * boundary check never runs, so run() emits it here to keep event parity.
     */
    private async emitAgentTerminated(taskId: string, reason: string): Promise<void> {
        await this.runtime.runPromise(
            EventBus.pipe(
                Effect.flatMap((eb) =>
                    eb.publish({
                        _tag: 'AgentTerminated' as const,
                        agentId: this.agentId,
                        taskId,
                        reason,
                    } as AgentEvent),
                ),
                Effect.catchAll(() => Effect.void),
            ) as Effect.Effect<void>,
        )
    }

    /**
     * Resume a crashed or paused durable run from its last checkpoint (Phase C).
     *
     * Loads the highest-iteration checkpoint persisted by `.withDurableRuns()`,
     * validates that this agent's config still matches the one the run was
     * captured under (config-hash guard), seeds the restored `KernelState` via
     * `ResumeStateRef`, and continues the run to completion. Completed tools are
     * NOT re-executed — their results live in the restored steps/messages.
     *
     * @param runId - The run id reported when the original run was created.
     * @throws Error if the agent was not built with `.withDurableRuns()`.
     * @throws DurableRunNotFoundError if the run / checkpoint is unknown.
     * @throws DurableConfigMismatchError if the agent config changed since capture.
     *
     * Note: resumed results return the base `AgentResult`; typed structured `object` carry is not threaded through resume yet.
     *
     * Named `resumeRun` (not `resume`) to avoid colliding with the in-process
     * pause/resume control verb `resume()`.
     */
    async resumeRun(runId: string): Promise<AgentResult> {
        if (!this._durableResume) {
            throw new Error(
                'resumeRun() requires .withDurableRuns() — this agent has no durable run store.',
            )
        }
        const { dir, configHash } = this._durableResume
        const dbPath = join(dir, 'runs.db')

        // 1. Load + guard the checkpoint on the default runtime (RunStore is
        //    self-contained; no agent services required).
        const payload = await Effect.runPromise(
            loadResumePayload({ runId, dbPath, currentConfigHash: configHash }),
        )

        // 2. Re-run to completion with the restored state seeded via FiberRef.
        //    reasoning-think reads ResumeStateRef, deserializes, and forwards it
        //    as KernelInput.resumeState so the runner continues mid-stream.
        const pipeline = this.buildRunTaskEffect(payload.run.task, { taskId: runId })
        try {
            const result = await this.runtime.runPromise(
                Effect.locally(pipeline, ResumeStateRef, payload.stateJson),
            )
            await Effect.runPromise(
                markRunStatus({ dbPath, runId, status: 'completed' }),
            )
            return result
        } catch (e) {
            await Effect.runPromise(
                markRunStatus({ dbPath, runId, status: 'failed' }),
            )
            throw unwrapError(e)
        }
    }

    /**
     * Fork a NEW run from any checkpoint of a prior run (Arc 1 Task 6) —
     * a counterfactual restart, NEVER "time travel". Every LLM call made
     * after the fork point is a live, fresh call against the current
     * provider; nothing is replayed.
     *
     * Loads the checkpoint at-or-below `opts.at` (defaults to the source
     * run's latest checkpoint, like `resumeRun`) from `runId`'s history via
     * `loadForkPayload` — deliberately WITHOUT `resumeRun`'s config-hash
     * guard, since forking under a different config (or a different
     * `opts.model`) is the whole point, not an error. Creates a BRAND NEW
     * run row (`${runId}-fork-<8 hex chars>`) stamped with THIS agent's
     * current config hash and `{ forkedFrom, forkedAtIteration }` provenance,
     * seeds the restored `KernelState`, and runs to completion — mirroring
     * `runDurable`'s create-row + checkpoint + resume-seed pipeline used by
     * `run()`/`approveRun`/`denyRun`.
     *
     * v1 scope: same agent instance/tools/system prompt as the source run.
     * `opts.task` overrides the re-run input (defaults to the source run's
     * original task — reusing it verbatim only makes sense against a fresh
     * test scenario/replay; real providers regenerate live). `opts.model`
     * overrides the model for this run only (see `ModelOverrideRef`); it has
     * no effect when `.withModelRouting()` is also enabled, since that phase
     * recomputes the selected model independently (known v1 gap).
     *
     * Caveat inherited from Task 4: a run that is currently paused
     * (`awaiting-approval` / `awaiting-interaction`) does not flush its
     * in-flight checkpoint write, so forking it may see a stale or absent
     * checkpoint row.
     *
     * @param runId - The SOURCE run id to fork from.
     * @throws Error if the agent was not built with `.withDurableRuns()`.
     * @throws DurableRunNotFoundError if the source run / a qualifying checkpoint is unknown.
     */
    async fork(
        runId: string,
        opts?: { at?: number; model?: string; task?: string },
    ): Promise<AgentResult> {
        if (!this._durableResume) {
            throw new Error(
                'fork() requires .withDurableRuns() — this agent has no durable run store.',
            )
        }
        const { dir } = this._durableResume
        const dbPath = join(dir, 'runs.db')

        // 1. Load the source checkpoint — any iteration, no config-hash guard.
        const payload = await Effect.runPromise(
            loadForkPayload({ runId, dbPath, at: opts?.at }),
        )

        // 2. Fresh identity for the forked run — distinct from the source by
        //    construction, and 8 hex chars (32 bits) of suffix entropy make
        //    two forks of the SAME source colliding with each other
        //    astronomically unlikely (4 hex chars/16 bits was too narrow:
        //    `INSERT OR REPLACE` on a collision would clobber the earlier
        //    fork's run row while its `run_checkpoints` rows stayed behind
        //    under the reused runId — a stale-state rehydration hazard).
        const forkedRunId = `${runId}-fork-${crypto.randomUUID().slice(0, 8)}`
        const task = opts?.task ?? payload.run.task

        // 3. Create the new row (this agent's CURRENT configHash) + seed the
        //    restored state + run to completion, same rail as run()/approveRun.
        return this.runDurable({
            input: task,
            taskId: forkedRunId,
            runId: forkedRunId,
            task,
            resume: { stateJson: payload.stateJson },
            ...(opts?.model !== undefined ? { modelOverride: opts.model } : {}),
            forkedFrom: runId,
            forkedAtIteration: payload.iteration,
        })
    }

    /**
     * List persisted durable runs (newest-updated first), optionally filtered by
     * lifecycle status. Requires `.withDurableRuns()`.
     */
    async listRuns(filter?: { status?: RunStatus; userId?: string }): Promise<readonly RunRecord[]> {
        if (!this._durableResume) {
            throw new Error(
                'listRuns() requires .withDurableRuns() — this agent has no durable run store.',
            )
        }
        const dbPath = join(this._durableResume.dir, 'runs.db')
        return Effect.runPromise(
            listDurableRuns({ dbPath, status: filter?.status, userId: filter?.userId }),
        )
    }

    /**
     * Durable HITL (Phase D): approve a run that paused for human approval and
     * resume it to completion. Callable from ANY process (the decision + the
     * paused checkpoint live in the durable RunStore). Requires `.withDurableRuns()`.
     *
     * @throws Error if the agent was not built with `.withDurableRuns()`.
     * @throws ApprovalStateError if the run has no pending approval.
     */
    async approveRun(runId: string, opts?: { reason?: string }): Promise<AgentResult> {
        return this.decideAndResumeRun(runId, { status: 'approved', reason: opts?.reason })
    }

    /**
     * Durable HITL (Phase D): deny a run's paused action and resume it to
     * completion (the agent observes the denial and continues). Requires
     * `.withDurableRuns()`.
     *
     * @throws Error if the agent was not built with `.withDurableRuns()`.
     * @throws ApprovalStateError if the run has no pending approval.
     */
    async denyRun(runId: string, reason: string): Promise<AgentResult> {
        return this.decideAndResumeRun(runId, { status: 'denied', reason })
    }

    /** Record an approve/deny decision then resume the run from its checkpoint. */
    private async decideAndResumeRun(
        runId: string,
        decision: { status: 'approved' | 'denied'; reason?: string },
    ): Promise<AgentResult> {
        if (!this._durableResume) {
            throw new Error(
                'approveRun()/denyRun() requires .withDurableRuns() — this agent has no durable run store.',
            )
        }
        const { dir, configHash } = this._durableResume
        const dbPath = join(dir, 'runs.db')

        // 1. Record the human decision (fails ApprovalStateError if not pending).
        const { gateId } = await Effect.runPromise(
            decideApprovalRecord({ dbPath, runId, status: decision.status, reason: decision.reason }),
        )

        // 2. Load + guard the paused checkpoint.
        const payload = await Effect.runPromise(
            loadResumePayload({ runId, dbPath, currentConfigHash: configHash }),
        )

        // 3. Resume through the durable wrapper (same as run()), seeding the restored
        //    state + the decision. Using runDurable means a re-pause on resume is
        //    persisted + surfaced (multi-gate), and completion flips to `completed`.
        return this.runDurable({
            input: payload.run.task,
            taskId: runId,
            runId,
            task: payload.run.task,
            resume: {
                stateJson: payload.stateJson,
                decision: {
                    gateId,
                    status: decision.status,
                    ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
                },
            },
        })
    }

    /**
     * Durable HITL (Phase D): list runs paused awaiting a human decision, with the
     * pending action (tool + args) for each. Requires `.withDurableRuns()`.
     */
    async listPendingApprovals(): Promise<
        readonly {
            runId: string
            gateId: string
            toolName: string
            args: unknown
            task: string
            updatedAt: number
        }[]
    > {
        if (!this._durableResume) {
            throw new Error('listPendingApprovals() requires .withDurableRuns().')
        }
        const dbPath = join(this._durableResume.dir, 'runs.db')
        const runs = await Effect.runPromise(
            listDurableRuns({ dbPath, status: 'awaiting-approval' }),
        )
        const out: {
            runId: string
            gateId: string
            toolName: string
            args: unknown
            task: string
            updatedAt: number
        }[] = []
        for (const run of runs) {
            const pending = await Effect.runPromise(
                getPendingApprovalAt({ dbPath, runId: run.runId }),
            )
            if (pending) {
                out.push({
                    runId: run.runId,
                    gateId: pending.gateId,
                    toolName: pending.toolName,
                    args: safeParseJson(pending.argsJson),
                    task: run.task,
                    updatedAt: run.updatedAt,
                })
            }
        }
        return out
    }

    /**
     * Agentic-UI interaction rail (Task 10): the durable store location + agent id
     * for this agent when built with `.withDurableRuns()`, else `undefined`.
     * Lets server adapters (Task 12) resolve the db path without reaching into
     * builder internals. Matches how `runDurable`/`listRuns` compute the db path.
     */
    getDurableInfo(): { dbPath: string; agentId: string } | undefined {
        if (!this._durableResume) return undefined
        return {
            dbPath: join(this._durableResume.dir, 'runs.db'),
            agentId: this.agentId,
        }
    }

    /**
     * Agentic-UI interaction rail (Task 10): list runs paused awaiting a human
     * response to a `request_user_input`, with the pending interaction (kind +
     * prompt + parsed schema) for each. Requires `.withDurableRuns()`. Clone of
     * `listPendingApprovals`.
     */
    async listPendingInteractions(): Promise<
        readonly {
            runId: string
            interactionId: string
            kind: string
            prompt: string
            schema: unknown
            task: string
            updatedAt: number
        }[]
    > {
        if (!this._durableResume) {
            throw new Error('listPendingInteractions() requires .withDurableRuns().')
        }
        const dbPath = join(this._durableResume.dir, 'runs.db')
        const runs = await Effect.runPromise(
            listDurableRuns({ dbPath, status: 'awaiting-interaction' }),
        )
        const out: {
            runId: string
            interactionId: string
            kind: string
            prompt: string
            schema: unknown
            task: string
            updatedAt: number
        }[] = []
        for (const run of runs) {
            const pending = await Effect.runPromise(
                getPendingInteractionAt({ dbPath, runId: run.runId }),
            )
            if (pending) {
                out.push({
                    runId: run.runId,
                    interactionId: pending.interactionId,
                    kind: pending.kind,
                    prompt: pending.prompt,
                    schema: safeParseJson(pending.schemaJson),
                    task: run.task,
                    updatedAt: run.updatedAt,
                })
            }
        }
        return out
    }

    /**
     * Agentic-UI interaction rail (Task 10): record a human's response to a run
     * that paused for `request_user_input` and resume it to completion. Callable
     * from ANY process (the response + the paused checkpoint live in the durable
     * RunStore). Requires `.withDurableRuns()`. Clone of `decideAndResumeRun`.
     *
     * @throws Error if the agent was not built with `.withDurableRuns()`.
     * @throws InteractionStateError if the run has no pending interaction.
     */
    async respondToInteraction(
        runId: string,
        interactionId: string,
        value: unknown,
    ): Promise<AgentResult> {
        if (!this._durableResume) {
            throw new Error(
                'respondToInteraction() requires .withDurableRuns() — this agent has no durable run store.',
            )
        }
        const { dir, configHash } = this._durableResume
        const dbPath = join(dir, 'runs.db')

        // 1. Record the human response (fails InteractionStateError if not pending).
        await Effect.runPromise(
            decideInteractionRecord({
                dbPath,
                runId,
                interactionId,
                valueJson: JSON.stringify(value),
            }),
        )

        // 2. Load + guard the paused checkpoint.
        const payload = await Effect.runPromise(
            loadResumePayload({ runId, dbPath, currentConfigHash: configHash }),
        )

        // 3. Resume through the durable wrapper (same as approve/deny), seeding the
        //    restored state + the interaction response. The runner injects the
        //    value as the pending interaction's result and re-thinks to completion.
        return this.runDurable({
            input: payload.run.task,
            taskId: runId,
            runId,
            task: payload.run.task,
            resume: {
                stateJson: payload.stateJson,
                interaction: { interactionId, valueJson: JSON.stringify(value) },
            },
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
     * Durable HITL (Phase D) — run a task on the NON-streaming path with full
     * durable wiring: create the run row, install per-iteration + paused-state
     * checkpointing, run to completion or to an approval pause. On pause the run
     * is persisted (`awaiting-approval` + a pending row) and the AgentResult
     * carries `status` + `pendingApproval` (with the durable runId). On normal
     * completion the run is flipped to `completed`. Shared by `run()` (fresh
     * runId) and `approveRun`/`denyRun` (existing runId + resume locals), so a
     * re-pause on resume persists too.
     */
    private async runDurable(params: {
        readonly input: string
        readonly taskId?: string
        readonly runId: string
        readonly task: string
        readonly resume?: {
            readonly stateJson: string
            readonly decision?: { gateId: string; status: 'approved' | 'denied'; reason?: string }
            readonly interaction?: { interactionId: string; valueJson: string }
        }
        /** Per-run model override (Arc 1 Task 6) — seeded via `ModelOverrideRef`. */
        readonly modelOverride?: string
        /** Fork lineage (Arc 1 Task 6) — stamped onto the created run row. */
        readonly forkedFrom?: string
        readonly forkedAtIteration?: number
    }): Promise<AgentResult> {
        const { dir, configHash } = this._durableResume!
        const dbPath = join(dir, 'runs.db')
        const { mkdirSync } = await import('node:fs')
        mkdirSync(dir, { recursive: true })
        const runStoreLayer = RunStoreLive(dbPath)

        // 1. Create (or replace) the run row.
        await Effect.runPromise(
            createDurableRun({
                dbPath,
                runId: params.runId,
                agentId: this.agentId,
                task: params.task,
                configHash,
                ...(params.forkedFrom !== undefined ? { forkedFrom: params.forkedFrom } : {}),
                ...(params.forkedAtIteration !== undefined ? { forkedAtIteration: params.forkedAtIteration } : {}),
            }),
        )

        // 2. RunController + durable checkpointing (the kernel captures the paused
        //    state at iteration+1 so resume restores `awaitingApprovalFor`).
        const controller = new RunController(new AbortController())
        const { finish } = installDurableCheckpointing(controller, {
            runId: params.runId,
            runStoreLayer,
            checkpointEvery: 1,
        })

        // 3. Run the pipeline with RunControllerRef set (+ resume locals when resuming).
        let pipeline = this.buildRunTaskEffect(params.input, {
            ...(params.taskId !== undefined ? { taskId: params.taskId } : {}),
            durableRunId: params.runId,
            ...(params.forkedFrom !== undefined ? { forkedFrom: params.forkedFrom } : {}),
        }).pipe(Effect.locally(RunControllerRef, controller))
        if (params.modelOverride !== undefined) {
            pipeline = pipeline.pipe(Effect.locally(ModelOverrideRef, params.modelOverride))
        }
        if (params.resume) {
            const resume = params.resume
            pipeline = pipeline.pipe(Effect.locally(ResumeStateRef, resume.stateJson))
            if (resume.decision) {
                pipeline = pipeline.pipe(Effect.locally(ApprovalDecisionRef, resume.decision))
            }
            if (resume.interaction) {
                pipeline = pipeline.pipe(Effect.locally(InteractionResponseRef, resume.interaction))
            }
        }

        try {
            const result = await this.runtime.runPromise(pipeline)
            if (result.status === 'awaiting-approval' && result.pendingApproval) {
                // Paused — persist (status + pending row). Do NOT finish: the run
                // intentionally stays `awaiting-approval` until approve/deny.
                await Effect.runPromise(
                    persistApprovalPauseAt({
                        dbPath,
                        runId: params.runId,
                        gate: {
                            gateId: result.pendingApproval.gateId,
                            toolName: result.pendingApproval.toolName,
                            args: result.pendingApproval.args,
                        },
                    }),
                )
            } else if (result.status === 'awaiting-interaction' && result.pendingInteraction) {
                // Agentic-UI interaction rail (Task 10): paused for user input —
                // persist (status + pending interaction row). Do NOT finish: the
                // run stays `awaiting-interaction` until respondToInteraction.
                await Effect.runPromise(
                    persistInteractionPauseAt({
                        dbPath,
                        runId: params.runId,
                        interaction: {
                            interactionId: result.pendingInteraction.interactionId,
                            kind: result.pendingInteraction.kind,
                            prompt: result.pendingInteraction.prompt,
                            schemaJson: JSON.stringify(result.pendingInteraction.schema ?? {}),
                        },
                    }),
                )
            } else {
                await finish(true)
            }
            return result
        } catch (e) {
            await finish(false)
            throw unwrapError(e)
        }
    }

    /**
     * Core task execution Effect (requires services from the agent's ManagedRuntime).
     */
    private buildRunTaskEffect(
        input: string,
        options?: {
            readonly taskId?: string
            readonly durableRunId?: string
            /** Fork lineage (Arc 1 Task 6) — threaded from `runDurable`/`fork()` so the trust receipt (Task 8) can surface it. */
            readonly forkedFrom?: string
        }
    ): Effect.Effect<AgentResult, Error> {
        // Pre-set the task description so sub-agents spawned on the first iteration
        // have access to the full user prompt (including phone numbers, URLs, etc.)
        this._setTaskDescription?.(input.slice(0, 500))

        const taskId = options?.taskId
            ? Schema.decodeSync(TaskId)(options.taskId)
            : generateTaskId()

        // Steer the agent to emit schema-shaped JSON when a schema is configured.
        // This lets parse-first (below) skip the extra LLM extraction call on the
        // happy path — same pattern used by streamObject.
        const steeredInput = this._outputSchemaConfig
            ? `${input}${this.buildSchemaSteering(this._outputSchemaConfig.contract)}`
            : input

        const task: Task = {
            id: taskId,
            agentId: Schema.decodeSync(AgentId)(this.agentId),
            type: 'query' as const,
            input: { question: steeredInput },
            priority: 'medium' as const,
            status: 'pending' as const,
            metadata: { tags: [] },
            createdAt: new Date(),
        }

        return this.engine.execute(task).pipe(
            Effect.flatMap((result: TaskResult) => {
                const r = result as TaskResult & {
                    format?: OutputFormat
                    terminatedBy?: TerminatedBy
                    debrief?: AgentDebrief
                    awaitingApprovalFor?: { gateId: string; toolName: string; args: unknown }
                    awaitingInteractionFor?: { interactionId: string; kind: string; prompt: string; schemaJson: string }
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
                // Rich LLM debrief: the engine forks it off the critical path and
                // attaches the fiber here. debriefRich() awaits it lazily; the
                // fiber is tracked so dispose() joins it (no dropped persist).
                const debriefFiber = (r as { _debriefFiber?: Fiber.RuntimeFiber<{ debrief?: AgentDebrief; tokensUsed: number }, never> })._debriefFiber
                // Trust receipt (Arc 1 Task 8) — graded evidence about HOW the
                // answer was produced, computed from in-memory run data (works
                // without tracing). See @reactive-agents/core's TrustReceipt
                // JSDoc: NOT a truth certificate.
                // Receipts belong to TERMINAL results only: a run paused for
                // approval/interaction is unfinished — grading it now would
                // stamp a misleading verdict, and the resumed run produces its
                // own receipt on completion. Mirrors the TrustEvent pause
                // suppression in engine/execute-stream.ts.
                const isPausedRun =
                    r.awaitingApprovalFor !== undefined ||
                    r.awaitingInteractionFor !== undefined
                // B2 (meta-loop 4a): declared deliverables × produced-status,
                // computed from the run's RunContract (recompiled here from the
                // same task inputs) × the reasoning-step artifact scan. A partial
                // multi-file run names its missing files on the receipt.
                const receiptDeliverables = isPausedRun
                    ? undefined
                    : deriveReceiptDeliverables({
                          task: input,
                          ...((this.config['requiredTools'] as { tools?: readonly string[] } | undefined)?.tools
                              ? { requiredTools: (this.config['requiredTools'] as { tools?: readonly string[] }).tools }
                              : {}),
                          ...(this.config['taskContract'] !== undefined
                              ? { taskContract: this.config['taskContract'] as import('@reactive-agents/core').TaskContract }
                              : {}),
                          reasoningSteps: (rawMetadata as {
                              reasoningSteps?: readonly ReasoningStep[]
                          }).reasoningSteps,
                          output: String(r.output ?? ''),
                      })
                // Deterministic upgrade over the terminatedBy heuristic: the
                // declared-deliverable evidence resolves end_turn's "maybe"
                // (see resolveGoalAchieved's JSDoc, builder/helpers.ts).
                const goalAchieved = resolveGoalAchieved(r.terminatedBy, receiptDeliverables)
                const receipt: TrustReceipt | undefined = isPausedRun
                    ? undefined
                    : computeTrustReceipt({
                          toolCalls: deriveReceiptToolCalls(
                              rawMetadata as {
                                  reasoningSteps?: ReadonlyArray<{ type: string; metadata?: Record<string, unknown> }>
                                  receiptToolCalls?: ReadonlyArray<{ name: string; ok: boolean }>
                              },
                          ),
                          ...(receiptDeliverables !== undefined ? { deliverables: receiptDeliverables } : {}),
                          // Spec §5b — harness interventions recorded on the
                          // reasoning steps become a receipt surface.
                          ...((): { interventions?: readonly import('@reactive-agents/core').InterventionReceipt[] } => {
                              const iv = deriveInterventionsFromSteps(
                                  (rawMetadata as { reasoningSteps?: readonly ReasoningStep[] }).reasoningSteps,
                              )
                              return iv.length > 0 ? { interventions: iv } : {}
                          })(),
                          ...(r.terminatedBy !== undefined ? { terminatedBy: r.terminatedBy } : {}),
                          goalAchieved,
                          abstained: r.terminatedBy === 'abstained',
                          success: r.success,
                          // Single shared source with the streaming site — see
                          // deriveReceiptModelId's JSDoc (builder/helpers.ts).
                          modelId: deriveReceiptModelId(this.config.model, this.config.provider),
                          ...(this._durableResume?.configHash !== undefined
                              ? { configHash: this._durableResume.configHash }
                              : {}),
                          ...(options?.forkedFrom !== undefined ? { forkedFrom: options.forkedFrom } : {}),
                          now: Date.now(),
                      })
                const agentResult: AgentResult = {
                    output: String(r.output ?? ''),
                    success: r.success,
                    taskId: String(r.taskId),
                    agentId: String(r.agentId),
                    metadata: enrichedMetadata,
                    ...(receipt !== undefined ? { receipt } : {}),
                    ...(r.format !== undefined ? { format: r.format } : {}),
                    ...(r.terminatedBy !== undefined
                        ? { terminatedBy: r.terminatedBy }
                        : {}),
                    goalAchieved,
                    ...(projectAbstention(r) !== undefined
                        ? { abstention: projectAbstention(r) }
                        : {}),
                    // Durable HITL (Phase D): when the run paused for human approval,
                    // surface status + the pending action (with the durable runId so
                    // callers can approveRun/denyRun it). durableRunId is threaded by
                    // the run()/resume durable wrapper; absent on non-durable runs.
                    ...(r.awaitingApprovalFor !== undefined && options?.durableRunId !== undefined
                        ? {
                              status: 'awaiting-approval' as const,
                              pendingApproval: {
                                  runId: options.durableRunId,
                                  gateId: r.awaitingApprovalFor.gateId,
                                  toolName: r.awaitingApprovalFor.toolName,
                                  args: r.awaitingApprovalFor.args,
                              },
                          }
                        : {}),
                    // Agentic-UI interaction rail (Task 10): when the run paused
                    // for user interaction, surface status + the pending
                    // interaction (with the durable runId so callers can
                    // respondToInteraction it). Mirrors awaitingApprovalFor above.
                    ...(r.awaitingInteractionFor !== undefined && options?.durableRunId !== undefined
                        ? {
                              status: 'awaiting-interaction' as const,
                              pendingInteraction: {
                                  runId: options.durableRunId,
                                  interactionId: r.awaitingInteractionFor.interactionId,
                                  kind: r.awaitingInteractionFor.kind,
                                  prompt: r.awaitingInteractionFor.prompt,
                                  schema: safeParseJson(r.awaitingInteractionFor.schemaJson),
                              },
                          }
                        : {}),
                    ...(r.debrief !== undefined ? { debrief: r.debrief } : {}),
                    ...(debriefFiber
                        ? {
                              debriefRich: () =>
                                  this.runtime
                                      .runPromise(Fiber.join(debriefFiber))
                                      .then((res) => res.debrief ?? r.debrief)
                                      .catch(() => r.debrief),
                          }
                        : {}),
                    ...(r.error !== undefined ? { error: r.error } : {}),
                }
                // Capture debrief for use as context in subsequent chat() calls.
                // result.debrief is the instant deterministic fallback.
                if (agentResult.debrief) this._lastDebrief = agentResult.debrief

                // Track the fiber for dispose(); upgrade _lastDebrief to the rich
                // version once it resolves; deregister when done (fire-and-forget).
                if (debriefFiber) {
                    this._pendingDebriefs.add(debriefFiber)
                    void this.runtime
                        .runPromise(Fiber.join(debriefFiber))
                        .then((res) => {
                            if (res.debrief) this._lastDebrief = res.debrief
                        })
                        .catch(() => {})
                        .finally(() => {
                            this._pendingDebriefs.delete(debriefFiber)
                        })
                }
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

                // ── Structured output extraction (Task 1.4 / 1.5) ───────────
                const outputSchemaConfig = this._outputSchemaConfig
                if (!outputSchemaConfig) {
                    return Effect.succeed(agentResult)
                }
                // Task 1.5 / 2.5: resolve the fast/grounded route before extracting.
                // LLMService is in the ManagedRuntime context (same requirement as
                // extractObjectFromAnswer / groundedExtract), so we can flatMap over it here.
                const self = this
                // Build evidence corpus from reasoning steps — used by the grounded engine.
                // reasoningSteps is already captured above; we cast to ReasoningStep[] for
                // buildEvidenceCorpusFromSteps (only accesses type/content/metadata fields
                // that are present on the inline type captured at line ~793).
                const evidenceCorpus = buildEvidenceCorpusFromSteps(
                    (reasoningSteps ?? []) as readonly ReasoningStep[]
                )
                // ── Parse-first: try to extract the object from the agent's own
                // answer before touching the LLM. The steering injected above
                // (buildSchemaSteering) makes the agent emit schema-shaped JSON
                // directly, so on the happy path this succeeds and we skip the
                // extra extraction LLM call entirely (~28s on local models).
                const parsedLoose = ReactiveAgent.parseJsonLoose(agentResult.output)
                const directValidation = parsedLoose !== null
                    ? outputSchemaConfig.contract.validate(parsedLoose)
                    : null

                const onParseFail = outputSchemaConfig.options.onParseFail ?? 'degrade'

                if (directValidation?.ok === true) {
                    // ── Happy path: agent already emitted valid JSON — zero extra LLM calls.
                    // For grounded mode we still compute provenance/confidence via groundFields
                    // (pure function, no LLM) so callers get the expected grounding fields.
                    // Arrays are skipped for grounding (no top-level Object.entries).
                    const jsonSchema = outputSchemaConfig.contract.toJsonSchema()
                    const isTopLevelObject = !jsonSchema || jsonSchema["type"] === "object"
                    const needsGrounding = (() => {
                        // Determine if grounded mode would have been selected, but we need
                        // to avoid an LLM call just for the engine choice. Use a synchronous
                        // heuristic: mode === "grounded" explicitly always needs grounding;
                        // "auto" and "fast" don't need groundFields on parse-first success.
                        return outputSchemaConfig.options.mode === 'grounded'
                    })()

                    if (needsGrounding && isTopLevelObject && typeof parsedLoose === 'object' && parsedLoose !== null && !Array.isArray(parsedLoose)) {
                        // Pure provenance computation — no LLM call.
                        const grounded = groundFields(
                            parsedLoose as Record<string, unknown>,
                            evidenceCorpus
                        )
                        const result: AgentResult = {
                            ...agentResult,
                            object: directValidation.value,
                            provenance: grounded.provenance,
                            confidence: grounded.confidence,
                        }
                        return Effect.succeed(result)
                    }
                    return Effect.succeed({
                        ...agentResult,
                        object: directValidation.value,
                    } satisfies AgentResult)
                }

                // ── Fallback: parse-first missed — run the LLM extraction pipeline.
                // This preserves all existing behavior for prose answers / model
                // non-compliance, and handles onParseFail:"throw" correctly.
                return LLMService.pipe(
                    Effect.flatMap((llm) => llm.getStructuredOutputCapabilities()),
                    Effect.flatMap((structCaps) => {
                        const engine = chooseStructuredEngine({
                            mode: outputSchemaConfig.options.mode ?? 'auto',
                            nativeJsonMode: structCaps.nativeJsonMode,
                            toolsRegistered: self._enableTools,
                            // TODO(P2): wire real calibration signal from Capability table.
                            // Defaulting to `true` (frontier-ish) is conservative — auto→fast
                            // only when nativeJsonMode AND no tools, which is already safe.
                            calibrated: true,
                        })
                        if (engine === 'grounded') {
                            // ── Task 2.5: grounded engine path ───────────────────────────────
                            // groundedExtract error channel is `never`; all failures degrade to
                            // { objectError }. We translate objectError → thrown error here when
                            // onParseFail === "throw" (callers expect StructuredOutputError).
                            return groundedExtract({
                                contract: outputSchemaConfig.contract,
                                finalAnswer: agentResult.output,
                                evidenceCorpus,
                                onParseFail,
                                abstainBelow: outputSchemaConfig.options.abstainBelow,
                            }).pipe(
                                Effect.flatMap((g) => {
                                    if (g.objectError !== undefined && onParseFail === 'throw') {
                                        return Effect.fail(new StructuredOutputError({
                                            rawText: agentResult.output,
                                            issues: [g.objectError],
                                        }) as unknown as Error)
                                    }
                                    const result: AgentResult = {
                                        ...agentResult,
                                        ...(g.object !== undefined ? { object: g.object } : {}),
                                        ...(g.objectError !== undefined ? { objectError: g.objectError } : {}),
                                        ...(g.provenance !== undefined ? { provenance: g.provenance } : {}),
                                        ...(g.confidence !== undefined ? { confidence: g.confidence } : {}),
                                        ...(g.abstained !== undefined ? { abstained: g.abstained } : {}),
                                    }
                                    return Effect.succeed(result)
                                })
                            )
                        }
                        // ── Fast path (auto → fast) ───────────────────────────────────────
                        return extractObjectFromAnswer({
                            contract: outputSchemaConfig.contract,
                            finalAnswer: agentResult.output,
                            onParseFail,
                            traceContext: { taskId: String(r.taskId) },
                        }).pipe(
                            Effect.map((extracted) => ({
                                ...agentResult,
                                ...(extracted.object !== undefined ? { object: extracted.object } : {}),
                                ...(extracted.objectError !== undefined ? { objectError: extracted.objectError } : {}),
                            } satisfies AgentResult)),
                            // If onParseFail: "throw" let StructuredOutputError propagate as-is.
                            // If "degrade" extractObjectFromAnswer already catches and returns
                            // { objectError } in the success channel — nothing extra needed.
                            Effect.catchTag('StructuredOutputError', (e: StructuredOutputError) =>
                                Effect.fail(e as unknown as Error)
                            ),
                        )
                    }),
                )
            }),
            // Trust receipt signing (Arc 1 Task 9) — optional, additive. Signs
            // the ALREADY-COMPUTED receipt (attached above, whichever branch
            // produced this result) with the configured Ed25519 key, if any.
            // Never fails the run: signing errors degrade to an unsigned
            // receipt rather than surfacing a spurious failure to the caller.
            // See receipt-signing.ts's honest-claims note — the signature
            // certifies provenance/integrity of the receipt, never the
            // correctness of `result.output`.
            Effect.flatMap((result: AgentResult): Effect.Effect<AgentResult, never> => {
                const key = resolveReceiptSigningKey(this.config['receiptSigningKey'])
                const receipt = result.receipt
                if (!key || !receipt) return Effect.succeed(result)
                return Effect.promise(() =>
                    signReceipt(receipt, key)
                        .then((signed) => ({ ...result, receipt: signed }) satisfies AgentResult)
                        .catch(() => result)
                )
            }),
            Effect.mapError(
                (e: RuntimeErrors | TaskError | Error) =>
                    e instanceof Error ? e : new Error('message' in e ? (e as { message: string }).message : String(e))
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
     * inspect()   — live kernel-state introspection (iteration/steps/messages/
     *               pending tool calls/last thought); undefined before the
     *               first iteration boundary.
     *
     * Note: streamed results do not carry the typed structured `object`; use `streamObject()` for streaming structured output.
     */
    runStream(
        input: string,
        options?: {
            density?: StreamDensity
            signal?: AbortSignal
            history?: readonly ChatMessage[]
            /**
             * Agentic-UI kit (Task 13): fired once with the durable runId before
             * the first event is emitted (durable path only). Lets server endpoint
             * helpers open a per-run journal ahead of streaming. No-op otherwise.
             */
            onRunId?: (runId: string) => void
            /**
             * Agentic-UI kit (Task 13): stamps the durable run row's owner so a
             * per-identity inbox can filter to it. Durable path only.
             */
            identity?: { userId: string; orgId?: string }
        }
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
        const taskInput = withHistoryBlock(input, options?.history);
        const gen = this._runStreamImpl(taskInput, { ...options, signal: controller.signal }, controller);
        return Object.assign(gen, {
            pause: () => controller.pause(),
            resume: () => controller.resume(),
            stop: (_opts?: { reason?: string }) => controller.stop(),
            terminate: (_opts?: { reason?: string }) => controller.terminate(),
            status: () => controller.status(),
            inspect: () => controller.inspect(),
        }) as RunHandle;
    }

    private async *_runStreamImpl(
        input: string,
        options: {
            density?: StreamDensity
            signal?: AbortSignal
            history?: readonly ChatMessage[]
            onRunId?: (runId: string) => void
            identity?: { userId: string; orgId?: string }
        },
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
            this.engine.executeStream(task, {
                density,
                runController: controller,
                ...(options?.onRunId !== undefined ? { onRunId: options.onRunId } : {}),
                ...(options?.identity !== undefined ? { identity: options.identity } : {}),
            })
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
     * Execute a task and stream deep-partial objects as tokens arrive, ending
     * with the final validated object.
     *
     * Requires `.withOutputSchema()` to have been called during builder setup.
     * Each yielded `{ object }` is a `DeepPartial<TOut>` built from the JSON
     * accumulated so far; only unique (changed) partials are emitted to avoid
     * noise. The final yield carries the schema-validated full value when parsing
     * succeeds, or the last best-effort partial in `degrade` mode.
     *
     * @param input - The task prompt or question
     * @param options - Optional streaming configuration (density, signal, history)
     * @returns `AsyncGenerator<{ object: DeepPartial<TOut> }>`
     * @throws `Error` when called without `.withOutputSchema()`.
     * @throws `StructuredOutputError` at the end when `onParseFail: "throw"` is set
     *         and the final buffer fails schema validation.
     *
     * @example
     * ```typescript
     * const agent = await ReactiveAgents.create()
     *   .withOutputSchema(Schema.Struct({ city: Schema.String }))
     *   .build();
     *
     * for await (const { object } of agent.streamObject("name a city")) {
     *   console.log(object.city); // "Par", "Paris", "Paris"
     * }
     * ```
     */
    streamObject(
        input: string,
        options?: { density?: StreamDensity; signal?: AbortSignal; history?: readonly ChatMessage[] }
    ): AsyncGenerator<{ object: DeepPartial<TOut> }> {
        if (!this._outputSchemaConfig) {
            throw new Error(
                'streamObject() requires .withOutputSchema() to be configured on this agent. ' +
                'Call .withOutputSchema(schema) before .build().'
            )
        }
        const { contract, options: schemaOptions } = this._outputSchemaConfig
        const onParseFail = schemaOptions.onParseFail ?? "degrade"

        // Steer the agent to emit schema-JSON instead of free-form prose.
        // Without this, the model answers naturally (e.g. "The total is **$4,200**")
        // and parsePartial yields {} because there is no JSON to extract.
        const steeringInstruction = this.buildSchemaSteering(contract)
        const augmentedTask = `${input}${steeringInstruction}`

        const stream = this.runStream(augmentedTask, options)
        return streamObjectFrom(
            stream,
            contract as import('@reactive-agents/reasoning').SchemaContract<TOut>,
            onParseFail
        )
    }

    /**
     * The debrief from this agent's most recent completed run, if any.
     * Populated after each `run()` / `runStream()` and reused as chat context.
     * @returns The last `AgentDebrief`, or `undefined` if no run has completed.
     */
    getLastDebrief(): AgentDebrief | undefined {
        return this._lastDebrief
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
        // Seed the kernel with prior conversation turns (session or agent-level)
        // so tool-capable chat stays history-aware, mirroring the direct path.
        const priorTurns = _history ?? this._chatHistory
        const result = await this.run(
            enrichedMessage,
            priorTurns.length > 0 ? { history: priorTurns } : undefined
        )
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

        const historyLoader = persist
            ? async (): Promise<ChatMessage[]> => {
                  return self.runtime.runPromise(
                      Effect.gen(function* () {
                          const memMod = yield* Effect.promise(
                              () => import('@reactive-agents/memory')
                          )
                          const storeOpt = yield* Effect.serviceOption(
                              memMod.SessionStoreService
                          )
                          if (storeOpt._tag !== 'Some') return [] as ChatMessage[]
                          const record = yield* storeOpt.value.findById(sessionId)
                          return (record?.messages ?? []) as ChatMessage[]
                      }).pipe(Effect.catchAll((_err) => Effect.succeed([] as ChatMessage[])))
                  )
              }
            : undefined

        return new AgentSession(
            (msg, history, opts) => this.chat(msg, opts, history, sessionId),
            undefined,
            onSave,
            undefined,
            historyLoader
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
        return queryGatewayStatus(this)
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
        return startGateway(this)
    }
}
