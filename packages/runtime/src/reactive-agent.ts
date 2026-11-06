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
    Layer,
} from 'effect'
import {
    startGateway,
    queryGatewayStatus,
} from './agent/gateway-runner.js'
import { makeJudgmentFacade } from './agent/judgment-facade.js'
import { makeSkillsFacade } from './agent/skills-facade.js'
import { runFacadeEffect } from './agent/run-facade-effect.js'
import { makeDurableFacade, type RunDurableParams } from './agent/durable-facade.js'
import { buildRunTaskEffect, type RunTaskDeps, type RunTaskEffectOptions } from './agent/run-task-effect.js'
import { makeSessionHistoryStore } from './agent/session-store.js'
import { startStreamPump } from './agent/stream-pump.js'
import { bareBuilderFailure, driveApprovals, mapRunBoundaryError } from './agent/run-contract.js'
import { a2aResultToEffect } from './agent/a2a-executor.js'
import type { ExecutionContext } from './types.js'
import type { RuntimeErrors } from './errors.js'
import { unwrapErrorWithSuggestion } from './errors.js'
import type { ToolDefinition } from '@reactive-agents/tools'
import type { Task, TaskResult } from '@reactive-agents/core'
import type { TaskError } from '@reactive-agents/core'
import { generateTaskId, AgentId, TaskId } from '@reactive-agents/core'
import { join } from 'node:path'
import {
    CapabilityRegistry,
    type CapabilityAuditReport,
} from './capabilities/registry.js'
import {
    createDurableRun,
    persistApprovalPauseAt,
    persistInteractionPauseAt,
} from './engine/durable-resume.js'
import type { RunRecord, RunStatus } from './services/run-store.js'
import type { AgentEvent } from '@reactive-agents/core'
import { workspaceCarry, type WorkspaceOption } from './engine/start-run.js'
import type { ExecuteStreamFn } from './engine/execute-stream.js'
import { EventBus } from '@reactive-agents/core'
import { KillSwitchService } from '@reactive-agents/guardrails'
import type {
    JudgmentAnswers,
    JudgmentEntry,
    JudgmentModel,
    QuestionSpecs,
} from '@reactive-agents/judgment'
import { type JudgeContextConfig } from './judgment-context.js'
import {
    type JudgeRankCandidate,
    type JudgeRankOptions,
    type JudgeRankQuestion,
    type JudgeRankResult,
} from './judgment-rank.js'
import type { AgentStreamEvent, StreamDensity } from './stream-types.js'
import { RunController, installDurableCheckpointing, type RunHandle } from './run-controller.js'
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

import {
    AgentSession,
    requiresTools,
    buildChatSystemContext,
    type ChatMessage,
    type ChatOptions,
    type ChatReply,
    type SessionOptions,
    type HistoryOverflowHandler,
} from './chat.js'
import { ChatEngine, nextSessionId } from './chat/engine.js'
import { turnCarryMetadata, planPosture, originCarry, type TurnCarryOption, type PostureOption, type OriginOption } from './chat/todo-seed.js'
import type { EnvironmentUpdateOption } from './chat/environment-snapshot.js'
import { makeChatComplete, makeChatPublishTurn, makeSessionRunTask, sessionEnvironmentOption, sessionEnvironmentPorts } from './agent/chat-capabilities.js'
import type { AgentDebrief } from './debrief.js'
import { Health } from '@reactive-agents/health'
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import {
    generateAgentCard,
    createA2AServer,
    createA2AHttpServer,
    A2AHttpServer,
    A2AError,
} from '@reactive-agents/a2a'
import { streamObjectFrom } from './engine/stream-object.js'
import type { DeepPartial } from './builder/types.js'
import type { ChannelsConfig } from "@reactive-agents/channels";
import type {
    GatewayHandle,
    AgentResult,
    OutputSchemaOptions,
} from './builder/types.js'
import type { SchemaContract } from '@reactive-agents/reasoning'
import { buildSchemaSteering } from './agent/schema-steering.js'
import { validateCitations } from '@reactive-agents/reasoning'
import type { ReasoningStep } from '@reactive-agents/reasoning'

/**
 * `agent.judge()`'s options type now lives canonically on the judgment
 * facade (`agent/judgment-facade.ts`, #217 decomposition); re-exported here
 * so the public surface (`index.ts` re-exports this symbol from this file)
 * is unchanged.
 */
export type { JudgeInput } from './agent/judgment-facade.js'

import type { JudgeInput } from './agent/judgment-facade.js'

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

// ── Class ──
export class ReactiveAgent<TOut = unknown> {
    constructor(
        public readonly engine: {
            execute: (
                task: Task
            ) => Effect.Effect<TaskResult, RuntimeErrors | TaskError>
            executeStream: ExecuteStreamFn
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
        public readonly runtime: ManagedRuntime.ManagedRuntime<unknown, never>,
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
            verificationStep?: { mode: 'reflect'; prompt?: string }
            outputValidator?: (output: string) => {
                valid: boolean
                feedback?: string
            }
            outputValidatorOptions?: { maxRetries?: number }
            customTermination?: (state: { output: string }) => boolean
            modelRouting?: { tierModels?: Partial<Record<'haiku' | 'sonnet' | 'opus', string>>; minTier?: 'haiku' | 'sonnet' | 'opus' }
            /** Per-agent override for chat()'s tool-need auto-detection, from `.withToolIntent()`. */
            toolIntentClassifier?: (message: string) => boolean
            /** Composed persona/system prompt from the builder (reaches the direct path). */
            systemPrompt?: string
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
        private readonly config: Record<string, unknown> = {},
        /**
         * @internal Mutable reference to the kernel's resolved meta-tools config
         * (`runtime-construction.ts`'s `kernelMetaTools`), read per-run by
         * `resolveExecutableToolCapabilities` — NOT a build-time snapshot.
         * `ingest()` mutates two fields on it so runtime ingestion becomes
         * discoverable the same way `.withDocuments()` is at build time:
         *   - `find`: by design (see runtime-construction.ts's "Wire measurement"
         *     comment — a deliberate, measured token-cost tradeoff), the `find`
         *     tool is registered ONLY when `.withDocuments()` supplied entries
         *     at build time. `agent.ingest()`'s own JSDoc example calls it with
         *     no `.withDocuments()`/`.withMetaTools({find:true})` at all — that
         *     documented usage silently ingests content the model has no tool
         *     to ever retrieve. `ingest()` now flips `find` on so its own
         *     documented example actually works.
         *   - `staticBriefInfo.indexedDocuments`: same backfill `.withDocuments()`
         *     does at build time (`builder/build-effect/rag-ingestion.ts`), so
         *     the `brief` meta-tool and the `isNonTrivial` harness-injection
         *     gate (`kernel/capabilities/reason/think.ts`) see it too.
         */
        private readonly _kernelMetaTools?: {
            find?: boolean
            staticBriefInfo?: {
                indexedDocuments: Array<{ source: string; chunkCount: number; format: string }>
            }
        },
        /**
         * @internal Display name set via `.withName()` at build time. Distinct
         * from `agentId`, which embeds a `${name}-${Date.now()}` timestamp
         * prefix (see `builder.ts`'s `agentId` derivation) and is therefore
         * unsuitable as a human-facing name — e.g. for the A2A Agent Card
         * (`serveA2A()`). `serveA2A(options)`'s own `name` option still wins
         * over this when the caller wants to present a different name than
         * the one the agent was built with.
         */
        private readonly _scratchpad: Map<string, string> = new Map(),
        private readonly _name?: string,
        /**
         * @internal Default port for `serveA2A()`, from `.withA2A({port})`.
         * `.withA2A()` builds no layer — see `serveA2A()`'s doc comment.
         */
        private readonly _a2aDefaultPort?: number,
        /**
         * @internal Default base path for `serveA2A()`, from `.withA2A({basePath})`.
         * Prefixes all three A2A routes (JSON-RPC, `/agent/card`,
         * `/.well-known/agent.json`) — see `http-server.ts`'s `normalizeBasePath`.
         */
        private readonly _a2aDefaultBasePath?: string,
        /**
         * @internal Wave 7.1 auto-shadow marker: the wired JudgmentService
         * came from build-time auto-detection (local Ollama), not explicit
         * `.withJudgment()`. The public judge primitives (`judge()`,
         * `listJudgmentModels()`, `judgeRank()`) still require the explicit
         * opt-in and reject on auto-shadowed agents — auto-shadow exists for
         * sampling, not as a free judge backend. Edge case (documented):
         * hand-injecting a JudgmentService via `.withLayers()` while Ollama
         * is reachable also trips this guard — use `.withJudgment()` for a
         * usable judge backend; the error message says so.
         */
        private readonly _judgmentAutoShadow: boolean = false
    ) {}

    /**
     * `parseJsonLoose` moved to `agent/run-task-effect.ts` (it was only ever
     * called from `buildRunTaskEffect`, which moved there for #217).
     *
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
    /**
     * @internal Raw reasoning steps from the last run() — feeds `agent.judge()`'s
     * `includeContext` auto-merge (Phase D, `judgment-context.ts`). Populated
     * alongside `_lastRunObservations`, same source, kept unformatted so
     * `buildAutoContext` can select/compress observation steps itself.
     */
    private _lastReasoningSteps: ReasoningStep[] = []
    /** @internal Lazily-constructed agent-scoped chat engine (canonical chat engine, Task 5). */
    private _defaultChatEngine?: ChatEngine

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
                        yield* ts
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

    /** Judgment facade wired to this agent (chat history + reasoning steps read live at call time). */
    private _judgmentFacade(): ReturnType<typeof makeJudgmentFacade> {
        return makeJudgmentFacade({
            agentId: this.agentId,
            runtime: this.runtime,
            judgmentAutoShadow: this._judgmentAutoShadow,
            chatHistory: this._defaultChatEngine?.history() ?? [],
            lastReasoningSteps: this._lastReasoningSteps,
        })
    }

    /** Skills facade wired to this agent. */
    private _skillsFacade(): ReturnType<typeof makeSkillsFacade> {
        return makeSkillsFacade({ agentId: this.agentId, runtime: this.runtime })
    }

    /**
     * Ask a calibrated typed judgment question.
     *
     * Delegates to `agent/judgment-facade.ts` (moved from this file for #217) —
     * see `makeJudgmentFacade().judge` there for the full public-contract JSDoc,
     * which moved verbatim with the body.
     */
    async judge<Q extends QuestionSpecs>(input: JudgeInput<Q>): Promise<JudgmentAnswers<Q>> {
        return runFacadeEffect(this.runtime, this._judgmentFacade().judge(input))
    }

    /**
     * List the models/aliases available to `judge()`.
     *
     * Delegates to `agent/judgment-facade.ts` (moved from this file for #217) —
     * see `makeJudgmentFacade().listJudgmentModels` there for the full JSDoc.
     */
    async listJudgmentModels(): Promise<ReadonlyArray<JudgmentModel>> {
        return runFacadeEffect(this.runtime, this._judgmentFacade().listJudgmentModels())
    }

    /**
     * Score-rank candidates against one question.
     *
     * Delegates to `agent/judgment-facade.ts` (moved from this file for #217) —
     * see `makeJudgmentFacade().judgeRank` there for the full JSDoc.
     */
    async judgeRank(
        candidates: readonly JudgeRankCandidate[],
        question: JudgeRankQuestion,
        opts: JudgeRankOptions = {}
    ): Promise<ReadonlyArray<JudgeRankResult>> {
        return runFacadeEffect(this.runtime, this._judgmentFacade().judgeRank(candidates, question, opts))
    }

    /**
     * Ingest a document into the agent's RAG memory store at runtime.
     *
     * The document is chunked and indexed so the agent can retrieve it via the
     * `find` tool on subsequent `run()` calls. This is the runtime counterpart
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

        // Mirror the build-time `.withDocuments()` wiring (see
        // `builder/build-effect/rag-ingestion.ts` +
        // `runtime-construction.ts`'s meta-tools resolution) so runtime
        // ingestion is discoverable — and retrievable — the same way.
        if (this._kernelMetaTools) {
            // find is off-by-default unless .withDocuments() supplied entries
            // at build time (a deliberate token-cost tradeoff) — but ingest()
            // just gave the model something to retrieve, so make sure it can.
            this._kernelMetaTools.find = true
            if (this._kernelMetaTools.staticBriefInfo) {
                // Recompute from the store's current contents (not just
                // append) so it stays correct across repeated `ingest()`
                // calls to the same source.
                this._kernelMetaTools.staticBriefInfo.indexedDocuments = [
                    ...(this._ragStore as Map<string, Array<{ metadata?: { format?: string } }>>).entries(),
                ].map(([source, chunks]) => ({
                    source,
                    chunkCount: chunks.length,
                    format: chunks[0]?.metadata?.format ?? 'text',
                }))
            }
        }
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
                yield* ts.register(definition, handler)
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
                yield* ts.unregisterTool(name)
            })
        )
    }

    /**
     * List all loaded skills for this agent.
     *
     * Delegates to `agent/skills-facade.ts` (moved from this file for #217).
     * Since Task 6 (D1 bridge) the facade methods return Effects and this
     * class shell — via `runFacadeEffect` — is the family's single Promise
     * boundary.
     */
    async skills(): Promise<import('@reactive-agents/core').SkillRecord[]> {
        return runFacadeEffect(this.runtime, this._skillsFacade().skills())
    }

    /**
     * Delegates to `agent/skills-facade.ts` — exportSkill (moved from this file for #217).
     */
    async exportSkill(name: string, outputPath?: string): Promise<string> {
        return runFacadeEffect(this.runtime, this._skillsFacade().exportSkill(name, outputPath))
    }

    /**
     * Delegates to `agent/skills-facade.ts` — loadSkill (moved from this file for #217).
     */
    async loadSkill(skillPath: string): Promise<void> {
        return runFacadeEffect(this.runtime, this._skillsFacade().loadSkill(skillPath))
    }

    /**
     * Manually trigger a skill refinement pass.
     *
     * Delegates to `agent/skills-facade.ts` (moved from this file for #217).
     */
    async refineSkills(): Promise<{ refined: number }> {
        return runFacadeEffect(this.runtime, this._skillsFacade().refineSkills())
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
            /** Per-run override for the agent's maxIterations (chat path). */
            readonly maxIterations?: number
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
        } & EnvironmentUpdateOption & PostureOption & OriginOption & WorkspaceOption
    ): Promise<AgentResult & { object?: TOut }> {
        // Run the task on ManagedRuntime only — do not wrap in Effect.runPromise(Effect.promise(...)),
        // which nests the default runtime with ManagedRuntime and can yield pure interruption
        // ("All fibers interrupted without errors") on first execution (e.g. with Cortex + reasoning).
        const taskInput = withHistoryBlock(input, options?.history)
        const taskIdOpt = {
            ...(options?.taskId ? { taskId: options.taskId } : {}),
            ...(options?.maxIterations !== undefined ? { maxIterations: options.maxIterations } : {}),
            // Chat-turn carry: environment notice + plan posture ride task context to the envelope.
            ...(options?.environmentUpdate ? { environmentUpdate: options.environmentUpdate } : {}), ...planPosture(options?.posture), ...originCarry(options?.origin), ...workspaceCarry(options?.workspace),
        }

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
                      ...(options?.taskId ? { taskId: options.taskId } : {}), ...workspaceCarry(options?.workspace),
                  })
                : await this.runtime.runPromise(
                      this.buildRunTaskEffect(taskInput, taskIdOpt),
                      runSignal ? { signal: runSignal } : undefined,
                  )

            // B1: a bare builder re-throws infrastructure/exhaustion failures
            // (llm_error / max_iterations / guard_stop) — see agent/run-contract.ts.
            const bareFailure = bareBuilderFailure(result, this.config['enableReasoning'] === true)
            if (bareFailure) throw bareFailure

            // Tier 2 — same-process convenience: drive pause→decide→resume in one
            // call (agent/run-contract.ts).
            result = await driveApprovals(result, options?.onApproval, {
                approve: (runId) => this.approveRun(runId),
                deny: (runId, reason) => this.denyRun(runId, reason),
            })
            return result
        }

        return execute().catch((e) =>
            mapRunBoundaryError(e, {
                agentId: this.agentId,
                taskId: taskIdOpt?.taskId,
                aborted: runSignal?.aborted === true,
                emitTerminated: (tid) => this.emitAgentTerminated(tid, 'terminate() called'),
                errorHandler: this._errorHandler,
            }),
        ) as Promise<AgentResult & { object?: TOut }>
    }

    /**
     * Serve this agent over the A2A protocol. Returns once the port is bound.
     *
     * Other agents discover it at `/.well-known/agent.json` and invoke it with
     * JSON-RPC `message/send`. Replaces the old `.withA2A()` layer wiring,
     * which composed at runtime-construction time — before the agent existed —
     * and so bound no port and reached no executor (dead code, deleted
     * alongside this method). `.withA2A(options)` itself is kept as a config
     * carrier: its `port` and `basePath` are the defaults here when the
     * caller omits them.
     *
     * Cancel correlation: A2A's minted `taskId` (`task-handler.ts`) is passed
     * straight into `run()`'s own `options.taskId`, which `buildRunTaskEffect`
     * adopts verbatim as the `Task.id` the ExecutionEngine executes under
     * (`reactive-agent.ts`'s `buildRunTaskEffect`). So the SAME id `agent
     * .cancel(taskId)` expects is the id A2A already knows — no separate
     * id-mapping table needed. (`tasks/cancel` still only flips the A2A task's
     * status today — the executor fiber itself is `forkDaemon`'d with no
     * retained interrupt handle in non-blocking mode; that gap is out of scope
     * here, see the A2A repair plan's Task 1 note.)
     */
    async serveA2A(options?: {
        readonly port?: number
        readonly description?: string
        readonly hostname?: string
        readonly token?: string
        /** Overrides the Agent Card `name`; defaults to the name set via `.withName()`. */
        readonly name?: string
        /** Prefixes all A2A routes; defaults to the base path set via `.withA2A({basePath})`. */
        readonly basePath?: string
    }): Promise<{ readonly port: number; stop(): Promise<void> }> {
        const port = options?.port ?? this._a2aDefaultPort ?? 3000
        const name = options?.name ?? this._name ?? this.agentId
        const basePath = options?.basePath ?? this._a2aDefaultBasePath

        // Executor seam: (input, taskId) => Effect<string, A2AError>. Threads
        // A2A's taskId into run() so cancel() correlation holds (see doc
        // comment above) and surfaces run() failures as A2AError instead of
        // letting them escape as raw Error/unknown.
        const executor = (input: string, taskId: string): Effect.Effect<string, A2AError> =>
            Effect.tryPromise({
                try: () => this.run(input, { taskId }),
                catch: (e) =>
                    new A2AError({
                        code: 'INTERNAL_ERROR',
                        message: e instanceof Error ? e.message : String(e),
                    }),
            }).pipe(
                Effect.flatMap(a2aResultToEffect),
            )

        const agentCard = generateAgentCard({
            name,
            description: options?.description,
            // Actual bound port isn't known until `start()` resolves (esp. with
            // `port: 0`), so the card's `url` uses the requested port; callers
            // that need the resolved port read `handle.port`. Includes
            // `basePath` when set, since that's where the routes actually live.
            url: `http://${options?.hostname ?? '127.0.0.1'}:${port}${basePath ?? ''}`,
        })

        // Pass hostname/token as explicit per-call parameters (never a
        // process.env mutation — that would leak across concurrent/sequential
        // serveA2A() calls in the same process, see the A2A repair plan's
        // final-review C1 finding). createA2AHttpServer falls back to
        // RA_A2A_HOST/RA_A2A_TOKEN itself when neither is given here, which
        // preserves `rax serve`'s env-driven behavior.
        const serverLayer = createA2AHttpServer(port, executor, basePath, {
            hostname: options?.hostname,
            token: options?.token,
        }).pipe(Layer.provide(createA2AServer(agentCard)))

        const { boundPort, stop } = await Effect.runPromise(
            Effect.gen(function* () {
                const server = yield* A2AHttpServer
                const boundPort = yield* server.start()
                return { boundPort, stop: () => Effect.runPromise(server.stop()) }
            }).pipe(Effect.provide(serverLayer)),
        )

        return {
            port: boundPort,
            stop: async () => {
                await stop()
            },
        }
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
                Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/reactive-agent.ts:emitTerminated", tag: errorTag(err) })),
            ) as Effect.Effect<void>,
        )
    }

    /** The durable-run facade, wired to this agent (deps are cheap closures; built per call). */
    private _durable(): ReturnType<typeof makeDurableFacade> {
        return makeDurableFacade({
            durableResume: this._durableResume,
            agentId: this.agentId,
            runtime: this.runtime,
            buildRunTaskEffect: (input, options) => this.buildRunTaskEffect(input, options),
            runDurable: (params) => this.runDurable(params),
        })
    }

    /**
     * Resume a crashed or paused durable run from its last checkpoint (Phase C).
     *
     * Delegates to `agent/durable-facade.ts` (moved from this file for #217); this shell, via `runFacadeEffect`, is the family's single Promise boundary (Task 10 / D1 bridge).
     * see `makeDurableFacade().resumeRun` there for the full JSDoc.
     */
    async resumeRun(runId: string): Promise<AgentResult> {
        return runFacadeEffect(this.runtime, this._durable().resumeRun(runId))
    }

    /**
     * Fork a NEW run from any checkpoint of a prior run (Arc 1 Task 6).
     *
     * Delegates to `agent/durable-facade.ts` via `runFacadeEffect`: this shell is the family's single Promise boundary (Task 10 / D1 bridge).
     * see `makeDurableFacade().fork` there for the full JSDoc.
     */
    async fork(
        runId: string,
        opts?: { at?: number; model?: string; task?: string },
    ): Promise<AgentResult> {
        return runFacadeEffect(this.runtime, this._durable().fork(runId, opts))
    }

    /**
     * List persisted durable runs (newest-updated first), optionally filtered by
     * lifecycle status.
     *
     * Delegates to `agent/durable-facade.ts` via `runFacadeEffect`: this shell is the family's single Promise boundary (Task 10 / D1 bridge).
     */
    async listRuns(filter?: { status?: RunStatus; userId?: string }): Promise<readonly RunRecord[]> {
        return runFacadeEffect(this.runtime, this._durable().listRuns(filter))
    }

    /**
     * Durable HITL (Phase D): approve a run that paused for human approval and
     * resume it to completion.
     *
     * Delegates to `agent/durable-facade.ts` via `runFacadeEffect`: this shell is the family's single Promise boundary (Task 10 / D1 bridge).
     */
    async approveRun(runId: string, opts?: { reason?: string }): Promise<AgentResult> {
        return runFacadeEffect(this.runtime, this._durable().approveRun(runId, opts))
    }

    /**
     * Durable HITL (Phase D): deny a run's paused action and resume it to
     * completion.
     *
     * Delegates to `agent/durable-facade.ts` via `runFacadeEffect`: this shell is the family's single Promise boundary (Task 10 / D1 bridge).
     */
    async denyRun(runId: string, reason: string): Promise<AgentResult> {
        return runFacadeEffect(this.runtime, this._durable().denyRun(runId, reason))
    }

    /**
     * Durable HITL (Phase D): list runs paused awaiting a human decision, with the
     * pending action (tool + args) for each.
     *
     * Delegates to `agent/durable-facade.ts` via `runFacadeEffect`: this shell is the family's single Promise boundary (Task 10 / D1 bridge).
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
        return runFacadeEffect(this.runtime, this._durable().listPendingApprovals())
    }

    /**
     * Agentic-UI interaction rail (Task 10): the durable store location + agent id
     * for this agent when built with `.withDurableRuns()`, else `undefined`.
     *
     * Delegates to `agent/durable-facade.ts` (moved from this file for #217); stays SYNCHRONOUS through Task 10 (D1 bridge): a pure accessor with no Promise boundary to bridge.
     */
    getDurableInfo(): { dbPath: string; agentId: string } | undefined {
        return this._durable().getDurableInfo()
    }

    /**
     * Agentic-UI interaction rail (Task 10): list runs paused awaiting a human
     * response to a `request_user_input`, with the pending interaction (kind +
     * prompt + parsed schema) for each.
     *
     * Delegates to `agent/durable-facade.ts` via `runFacadeEffect`: this shell is the family's single Promise boundary (Task 10 / D1 bridge).
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
        return runFacadeEffect(this.runtime, this._durable().listPendingInteractions())
    }

    /**
     * Agentic-UI interaction rail (Task 10): record a human's response to a run
     * that paused for `request_user_input` and resume it to completion.
     *
     * Delegates to `agent/durable-facade.ts` via `runFacadeEffect`: this shell is the family's single Promise boundary (Task 10 / D1 bridge).
     */
    async respondToInteraction(
        runId: string,
        interactionId: string,
        value: unknown,
    ): Promise<AgentResult> {
        return runFacadeEffect(this.runtime, this._durable().respondToInteraction(runId, interactionId, value))
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
        options?: { readonly taskId?: string } & WorkspaceOption
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
    private async runDurable(params: RunDurableParams): Promise<AgentResult> {
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

        // 3. Run the pipeline; the controller (+ resume state when resuming)
        //    is bound into the run scope by the run entry.
        const resume = params.resume
        const pipeline = this.buildRunTaskEffect(params.input, {
            ...(params.taskId !== undefined ? { taskId: params.taskId } : {}),
            durableRunId: params.runId,
            ...(params.forkedFrom !== undefined ? { forkedFrom: params.forkedFrom } : {}),
            ...(params.fileRoot !== undefined ? { fileRoot: params.fileRoot } : {}), ...workspaceCarry(params.workspace),
            runState: {
                runController: controller,
                ...(params.modelOverride !== undefined ? { modelOverride: params.modelOverride } : {}),
                ...(resume ? { resumeState: resume.stateJson } : {}),
                ...(resume?.decision ? { approvalDecision: resume.decision } : {}),
                ...(resume?.interaction ? { interactionResponse: resume.interaction } : {}),
            },
        })

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
            throw unwrapErrorWithSuggestion(e)
        }
    }

    /**
     * Explicit dependency surface for `agent/run-task-effect.ts` — exactly the
     * class fields the moved `buildRunTaskEffect` body reads/writes. Mutables
     * (`_lastDebrief`, `_lastRunObservations`, `_lastReasoningSteps`) ride as
     * setter closures so the fields stay the single source of truth; the
     * debrief-fiber Set is passed by reference.
     *
     * @internal Deps builder for the #217 factor-out; not part of the public API.
     */
    private _runTaskDeps(): RunTaskDeps {
        return {
            agentId: this.agentId,
            engine: this.engine,
            runtime: this.runtime,
            config: this.config,
            outputSchemaConfig: this._outputSchemaConfig,
            durableResume: this._durableResume,
            enableTools: this._enableTools,
            setTaskDescription: this._setTaskDescription,
            pendingDebriefs: this._pendingDebriefs,
            setLastDebrief: (debrief) => { this._lastDebrief = debrief },
            setLastRunObservations: (observations) => { this._lastRunObservations = observations },
            setLastReasoningSteps: (steps) => { this._lastReasoningSteps = steps },
            buildSchemaSteering,
        }
    }

    /**
     * Core task execution Effect (requires services from the agent's ManagedRuntime).
     *
     * Delegates to `agent/run-task-effect.ts` — moved from this file for #217
     * (the largest single method, ~400 LOC); `parseJsonLoose` moved alongside it.
     * This thin delegate remains because `runDurable`, `runEffect`, and
     * `resumeRun` (via the durable facade) call it.
     */
    private buildRunTaskEffect(input: string, options?: RunTaskEffectOptions): Effect.Effect<AgentResult, Error> {
        return buildRunTaskEffect(this._runTaskDeps(), input, options)
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
     *
     * Error contract vs `run()`: when the agent has been halted (`stop()`,
     * `terminate()`, or a triggered kill switch), `run()` REJECTS with
     * `KillSwitchTriggeredError`, while `runStream()` does NOT throw — it yields a
     * terminal `StreamError` (or `StreamCancelled` for an aborted signal) and the
     * generator completes normally. Callers porting `try/catch` kill-switch handling
     * from `run()` must branch on the terminal event tag instead.
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
        } & TurnCarryOption & WorkspaceOption
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
        } & TurnCarryOption & WorkspaceOption,
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
            metadata: { tags: [], ...turnCarryMetadata(options) },
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
                ...(options?.identity !== undefined ? { identity: options.identity } : {}), ...workspaceCarry(options?.workspace),
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

        // Fiber-interruption bridge (agent/stream-pump.ts): the Effect stream runs in
        // an interruptible fiber feeding a JS queue; abort interrupts the fiber.
        const pump = startStreamPump(this.runtime, stream, signal)

        let iterationsCompleted = 0
        // FM-5 (Phase 4 Task 4, review fix): true only once the CONSUMER effect
        // itself finished (a terminal StreamCompleted/StreamError/StreamCancelled
        // was already pushed onto itemQueue, or the underlying Effect errored).
        // Every OTHER way this generator stops — the caller's `for await` loop
        // doing a bare `break`/`return`/`throw`, which the async-generator
        // protocol turns into `.return()` on this generator and unwinds
        // straight to `finally` — leaves this `false`. That distinguishes a
        // natural completion (producer already finished on its own, nothing
        // left to stop) from an abandoned run (producer may still be mid-flight
        // in execute-stream.ts's daemon-forked fiber) so `finally` below knows
        // when it must force a real terminate(), not just interrupt the local
        // consumer fiber.
        let reachedTerminal = false

        try {
            while (true) {
                // Wait for the next item; undefined = aborted while waiting.
                const item = await pump.next()
                if (item === undefined) break

                if (item.done) {
                    reachedTerminal = true
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

                // FM-5 follow-up (Phase 4 final review fix): a consumer doing the
                // normal `for await (... ) { if (ev._tag === 'StreamCompleted') break }`
                // pattern exits its loop right after receiving a terminal event.
                // Under the async-generator protocol, a `break` in the consumer's
                // `for await` turns into `.return()` on THIS generator, which
                // resumes execution at the `yield` below not by falling through
                // to the next statement but by treating the yield itself as a
                // `return` — so any code placed AFTER `yield event` never runs on
                // that exit path (verified empirically: placing this check after
                // the yield left `reachedTerminal` false). This generator also
                // never loops back around to shift the producer's `item.done`
                // sentinel off `itemQueue` in that case. Both together left
                // `reachedTerminal` false for a run that had actually completed
                // naturally, so `finally` below incorrectly force-terminated it
                // (RunHandle.status() then reported "terminated" instead of
                // "completed" for a successful run). Fix: mark it terminal BEFORE
                // yielding — once a terminal event is about to be handed to the
                // consumer, the run has reached a terminal outcome regardless of
                // whether the consumer keeps reading afterward.
                if (
                    event._tag === 'StreamCompleted' ||
                    event._tag === 'StreamError' ||
                    event._tag === 'StreamCancelled'
                ) {
                    reachedTerminal = true
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
            // Detach the abort listener and interrupt the consumer fiber on any
            // generator exit (break/throw/return).
            pump.dispose()
            // FM-5 (Phase 4 Task 4, review fix): interrupting the fiber above only
            // stops the CONSUMER (this generator's `EStream.runForEach` read loop)
            // — it does nothing to the PRODUCER, execute-stream.ts's daemon-forked
            // pipeline, which only stops when `controller`'s AbortController fires
            // (execute-stream.ts's signal listener + iterate-pass.ts's checkpoint
            // both key off that). A caller that just stops consuming — breaks out
            // of its `for await` loop, throws, or gets interrupted upstream —
            // WITHOUT calling `handle.terminate()`/aborting its own signal never
            // fires that AbortController, so the producer ran on unobserved before
            // this fix (confirmed by a reviewer repro: 1→4 provider calls over
            // ~800ms after an un-terminated early break). Force it here whenever
            // this generator stops WITHOUT the consumer effect having reached a
            // terminal item itself — i.e. any exit that is not a natural
            // completion. Calling terminate() when the run already terminated
            // (explicit handle.terminate()/aborted signal) is a safe no-op: both
            // `_status = "terminated"` and `AbortController.abort()` are
            // idempotent.
            if (!reachedTerminal) {
                controller.terminate()
            }
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
        const steeringInstruction = buildSchemaSteering(contract)
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
     * Use `options.useTools` to override the automatic routing for a single call,
     * or `.withToolIntent(classifier)` (on the builder) to override the default
     * classifier for every call on this agent. Precedence: `options.useTools` >
     * agent-level classifier from `.withToolIntent()` > default `requiresTools()`.
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
        // Legacy path for callers that supply history or a sessionId (e.g. the
        // AgentSession facade): preserves the pre-engine semantics, including
        // per-call history windowing and ChatTurn publication. Agent-scoped
        // chat (no history/sessionId) routes through the canonical engine below.
        if (_history !== undefined || _sessionId !== undefined) {
            return this._chatLegacy(message, options, _history, _sessionId);
        }

        // Lazily-constructed agent-scoped engine (canonical chat engine, Task 5).
        if (!this._defaultChatEngine) {
            const sessionId = nextSessionId("agent", [this.agentId]);
            const self = this;
            this._defaultChatEngine = new ChatEngine(
                {
                    runTask: async (input, opts) => {
                        return self.run(
                            input,
                            opts?.maxIterations !== undefined
                                ? { history: opts.history, maxIterations: opts.maxIterations }
                                : { history: opts.history },
                        );
                    },
                    complete: makeChatComplete(self.runtime),
                    publishTurn: makeChatPublishTurn(self.runtime, "runtime/src/reactive-agent.ts:chat"),
                    systemPrompt: self._config?.systemPrompt
                        ? () => self._config!.systemPrompt!
                        : undefined,
                    contextSummary: () =>
                        buildChatSystemContext(
                            self._config?.taskContext,
                            self._lastDebrief,
                            self._lastRunObservations,
                        ),
                    scratchpadEntries: () => Object.fromEntries(self._scratchpad),
                },
                { sessionId },
            );
        }

        const useTools = this._resolveUseTools(message, options)

        return this._defaultChatEngine.turn(message, {
            ...options,
            useTools,
            maxIterations: options?.maxIterations,
        });
    }

    /**
     * Whether a chat turn should run with tools: explicit `options.useTools`
     * wins, then the `.withToolIntent()` classifier, then default `requiresTools()`.
     */
    private _resolveUseTools(message: string, options?: ChatOptions): boolean {
        return options?.useTools ?? (this._config?.toolIntentClassifier ?? requiresTools)(message)
    }

    /**
     * Legacy chat implementation retained for session/override callers that
     * supply history or a sessionId. Agent-scoped chat routes through the
     * canonical engine instead.
     */
    private async _chatLegacy(
        message: string,
        options?: ChatOptions,
        _history?: ChatMessage[],
        _sessionId?: string,
    ): Promise<ChatReply> {
        const useTools = this._resolveUseTools(message, options)
        const contextSummary = buildChatSystemContext(
            this._config?.taskContext,
            this._lastDebrief,
            this._lastRunObservations,
        );
        // Retained compat path (cortex + history/sessionId callers). Migrated
        // onto a transient ChatEngine (Task 8): the direct path no longer calls
        // the deleted free function (pre-engine direct path), and the "Context from prior run"
        // / "New request" framing now lives in the engine's contextSummary
        // capability composition (engine parity). Legacy session-id fallback
        // `chat_<ts>` is documented here (R10).
        const sessionId = _sessionId ?? `chat_${Date.now()}`;
        const self = this;
        const engine = new ChatEngine(
            {
                runTask: async (input, opts) => {
                    return self.run(
                        input,
                        opts?.maxIterations !== undefined
                            ? { history: opts.history, maxIterations: opts.maxIterations }
                            : { history: opts.history },
                    );
                },
                complete: makeChatComplete(self.runtime),
                publishTurn: makeChatPublishTurn(self.runtime),
                systemPrompt: self._config?.systemPrompt
                    ? () => self._config!.systemPrompt!
                    : undefined,
                contextSummary: () => contextSummary,
                scratchpadEntries: () => Object.fromEntries(self._scratchpad),
                loadHistory: async () => _history ?? [],
            },
            { sessionId, maxDirectTokens: 4096 },
        );
        return engine.turn(message, { ...options, useTools });
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
     * @example Overflow summarization — fold dropped turns into a summary instead of losing them
     * ```typescript
     * const session = agent.session({
     *   onOverflow: async (dropped) => {
     *     const { message } = await agent.chat(
     *       `Summarize these turns in 2-3 sentences:\n${dropped.map(d => d.content).join("\n")}`,
     *       { useTools: false }
     *     );
     *     return message;
     *   },
     * });
     * ```
     */
    session(
        options?: SessionOptions
    ): AgentSession {
        const persist = options?.persist ?? this._sessionPersist
        const _maxAgeDays = options?.maxAgeDays ?? this._sessionMaxAgeDays
        const sessionId =
            options?.id ??
            nextSessionId("session", [])
        const self = this

        // Optional durable session history (agent/session-store.ts).
        const sessionStore = persist ? makeSessionHistoryStore(self.runtime, self.agentId) : undefined

        const engine = new ChatEngine(
            {
                runTask: makeSessionRunTask((input, o) => self.run(input, o)),
                runStreamTask: (input, opts) => {
                    return self.runStream(input, {
                        history: opts.history ? [...opts.history] : undefined,
                        density: opts.density,
                        signal: opts.signal, ...(opts.initialTodo ? { initialTodo: opts.initialTodo } : {}), ...(opts.environmentUpdate ? { environmentUpdate: opts.environmentUpdate } : {}), ...planPosture(opts.posture), ...originCarry(opts.origin),
                    });
                },
                complete: makeChatComplete(self.runtime),
                publishTurn: makeChatPublishTurn(self.runtime, "runtime/src/reactive-agent.ts:session-publish"),
                saveHistory: sessionStore?.save,
                loadHistory: sessionStore?.load,
                systemPrompt: self._config?.systemPrompt
                    ? () => self._config!.systemPrompt!
                    : undefined,
                contextSummary: () =>
                    buildChatSystemContext(
                        self._config?.taskContext,
                        self._lastDebrief,
                        self._lastRunObservations,
                    ),
                scratchpadEntries: () => Object.fromEntries(self._scratchpad),
                ...sessionEnvironmentPorts(self.runtime, options),
            },
            {
                sessionId,
                onOverflow: options?.onOverflow,
                initialHistory: options?.initialHistory, initialTodo: options?.initialTodo, ...originCarry(options?.origin),
                ...sessionEnvironmentOption(self.runtime, options),
            },
        );

        return new AgentSession(engine);
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
    /**
     * Run a control action against the KillSwitchService.
     *
     * The service is only in the layer when `.withKillSwitch()` was called — it
     * is `Layer.empty` otherwise (see acquireRunSignal, which already resolves it
     * with `serviceOption` for exactly this reason). Requesting the tag directly
     * makes a missing service a *defect*, and a defect is not catchable by
     * `catchAll` — so pause/resume/stop/terminate, four DOCUMENTED public methods,
     * each crashed the caller with "Service not found: KillSwitchService" on any
     * agent that had not opted in (the default). A caller's try/catch around the
     * un-awaited promise cannot save them either; it surfaces as an unhandled
     * rejection and takes the process down.
     *
     * Now: a clear, catchable error that names the remedy.
     */
    private async killSwitchAction(
        method: string,
        // KillSwitchService's pause/resume/stop/terminate are all
        // `Effect.Effect<void>` (never-typed error channel, see
        // guardrails/src/kill-switch.ts) — so no error translation or
        // swallow is needed here; failures would be defects, not errors.
        run: (ks: Context.Tag.Service<typeof KillSwitchService>) => Effect.Effect<void>,
    ): Promise<void> {
        return this.runtime.runPromise(
            Effect.serviceOption(KillSwitchService).pipe(
                Effect.flatMap((opt) =>
                    opt._tag === "Some"
                        ? run(opt.value)
                        : Effect.die(
                              new Error(
                                  `agent.${method}() requires the kill switch. Build the agent with .withKillSwitch() (or features.killSwitch in a config) to enable pause/resume/stop/terminate.`,
                              ),
                          ),
                ),
            ) as Effect.Effect<void>,
        )
    }

    async pause(): Promise<void> {
        return this.killSwitchAction("pause", (ks) => ks.pause(this.agentId))
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
        return this.killSwitchAction("resume", (ks) => ks.resume(this.agentId))
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
        return this.killSwitchAction("stop", (ks) => ks.stop(this.agentId, reason))
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
        return this.killSwitchAction("terminate", (ks) => ks.terminate(this.agentId, reason))
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
        // Invariant (GH #224): EventBus is a MANDATORY runtime layer —
        // createRuntime/createLightRuntime always merge EventBusLive — and
        // EventBus.subscribe/on are typed Effect<() => void, never>, so there
        // is no error channel to recover from here. A missing EventBus is a
        // Context DEFECT, which catchAll cannot catch; it must surface loudly
        // rather than resolve to a silent no-op. Do not add a fallback branch.
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
                    )
                )
            )
        }
        // Tag-filtered overload — delegates to the typed eb.on()
        return this.runtime.runPromise(
            EventBus.pipe(
                Effect.flatMap((eb) =>
                    eb.on(tagOrHandler, (event) =>
                        Effect.sync(() => handler!(event))
                    )
                )
            )
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
