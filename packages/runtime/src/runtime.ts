import { Layer, Effect, Context, Schedule, Duration, Ref } from "effect";
import { LifecycleHookRegistryLive } from "./hooks.js";
import { ExecutionEngineLive } from "./execution-engine.js";
import type { ReactiveAgentsConfig } from "./types.js";
import { defaultReactiveAgentsConfig } from "./types.js";
import { CoreServicesLive, EventBusLive, EventBus } from "@reactive-agents/core";
import type { AgentEvent } from "@reactive-agents/core";
import {
  createLLMProviderLayer,
  getProviderDefaultModel,
  LLMService,
  makeRateLimitedProvider,
  FallbackChain,
} from "@reactive-agents/llm-provider";
import type { TestTurn } from "@reactive-agents/llm-provider";
import { createMemoryLayer, ExperienceStoreLive, MemoryConsolidatorServiceLive, SessionStoreLive } from "@reactive-agents/memory";
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

// ─── Runtime Options ───
// Type definitions hoisted to ./runtime-types.ts (W26-C step 1).
// Re-exported here for backward compatibility with all existing consumers.
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
 *   model: "claude-opus-4-20250514",
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
    "claude-sonnet-4-20250514";

  const config: ReactiveAgentsConfig = {
    ...defaultReactiveAgentsConfig(options.agentId),
    defaultModel: resolvedModel,
    provider: options.provider,
    thinking: options.thinking,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    memoryTier: options.memoryTier ?? "1",
    maxIterations: options.maxIterations ?? 10,
    enableGuardrails: options.enableGuardrails ?? false,
    enableVerification: options.enableVerification ?? false,
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
    contextProfile: options.contextProfile,
    defaultStrategy: options.reasoningOptions?.defaultStrategy,
    resultCompression: options.resultCompression,
    requiredTools: options.requiredTools
      ? {
          tools: options.requiredTools.tools ? [...options.requiredTools.tools] : undefined,
          adaptive: options.requiredTools.adaptive,
          maxRetries: options.requiredTools.maxRetries,
        }
      : undefined,
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
      temperature: options.temperature,
      maxTokens: options.maxTokens,
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

  // Apply retry policy: wrap complete() with Effect.retry so transient LLM
  // failures (rate limits, network errors) automatically back off and retry.
  const finalLlmLayer: Layer.Layer<LLMService> =
    options.retryPolicy
      ? Layer.effect(
          LLMService,
          Effect.gen(function* () {
            const svc = yield* LLMService.pipe(
              Effect.provide(effectiveLlmLayer as Layer.Layer<LLMService, never, never>),
            );
            const retrySchedule = Schedule.recurs(options.retryPolicy!.maxRetries).pipe(
              Schedule.intersect(Schedule.spaced(Duration.millis(options.retryPolicy!.backoffMs))),
            );
            return {
              ...svc,
              complete: (req: Parameters<typeof svc.complete>[0]) =>
                svc.complete(req).pipe(Effect.retry(retrySchedule)),
            } as Context.Tag.Service<LLMService>;
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

  let runtime = Layer.mergeAll(
    coreLayer,
    eventBusLayer,
    observableLlmLayer,
    memoryLayer,
    hookLayer,
    engineLayer,
  );

  // ── Optional layers ──

  if (options.enableGuardrails) {
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
    runtime = Layer.merge(runtime, createGuardrailsLayer(guardrailConfig)) as any;
  }

  if (options.enableKillSwitch) {
    const { KillSwitchServiceLive } =
      require("@reactive-agents/guardrails") as typeof import("@reactive-agents/guardrails");
    // Provide eventBusLayer so KillSwitchService captures the same EventBus instance
    // during its layer build (for AgentPaused/AgentResumed event emission).
    runtime = Layer.merge(
      runtime,
      KillSwitchServiceLive().pipe(Layer.provide(eventBusLayer)),
    ) as any;
  }

  if (options.enableBehavioralContracts && options.behavioralContract) {
    const { BehavioralContractServiceLive } =
      require("@reactive-agents/guardrails") as typeof import("@reactive-agents/guardrails");
    runtime = Layer.merge(
      runtime,
      BehavioralContractServiceLive(options.behavioralContract),
    ) as any;
  }

  if (options.enableVerification) {
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
    const verificationLayer =
      verificationConfig.useLLMTier === true
        ? createVerificationLayerWithRuntimeLlm(verificationConfig).pipe(
            // Same pattern as memoryLayer: satisfy LLM here so merge order does not
            // leave VerificationService construction without LLMService.
            Layer.provide(observableLlmLayer as Layer.Layer<LLMService>),
          )
        : createVerificationLayer({ ...verificationConfig, useLLMTier: false });
    runtime = Layer.merge(runtime, verificationLayer) as any;
  }

  if (options.enableCostTracking) {
    runtime = Layer.merge(runtime, createCostLayer(options.costTrackingOptions)) as any;
  }

  // Build tools layer first — reasoning may depend on it
  // MCP servers implicitly enable tools
  let toolsLayer: Layer.Layer<any, any> | null = null;
  const shouldEnableTools =
    options.enableTools ||
    (options.mcpServers && options.mcpServers.length > 0);
  if (shouldEnableTools) {
    // ToolService requires EventBus; ToolResultCache enables opt-in tool result caching
    const baseToolsLayer = createToolsLayer().pipe(Layer.provide(eventBusLayer));

    // If allowedTools is specified, wrap the ToolService with a filtering layer
    // that restricts listTools, getTool, and toFunctionCallingFormat to only
    // the whitelisted tool names. execute() also rejects non-allowed tools.
    if (options.allowedTools && options.allowedTools.length > 0) {
      // Normalize entries: trim whitespace so typos like `" recall"` don't silently
      // reject the legitimate `recall` tool. Keeping the comparison lenient here is
      // safer than making users debug invisible whitespace; `checkAllowedToolsMismatch`
      // at bootstrap surfaces the normalized→registered match for visibility.
      const allowed = new Set(
        options.allowedTools
          .map((name) => name.trim())
          .filter((name) => name.length > 0),
      );
      toolsLayer = Layer.effect(
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
    } else {
      toolsLayer = baseToolsLayer;
    }

    const toolResultCacheLayer = ToolResultCacheLive();
    runtime = Layer.merge(runtime, toolsLayer) as any;
    runtime = Layer.merge(runtime, toolResultCacheLayer) as any;
  }

  // ── Experience learning layer (requires MemoryDatabase from memoryLayer) ──
  if (options.enableExperienceLearning) {
    runtime = Layer.merge(
      runtime,
      ExperienceStoreLive.pipe(Layer.provide(memoryLayer)),
    ) as any;
  }

  // ── Memory consolidation layer (requires MemoryDatabase from memoryLayer) ──
  if (options.enableMemoryConsolidation) {
    runtime = Layer.merge(
      runtime,
      MemoryConsolidatorServiceLive(options.consolidationConfig).pipe(Layer.provide(memoryLayer)),
    ) as any;
  }

  // ── Session persistence layer (requires MemoryDatabase from memoryLayer) ──
  // Only wired when sessionPersist is true. Without memory, SessionStoreService will not be
  // in the runtime and agent.session({ persist: true }) will silently no-op via Effect.serviceOption.
  if (options.sessionPersist) {
    runtime = Layer.merge(
      runtime,
      SessionStoreLive.pipe(Layer.provide(memoryLayer)),
    ) as any;
  }

  // Create PromptLayer once — shared by reasoning deps and the main runtime
  const promptLayer = options.enablePrompts ? createPromptLayer() : null;

  if (options.enableReasoning) {
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

    // ReasoningService requires LLMService, optionally ToolService + PromptService
    let reasoningDeps = observableLlmLayer;
    if (toolsLayer) {
      reasoningDeps = Layer.merge(observableLlmLayer, toolsLayer) as any;
    }
    if (promptLayer) {
      reasoningDeps = Layer.merge(reasoningDeps, promptLayer) as any;
    }
    const reasoningLayer = createReasoningLayer(reasoningConfig).pipe(
      Layer.provide(reasoningDeps),
    );
    runtime = Layer.merge(runtime, reasoningLayer) as any;
  }

  if (options.enableIdentity) {
    runtime = Layer.merge(runtime, createIdentityLayer()) as any;
  }

  if (options.enableObservability) {
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
    const obsLayer = createObservabilityLayer(
      obsExporterConfig,
      metricsCollectorLayer,
    );
    runtime = Layer.merge(runtime, obsLayer) as any;
  }

  if (options.telemetryConfig) {
    const telemetryLayer = TelemetryCollectorLive(options.telemetryConfig).pipe(
      Layer.provide(eventBusLayer),
    );
    runtime = Layer.merge(runtime, telemetryLayer) as any;
  }

  // ── Structured logging tap — subscribes to EventBus and writes to configured output ──
  if (options.loggingConfig) {
    const { makeLoggerService } =
      require("@reactive-agents/observability") as typeof import("@reactive-agents/observability");
    const loggerCfg = options.loggingConfig;
    const loggerTapLayer = Layer.effectDiscard(
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
    runtime = Layer.merge(runtime, loggerTapLayer) as any;
  }

  // ── Health check service ──
  if (options.enableHealthCheck) {
    const { Health, makeHealthService } =
      require("@reactive-agents/health") as typeof import("@reactive-agents/health");
    const healthLayer = Layer.effect(
      Health,
      makeHealthService({ port: 0, agentName: options.agentId }),
    );
    runtime = Layer.merge(runtime, healthLayer) as any;
  }

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

  if (options.enableReactiveIntelligence) {
    runtime = Layer.merge(
      runtime,
      createReactiveIntelligenceLayer(
        options.reactiveIntelligenceOptions as any,
        undefined,
        skillLayerForRi,
      ),
    ) as any;
  } else if (skillLayerForRi?.resolver) {
    runtime = Layer.merge(runtime, makeSkillResolverService(skillLayerForRi.resolver)) as any;
  }

  if (options.enableInteraction) {
    // InteractionManager requires EventBus
    const interactionLayer = createInteractionLayer().pipe(
      Layer.provide(eventBusLayer),
    );
    runtime = Layer.merge(runtime, interactionLayer) as any;
  }

  if (promptLayer) {
    runtime = Layer.merge(runtime, promptLayer) as any;
  }

  if (options.enableOrchestration) {
    runtime = Layer.merge(runtime, createOrchestrationLayer()) as any;
  }

  // A2A support - use extraLayers pattern for optional A2A
  if (options.enableA2A) {
    runtime = Layer.merge(
      runtime,
      A2aExtraLayer(options.agentId, options.a2aPort ?? 3000),
    ) as any;
  }

  // Gateway — compose GatewayService + SchedulerService when enabled.
  // The persistent event loop itself starts via agent.start(); layer composition just makes
  // the services resolvable from the ManagedRuntime.
  // EventBus is passed to gateway services for observability when available.
  if (options.enableGateway) {
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
    runtime = Layer.merge(
      runtime,
      gatewayLayer.pipe(Layer.provide(eventBusLayer)),
    ) as any;
  }

  if (options.extraLayers) {
    runtime = Layer.merge(runtime, options.extraLayers) as any;
  }

  return runtime;
};

// ── Light Runtime Options ───


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
    "claude-sonnet-4-20250514";

  const config: ReactiveAgentsConfig = {
    ...defaultReactiveAgentsConfig(options.agentId),
    defaultModel: resolvedModel,
    provider: options.provider,
    thinking: options.thinking,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
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
    contextProfile: options.contextProfile,
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
      temperature: options.temperature,
      maxTokens: options.maxTokens,
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

  let runtime = Layer.mergeAll(
    coreLayer,
    eventBusLayer,
    llmLayer,
    memoryLayer,
    hookLayer,
    engineLayer,
  );

  // ── Optional tools layer ──
  let toolsLayer: Layer.Layer<any, any> | null = null;
  if (options.enableTools) {
    const baseToolsLayer = createToolsLayer().pipe(Layer.provide(eventBusLayer));
    if (options.allowedTools && options.allowedTools.length > 0) {
      const allowed = new Set(
        options.allowedTools
          .map((name) => name.trim())
          .filter((name) => name.length > 0),
      );
      toolsLayer = Layer.effect(
        ToolService,
        Effect.gen(function* () {
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
    } else {
      toolsLayer = baseToolsLayer;
    }
    const toolResultCacheLayer = ToolResultCacheLive();
    runtime = Layer.merge(runtime, toolsLayer) as any;
    runtime = Layer.merge(runtime, toolResultCacheLayer) as any;
  }

  // ── Optional reasoning layer ──
  if (options.enableReasoning) {
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

    let reasoningDeps = llmLayer as Layer.Layer<any>;
    if (toolsLayer) {
      reasoningDeps = Layer.merge(llmLayer, toolsLayer) as any;
    }
    const reasoningLayer = createReasoningLayer(reasoningConfig).pipe(
      Layer.provide(reasoningDeps),
    );
    runtime = Layer.merge(runtime, reasoningLayer) as any;
  }

  // ── Optional heavy layers (parent-toggleable) ──

  if (options.enableGuardrails) {
    const gc = options.guardrailsOptions;
    const guardrailConfig = gc
      ? {
          enableInjectionDetection: gc.injection ?? true,
          enablePiiDetection: gc.pii ?? true,
          enableToxicityDetection: gc.toxicity ?? true,
        }
      : undefined;
    runtime = Layer.merge(runtime, createGuardrailsLayer(guardrailConfig)) as any;
  }

  if (options.enableCostTracking) {
    runtime = Layer.merge(runtime, createCostLayer()) as any;
  }

  if (options.enableObservability) {
    const obsExporterConfig = {
      verbosity: options.observabilityOptions?.verbosity,
      live: options.observabilityOptions?.live,
      ...(options.observabilityOptions?.redactors !== undefined
        ? { redactors: options.observabilityOptions.redactors }
        : {}),
    };
    const obsLayer = createObservabilityLayer(
      obsExporterConfig,
      metricsCollectorLayer,
    );
    runtime = Layer.merge(runtime, obsLayer) as any;
  }

  return runtime;
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
): Layer.Layer<any, any> => {
  // Use dynamic import() so Bun's mock.module() can intercept it in tests.
  // Layer.unwrapEffect lets us return a Layer from inside an async Effect.
  return Layer.unwrapEffect(
    Effect.promise(async () => {
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
        return createA2AServerLayer(agentCard, port) as Layer.Layer<any, any>;
      } catch {
        // A2A package not installed — return empty layer
        return Layer.empty as unknown as Layer.Layer<any, any>;
      }
    }),
  );
};
