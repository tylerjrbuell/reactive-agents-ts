/**
 * `build()` body — `ReactiveAgentBuilder.build()` moved out of `builder.ts`
 * (2026-10-20 builder decomp, GH #218 / HS-248).
 *
 * The class method is a thin delegate that constructs the
 * {@link BuildAgentDeps} object per call (so mutable class state is always
 * read live) and forwards here. No logic changed — the body was moved
 * verbatim with `this` renamed to `state` (the `asBuilderState` private-field
 * view from `builder/withers/_state.ts`).
 */

import { Effect } from 'effect'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { wireRiHooks } from '../ri-wiring.js'
import { autoShadowRequested, probeAutoShadow } from '../../judgment-autoshadow.js'
import { unwrapError } from '../../errors.js'
import { emitBuilderNotice } from '../builder-notice.js'
import type { ReactiveAgent } from '../../reactive-agent.js'
import type { MCPServerConfig } from '../../runtime.js'
import type { BuilderState } from '../withers/_state.js'

/**
 * Explicit dependency surface for {@link buildAgent} — the live mutable
 * builder state plus the builder's own `buildEffect()` (invoked fresh at the
 * same position in the orchestrating body).
 */
export interface BuildAgentDeps<TOut> {
    /** Live mutable builder state (`asBuilderState` view); mutated in place. */
    readonly state: BuilderState
    /** The builder's `buildEffect()` — re-entrant so the delegate's closure governs. */
    readonly buildEffect: () => Effect.Effect<ReactiveAgent<TOut>, Error>
}

/**
 * Orchestrate a synchronous builder `build()` — validate configuration,
 * mutate the build-time state folds (auto-shadow, gateway approval merge,
 * MCP toolkit resolution, capability prime, context profile resolve), then
 * run the builder's `buildEffect()` Effect.
 */
export const buildAgent = async <TOut>(
    deps: BuildAgentDeps<TOut>,
): Promise<ReactiveAgent<TOut>> => {
    const state = deps.state
        // Wave 7.1 auto-shadow, OPT-IN since 2026-11-18: only with
        // `.withJudgment({ shadow: true })` or REACTIVE_AGENTS_AUTO_SHADOW=1
        // (REACTIVE_AGENTS_NO_AUTO_SHADOW=1 and `.withJudgment(false)` win).
        // Default builds make no Ollama call here. When asked, probe a LOCAL
        // Ollama for the shadow model: shadow events fire, decisions are
        // never consumed. Keyless-safe: unreachable server, model not
        // installed, or any error = no service, build proceeds unchanged.
        // Explicit `.withJudgment()` always wins (it sets _enableJudgment).
        if (!state._enableJudgment && autoShadowRequested(state._autoShadow)) {
            const auto = await probeAutoShadow({
                model: state._judgmentOptions?.model,
                baseUrl: state._judgmentOptions?.baseUrl,
            })
            if (auto !== undefined) {
                state._enableJudgment = true
                state._judgmentOptions = {
                    ...state._judgmentOptions,
                    backend: auto.backend,
                    baseUrl: auto.baseUrl,
                    model: auto.model,
                }
                state._judgmentShadowDbPath =
                    process.env.REACTIVE_AGENTS_SHADOW_DB ??
                    join(homedir(), ".reactive-agents", "judgment-shadow.db")
            }
        }
        // Wave 6.1: gateway-declared approvals join the kernel approval
        // policy HERE (not in withGateway/withApprovalPolicy) so the merge is
        // order-independent — whichever wither runs last must not silently
        // drop a safety list. Gateway only ADDS tools (union); an explicit
        // policy keeps its mode/decider, and gateway-only runs get block mode
        // via the existing default below. Before this the gateway
        // `policies.requireApprovalFor` field had zero consumers.
        const gatewayGated = state._gatewayOptions?.policies?.requireApprovalFor ?? []
        if (gatewayGated.length > 0) {
            const prior = state._approvalPolicy?.tools ?? []
            state._approvalPolicy = {
                ...state._approvalPolicy,
                tools: [...new Set([...prior, ...gatewayGated])],
            }
        }
        // `mode: 'detach'` no longer needs a durable store: without one the run
        // waits live, in process, for approveRun/denyRun (engine/human-gate.ts);
        // with one it pauses durably and resumes from any process.

        // `.withUserInteraction()` no longer needs a durable store either:
        // without one a request_user_input question waits live on the same
        // human gate (run-envelope-config.ts `askWaitsLive`).

        // Durable checkpoint hardening (Arc 1 Task 4): `.withDurableRuns()`
        // writes a run row unconditionally, but per-iteration checkpointing
        // only fires through the kernel path — installDurableCheckpointing's
        // onCheckpoint seam is wired by the reasoning kernel, so without
        // `.withReasoning()` the run row exists but is never checkpointed and
        // crash-resume silently can't rehydrate. Warn once, don't throw: the
        // run row + approval rails still work without the kernel path.
        // Category-A sync fallback (see packages/core/src/errors/index.ts): sync build() config validation, no hydrated Effect runtime yet.
        if (state._durableRuns && !state._enableReasoning) {
            console.warn(
                "[reactive-agents] .withDurableRuns() is configured but the run will NOT checkpoint: " +
                "crash-resume checkpoints require the kernel path — add .withReasoning(). " +
                "(The run row and approval rails still work.)",
            )
        }

        // Implicit-test-provider warning lives in `warnIfImplicitTestProvider()`,
        // invoked from `buildEffect()`'s Effect.gen. `build()` is covered
        // transitively: it runs this very effect at
        // `Effect.runPromise(deps.buildEffect())` below, so a single call site
        // keeps the "exactly once per build" guarantee on both public terminals
        // (class JSDoc advertises `.build()` AND `.buildEffect()`).

        // MCP toolkit resolution (2026-09-19): resolve any pending
        // `.withMCP(catalogName)` requests via their registry BEFORE anything
        // else reads `_mcpServers` below (e.g. the task-contract
        // `hasMcpServers` check just past the capability-prime block). Plain
        // `await` here, matching this method's existing style (see the
        // dynamic imports throughout `build()`) — NOT routed through
        // `buildEffect()`'s Effect.gen, so a registry rejection
        // (`MCPApprovalRequiredError`, `MCPMissingEnvVarError`, etc.)
        // propagates out of this `await` untransformed instead of being
        // flattened by `unwrapError()` at the
        // `Effect.runPromise(deps.buildEffect())` boundary further down.
        if (state._mcpToolkitRequests.length > 0) {
            const { defaultRegistries } = await import('@reactive-agents/tools')
            const pending = state._mcpToolkitRequests
            state._mcpToolkitRequests = []
            const resolved = await Promise.all(
                pending.map((request) =>
                    defaultRegistries[request.registry ?? 'docker-hub'].resolve(request)
                )
            )
            state._mcpServers.push(...(resolved as MCPServerConfig[]))
            state._enableTools = true
        }

        // Eager capability prime — run the provider's live discovery probe
        // (Ollama /api/show) and write through to the process-wide registry
        // BEFORE we resolve the context profile below AND before validateBuild's
        // synchronous PreFlight resolve. Ordering is load-bearing: the context
        // profile (tier + window/maxTokens) is frozen HERE from the resolved
        // capability, and the wire `num_ctx` resolves later at call time from the
        // SAME registry. If prime ran AFTER the profile resolve, the profile
        // froze to the 2048-ctx `source: "fallback"` while the wire got the real
        // probed window (e.g. gemma4 32768) — a 16× budget/wire divergence that
        // starved every tool-result compression budget (live-confirmed 2026-07-30:
        // a 25-KB result from the since-removed gh-cli tool crushed to ~1.2 KB → model fabricated the tail).
        // Best-effort: never throws, no-op for providers without a probe.
        const { primeCapability, registerUserSuppliedCapability } = await import(
            '@reactive-agents/llm-provider'
        )
        await primeCapability(state._provider, state._model, {
            endpoint: state._providerConfig?.baseUrl,
            apiKey: state._providerConfig?.apiKey,
        })
        // Developer-declared window via `.withModel({ numCtx })` wins over the
        // probe/table AND must reach the profile too — so it has to register
        // BEFORE the profile resolve below (one knob moves both budget + wire).
        // Also the escape hatch when the probe is unavailable (air-gapped,
        // proxied gateway): otherwise validateBuild fails on a `source:
        // "fallback"` capability and tells the user to patch STATIC_CAPABILITIES
        // for a fact they just supplied. No-op when the probe or table won.
        if (state._numCtx !== undefined && state._model !== undefined) {
            registerUserSuppliedCapability(state._provider, state._model, state._numCtx)
        }

        // Auto-resolve context profile from model name if not explicitly set.
        // resolveProfileWithWindow binds maxTokens to the MODEL's real window
        // (recommendedNumCtx — now probe/numCtx-aware thanks to the prime above)
        // instead of the tier placeholder — otherwise the placeholder (e.g.
        // mid=32768) masqueraded as a caller-set cap and the runner's
        // applyCapabilityMaxTokens skipped resolution, so builder agents ran at
        // 32768 instead of e.g. haiku's 200k (createRuntime resolved fine → a
        // same-model asymmetry between the two construction paths).
        if (!state._contextProfile && state._model) {
            const { resolveProfileWithWindow } = await import(
                '@reactive-agents/reasoning'
            )
            state._contextProfile = resolveProfileWithWindow(
                state._model,
                state._provider
            )
        }

        // Build-time validation
        const {
            validateBuild,
            validateProviderConnection,
            logBuildInfo,
            BuildValidationError,
        } = await import('../../build-validation.js')
        let defaultModel = 'unknown'
        try {
            const { getProviderDefaultModel } = await import(
                '@reactive-agents/llm-provider'
            )
            defaultModel = getProviderDefaultModel(state._provider) ?? 'unknown'
        } catch {
            // ignore — provider defaults unavailable
        }
        // The built-in selection over builtins / allowedTools / requiredTools
        // (contract-required included, as registration uses). Removed CLI
        // names gh-cli / git-cli select a scoped shell-execute; workspace /
        // gws-cli select nothing. Each removed name adds a deprecation.
        const { builtinSelectionFor, builtinDeprecationWarnings, ownToolNames } = await import('../builtins-option.js')
        const { computeExposedToolNames, mergeContractRequiredTools, resolveContractToolNames } =
            await import('../contract-tool-set.js')
        const ownNames = ownToolNames(state._toolsOptions, state._agentTools.map((t) => t.name))
        const toolSelection = builtinSelectionFor(
            state._toolsOptions,
            mergeContractRequiredTools(state._requiredToolsConfig, state._taskContract)?.tools,
            ownNames
        )
        let taskContractInput:
            | import('../../build-validation.js').TaskContractValidationInput
            | undefined
        if (state._taskContract) {
            // Contract tool names resolve like requiredTools: `gh-cli` means the
            // scoped shell-execute the build registers for it.
            const exposed = computeExposedToolNames(state._toolsOptions, state._requiredToolsConfig?.tools)
            if (toolSelection.shellPrograms.length > 0 && !exposed.includes('shell-execute')) {
                exposed.push('shell-execute')
            }
            taskContractInput = {
                contract: resolveContractToolNames(state._taskContract, ownNames),
                exposedToolNames: exposed,
                hasMcpServers: state._mcpServers.length > 0,
            }
        }
        const validation = validateBuild(
            state._provider,
            state._model,
            defaultModel,
            state._strictValidation,
            state._lazyValidation,
            taskContractInput,
            state._providerConfig?.apiKey
        )
        // Each requested removed CLI name is a build warning, never an error.
        validation.warnings.push(...builtinDeprecationWarnings(toolSelection))
        // `.withTools({ riskLevels })` names that match no tool: warn, never throw.
        if (state._toolsOptions?.riskLevels) {
            const { unknownRiskLevelToolNames, riskLevelOverrideWarning } =
                await import('../../tool-risk-levels.js')
            const riskWarning = riskLevelOverrideWarning(
                unknownRiskLevelToolNames({
                    riskLevels: state._toolsOptions.riskLevels,
                    customToolNames: (state._toolsOptions.tools ?? []).map(
                        (t) => t.definition.name
                    ),
                    agentToolNames: state._agentTools.map((t) => t.name),
                    terminal:
                        Boolean(state._toolsOptions.terminal) ||
                        toolSelection.shellPrograms.length > 0,
                }),
                state._mcpServers.length > 0
            )
            if (riskWarning !== undefined) validation.warnings.push(riskWarning)
        }
        for (const warning of validation.warnings) emitBuilderNotice(warning)
        // A tools-enabled agent with zero capability tools: one notice naming
        // the fix (spec §12.8 Q1). Same channel as the withMetaTools notice.
        if (state._enableTools) {
            const { noCapabilityToolsNotice } = await import('../contract-tool-set.js')
            const notice = noCapabilityToolsNotice({
                toolsOptions: state._toolsOptions,
                requiredTools: state._requiredToolsConfig?.tools,
                hasMcpServers: state._mcpServers.length > 0,
                hasAgentTools: state._agentTools.length > 0 || state._allowDynamicSubAgents,
                hasDocuments: state._documents.length > 0,
            })
            if (notice !== undefined) emitBuilderNotice(notice)
        }
        if (validation.errors.length > 0) {
            throw new BuildValidationError(validation.errors)
        }

        // Pre-flight connection check for local providers
        const conn = await validateProviderConnection(state._provider, state._providerConfig?.baseUrl, state._providerConfig?.apiKey)
        if (!conn.ok) {
            throw new Error(`Provider connection failed: ${conn.error}`)
        }

        // Verbosity counts only when observability is on: the same rule the
        // runtime applies when it builds the ObservabilityService.
        logBuildInfo(state._provider, validation.resolvedModel, state._providerConfig?.apiKey, {
            verbosity: state._enableObservability ? state._observabilityOptions.verbosity : undefined,
        })

        const agent = await Effect.runPromise(deps.buildEffect()).catch((e) => {
            throw unwrapError(e)
        })

        // RI hook subscription — extracted to ./builder/ri-wiring.ts (W25-C step 1)
        if (state._riHooks) {
            await wireRiHooks(agent, state._riHooks)
        }

        return agent
    }

