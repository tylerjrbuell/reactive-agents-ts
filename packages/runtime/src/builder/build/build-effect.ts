/**
 * `buildEffect()` body — `ReactiveAgentBuilder.buildEffect()` (and the
 * private `warnIfImplicitTestProvider()` helper it calls) moved out of
 * `builder.ts` (2026-10-20 builder decomp, GH #218 / HS-248).
 *
 * The class method is a thin delegate that forwards the live mutable builder
 * state (the `asBuilderState` view from `builder/withers/_state.ts`) and
 * returns this module's Effect. No logic changed — the generator body was
 * moved verbatim with the local `const self = this` replaced by the `state`
 * parameter.
 */

import { Effect, Layer } from 'effect'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { durableConfigHash } from '../../services/run-store.js'
import { buildSubAgentSystemPrompt } from '../helpers.js'
import {
    buildBaseRuntimeAndEngine,
    type BuilderRuntimeStateView,
} from '../build-effect/runtime-construction.js'
import { fetchAndMergePricing } from '../build-effect/pricing-fetch.js'
import { setupParentContext } from '../build-effect/parent-context.js'
import { buildToolMcpRegistrations } from '../build-effect/tool-mcp-registrations.js'
import { ingestRagDocuments } from '../build-effect/rag-ingestion.js'
import { composeHealthLayer } from '../build-effect/health-layer.js'
import { composeTracingLayer } from '../build-effect/tracing-layer.js'
import { instantiateAgent } from '../build-effect/agent-instantiation.js'
import type { ReactiveAgent } from '../../reactive-agent.js'
import type { MCPServerConfig } from '../../runtime.js'
import type { BuilderState } from '../withers/_state.js'

/**
 * Warn when the provider silently resolves to `"test"` without expressed
 * user intent (W0.3, Local-Tier Reliability program). The builder's
 * `_provider` default is `"test"`, so a user who never chooses a provider
 * gets canned output that reports success with no model ever called (the
 * program's named "fake green" trap at the framework's front door). Signal
 * only: no throw, no default flip.
 *
 * Explicit arms stay silent: `.withProvider(...)` (also used by `quick()`
 * and `fromConfig()`), `.withTestScenario(...)`, and `.withReplayLLM(...)`:
 * with a replay LLM override the `_provider` field is irrelevant, so
 * warning about canned test output would be a false positive.
 *
 * Called from {@link runBuilderBuildEffect}'s Effect.gen, which `build()`
 * runs at `Effect.runPromise(deps.buildEffect())`: one call site covers both
 * public terminals with exactly one warning per build. Not per run():
 * emitting here (build time) keeps the cost at one line per agent
 * construction.
 */
const warnIfImplicitTestProvider = (state: BuilderState): void => {
    if (state._provider === 'test' && !state._providerExplicit && state._llmOverrideLayer === undefined) {
        console.warn(
            "[reactive-agents] ⚠ No provider was chosen: this agent silently defaults to the \"test\" provider, " +
            "which returns canned output and reports success without ever calling a model. " +
            "Choose one explicitly with .withProvider(\"anthropic\"|\"openai\"|\"ollama\"|...), " +
            "or make the test provider intentional with .withProvider(\"test\") / .withTestScenario(...).",
        )
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
export const runBuilderBuildEffect = <TOut>(
    state: BuilderState,
): Effect.Effect<ReactiveAgent<TOut>, Error> => {
    return Effect.gen(function* () {
        // Implicit-test-provider warning (W0.3): runs on BOTH public build
        // terminals. `build()` delegates to this effect, so a single call
        // site here satisfies the file's own duplication convention
        // ("buildEffect() is also a public entry point", see the strict-
        // validation block below) without double-warning on the Promise
        // path.
        warnIfImplicitTestProvider(state)

        // Under strict validation, fail fast on a missing API key. `build()`
        // already ran the full validateBuild gate before reaching here, but
        // buildEffect() is also a public entry point, so it independently
        // refuses to construct a provider layer that cannot run. Routed
        // through the single build-time read path so the check can never
        // disagree with what the provider actually sees. Default (non-strict)
        // is warn-then-succeed — the run() boundary surfaces a clean typed
        // failure if the agent is actually invoked without a key.
        if (state._strictValidation && !state._lazyValidation) {
            const { providerRequiresApiKey, readProviderApiKey, providerApiKeyName } =
                yield* Effect.promise(() => import('../../build-validation.js'))
            if (
                providerRequiresApiKey(state._provider) &&
                !readProviderApiKey(state._provider) &&
                !state._providerConfig?.apiKey
            ) {
                const keyName = providerApiKeyName(state._provider)
                return yield* Effect.fail(
                    new Error(
                        `Missing ${keyName} for provider "${state._provider}" — the agent cannot run without it. ` +
                            `Set ${keyName}, switch providers, or call .withLazyValidation() to defer this check.`
                    )
                )
            }
        }

        // Automatically fetch remote pricing if a provider was configured.
        // Extracted to ./builder/build-effect/pricing-fetch.ts (W26-B step 1).
        {
            const { registry } = yield* fetchAndMergePricing({
                pricingProvider: state._pricingProvider,
                pricingRegistry: state._pricingRegistry,
                strict: state._strictValidation,
            })
            state._pricingRegistry = registry
        }

        const agentId = state._stableAgentId ?? `${state._name}-${Date.now()}`

        // Compose persona into system prompt if provided
        const composedSystemPrompt = buildSubAgentSystemPrompt(
            state._persona,
            state._systemPrompt,
            state._name
        )

        // Base runtime + cortex + meta-tools + engine resolution — extracted to
        // ./builder/build-effect/runtime-construction.ts (W25-B step 7).
        const { baseRuntime, runtimeWithCortex, engine, kernelMetaTools } =
            yield* buildBaseRuntimeAndEngine({
                agentId,
                composedSystemPrompt,
                state: state as unknown as BuilderRuntimeStateView,
            })

        const hooks = [...state._hooks]
        const mcpServers = [...state._mcpServers]
        const toolsOptions = state._toolsOptions
        const promptsOptions = state._promptsOptions
        const gatewayOptions = state._gatewayOptions
        const agentTools = state._agentTools
        const allowDynamicSubAgents = state._allowDynamicSubAgents
        const dynamicSubAgentOptions = state._dynamicSubAgentOptions
        const parentProvider = state._provider
        const parentModel = state._model
        const streamDensity = state._streamDensity
        const errorHandler = state._errorHandler
        const enableHealthCheck = state._enableHealthCheck
        const sessionPersist = state._sessionPersist
        const sessionMaxAgeDays = state._sessionMaxAgeDays
        const documents = [...state._documents]
        const agentIdCapture = agentId

        // Capture parent config for sub-agent inheritance — sub-agents get
        // the same infrastructure as the parent without explicit configuration.
        const parentReasoningOptions = state._reasoningOptions
        const parentEnableGuardrails = state._enableGuardrails
        const parentEnableObservability = state._enableObservability
        const parentObservabilityOptions = state._observabilityOptions
        const parentContextProfile = state._contextProfile
        const parentEnableCostTracking = state._enableCostTracking
        // Cross-cutting inheritance (2026-07-23) — a sub-agent operates under
        // the parent's judgment + safety constraints, not rubber-stamped.
        const parentTaskContract = state._taskContract
        const parentFabricationGuard = state._fabricationGuard
        const parentGrounding = state._groundingConfig
        const parentApprovalPolicy = state._approvalPolicy

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
            // `as any` justified: resolving a dynamically-imported service Tag
            // against `baseRuntime`, whose R/E/ROut channels are intentionally
            // erased to `unknown` at the build seam (see BuildBaseRuntimeResult
            // in runtime-construction.ts — tightening them is a separate refactor).
            const promptService = yield* (PromptService as any).pipe(
                Effect.provide(baseRuntime)
            )
            for (const template of promptsOptions.templates) {
                yield* (promptService as { register: (t: unknown) => Effect.Effect<unknown> }).register(template)
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
                parentScratchpadWriter: (key: string, value: string) => {
                  state._scratchpad.set(key, value);
                },
                parentProvider,
                parentModel,
                parentReasoningOptions,
                parentEnableGuardrails,
                parentEnableObservability,
                parentObservabilityOptions,
                parentContextProfile,
                parentEnableCostTracking,
                parentTestScenario: state._testScenario,
                // Cross-cutting inheritance (2026-07-23) — judgment + safety
                // to the child. Undefined-spread so an unset field is absent,
                // not a written `undefined` (keeps createLightRuntime's
                // presence checks honest).
                ...(parentTaskContract !== undefined ? { parentTaskContract } : {}),
                ...(parentFabricationGuard !== undefined ? { parentFabricationGuard } : {}),
                ...(parentGrounding !== undefined ? { parentGrounding } : {}),
                ...(parentApprovalPolicy !== undefined ? { parentApprovalPolicy } : {}),
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
            tracingConfig: state._tracingConfig,
        })

        // ManagedRuntime + ReactiveAgent construction extracted to
        // ./builder/build-effect/agent-instantiation.ts (W26-B step 4).
        return instantiateAgent({
            engine,
            fullRuntime,
            agentId,
            name: state._name,
            scratchpad: state._scratchpad,
            a2aDefaultPort: state._a2aOptions?.port,
            a2aDefaultBasePath: state._a2aOptions?.basePath,
            judgmentAutoShadow: state._judgmentShadowDbPath !== undefined,
            mcpServerNames: mcpServers.map((s) => s.name),
            gatewayOptions,
            streamDensity,
            hasParentCallbacks: agentTools.length > 0 || allowDynamicSubAgents,
            parentCtxRef: parentCtx.ref,
            errorHandler,
            sessionPersist,
            sessionMaxAgeDays,
            ragStore,
            kernelMetaTools: kernelMetaTools
                ? (kernelMetaTools as {
                      find?: boolean
                      staticBriefInfo?: {
                          indexedDocuments: Array<{ source: string; chunkCount: number; format: string }>
                      }
                  })
                : undefined,
            channelsConfig: state._channelsConfig,
            capabilities: {
                minIterations: state._minIterations,
                taskContext: state._taskContext,
                systemPrompt: composedSystemPrompt,
                verificationStep: state._verificationStep,
                outputValidator: state._outputValidator,
                outputValidatorOptions: state._outputValidatorOptions,
                customTermination: state._customTermination,
                modelRouting: state._modelRouting,
                toolIntentClassifier: state._toolIntentClassifier,
            },
            // Phase C: when durable runs are enabled, resolve the same
            // checkpoint dir + identity configHash execute-stream computes
            // at run start, so agent.resume(runId) can open the store and
            // guard config drift. dir derivation MUST mirror
            // execute-stream.ts:175-179.
            durableResume: state._durableRuns
                ? {
                      dir:
                          state._durableRuns.dir ??
                          join(homedir(), '.reactive-agents', agentId),
                      configHash: durableConfigHash({
                          systemPrompt: composedSystemPrompt,
                          provider: state._provider,
                      }),
                  }
                : undefined,
            outputSchemaConfig: state._outputSchemaConfig,
            enableTools: state._enableTools,
            runtimeConfig: {
                thinking: state._thinking,
                thinkingOptions: state._thinkingOptions,
                provider: state._provider,
                model: state._model,
                // Arc 1 Task 9: threaded through so buildRunTaskEffect can
                // resolve it via resolveReceiptSigningKey (config wins over
                // RA_RECEIPT_KEY env var).
                receiptSigningKey: state._receiptSigningKey,
                // B1 (Move 1 merge, 2026-08-12): whether .withReasoning() was
                // called explicitly. Used only to decide the provider-fault
                // error contract in run() — see reactive-agent.ts's execute().
                enableReasoning: state._enableReasoning,
            },
        })
    }) as Effect.Effect<ReactiveAgent<TOut>, Error>
}
