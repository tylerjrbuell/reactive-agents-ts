import { Layer, Effect, Context, Ref } from "effect";
import { applyRetryToLlmService } from "./llm-retry.js";
import { LifecycleHookRegistryLive } from "./hooks.js";
import { ExecutionEngineLive } from "./execution-engine.js";
import { CapabilityRegistryLive } from "./capabilities/registry.js";
import type { ReactiveAgentsConfig } from "./types.js";
import { defaultReactiveAgentsConfig } from "./types.js";
import { CoreServicesLive, EventBusLive, EventBus } from "@reactive-agents/core";
import { META_TOOLS } from "@reactive-agents/reasoning";
import type { AgentEvent } from "@reactive-agents/core";
import {
  createLLMProviderLayer,
  getProviderDefaultModel,
  LLMService,
  makeRateLimitedProvider,
  FallbackChain,
} from "@reactive-agents/llm-provider";
import type { TestTurn } from "@reactive-agents/llm-provider";
import { createMemoryLayer, ExperienceStoreLive, MemoryConsolidatorServiceLive, SessionStoreLive, SkillStoreServiceLive } from "@reactive-agents/memory";
import type { MemoryLLM } from "@reactive-agents/memory";

// Optional package imports
import { createGuardrailsLayer } from "@reactive-agents/guardrails";
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
import type { ReasoningConfig, KernelMetaToolsConfig, Verifier } from "@reactive-agents/reasoning";
import { createToolsLayer, ToolResultCacheLive, ToolService, ToolNotFoundError } from "@reactive-agents/tools";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import type { ObservabilityOptions } from "./builder.js";
import type { ReasoningOptions } from "./types.js";
import { withoutStrategyIcsOverrides } from "./synthesis-resolve.js";
import type { TelemetryConfig } from "@reactive-agents/observability";
import type { ContextProfile } from "@reactive-agents/reasoning";
import { createIdentityLayer } from "@reactive-agents/identity";
import {
  createObservabilityLayer,
  MetricsCollectorLive,
  TelemetryCollectorLive,
} from "@reactive-agents/observability";
import { createInteractionLayer } from "@reactive-agents/interaction";
import { createPromptLayer } from "@reactive-agents/prompts";
import { createOrchestrationLayer } from "@reactive-agents/orchestration";
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
 * site (~33 across `createRuntime` + `createLightRuntime` + `A2aExtraLayer`).
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

const leanModeVerifier: Verifier = {
  verify: (ctx) => ({
    verified: true,
    softFail: false,
    checks: [{ name: "noop", passed: true }],
    summary: `${ctx.action}: noop (lean harness)`,
    action: ctx.action,
  }),
};

/**
 * Build the optional ToolService layer for a runtime factory.
 *
 * Encapsulates the gate (`enableTools || mcpServers.length > 0`) and the
 * optional `allowedTools` filtering wrap that both `createRuntime` and
 * `createLightRuntime` previously open-coded as ~70-LOC duplicate blocks.
 *
 * Returns a typed `Layer.Layer<ToolService>` (or `null` when tools are
 * disabled) — no `as ComposableLayer` cast inside. The single widening cast
 * happens once in `finalizeComposition()`, through which both factories route
 * their terminal `Layer.mergeAll(...)` result — the WS-5d / §8.1 invariant
 * pinned by `packages/runtime/test/composable-layer-ceiling.test.ts`.
 *
 * Note: `createLightRuntime` does not honor `mcpServers` (its tools gate
 * is `options.enableTools` only). To preserve that behavior, the caller
 * passes `mcpServers: undefined` (or simply omits it via Pick) when
 * invoking from the light runtime path.
 */
function buildToolsLayer(
  options: {
    readonly enableTools?: boolean;
    // We only inspect `.length`; the element shape is irrelevant here. Using
    // `unknown` avoids importing MCPServerConfig solely for arity checking
    // and keeps the helper compatible with LightRuntimeOptions (no mcpServers).
    readonly mcpServers?: readonly unknown[] | undefined;
    readonly allowedTools?: readonly string[];
  },
  eventBusLayer: Layer.Layer<EventBus>,
): Layer.Layer<ToolService> | null {
  const shouldEnableTools =
    options.enableTools ||
    (options.mcpServers && options.mcpServers.length > 0);
  if (!shouldEnableTools) return null;

  // ToolService requires EventBus; over-provide the runtime's shared
  // EventBus instance so the tool layer joins the runtime's singleton bus.
  const baseToolsLayer = createToolsLayer().pipe(Layer.provide(eventBusLayer));

  if (!options.allowedTools || options.allowedTools.length === 0) {
    return baseToolsLayer;
  }

  // Normalize entries: trim whitespace so typos like `" recall"` don't silently
  // reject the legitimate `recall` tool. Keeping the comparison lenient here is
  // safer than making users debug invisible whitespace; `checkAllowedToolsMismatch`
  // at bootstrap surfaces the normalized→registered match for visibility.
  // Meta-tools (recall, write_result_to_file, brief, pulse, …) bypass the user
  // allowlist at EXECUTION, mirroring the kernel guard's unconditional META_TOOLS
  // bypass (guard.ts:84). Without this, setting an explicit allowedTools silently
  // blocks every meta-tool at ToolService.execute even though it is offered to the
  // model — the bug that hid write_result_to_file behind "not in the allowed tools list".
  const allowed = new Set([
    ...options.allowedTools.map((name) => name.trim()).filter((name) => name.length > 0),
    ...META_TOOLS,
  ]);

  return Layer.effect(
    ToolService,
    Effect.gen(function* () {
      // Get the underlying ToolService from the base layer
      const base = yield* ToolService.pipe(Effect.provide(baseToolsLayer));

      return {
        execute: (input: import("@reactive-agents/tools").ToolInput) => {
          if (!allowed.has(input.toolName)) {
            return Effect.fail(
              new ToolNotFoundError({
                message: `Tool "${input.toolName}" is not in the allowed tools list`,
                toolName: input.toolName,
              }),
            );
          }
          return base.execute(input);
        },
        register: base.register,
        connectMCPServer: base.connectMCPServer,
        disconnectMCPServer: base.disconnectMCPServer,
        listTools: (filter?: { category?: string; source?: string; riskLevel?: string }) =>
          base.listTools(filter).pipe(
            Effect.map((tools) => tools.filter((t) => allowed.has(t.name))),
          ),
        getTool: (name: string) => {
          if (!allowed.has(name)) {
            return Effect.fail(
              new ToolNotFoundError({
                message: `Tool "${name}" is not in the allowed tools list`,
                toolName: name,
              }),
            );
          }
          return base.getTool(name);
        },
        toFunctionCallingFormat: () =>
          base.toFunctionCallingFormat().pipe(
            Effect.map((tools) => tools.filter((t) => allowed.has(t.name))),
          ),
        listMCPServers: base.listMCPServers,
        unregisterTool: base.unregisterTool,
      };
    }),
  ).pipe(Layer.provide(baseToolsLayer));
}

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
    observabilityVerbosity: options.observabilityOptions?.verbosity,
    logModelIO: options.observabilityOptions?.logModelIO,
    logPrefix: options.observabilityOptions?.logPrefix,
    // When a user sets `numCtx` (provider context window), keep the
    // reasoning-side window in lockstep: seed `contextProfile.maxTokens` so the
    // kernel packs/sends within the SAME budget the provider will accept.
    // Otherwise narrowing numCtx silently truncates (kernel still packs to the
    // 32K capability default) and widening underdelivers. An explicit
    // contextProfile.maxTokens from the caller still wins.
    contextProfile:
      options.numCtx !== undefined
        ? {
            ...options.contextProfile,
            maxTokens: options.contextProfile?.maxTokens ?? options.numCtx,
          }
        : options.contextProfile,
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
    builtins: options.builtins,
    enableMemory: options.enableMemory ?? false,
    enableExperienceLearning: options.enableExperienceLearning,
    enableMemoryConsolidation: options.enableMemoryConsolidation,
    consolidationConfig: options.consolidationConfig,
    executionTimeoutMs: options.executionTimeoutMs,
    retryPolicy: options.retryPolicy,
    cacheTimeoutMs: options.cacheTimeoutMs,
    minIterations: options.minIterations,
    taskContext: options.taskContext,
    progressCheckpoint: options.progressCheckpoint,
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
    strategySwitching: options.leanHarness || options.reasoningOptions?.enableStrategySwitching === false
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
    },
    options.circuitBreakerConfig,
    options.pricingRegistry,
  );

  // Build effectiveLlmLayer: if fallbackConfig has additional providers, wrap
  // the primary layer with Effect.catchAll chains so failures cascade through
  // fallback providers automatically.
  const fallbackProviders = (options.fallbackConfig?.providers ?? []).slice(1);
  const effectiveLlmLayer: Layer.Layer<LLMService> =
    fallbackProviders.length > 0
      ? Layer.effect(
          LLMService,
          Effect.gen(function* () {
            const primary = yield* LLMService.pipe(
              Effect.provide(llmLayer as Layer.Layer<LLMService, never, never>),
            );
            const fallbacks = yield* Effect.all(
              fallbackProviders.map((fp) =>
                LLMService.pipe(
                  Effect.provide(
                    createLLMProviderLayer(fp as Parameters<typeof createLLMProviderLayer>[0], undefined, undefined, {
                        temperature: options.temperature,
                        maxTokens: options.maxTokens,
                        numCtx: options.numCtx,
                      }) as Layer.Layer<LLMService, never, never>,
                  ),
                ),
              ),
              { concurrency: "unbounded" },
            );
            const all = [primary, ...fallbacks];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return {
              complete: (req: Parameters<typeof primary.complete>[0]) => {
                const fallbackTransitions: Array<{
                  fromProvider: string;
                  toProvider: string;
                  reason: string;
                  attemptNumber: number;
                }> = [];
                const fallbackChain = new FallbackChain(
                  {
                    providers: [options.provider ?? "test", ...fallbackProviders],
                    errorThreshold: options.fallbackConfig?.errorThreshold,
                  },
                  (fromProvider, toProvider, reason, attemptNumber) => {
                    fallbackTransitions.push({
                      fromProvider,
                      toProvider,
                      reason,
                      attemptNumber,
                    });
                  },
                );
                let effect = primary.complete(req);
                for (const fb of fallbacks) {
                  const captured = fb;
                  effect = effect.pipe(
                    Effect.catchAllCause(() =>
                      Effect.sync(() => {
                        fallbackChain.recordError(options.provider ?? "test");
                      }).pipe(Effect.zipRight(captured.complete(req))),
                    ),
                  );
                }
                return effect.pipe(
                  Effect.flatMap((response) =>
                    Effect.gen(function* () {
                      const transitions = [...fallbackTransitions];

                      return transitions.length > 0
                        ? ({
                            ...response,
                            fallbackTransitions: transitions,
                          } as typeof response & {
                            fallbackTransitions: Array<{
                              fromProvider: string;
                              toProvider: string;
                              reason: string;
                              attemptNumber: number;
                            }>;
                          })
                        : response;
                    }),
                  ),
                );
              },
              stream: (req: Parameters<typeof primary.stream>[0]) => primary.stream(req),
              completeStructured: (req: Parameters<typeof primary.completeStructured>[0]) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                let effect = primary.completeStructured(req as any) as any;
                for (const fb of fallbacks) {
                  const captured = fb;
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  effect = effect.pipe(Effect.catchAll(() => captured.completeStructured(req as any)));
                }
                return effect;
              },
              embed: (texts: Parameters<typeof primary.embed>[0], model: Parameters<typeof primary.embed>[1]) => {
                let effect = primary.embed(texts, model);
                for (const fb of all.slice(1)) {
                  const captured = fb;
                  effect = effect.pipe(Effect.catchAll(() => captured.embed(texts, model)));
                }
                return effect;
              },
              countTokens: (msgs: Parameters<typeof primary.countTokens>[0]) => primary.countTokens(msgs),
              getModelConfig: () => primary.getModelConfig(),
              getStructuredOutputCapabilities: () => primary.getStructuredOutputCapabilities(),
            } as Context.Tag.Service<LLMService>;
          }),
        )
      : (llmLayer as Layer.Layer<LLMService>);

  // Apply retry policy: wrap complete() / stream() / completeStructured() with
  // Effect.retry so transient LLM failures (rate limits, network errors) back
  // off and retry. Wrapping ALL three matters — the reactive kernel runs through
  // stream(), so a complete()-only wrap left withRetryPolicy dead for the main
  // path (see applyRetryToLlmService).
  const finalLlmLayer: Layer.Layer<LLMService> =
    options.retryPolicy
      ? Layer.effect(
          LLMService,
          Effect.gen(function* () {
            const svc = yield* LLMService.pipe(
              Effect.provide(effectiveLlmLayer as Layer.Layer<LLMService, never, never>),
            );
            return applyRetryToLlmService(svc, options.retryPolicy!);
          }),
        )
      : effectiveLlmLayer;

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

  const memoryOverrides: Record<string, unknown> = { agentId: options.agentId };
  if (options.memoryOptions) {
    const mo = options.memoryOptions;
    if (mo.dbPath) memoryOverrides.dbPath = mo.dbPath;
    if (mo.capacity || mo.evictionPolicy) {
      memoryOverrides.working = {
        capacity: mo.capacity ?? 7,
        evictionPolicy: mo.evictionPolicy ?? "fifo",
      };
    }
    if (mo.importanceThreshold !== undefined) {
      memoryOverrides.semantic = {
        maxMarkdownLines: 200,
        importanceThreshold: mo.importanceThreshold,
      };
    }
    if (mo.retainDays !== undefined) {
      memoryOverrides.episodic = {
        retainDays: mo.retainDays,
        maxSnapshotsPerSession: 3,
      };
    }
    if (mo.maxEntries !== undefined) {
      memoryOverrides.compaction = {
        strategy: "progressive",
        maxEntries: mo.maxEntries,
        intervalMs: 86_400_000,
        similarityThreshold: 0.92,
        decayFactor: 0.05,
      };
    }
  }
  // Whether ANY configured feature needs the memory stack in the ambient
  // runtime. `.session({persist})` and skill persistence are gated on
  // enableMemory already; experience/consolidation carry their own flags.
  const memoryStackNeeded =
    (options.enableMemory ?? false) ||
    (options.enableExperienceLearning ?? false) ||
    (options.enableMemoryConsolidation ?? false);

  // Bridge LLMService.embed into MemoryLLM so semantic memory auto-generates embeddings
  const memoryLayer = Layer.unwrapEffect(
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
      return createMemoryLayer(
        config.memoryTier,
        memoryOverrides as Parameters<typeof createMemoryLayer>[1],
        bridgedLLM,
      );
    }),
  ).pipe(Layer.provide(Layer.merge(observableLlmLayer, eventBusLayer)));
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
            }
          : undefined;
        return createGuardrailsLayer(guardrailConfig);
      })()
    : Layer.empty;

  // ── KillSwitch ──
  // Provide eventBusLayer so KillSwitchService captures the same EventBus instance
  // during its layer build (for AgentPaused/AgentResumed event emission).
  const killSwitchOptLayer = options.enableKillSwitch
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
  const reasoningOptLayer = options.enableReasoning
    ? (() => {
        // Build reasoning config from defaults + user overrides
        const reasoningConfig: ReasoningConfig = options.reasoningOptions
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
                  ...(options.maxIterations !== undefined
                    ? { maxIterations: options.maxIterations }
                    : {}),
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
      })()
    : Layer.empty;

  // ── Identity ──
  const identityOptLayer = options.enableIdentity
    ? createIdentityLayer()
    : Layer.empty;

  // ── Observability ──
  const observabilityOptLayer = options.enableObservability
    ? (() => {
        const obsExporterConfig = {
          verbosity: options.observabilityOptions?.verbosity,
          live: options.observabilityOptions?.live,
          file: options.observabilityOptions?.file
            ? { filePath: options.observabilityOptions.file }
            : undefined,
          ...(options.observabilityOptions?.redactors !== undefined
            ? { redactors: options.observabilityOptions.redactors }
            : {}),
        };
        // Provide the shared metricsCollectorLayer so ObservabilityService uses the same instance
        // as ExecutionEngine, ensuring metrics flow through properly
        return createObservabilityLayer(obsExporterConfig, metricsCollectorLayer);
      })()
    : Layer.empty;

  // ── Telemetry ──
  const telemetryOptLayer = options.telemetryConfig
    ? TelemetryCollectorLive(options.telemetryConfig).pipe(
        Layer.provide(eventBusLayer),
      )
    : Layer.empty;

  // ── Structured logging tap — subscribes to EventBus and writes to configured output ──
  const loggerTapOptLayer = options.loggingConfig
    ? (() => {
        const { makeLoggerService } =
          require("@reactive-agents/observability") as typeof import("@reactive-agents/observability");
        const loggerCfg = options.loggingConfig;
        return Layer.effectDiscard(
          Effect.gen(function* () {
            const logger = makeLoggerService(loggerCfg);
            const eb = yield* EventBus;

            type E<T extends AgentEvent["_tag"]> = Extract<AgentEvent, { _tag: T }>;

            yield* eb.on("AgentStarted", (event: E<"AgentStarted">) =>
              Effect.sync(() =>
                logger.info("[agent:started]", { agentId: event.agentId, taskId: event.taskId }),
              ),
            );

            yield* eb.on("AgentCompleted", (event: E<"AgentCompleted">) =>
              Effect.sync(() =>
                event.success
                  ? logger.info("[agent:completed]", {
                      agentId: event.agentId,
                      taskId: event.taskId,
                      durationMs: event.durationMs,
                      totalTokens: event.totalTokens,
                      totalIterations: event.totalIterations,
                    })
                  : logger.warn("[agent:failed]", {
                      agentId: event.agentId,
                      taskId: event.taskId,
                      durationMs: event.durationMs,
                    }),
              ),
            );

            yield* eb.on("ExecutionPhaseCompleted", (event: E<"ExecutionPhaseCompleted">) =>
              Effect.sync(() =>
                logger.debug(`[phase:${event.phase}]`, {
                  taskId: event.taskId,
                  durationMs: event.durationMs,
                }),
              ),
            );

            yield* eb.on("ToolCallCompleted", (event: E<"ToolCallCompleted">) =>
              Effect.sync(() => {
                if (event.success) {
                  logger.info(`[tool:${event.toolName}]`, {
                    taskId: event.taskId,
                    durationMs: event.durationMs,
                  });
                } else {
                  logger.warn(`[tool:${event.toolName}:error]`, {
                    taskId: event.taskId,
                    durationMs: event.durationMs,
                  });
                }
              }),
            );

            yield* eb.on("LLMRequestCompleted", (event: E<"LLMRequestCompleted">) =>
              Effect.sync(() =>
                logger.debug("[llm:completed]", {
                  taskId: event.taskId,
                  model: event.model,
                  tokensUsed: event.tokensUsed,
                  durationMs: event.durationMs,
                }),
              ),
            );

            yield* eb.on("GuardrailViolationDetected", (event: E<"GuardrailViolationDetected">) =>
              Effect.sync(() =>
                logger.warn("[guardrail:violation]", {
                  taskId: event.taskId,
                  blocked: event.blocked,
                  violations: event.violations,
                }),
              ),
            );
          }),
        ).pipe(Layer.provide(eventBusLayer));
      })()
    : Layer.empty;

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
          },
        }
      : undefined;

  const reactiveIntelOptLayer = options.enableReactiveIntelligence
    ? createReactiveIntelligenceLayer(
        options.reactiveIntelligenceOptions as any,
        undefined,
        skillLayerForRi,
      )
    : skillLayerForRi?.resolver
      ? makeSkillResolverService(skillLayerForRi.resolver)
      : Layer.empty;

  // ── Interaction ──
  const interactionOptLayer = options.enableInteraction
    ? createInteractionLayer().pipe(Layer.provide(eventBusLayer))
    : Layer.empty;

  // ── Prompts (already constructed above; included only if enabled) ──
  const promptOptLayer = promptLayer ?? Layer.empty;

  // ── Orchestration ──
  const orchestrationOptLayer = options.enableOrchestration
    ? createOrchestrationLayer()
    : Layer.empty;

  // ── A2A ──
  const a2aOptLayer = options.enableA2A
    ? A2aExtraLayer(options.agentId, options.a2aPort ?? 3000)
    : Layer.empty;

  // ── Gateway — compose GatewayService + SchedulerService when enabled. ──
  // The persistent event loop itself starts via agent.start(); layer composition just makes
  // the services resolvable from the ManagedRuntime.
  // EventBus is passed to gateway services for observability when available.
  const gatewayOptLayer = options.enableGateway
    ? (() => {
        const gatewayLayer = Layer.unwrapEffect(
          Effect.gen(function* () {
            const gw = yield* Effect.promise(
              () => import("@reactive-agents/gateway"),
            );

            // Resolve EventBus from context for observability (optional).
            // Use Effect.catchAll — yield* with a missing service produces a fiber failure,
            // not a JS exception, so try/catch won't catch it.
            const core = yield* Effect.promise(
              () => import("@reactive-agents/core"),
            );
            type BusLike = { publish: (e: any) => Effect.Effect<void, never> };
            const bus: BusLike | undefined = yield* Effect.gen(function* () {
              const eb = yield* core.EventBus as any;
              return { publish: (e: any) => (eb as any).publish(e) } as BusLike;
            }).pipe(
              Effect.catchAll(() =>
                Effect.succeed(undefined as BusLike | undefined),
              ),
            );

            const gwLayer = gw.GatewayServiceLive(
              (options.gatewayOptions ?? {}) as any,
              bus,
            );
            const schedLayer = gw.SchedulerServiceLive(
              {
                agentId: options.agentId,
                timezone: options.gatewayOptions?.timezone as any,
                heartbeat: options.gatewayOptions?.heartbeat as any,
                crons: options.gatewayOptions?.crons as any,
              },
              bus,
            );
            return Layer.merge(gwLayer, schedLayer);
          }),
        );
        return gatewayLayer.pipe(Layer.provide(eventBusLayer));
      })()
    : Layer.empty;

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
      costTrackingOptLayer,
      toolsLayer ?? Layer.empty,
      toolResultCacheOptLayer,
      experienceLearningOptLayer,
      memoryConsolidationOptLayer,
      sessionStoreOptLayer,
      skillStoreOptLayer,
      reasoningOptLayer,
      identityOptLayer,
      observabilityOptLayer,
      telemetryOptLayer,
      loggerTapOptLayer,
      healthOptLayer,
      reactiveIntelOptLayer,
      interactionOptLayer,
      promptOptLayer,
      orchestrationOptLayer,
      a2aOptLayer,
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
 * - All optional layers: Identity, Interaction, Prompts, Orchestration, Gateway, A2A,
 *   Health, ReactiveIntelligence, Telemetry, Logging, KillSwitch, BehavioralContracts
 *
 * The parent can toggle heavier layers (memory, guardrails, observability, cost tracking)
 * for sub-agents that need more capabilities.
 *
 * @param options - Light runtime configuration
 * @returns A composed Effect-TS Layer with minimal services
 */
export const createLightRuntime = (options: LightRuntimeOptions) => {
  const resolvedModel =
    options.model ||
    process.env.LLM_DEFAULT_MODEL ||
    (options.provider ? getProviderDefaultModel(options.provider) : undefined) ||
    "claude-sonnet-4-6";

  const config: ReactiveAgentsConfig = {
    ...defaultReactiveAgentsConfig(options.agentId),
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
    observabilityVerbosity: options.observabilityOptions?.verbosity,
    logModelIO: options.observabilityOptions?.logModelIO,
    logPrefix: options.observabilityOptions?.logPrefix,
    // When a user sets `numCtx` (provider context window), keep the
    // reasoning-side window in lockstep: seed `contextProfile.maxTokens` so the
    // kernel packs/sends within the SAME budget the provider will accept.
    // Otherwise narrowing numCtx silently truncates (kernel still packs to the
    // 32K capability default) and widening underdelivers. An explicit
    // contextProfile.maxTokens from the caller still wins.
    contextProfile:
      options.numCtx !== undefined
        ? {
            ...options.contextProfile,
            maxTokens: options.contextProfile?.maxTokens ?? options.numCtx,
          }
        : options.contextProfile,
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
    enableMemory: options.enableMemory ?? false,
    enableExperienceLearning: false,
    enableMemoryConsolidation: false,
    reasoningOptions: options.reasoningOptions,
  };

  // ── Minimal required layers ──
  const eventBusLayer = EventBusLive;
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
    },
  ) as Layer.Layer<LLMService>;

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
          return createMemoryLayer("1", { agentId: options.agentId }, bridgedLLM);
        }),
      ).pipe(Layer.provide(llmLayer))
    : createMemoryLayer("1", { agentId: options.agentId });

  // Minimal hooks layer (required by ExecutionEngine)
  const hookLayer = LifecycleHookRegistryLive;

  // MetricsCollector is still needed by ExecutionEngine but we skip the EventBus subscription
  // by providing it with an isolated EventBus (no listeners accumulating in the parent's bus)
  const metricsCollectorLayer = MetricsCollectorLive.pipe(
    Layer.provide(eventBusLayer),
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
  const lightReasoningOptLayer = options.enableReasoning
    ? (() => {
        const reasoningConfig: ReasoningConfig = options.reasoningOptions
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
                  ...(options.maxIterations !== undefined
                    ? { maxIterations: options.maxIterations }
                    : {}),
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

        // Tiny dep stack assembly — not a runtime mid-chain mutation.
        const reasoningDeps = toolsLayer
          ? Layer.merge(llmLayer, toolsLayer)
          : llmLayer;
        return createReasoningLayer(reasoningConfig).pipe(
          Layer.provide(reasoningDeps),
        );
      })()
    : Layer.empty;

  // ── Optional heavy layers (parent-toggleable) ──
  const lightGuardrailsOptLayer = options.enableGuardrails
    ? (() => {
        const gc = options.guardrailsOptions;
        const guardrailConfig = gc
          ? {
              enableInjectionDetection: gc.injection ?? true,
              enablePiiDetection: gc.pii ?? true,
              enableToxicityDetection: gc.toxicity ?? true,
            }
          : undefined;
        return createGuardrailsLayer(guardrailConfig);
      })()
    : Layer.empty;

  const lightCostTrackingOptLayer = options.enableCostTracking
    ? createCostLayer()
    : Layer.empty;

  const lightObservabilityOptLayer = options.enableObservability
    ? (() => {
        const obsExporterConfig = {
          verbosity: options.observabilityOptions?.verbosity,
          live: options.observabilityOptions?.live,
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
      lightCostTrackingOptLayer,
      lightObservabilityOptLayer,
    ),
  );
};

/**
 * Create the A2A (Agent-to-Agent) protocol server layer.
 *
 * Sets up an HTTP server that exposes the agent via JSON-RPC 2.0 for remote invocation.
 * The agent becomes discoverable via an Agent Card at `/.well-known/agent.json`.
 *
 * If the `@reactive-agents/a2a` package is not installed, returns an empty layer (graceful degradation).
 *
 * @param agentId - Agent identifier (used in the Agent Card)
 * @param port - HTTP port to listen on (e.g., 3000)
 * @returns A Layer that sets up the A2A server
 *
 * @internal Called internally by `createRuntime()` when `enableA2A: true`
 */
const A2aExtraLayer = (
  agentId: string,
  port: number,
): ComposableLayer => {
  // Use dynamic import() so Bun's mock.module() can intercept it in tests.
  // Layer.unwrapEffect lets us return a Layer from inside an async Effect.
  // Single erasure cast at the wrap boundary — the inner promise returns
  // dynamically-typed Layers (a2a package may be absent), so the union is
  // collapsed to ComposableLayer once at the helper return.
  return Layer.unwrapEffect(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Effect.promise<any>(async () => {
      try {
        const mod = (await import("@reactive-agents/a2a")) as any;
        const { createA2AServerLayer } = mod;
        const agentCard = {
          id: agentId,
          name: agentId,
          version: "0.5.0",
          url: `http://localhost:${port}`,
          provider: { organization: "Reactive Agents" },
          capabilities: {
            streaming: true,
            pushNotifications: false,
            stateTransitionHistory: false,
          },
        };
        return createA2AServerLayer(agentCard, port);
      } catch {
        // A2A package not installed — return empty layer
        return Layer.empty;
      }
    }),
  );
};
