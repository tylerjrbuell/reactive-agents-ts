import { Layer, Effect, Ref } from "effect";
import { observabilityEngineFields } from "./observability-engine-fields.js";
import { contextProfileEngineField } from "./context-profile-engine-field.js";
import { applyRetryToLlmService } from "./llm-retry.js";
import { buildToolsLayer } from "./runtime-tools-layer.js";
import { buildEffectiveLlmLayer } from "./runtime-llm-fallback.js";
import { buildMemoryLayer } from "./runtime-memory-layer.js";
import { buildLoggerTapLayer } from "./runtime-logger-tap-layer.js";
import { buildGatewayLayer } from "./runtime-gateway-layer.js";
import { LifecycleHookRegistryLive } from "./hooks.js";
import { ExecutionEngineLive } from "./execution-engine.js";
import { CapabilityRegistryLive } from "./capabilities/registry.js";
import type { ReactiveAgentsConfig } from "./types.js";
import { defaultReactiveAgentsConfig } from "./types.js";
import { CoreServicesLive, EventBusLive, EventBus } from "@reactive-agents/core";
import {
  createLLMProviderLayer,
  getProviderDefaultModel,
  LLMService,
  makeRateLimitedProvider,
} from "@reactive-agents/llm-provider";
import type { TestTurn } from "@reactive-agents/llm-provider";
import { createMemoryLayer, ExperienceStoreLive, MemoryConsolidatorServiceLive, SessionStoreLive, SkillStoreServiceLive } from "@reactive-agents/memory";
import type { MemoryLLM } from "@reactive-agents/memory";
import { withMemoryGuardrails } from "./memory-guardrails.js";

// Optional package imports
import { createGuardrailsLayer } from "@reactive-agents/guardrails";
import { JudgmentService } from "@reactive-agents/judgment";
import { buildJudgmentLayer } from "./judgment-layer.js";
import {
  createVerificationLayer,
  createVerificationLayerWithRuntimeLlm,
} from "@reactive-agents/verification";
import { createCostLayer } from "@reactive-agents/cost";
import {
  createReasoningLayer,
  defaultReasoningConfig,
  makeObservableLLM,
} from "@reactive-agents/reasoning";
import type { ReasoningConfig, KernelMetaToolsConfig } from "@reactive-agents/reasoning";
import { ToolResultCacheLive, ToolService, builtinTools } from "@reactive-agents/tools";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import { foldApprovalRequiredTools } from "./builder/build-effect/approval-autofeed.js";
import type { ObservabilityOptions } from "./builder.js";
import type { ReasoningOptions } from "./types.js";
import { withoutStrategyIcsOverrides } from "./synthesis-resolve.js";
import type { TelemetryConfig } from "@reactive-agents/observability";
import type { ContextProfile } from "@reactive-agents/reasoning";

/**
 * Move 1 (single agent loop): the reasoning config for a BARE builder — one
 * that never called `.withReasoning()`. The ReasoningService is now ALWAYS
 * provided so the kernel arm is the only agent loop (the inline arm is gone);
 * a bare builder therefore routes through `reactive` (multi-turn), which is the
 * config `.withReasoning()` already defaults to. `maxIterations` is threaded so
 * the default matches the old inline loop's `maxIterations ?? 10` seam.
 * `defaultStrategy` is pinned explicitly (not inherited) so a future change to
 * `defaultReasoningConfig` cannot silently switch the default path's strategy.
 */
const bareReasoningConfig = (maxIterations: number | undefined, explicit: boolean): ReasoningConfig => ({
  ...defaultReasoningConfig,
  defaultStrategy: "reactive",
  strategies: {
    ...defaultReasoningConfig.strategies,
    reactive: {
      ...defaultReasoningConfig.strategies.reactive,
      ...(maxIterations !== undefined ? { maxIterations } : {}),
      ...(explicit ? { maxIterationsExplicit: true } : {}),
    },
  },
});
/**
 * Derive the ReasoningConfig for a runtime from resolved options.
 *
 * The single builder→strategy seam for the iteration cap (2026-10-23
 * explicit-cap fix): a `maxIterations` arriving via the builder's
 * `_maxIterations` (`.withMaxIterations()` / `.withReasoning({ maxIterations })`)
 * or declared directly in `strategies.reactive.maxIterations` is stamped with
 * `maxIterationsExplicit: true`, so `resolveMaxIterationCap` in
 * `@reactive-agents/reasoning` resolves it ABOVE the tier context-profile hint
 * instead of min()-clamping an explicit 10/12/20 down to the local-tier 8
 * (evidence: wiki/Research/Harness-Reports/introspective-2026-10-24-02-*).
 *
 * Behavioral-contract interplay: `.withBehavioralContracts({ maxIterations })`
 * is ALSO a user-declared cap that must only ever TIGHTEN (the
 * behavioral-contract-bridge invariant — a contract tighter than
 * `.withMaxIterations()` still wins). The bridge weaves it into the per-run
 * `contextProfile.maxIterations` slot, the SAME slot the tier hint rides — so
 * the contract is folded HERE into the explicit channel
 * (`min(face, contract)`, face = builder cap ?? strategies-level cap ??
 * resolved tier hint ?? default 10) before stamping `maxIterationsExplicit`.
 * The fold keeps the contract binding even though an explicit cap otherwise
 * outranks the profile slot inside the strategy.
 *
 * Exported so the wiring has a direct test seam — both `createRuntime` and
 * `createLightRuntime` route through this one derivation.
 */
export const resolveReasoningConfig = (options: {
  readonly enableReasoning?: boolean | undefined;
  readonly reasoningOptions?: ReasoningOptions | undefined;
  readonly maxIterations?: number | undefined;
  readonly behavioralContract?: { readonly maxIterations?: number } | undefined;
  readonly contextProfile?: { readonly maxIterations?: number } | undefined;
}): ReasoningConfig => {
  const builderCap = options.maxIterations;
  const strategiesCap = options.reasoningOptions?.strategies?.reactive?.maxIterations;
  const contractCap = options.behavioralContract?.maxIterations;
  const tierHint = options.contextProfile?.maxIterations;

  // Explicitness: only a user-declared cap (builder, strategies-level, or
  // behavioral contract) counts as explicit. The tier hint (contextProfile)
  // is the thing that should CLAMP an explicit cap — never stamp it explicit,
  // otherwise the tier value (e.g. 1 for mid) would always win outright.
  const hasExplicitCap =
    builderCap !== undefined ||
    strategiesCap !== undefined ||
    (contractCap !== undefined && Number.isFinite(contractCap) && contractCap > 0);

  const face = builderCap ?? strategiesCap ?? tierHint ?? 10;
  const contractValid = contractCap !== undefined && Number.isFinite(contractCap) && contractCap > 0;
  const maxIterations = contractValid ? Math.min(face, contractCap as number) : face;
  const explicit = hasExplicitCap || contractValid;

  return !options.enableReasoning
    ? bareReasoningConfig(maxIterations, explicit)
    : options.reasoningOptions
    ? {
        ...defaultReasoningConfig,
        ...(options.reasoningOptions.defaultStrategy
          ? { defaultStrategy: options.reasoningOptions.defaultStrategy }
          : {}),
        adaptive: {
          ...defaultReasoningConfig.adaptive,
          ...(options.reasoningOptions.adaptive ?? {}),
        },
        strategies: {
          reactive: {
            ...defaultReasoningConfig.strategies.reactive,
            ...withoutStrategyIcsOverrides(options.reasoningOptions.strategies?.reactive),
            ...(maxIterations !== undefined ? { maxIterations } : {}),
            ...(explicit ? { maxIterationsExplicit: true } : {}),
            ...(options.reasoningOptions.parallelToolCalls === false
              ? { nextMovesPlanning: { ...defaultReasoningConfig.strategies.reactive.nextMovesPlanning, enabled: false } }
              : {}),
          },
          planExecute: {
            ...defaultReasoningConfig.strategies.planExecute,
            ...withoutStrategyIcsOverrides(options.reasoningOptions.strategies?.planExecute),
          },
          treeOfThought: {
            ...defaultReasoningConfig.strategies.treeOfThought,
            ...withoutStrategyIcsOverrides(options.reasoningOptions.strategies?.treeOfThought),
          },
          reflexion: {
            ...defaultReasoningConfig.strategies.reflexion,
            ...withoutStrategyIcsOverrides(options.reasoningOptions.strategies?.reflexion),
          },
        },
      }
    : defaultReasoningConfig;
};

import {
  createObservabilityLayer,
  MetricsCollectorLive,
  TelemetryCollectorLive,
  ChildDashboardRegistry,
  makeChildDashboardRegistry,
  type ExporterConfig,
} from "@reactive-agents/observability";
import { createPromptLayer } from "@reactive-agents/prompts";
import {
  createReactiveIntelligenceLayer,
  makeSkillResolverService,
  type SkillLayerConfig,
} from "@reactive-agents/reactive-intelligence";

// ─── Composable Layer Helper (HS-03 / GH #69) ───

/**
 * `Layer.merge` chains produce nested `Layer.Layer<Out1|Out2, Err1|Err2, In1|In2>`
 * union types. After ~15 conditional optional layers the union explodes and
 * TS either bails on inference ("type instantiation excessively deep") or
 * stamps out a >10KB type display that slows the editor to a crawl.
 *
 * The pre-existing workaround was `Layer.merge(runtime, X) as any` at every
 * site (~33 across `createRuntime` + `createLightRuntime`; the historical
 * count included the now-deleted `A2aExtraLayer` — see `ReactiveAgent
 * .serveA2A()` for where A2A serving lives now).
 * `as any` is dishonest — every consumer downstream had to re-narrow.
 *
 * `ComposableLayer` is the single erasure boundary: `unknown` instead of
 * `any` so the type system still enforces an explicit `Effect.provide(...)`
 * or `ManagedRuntime.make(...)` to materialise a concrete service. The
 * runtime is dynamically composed (~25 optional layers); the union it
 * produces is meaningful only at the `ManagedRuntime.make()` boundary that
 * comes from {@link BuildBaseRuntimeResult} in
 * `builder/build-effect/runtime-construction.ts:180`. Both boundaries
 * agreed on this widening in W25 — `unknown` here keeps them in lockstep.
 */
// RIn is `never`: a fully-composed runtime layer is self-contained — every
// optional sub-layer provides its own deps before reaching the terminal
// `Layer.mergeAll(...)`. The erasure is on the OUTPUT (ROut) + error (E)
// channels only, where the ~25-layer union explodes. Keeping RIn=`never`
// lets consumers `Effect.provide(runtime)` and `runPromise` without the
// requirements channel widening to `unknown` (which would make every
// downstream `runPromise` un-typecheckable). See runtime/tests/*.
type ComposableLayer = Layer.Layer<unknown, unknown, never>;

/**
 * Single widening boundary for runtime composition (WS-5d / §8.1).
 *
 * Effect-TS `Layer` is invariant in its requirements channel, so the fully
 * merged runtime layer cannot be assigned to `ComposableLayer`
 * (`Layer<unknown, unknown, unknown>`) without an explicit widening. This is
 * the ONE place that widening happens — both `createRuntime` and
 * `createLightRuntime` route their terminal `Layer.mergeAll(...)` result
 * through here, so the `as ComposableLayer` assertion lives exactly once.
 * Pinned by `composable-layer-ceiling.test.ts`.
 */
function finalizeComposition<A, E, R>(
  merged: Layer.Layer<A, E, R>,
): ComposableLayer {
  return merged as ComposableLayer;
}

// ─── Runtime Options ───
// Hoisted to ./runtime-types.ts (W26-C redo). Re-exported for backward
// compatibility with builder.ts and external consumers.
export type {
  MCPServerConfig,
  RuntimeOptions,
  LightRuntimeOptions,
} from "./runtime-types.js";
import type { RuntimeOptions, LightRuntimeOptions } from "./runtime-types.js";
import { leanModeVerifier } from "./lean-verifier.js";


/**
 * Create the full Reactive Agents runtime layer.
 *
 * Composes the base layers (Core, LLM Provider, Memory, ExecutionEngine, EventBus, MetricsCollector)
 * and optionally merges additional feature layers (Guardrails, Reasoning, Tools, Observability, etc.)
 * based on the enabled flags in `RuntimeOptions`.
 *
 * This function is called internally by `ReactiveAgentBuilder.buildEffect()` and should not normally
 * be used directly. Use the builder API instead.
 *
 * @param options - Runtime configuration options
 * @returns A composed Effect-TS Layer that provides all configured services
 *
 * @example
 * ```typescript
 * // Low-level usage (normally use builder instead)
 * const layer = createRuntime({
 *   agentId: "my-agent",
 *   provider: "anthropic",
 *   model: "claude-opus-4-8",
 *   enableReasoning: true,
 *   enableTools: true,
 *   enableObservability: true,
 * });
 *
 * const result = await Effect.runPromise(
 *   ExecutionEngine.pipe(Effect.provide(layer))
 * );
 * ```
 *
 * @see ReactiveAgentBuilder
 * @see RuntimeOptions
 */
export const createRuntime = (options: RuntimeOptions) => {
  // Resolve default model: explicit > env var > provider registry fallback
  // Note: empty strings are treated as unset (env vars can be "" after unsetting)
  const resolvedModel =
    options.model ||
    process.env.LLM_DEFAULT_MODEL ||
    (options.provider
      ? getProviderDefaultModel(options.provider)
      : undefined) ||
    "claude-sonnet-4-6";

  const config: ReactiveAgentsConfig = {
    ...defaultReactiveAgentsConfig(options.agentId),
    defaultModel: resolvedModel,
    provider: options.provider,
    // Trust-receipt signing key (Arc 1 Task 9) — reaches the streaming
    // finalization path (execute-stream.ts) via this engine config so
    // StreamCompleted.receipt is signed the same as AgentResult.receipt.
    receiptSigningKey: options.receiptSigningKey,
    thinking: options.thinking,
    thinkingOptions: options.thinkingOptions,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    numCtx: options.numCtx,
    memoryTier: options.memoryTier ?? "1",
    maxIterations: options.maxIterations ?? 10,
    enableGuardrails: options.enableGuardrails ?? false,
    enableVerification: options.enableVerification ?? false,
    verificationOnReject: options.verificationOnReject,
    enableCostTracking: options.enableCostTracking ?? false,
    enableAudit: options.enableAudit ?? false,
    enableKillSwitch: options.enableKillSwitch ?? false,
    enableBehavioralContracts: options.enableBehavioralContracts ?? false,
    enableSelfImprovement: options.enableSelfImprovement ?? false,
    systemPrompt: options.systemPrompt,
    environmentContext: options.environmentContext,
    ...observabilityEngineFields(options.observabilityOptions),
    // W0.5 result→trace linkage: the builder-resolved trace dir (null when
    // tracing disabled) rides to the finalize seam via this engine config.
    traceDir: options.traceDir,
    // numCtx seeds contextProfile.maxTokens / explicitNumCtx (see the helper).
    contextProfile: contextProfileEngineField(options),
    defaultStrategy: options.reasoningOptions?.defaultStrategy,
    resultCompression: options.resultCompression,
    requiredTools: options.requiredTools
      ? {
          tools: options.requiredTools.tools ? [...options.requiredTools.tools] : undefined,
          adaptive: options.requiredTools.adaptive,
          maxRetries: options.requiredTools.maxRetries,
        }
      : undefined,
    // C2: the declared TaskContract → config.taskContract → reasoning-think →
    // strategy → KernelInput.taskContract → compileRunContract.
    taskContract: options.taskContract,
    adaptiveToolFiltering: options.adaptiveToolFiltering,
    allowedTools: options.allowedTools,
    builtins: options.builtins, toolDisclosure: options.toolDisclosure,
    // `.withTools({ maxCallsPerTool })` → reasoning-think → KernelInput.maxCallsPerTool.
    maxCallsPerTool: options.maxCallsPerTool,
    enableMemory: options.enableMemory ?? false,
    enableExperienceLearning: options.enableExperienceLearning,
    enableMemoryConsolidation: options.enableMemoryConsolidation,
    consolidationConfig: options.consolidationConfig,
    executionTimeoutMs: options.executionTimeoutMs,
    retryPolicy: options.retryPolicy,
    minIterations: options.minIterations,
    taskContext: options.taskContext,
    verificationStep: options.verificationStep,
    outputValidator: options.outputValidator,
    outputValidatorOptions: options.outputValidatorOptions,
    customTermination: options.customTermination,
    session: options.sessionPersist
      ? {
          persist: options.sessionPersist,
          maxAgeDays: options.sessionMaxAgeDays,
        }
      : undefined,
    strategySwitching: options.leanHarness || options.reasoningOptions?.enableStrategySwitching !== true
      ? undefined
      : {
          enabled: true,
          maxSwitches: options.reasoningOptions?.maxStrategySwitches,
          fallbackStrategy: options.reasoningOptions?.fallbackStrategy,
        },
    // Issue #128 / North Star v5.0 Pillar 6 — declarative budget caps for
    // the Arbitrator pre-intent guard. Propagated from `.withBudget()`.
    budgetLimits: options.budgetLimits,
    // Opt-in numeric evidence-grounding. Propagated from `.withGrounding()`.
    grounding: options.grounding,
    // Fabrication guard mode. Propagated from `.withFabricationGuard()`.
    fabricationGuard: options.fabricationGuard,
    // Stall/no-progress policy. Propagated from `.withStallPolicy()`.
    stallPolicy: options.stallPolicy,
    // Opt-in long-horizon guard profile. Propagated from `.withLongHorizon()`.
    horizonProfile: options.horizonProfile,
    checklistGuidance: options.checklistGuidance,
    // Opt-in adaptive harness / policy compiler. Propagated from `.withAdaptiveHarness()`.
    adaptiveHarness: options.adaptiveHarness,
    // Opt-in cost-aware model routing. Propagated from `.withModelRouting()`.
    modelRouting: options.modelRouting,
    // Opt-in durable run persistence. Propagated from `.withDurableRuns()`.
    durableRuns: options.durableRuns,
    // Opt-in durable HITL approval policy. Propagated from `.withApprovalPolicy()`.
    approvalPolicy: options.approvalPolicy,
    verifier: options.leanHarness ? leanModeVerifier : undefined,
    harnessPipeline: options.harnessPipeline,
    enableReactiveIntelligence: options.enableReactiveIntelligence,
    reactiveIntelligenceOptions: options.reactiveIntelligenceOptions,
    reasoningOptions: options.reasoningOptions,
    metaTools: options.metaTools,
    calibration: options.calibration,
  };

  // ── Required layers ──
  // EventBusLive and MetricsCollectorLive are exposed separately so optional layers that need them can be provided
  // This ensures they're singletons shared across all services (ExecutionEngine, ObservabilityService, etc.)
  const eventBusLayer = EventBusLive;
  // Provide EventBusLive to MetricsCollectorLive so it can subscribe to ToolCallCompleted events
  // IMPORTANT: MetricsCollectorLive must have EventBus available when it initializes
  const metricsCollectorLayer = MetricsCollectorLive.pipe(
    Layer.provide(eventBusLayer),
  );
  const coreLayer = CoreServicesLive;
  const llmLayer = createLLMProviderLayer(
    options.provider ?? "test",
    options.testScenario,
    resolvedModel,
    {
      thinking: options.thinking,
      thinkingOptions: options.thinkingOptions,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      numCtx: options.numCtx,
      ollamaTimeoutMs: options.ollamaTimeoutMs,
      baseUrl: options.providerConfig?.baseUrl,
      apiKey: options.providerConfig?.apiKey,
      headers: options.providerConfig?.headers,
    },
    options.circuitBreakerConfig,
    options.pricingRegistry,
  );

  // Build effectiveLlmLayer: if fallbackConfig has additional providers, wrap
  // the primary layer with Effect.catchAll chains so failures cascade through
  // fallback providers automatically.
  const effectiveLlmLayer: Layer.Layer<LLMService> = buildEffectiveLlmLayer(
    options,
    llmLayer as Layer.Layer<LLMService>,
  );

  // Apply retry policy: wrap complete() / stream() / completeStructured() with
  // Effect.retry so transient LLM failures (rate limits, network errors) back
  // off and retry. Wrapping ALL three matters — the reactive kernel runs through
  // stream(), so a complete()-only wrap left withRetryPolicy dead for the main
  // path (see applyRetryToLlmService).
  // Replay keystone: when an override layer is supplied, it BECOMES the base
  // LLMService for the whole stack (reasoning/engine/memory all build on
  // `observableLlmLayer` below, which wraps this). Swapped here — upstream of
  // every `Layer.provide(observableLlmLayer)` consumer — because those capture
  // LLMService at construction, so the terminal `extraLayers` merge can never
  // reach it. Retry/rate-limit still wrap it (no-ops for a replay layer);
  // the observable wrap is desired (the replayed run emits its own trace).
  const baseLlmLayer: Layer.Layer<LLMService> =
    options.llmOverrideLayer ?? effectiveLlmLayer;

  const finalLlmLayer: Layer.Layer<LLMService> =
    options.retryPolicy
      ? Layer.effect(
          LLMService,
          Effect.gen(function* () {
            const svc = yield* LLMService.pipe(
              Effect.provide(baseLlmLayer as Layer.Layer<LLMService, never, never>),
            );
            return applyRetryToLlmService(svc, options.retryPolicy!);
          }),
        )
      : baseLlmLayer;

  // Apply rate limiting: wrap LLM calls with a sliding-window rate limiter
  // so requests are throttled BEFORE hitting the API (prevents 429 errors).
  // Rate limiting is applied after retry policy so retried requests also
  // respect the rate limit.
  const rateLimitedLlmLayer: Layer.Layer<LLMService> =
    options.rateLimiterConfig
      ? makeRateLimitedProvider(options.rateLimiterConfig).pipe(
          Layer.provide(finalLlmLayer as Layer.Layer<LLMService, never, never>),
        ) as Layer.Layer<LLMService>
      : finalLlmLayer;

  // Observable wrapper (Task 7) — emits `LLMExchangeEmitted` events on every
  // complete/completeStructured call so observers (reasoning-stream-logger
  // with logModelIO, trace layer, diagnose CLI) can see direct LLM calls
  // outside the kernel main loop (plan-execute analysis, reflexion, ToT
  // BFS, etc.). Always wrap — events are silent unless someone subscribes.
  const observableLlmLayer: Layer.Layer<LLMService> = makeObservableLLM().pipe(
    Layer.provide(rateLimitedLlmLayer as Layer.Layer<LLMService, never, never>),
  ) as Layer.Layer<LLMService>;

  // Whether ANY configured feature needs the memory stack in the ambient
  // runtime. `.session({persist})` and skill persistence are gated on
  // enableMemory already; experience/consolidation carry their own flags.
  const memoryStackNeeded =
    (options.enableMemory ?? false) ||
    (options.enableExperienceLearning ?? false) ||
    (options.enableMemoryConsolidation ?? false);

  // Bridge LLMService.embed into MemoryLLM so semantic memory auto-generates embeddings
  const memoryLayer = buildMemoryLayer(options, config, observableLlmLayer, eventBusLayer);
  const hookLayer = LifecycleHookRegistryLive;
  const engineLayer = ExecutionEngineLive(config).pipe(
    Layer.provide(hookLayer),
    Layer.provide(metricsCollectorLayer), // Now has EventBusLive already provided
  );

  // ── Canonical composition (WS-2 RC-1) ──
  // Build every optional layer into a local variable defaulting to `Layer.empty`
  // when the feature is disabled. Final composition is a single declarative
  // `Layer.mergeAll(...)` call mirroring the shape used by `createLightRuntime`
  // (see this file ~1180). The single terminal erasure cast is the only
  // boundary widening — no mid-chain mutations, no per-layer casts.

  // ── Guardrails ──
  const guardrailsOptLayer = options.enableGuardrails
    ? (() => {
        const gc = options.guardrailsOptions;
        const guardrailConfig = gc
          ? {
              enableInjectionDetection: gc.injection ?? true,
              enablePiiDetection: gc.pii ?? true,
              enableToxicityDetection: gc.toxicity ?? true,
              ...(gc.customBlocklist
                ? { customBlocklist: [...gc.customBlocklist] }
                : {}),
              ...(gc.enableJudgmentBattery !== undefined
                ? { enableJudgmentBattery: gc.enableJudgmentBattery }
                : {}),
              ...(gc.judgmentStrictness ? { judgmentStrictness: gc.judgmentStrictness } : {}),
              ...(gc.judgmentActionThreshold !== undefined
                ? { judgmentActionThreshold: gc.judgmentActionThreshold }
                : {}),
              ...(gc.judgmentReviewThreshold !== undefined
                ? { judgmentReviewThreshold: gc.judgmentReviewThreshold }
                : {}),
              ...(gc.screenOutputs !== undefined ? { screenOutputs: gc.screenOutputs } : {}),
            }
          : undefined;
        return createGuardrailsLayer(guardrailConfig);
      })()
    : Layer.empty;

  // ── KillSwitch ──
  // Provide eventBusLayer so KillSwitchService captures the same EventBus instance
  // during its layer build (for AgentPaused/AgentResumed event emission).
  // Also auto-provided when a behavioral contract declares `maxToolCalls` —
  // that dimension has no kernel-native equivalent and is enforced by
  // triggering the kill switch from an EventBus subscriber (see
  // engine/phases/agent-loop/behavioral-contract-bridge.ts). Without this,
  // `.withBehavioralContracts({ maxToolCalls })` alone (no `.withKillSwitch()`)
  // would silently never enforce the cap — the service simply wouldn't exist
  // in the DI graph for execution-engine.ts to acquire.
  const killSwitchOptLayer = options.enableKillSwitch || (options.enableBehavioralContracts && options.behavioralContract?.maxToolCalls != null)
    ? (() => {
        const { KillSwitchServiceLive } =
          require("@reactive-agents/guardrails") as typeof import("@reactive-agents/guardrails");
        return KillSwitchServiceLive().pipe(Layer.provide(eventBusLayer));
      })()
    : Layer.empty;

  // ── Behavioral contracts ──
  const behavioralContractsOptLayer =
    options.enableBehavioralContracts && options.behavioralContract
      ? (() => {
          const { BehavioralContractServiceLive } =
            require("@reactive-agents/guardrails") as typeof import("@reactive-agents/guardrails");
          return BehavioralContractServiceLive(options.behavioralContract);
        })()
      : Layer.empty;

  // ── Verification ──
  const verificationOptLayer = options.enableVerification
    ? (() => {
        const vc = options.verificationOptions;
        const verificationConfig = {
          enableSemanticEntropy: vc?.semanticEntropy ?? true,
          enableFactDecomposition: vc?.factDecomposition ?? true,
          enableMultiSource: vc?.multiSource ?? false,
          enableSelfConsistency: vc?.selfConsistency ?? true,
          enableNli: vc?.nli ?? true,
          enableHallucinationDetection: vc?.hallucinationDetection,
          hallucinationThreshold: vc?.hallucinationThreshold,
          passThreshold: vc?.passThreshold ?? 0.7,
          riskThreshold: vc?.riskThreshold ?? 0.5,
          useLLMTier: vc?.useLLMTier !== false,
        };
        return verificationConfig.useLLMTier === true
          ? createVerificationLayerWithRuntimeLlm(verificationConfig).pipe(
              // Same pattern as memoryLayer: satisfy LLM here so merge order does not
              // leave VerificationService construction without LLMService.
              Layer.provide(observableLlmLayer as Layer.Layer<LLMService>),
            )
          : createVerificationLayer({ ...verificationConfig, useLLMTier: false });
      })()
    : Layer.empty;

  // ── Judgment ──
  // Calibrated typed judgments (Choice/Score/Noul) via `@reactive-agents/judgment`.
  // `jev` backend when a TypeSafe key resolves (explicit `judgmentOptions.apiKey`
  // or `TYPESAFE_API_KEY`), else the `llm` emulation backend over this runtime's
  // own `LLMService`. Absent (`Layer.empty`) when `.withJudgment()` was never
  // called — `JudgmentService` is genuinely not in the runtime's Layer graph in
  // that case, not a dummy/no-op stand-in (Task 8, judgment-layer plan).
  const judgmentOptLayer = options.enableJudgment
    ? buildJudgmentLayer(
        options.judgmentOptions,
        {
          llmLayer: observableLlmLayer as Layer.Layer<LLMService>,
          eventBusLayer,
        },
        options.judgmentShadowDbPath !== undefined
          ? { dbPath: options.judgmentShadowDbPath }
          : undefined,
      )
    : Layer.empty;

  // ── Cost tracking ──
  const costTrackingOptLayer = options.enableCostTracking
    ? createCostLayer(options.costTrackingOptions)
    : Layer.empty;

  // Build tools layer first — reasoning may depend on it.
  // MCP servers implicitly enable tools (gate handled inside the helper).
  // Helper returns `Layer.Layer<ToolService> | null` — no cast here; the
  // ComposableLayer widening happens at the terminal Layer.mergeAll below
  // (WS-5c / §8.1 ceiling pinned by composable-layer-ceiling.test.ts).
  const toolsLayer = buildToolsLayer(options, eventBusLayer);
  const shouldEnableTools = toolsLayer !== null;

  // toolsLayer is included in the terminal Layer.mergeAll below when defined.
  const toolResultCacheOptLayer = shouldEnableTools
    ? ToolResultCacheLive()
    : Layer.empty;

  // ── Experience learning layer (requires MemoryDatabase from memoryLayer) ──
  const experienceLearningOptLayer = options.enableExperienceLearning
    ? ExperienceStoreLive.pipe(Layer.provide(memoryLayer))
    : Layer.empty;

  // ── Memory consolidation layer (requires MemoryDatabase from memoryLayer) ──
  const memoryConsolidationOptLayer = options.enableMemoryConsolidation
    ? MemoryConsolidatorServiceLive(options.consolidationConfig).pipe(
        Layer.provide(memoryLayer),
      )
    : Layer.empty;

  // ── Session persistence layer (requires MemoryDatabase from memoryLayer) ──
  // Policy: wire-when-memory-enabled (mirrors SkillStoreLive). When memory is on,
  // SessionStoreService is available so agent.session({ persist: true }) saves/restores
  // history. Without memory, service is absent and session() silently no-ops via
  // Effect.serviceOption.
  const sessionStoreOptLayer = options.enableMemory
    ? SessionStoreLive.pipe(Layer.provide(memoryLayer))
    : Layer.empty;

  // ── Skill persistence layer (requires MemoryDatabase from memoryLayer) ──
  // Policy: wire-when-memory-enabled. Default-on when memory is enabled — graduates
  // M6 "learning transfers within session but doesn't persist" verdict to KEEP and
  // activates the existing dead write path at
  // `reactive-intelligence/src/learning/learning-engine.ts:170`. Without memory,
  // SkillStoreService is absent and `agent.skills()` returns [] via the existing
  // `Effect.serviceOption` fallback at `reactive-agent.ts:370`.
  const skillStoreOptLayer =
    options.enableMemory && options.skillPersistence !== false
      ? SkillStoreServiceLive.pipe(Layer.provide(memoryLayer))
      : Layer.empty;

  // Create PromptLayer once — shared by reasoning deps and the main runtime
  const promptLayer = options.enablePrompts ? createPromptLayer() : null;

  // ── Reasoning ──
  // Move 1: ALWAYS build the reasoning layer so `reasoningOpt` is always `Some`
  // in the engine — the kernel arm is the sole agent loop. A bare builder gets
  // the `reactive` default (see `bareReasoningConfig`); `.withReasoning()` users
  // get the opt-in config unchanged. `enableReasoning` no longer selects the
  // loop; it only gates reasoning EXTRAS (calibration auto-on, features flag,
  // durable runs) elsewhere.
  const reasoningOptLayer = (() => {
        // Build reasoning config from defaults + user overrides (single
        // derivation shared with createLightRuntime — see resolveReasoningConfig).
        const reasoningConfig: ReasoningConfig = resolveReasoningConfig(options);

        // ReasoningService requires LLMService, optionally ToolService + PromptService.
        // Build deps via small Layer.merge calls (NOT mid-chain runtime mutations —
        // they only assemble the dep stack for a single optional layer).
        const reasoningDepsBase = toolsLayer
          ? Layer.merge(observableLlmLayer, toolsLayer)
          : observableLlmLayer;
        const reasoningDeps = promptLayer
          ? Layer.merge(reasoningDepsBase, promptLayer)
          : reasoningDepsBase;
        return createReasoningLayer(reasoningConfig).pipe(
          Layer.provide(reasoningDeps),
        );
      })();

  // ── Observability ──
  const observabilityOptLayer = options.enableObservability
    ? (() => {
        const obsExporterConfig: ExporterConfig = {
          verbosity: options.observabilityOptions?.verbosity,
          live: options.observabilityOptions?.live,
          file: options.observabilityOptions?.file
            ? { filePath: options.observabilityOptions.file }
            : undefined,
          ...(options.observabilityOptions?.emitConsole === false ? { console: false as const } : {}),
          ...(options.observabilityOptions?.redactors !== undefined
            ? { redactors: options.observabilityOptions.redactors }
            : {}),
          // Without this, every LogEntry.agentId is undefined and
          // getLogs({ agentId }) silently matches nothing.
          ...(options.agentId !== undefined ? { agentId: options.agentId } : {}),
        };
        // Provide the shared metricsCollectorLayer so ObservabilityService uses the same instance
        // as ExecutionEngine, ensuring metrics flow through properly
        return createObservabilityLayer(obsExporterConfig, metricsCollectorLayer);
      })()
    : Layer.empty;

  // ── Child dashboard registry (root-only) ──
  // A run's ROOT is the only place that ever mints a `ChildDashboardRegistry`
  // instance. It is threaded down to every sub-agent's `createLightRuntime`
  // call via `sharedChildDashboardRegistry` (sub-agent-executor.ts), exactly
  // as `EventBus` is shared for audit G1 — so no matter how deep a delegation
  // chain gets, every `record()` call resolves to THIS one instance, and this
  // root's `execution-engine.ts` `drain()` (gated by `!lp`, root-only) sees
  // every descendant's dashboard before its single end-of-run `flush()`.
  const childDashboardRegistryOptLayer = options.enableObservability
    ? Layer.effect(ChildDashboardRegistry, makeChildDashboardRegistry)
    : Layer.empty;

  // ── Telemetry ──
  const telemetryOptLayer = options.telemetryConfig
    ? TelemetryCollectorLive(options.telemetryConfig).pipe(
        Layer.provide(eventBusLayer),
      )
    : Layer.empty;

  // ── Structured logging tap — subscribes to EventBus and writes to configured output ──
  const loggerTapOptLayer = buildLoggerTapLayer(options, eventBusLayer);

  // ── Health check service ──
  const healthOptLayer = options.enableHealthCheck
    ? (() => {
        const { Health, makeHealthService } =
          require("@reactive-agents/health") as typeof import("@reactive-agents/health");
        return Layer.effect(
          Health,
          makeHealthService({ port: 0, agentName: options.agentId }),
        );
      })()
    : Layer.empty;

  // ── Reactive Intelligence (entropy sensing) + optional skill resolver ──
  const skillResolverPaths =
    options.skills?.paths?.filter(
      (p): p is string => typeof p === "string" && p.trim().length > 0,
    ).map((p) => p.trim()) ?? [];
  const skillLayerForRi: SkillLayerConfig | undefined =
    skillResolverPaths.length > 0
      ? {
          resolver: {
            customPaths: skillResolverPaths,
            agentId: options.agentId,
            projectRoot: options.skillDiscoveryRoot ?? process.cwd(),
            ...(options.skills?.activate?.length
              ? { activate: [...options.skills.activate] }
              : {}),
          },
        }
      : undefined;

  const reactiveIntelOptLayer = options.enableReactiveIntelligence
    ? // The RI layer's calibration-update subscriber (wired in
      // `createReactiveIntelligenceLayer`) requires `EventBus`. Per the
      // `Layer.mergeAll` caveat documented below (gateway/extra layers hit
      // the same thing), sibling layers in a single `mergeAll` do NOT
      // auto-wire each other's requirements — provide the runtime's shared
      // `eventBusLayer` explicitly so the subscriber joins the SAME bus
      // instance `reactive-observer.ts` publishes `EntropyScored` to.
      createReactiveIntelligenceLayer(
        options.reactiveIntelligenceOptions,
        undefined,
        skillLayerForRi,
      ).pipe(Layer.provide(eventBusLayer))
    : skillLayerForRi?.resolver
      ? makeSkillResolverService(skillLayerForRi.resolver)
      : Layer.empty;

  // ── Prompts (already constructed above; included only if enabled) ──
  const promptOptLayer = promptLayer ?? Layer.empty;

  // ── Gateway — compose GatewayService + SchedulerService when enabled. ──
  // The persistent event loop itself starts via agent.start(); layer composition just makes
  // the services resolvable from the ManagedRuntime.
  // EventBus is passed to gateway services for observability when available.
  const gatewayOptLayer = buildGatewayLayer(options, eventBusLayer);

  // ── Extra (user-supplied) layers ──
  // WS-4 Phase 3: user-supplied layers (e.g. `OpenInferenceTracerLayer` from
  // `@reactive-agents/observe`) typically subscribe to the framework
  // `EventBus`. `Layer.mergeAll` does NOT auto-wire cross-dependencies, so
  // an extra layer requiring `EventBus` would surface as
  // "Service not found: EventBus" at build time. Provide the framework's
  // EventBus to the extra layer so user code can compose against it the
  // same way internal optional layers do (cf. `gatewayLayer.pipe(...)` above).
  const extraOptLayer =
    options.extraLayers !== undefined
      ? options.extraLayers.pipe(Layer.provide(eventBusLayer))
      : Layer.empty;

  // ── Terminal canonical composition (WS-2 RC-1) ──
  // Single declarative Layer.mergeAll over mandatory + optional layers; the
  // erasure cast lives once in finalizeComposition() (WS-5d / §8.1).
  return finalizeComposition(
    Layer.mergeAll(
      // Mandatory
      coreLayer,
      eventBusLayer,
      observableLlmLayer,
      // Memory is DEFAULT-OFF, but this merge was unconditional — so every
      // run still built the full memory stack, and the memory-flush phase
      // (which gates on serviceOption presence, not on the option) ran a
      // "memory extraction assistant" LLM call per non-trivial run. Wire-
      // captured 2026-07-10: request #7 of a 6-iteration memory-off run was
      // a 2,252-char extraction prompt. Feature-dependent layers below
      // (experience/consolidation/session/skill) provide memoryLayer to
      // THEMSELVES, so they are unaffected by gating the ambient merge.
      memoryStackNeeded ? memoryLayer : Layer.empty,
      hookLayer,
      engineLayer,
      CapabilityRegistryLive, // MOVE-2 M2.1 — default-on capability metadata + audit surface backing
      // Optional (default Layer.empty when feature disabled)
      guardrailsOptLayer,
      killSwitchOptLayer,
      behavioralContractsOptLayer,
      verificationOptLayer,
      judgmentOptLayer,
      costTrackingOptLayer,
      toolsLayer ?? Layer.empty,
      toolResultCacheOptLayer,
      experienceLearningOptLayer,
      memoryConsolidationOptLayer,
      sessionStoreOptLayer,
      skillStoreOptLayer,
      reasoningOptLayer,
      observabilityOptLayer,
      childDashboardRegistryOptLayer,
      telemetryOptLayer,
      loggerTapOptLayer,
      healthOptLayer,
      reactiveIntelOptLayer,
      promptOptLayer,
      gatewayOptLayer,
      extraOptLayer,
    ),
  );
};

/**
 * Create a lightweight runtime for sub-agents and simple use cases.
 *
 * Compared to `createRuntime()`, this skips:
 * - MetricsCollector (auto-subscribed EventBus listener — overhead for short-lived agents)
 * - LifecycleHookRegistry (sub-agents don't fire lifecycle hooks)
 * - Memory system (unless parent explicitly enables it)
 * - All optional layers: Prompts, Gateway, A2A,
 *   Health, ReactiveIntelligence, Telemetry, Logging, KillSwitch, BehavioralContracts
 *
 * The parent can toggle heavier layers (memory, guardrails, observability, cost tracking)
 * for sub-agents that need more capabilities.
 *
 * @param options - Light runtime configuration
 * @returns A composed Effect-TS Layer with minimal services
 */
/**
 * Resolve the model a light runtime uses (explicit → env → provider default →
 * fallback). Shared by `createLightRuntime` and `buildLightRuntimeConfig` so the
 * config helper is pure + independently testable.
 */
export const resolveLightRuntimeModel = (options: LightRuntimeOptions): string =>
  options.model ||
  process.env.LLM_DEFAULT_MODEL ||
  (options.provider ? getProviderDefaultModel(options.provider) : undefined) ||
  "claude-sonnet-4-6";

/**
 * Build the child `ReactiveAgentsConfig` for a light (sub-agent) runtime. PURE —
 * extracted from `createLightRuntime` so the cross-cutting inheritance mapping
 * (taskContract / fabricationGuard / grounding, and the approval block-coercion +
 * autofeed) is unit-testable without materializing layers. See
 * `sub-agent-light-config.test.ts`.
 */
export const buildLightRuntimeConfig = (options: LightRuntimeOptions): ReactiveAgentsConfig => {
  const resolvedModel = resolveLightRuntimeModel(options);
  const config: ReactiveAgentsConfig = {
    ...defaultReactiveAgentsConfig(options.agentId),
    // Sub-agent ids are uniquified (`sub-<name>-<epoch>`); carry the given name
    // through so `AgentStarted.agentDisplayName` renders "researcher", not the id.
    agentDisplayName: options.agentDisplayName,
    defaultModel: resolvedModel,
    provider: options.provider,
    thinking: options.thinking,
    thinkingOptions: options.thinkingOptions,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    numCtx: options.numCtx,
    memoryTier: "1",
    maxIterations: options.maxIterations ?? 4,
    enableGuardrails: options.enableGuardrails ?? false,
    enableVerification: false,
    enableCostTracking: options.enableCostTracking ?? false,
    enableAudit: false,
    enableKillSwitch: false,
    enableBehavioralContracts: false,
    enableSelfImprovement: false,
    systemPrompt: options.systemPrompt,
    environmentContext: options.environmentContext,
    ...observabilityEngineFields(options.observabilityOptions),
    // numCtx seeds contextProfile.maxTokens / explicitNumCtx (see the helper).
    contextProfile: contextProfileEngineField(options),
    defaultStrategy: options.reasoningOptions?.defaultStrategy,
    resultCompression: options.resultCompression,
    requiredTools: options.requiredTools
      ? {
          tools: options.requiredTools.tools ? [...options.requiredTools.tools] : undefined,
          adaptive: options.requiredTools.adaptive,
          maxRetries: options.requiredTools.maxRetries,
        }
      : undefined,
    adaptiveToolFiltering: false,
    allowedTools: options.allowedTools,
    maxCallsPerTool: options.maxCallsPerTool, // parent's caps, or the sub-agent's own merged over them
    enableMemory: options.enableMemory ?? false,
    enableExperienceLearning: false,
    enableMemoryConsolidation: false,
    reasoningOptions: options.reasoningOptions,
    // ── Cross-cutting inheritance (2026-07-23) ──────────────────────────────
    // A sub-agent operates under the parent's judgment + safety constraints.
    // These build the child's own RunEnvelope (via buildRunEnvelopeFromConfig at
    // execution time) exactly as they do for the parent — so a child's answer is
    // judged against the same contract / fabrication guard / grounding.
    taskContract: options.taskContract,
    fabricationGuard: options.fabricationGuard,
    grounding: options.grounding,
    // Approval: COERCE to block. A light runtime has no durable store, so detach
    // (pause + checkpoint) would strand the child. Block decides in process and
    // denies by default — the child gates or refuses a gated tool, never pauses,
    // never executes one unattended. The same F2 autofeed the parent runs folds
    // the child's `requiresApproval` built-ins (shell/docker/code-execute/
    // file-write) into the gated set, so robustness does not depend on the
    // parent having named them.
    approvalPolicy: options.approvalPolicy
      ? {
          mode: "block" as const,
          tools: foldApprovalRequiredTools(
            options.approvalPolicy.tools ?? [],
            builtinTools.map((t) => t.definition),
          ),
          requireFor: options.approvalPolicy.requireFor,
          onApprove: options.approvalPolicy.onApprove,
        }
      : undefined,
  };
  return config;
};

export const createLightRuntime = (options: LightRuntimeOptions) => {
  const resolvedModel = resolveLightRuntimeModel(options);
  const config = buildLightRuntimeConfig(options);

  // ── Minimal required layers ──
  // Audit G1: when the parent threads its EventBus instance, the child's
  // ExecutionEngine joins it (via Layer.succeed) so sub-agent lifecycle events
  // land on the parent's bus and trace bridge. Absent = fresh, isolated bus.
  const eventBusLayer = options.sharedEventBus
    ? Layer.succeed(EventBus, options.sharedEventBus)
    : EventBusLive;
  // Sub-agent-dashboard-rollup analog of eventBusLayer above: when the parent
  // threads its ChildDashboardRegistry down (so THIS child can itself record
  // a grandchild's dashboard into the root's registry), join it via
  // Layer.succeed. Absent = no registry provided — recording degrades to a
  // no-op via Effect.serviceOption at the call site (sub-agent-executor.ts),
  // never a missing-service failure. Light runtimes never mint a FRESH
  // registry of their own — only the root's createRuntime() does that; a
  // child with no shared registry simply has none to record into.
  const childDashboardRegistryLayer = options.sharedChildDashboardRegistry
    ? Layer.succeed(ChildDashboardRegistry, options.sharedChildDashboardRegistry)
    : Layer.empty;
  const coreLayer = CoreServicesLive;
  const llmLayer = createLLMProviderLayer(
    options.provider ?? "test",
    options.testScenario,
    resolvedModel,
    {
      thinking: options.thinking,
      thinkingOptions: options.thinkingOptions,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      numCtx: options.numCtx,
      baseUrl: options.providerConfig?.baseUrl,
      apiKey: options.providerConfig?.apiKey,
      headers: options.providerConfig?.headers,
    }, // observable-wrapped like the root: the child's run meter and LLM events see every call
  ).pipe((p) => makeObservableLLM().pipe(Layer.provide(p as Layer.Layer<LLMService, never, never>))) as Layer.Layer<LLMService>;

  // Lightweight memory — working memory only, no SQLite, no embeddings
  const memoryLayer = options.enableMemory
    ? Layer.unwrapEffect(
        Effect.gen(function* () {
          const llm = yield* LLMService;
          const bridgedLLM: MemoryLLM = {
            complete: (req) =>
              llm.complete({
                messages: req.messages.map((m) => ({
                  role: m.role as "user" | "assistant" | "system",
                  content: m.content,
                })),
                temperature: req.temperature,
                maxTokens: req.maxTokens,
              }).pipe(
                Effect.map((r) => ({
                  content: r.content,
                  usage: r.usage ? { totalTokens: r.usage.totalTokens } : undefined,
                })),
              ),
            embed: (texts, model) => llm.embed(texts, model),
          };
          return withMemoryGuardrails(createMemoryLayer("1", { agentId: options.agentId }, bridgedLLM));
        }),
      ).pipe(Layer.provide(llmLayer))
    : withMemoryGuardrails(createMemoryLayer("1", { agentId: options.agentId }));

  // Minimal hooks layer (required by ExecutionEngine)
  const hookLayer = LifecycleHookRegistryLive;

  // MetricsCollector is still needed by ExecutionEngine but we skip the EventBus subscription
  // by providing it with an isolated EventBus (no listeners accumulating in the parent's bus).
  // NB: this is deliberately a FRESH EventBusLive, not `eventBusLayer` — when the
  // parent shares its bus for G1 observability, the child's metrics must NOT
  // subscribe to parent traffic (which would inflate the child's counters).
  const metricsCollectorLayer = MetricsCollectorLive.pipe(
    Layer.provide(EventBusLive),
  );

  const engineLayer = ExecutionEngineLive(config).pipe(
    Layer.provide(hookLayer),
    Layer.provide(metricsCollectorLayer),
  );

  // ── Optional tools layer ──
  // Light runtime ignores `mcpServers` by passing only the fields it honors
  // (enableTools, allowedTools). Helper returns typed Layer.Layer<ToolService>
  // | null — no cast here; ComposableLayer widening happens at the terminal
  // Layer.mergeAll below (WS-5c / §8.1 ceiling pinned by
  // composable-layer-ceiling.test.ts).
  const toolsLayer = buildToolsLayer(
    { enableTools: options.enableTools, allowedTools: options.allowedTools },
    eventBusLayer,
  );
  const lightToolResultCacheOptLayer = options.enableTools
    ? ToolResultCacheLive()
    : Layer.empty;

  // ── Optional reasoning layer ──
  // Move 1: ALWAYS build (see the main-runtime site above). The light runtime is
  // the sub-agent runtime; sub-agents already force `enableReasoning`, but always
  // building keeps the single-loop invariant true from every door.
  const lightReasoningOptLayer = (() => {
        // Single shared derivation — see resolveReasoningConfig.
        const reasoningConfig: ReasoningConfig = resolveReasoningConfig(options);

        // Tiny dep stack assembly — not a runtime mid-chain mutation.
        const reasoningDeps = toolsLayer
          ? Layer.merge(llmLayer, toolsLayer)
          : llmLayer;
        return createReasoningLayer(reasoningConfig).pipe(
          Layer.provide(reasoningDeps),
        );
      })();

  // ── Optional heavy layers (parent-toggleable) ──
  const lightGuardrailsOptLayer = options.enableGuardrails
    ? (() => {
        const gc = options.guardrailsOptions;
        const guardrailConfig = gc
          ? {
              enableInjectionDetection: gc.injection ?? true,
              enablePiiDetection: gc.pii ?? true,
              enableToxicityDetection: gc.toxicity ?? true,
              ...(gc.customBlocklist
                ? { customBlocklist: [...gc.customBlocklist] }
                : {}),
              ...(gc.enableJudgmentBattery !== undefined
                ? { enableJudgmentBattery: gc.enableJudgmentBattery }
                : {}),
              ...(gc.judgmentStrictness ? { judgmentStrictness: gc.judgmentStrictness } : {}),
              ...(gc.judgmentActionThreshold !== undefined
                ? { judgmentActionThreshold: gc.judgmentActionThreshold }
                : {}),
              ...(gc.judgmentReviewThreshold !== undefined
                ? { judgmentReviewThreshold: gc.judgmentReviewThreshold }
                : {}),
              ...(gc.screenOutputs !== undefined ? { screenOutputs: gc.screenOutputs } : {}),
            }
          : undefined;
        return createGuardrailsLayer(guardrailConfig);
      })()
    : Layer.empty;

  // ── Judgment (mirrors the root runtime's judgmentOptLayer above; the
  // light `llmLayer` is itself observable-wrapped, see its construction) ──
  const lightJudgmentOptLayer = options.enableJudgment
    ? buildJudgmentLayer(
        options.judgmentOptions,
        { llmLayer, eventBusLayer },
        options.judgmentShadowDbPath !== undefined
          ? { dbPath: options.judgmentShadowDbPath }
          : undefined,
      )
    : Layer.empty;

  const lightCostTrackingOptLayer = options.enableCostTracking
    ? createCostLayer()
    : Layer.empty;

  const lightObservabilityOptLayer = options.enableObservability
    ? (() => {
        const obsExporterConfig: ExporterConfig = {
          verbosity: options.observabilityOptions?.verbosity,
          live: options.observabilityOptions?.live,
          ...(options.observabilityOptions?.emitConsole === false ? { console: false as const } : {}),
          ...(options.observabilityOptions?.redactors !== undefined
            ? { redactors: options.observabilityOptions.redactors }
            : {}),
        };
        return createObservabilityLayer(obsExporterConfig, metricsCollectorLayer);
      })()
    : Layer.empty;

  // ── Terminal canonical composition (WS-2 RC-1) ──
  // Erasure cast lives once in finalizeComposition() (WS-5d / §8.1).
  return finalizeComposition(
    Layer.mergeAll(
      // Mandatory
      coreLayer,
      eventBusLayer,
      childDashboardRegistryLayer,
      llmLayer,
      memoryLayer,
      hookLayer,
      engineLayer,
      CapabilityRegistryLive, // MOVE-2 M2.1 — default-on capability metadata + audit surface backing
      // Optional (default Layer.empty when feature disabled)
      toolsLayer ?? Layer.empty,
      lightToolResultCacheOptLayer,
      lightReasoningOptLayer,
      lightGuardrailsOptLayer,
      lightJudgmentOptLayer,
      lightCostTrackingOptLayer,
      lightObservabilityOptLayer,
    ),
  );
};

// A2A serving moved off the layer-construction path — see
// `ReactiveAgent.serveA2A()` in `reactive-agent.ts`. The layer this file used
// to build here (`A2aExtraLayer`, removed) ran at `createRuntime()` time,
// before the agent existed and before there was any executor to hand it, so
// it could never bind a real port or reach a real run() — confirmed dead via
// research, deleted rather than fixed in place (A2A repair plan, Task 2).
