/**
 * Base runtime + cortex layer + meta-tools + ExecutionEngine resolution.
 *
 * Owns the four-step initialization that produces the foundational
 * runtime layer used by the rest of buildEffect():
 *
 *  1. Resolve `kernelMetaTools` (with harness-skill content) from
 *     the builder's `_metaTools` config.
 *  2. Resolve the optional `cortexReporterLayer` if .withCortex() is set.
 *  3. Call `createRuntime(...)` with ~60 builder-state fields to
 *     produce `baseRuntime`.
 *  4. Resolve `ExecutionEngine` against the base runtime, then
 *     conditionally merge the cortex reporter into `runtimeWithCortex`.
 *
 * Lifted from builder.ts pre-W25 (6,232-LOC checkpoint).
 */

import { Effect, Layer } from "effect";
import type { Context } from "effect";
import { createRuntime } from "../../runtime.js";
import type { MCPServerConfig } from "../../runtime.js";
import { RegistrationHarness, HarnessPipeline } from "@reactive-agents/core";
import { defaultUserMemoryPath } from "@reactive-agents/memory";
import { ExecutionEngine } from "../../execution-engine.js";
import { contractForbiddenTools, mergeContractRequiredTools } from "../contract-tool-set.js";
import type {
  ContextProfile,
  KernelMetaToolsConfig,
} from "@reactive-agents/reasoning";
import type { ReasoningOptions, CalibrationMode } from "../../types.js";
import type { TestTurn, LLMService } from "@reactive-agents/llm-provider";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import { builtinTools, shellExecuteTool } from "@reactive-agents/tools";
import { foldApprovalRequiredTools } from "./approval-autofeed.js";
import type { TelemetryConfig } from "@reactive-agents/observability";
import type {
  ProviderName,
  ToolsOptions,
  MemoryOptions,
  CostTrackingOptions,
  GuardrailsOptions,
  VerificationOptions,
  ObservabilityOptions,
  A2AOptions,
  GatewayOptions,
  ModelRoutingOptions,
} from "../types.js";

/**
 * Structural view over the builder state fields read by
 * {@link buildBaseRuntimeAndEngine}. The `ReactiveAgentBuilder` class
 * structurally satisfies this interface — call sites cast via
 * `self as unknown as BuilderRuntimeStateView`.
 *
 * Keep field types in sync with the corresponding `_*` declarations on
 * `ReactiveAgentBuilder` in `builder.ts`.
 */
export interface BuilderRuntimeStateView {
  readonly _provider: ProviderName;
  /** `.withDocuments()` accumulator — presence turns `find` on by default (its retrieval surface). */
  readonly _documents: ReadonlyArray<unknown>;
  readonly _model?: string;
  /** Ed25519 private JWK from `.withReceiptSigning()` (Arc 1 Task 9) — threaded to the engine config for the streaming receipt-signing path. */
  readonly _receiptSigningKey?: JsonWebKey;
  readonly _thinking?: boolean;
  readonly _thinkingOptions?: import("@reactive-agents/llm-provider").ThinkingOptions;
  readonly _temperature?: number;
  readonly _maxTokens?: number;
  readonly _numCtx?: number;
  readonly _memoryTier: "1" | "2";
  readonly _maxIterations: number | undefined;
  readonly _enableGuardrails: boolean;
  readonly _enableVerification: boolean;
  readonly _enableCostTracking: boolean;
  readonly _enableAudit: boolean;
  readonly _enableReasoning: boolean;
  readonly _enableTools: boolean;
  readonly _enableIdentity: boolean;
  readonly _enableObservability: boolean;
  readonly _observabilityOptions: ObservabilityOptions;
  readonly _enableInteraction: boolean;
  readonly _enablePrompts: boolean;
  readonly _enableOrchestration: boolean;
  readonly _enableKillSwitch: boolean;
  readonly _enableBehavioralContracts: boolean;
  readonly _behavioralContract?: import("@reactive-agents/guardrails").BehavioralContract;
  readonly _enableSelfImprovement: boolean;
  readonly _testScenario?: TestTurn[];
  readonly _extraLayers?: Layer.Layer<any, any, any>;
  readonly _llmOverrideLayer?: Layer.Layer<any, any, any>;
  readonly _environmentContext?: Record<string, string>;
  readonly _mcpServers: MCPServerConfig[];
  readonly _reasoningOptions?: ReasoningOptions;
  readonly _a2aOptions?: A2AOptions;
  readonly _gatewayOptions?: GatewayOptions;
  readonly _contextProfile?: Partial<ContextProfile>;
  readonly _resultCompression?: ResultCompressionConfig;
  readonly _telemetryConfig?: TelemetryConfig;
  readonly _memoryOptions?: MemoryOptions;
  readonly _guardrailsOptions?: GuardrailsOptions;
  readonly _verificationOptions?: VerificationOptions;
  readonly _costTrackingOptions?: CostTrackingOptions;
  readonly _circuitBreakerConfig?:
    | Partial<import("@reactive-agents/llm-provider").CircuitBreakerConfig>
    | false;
  readonly _rateLimiterConfig?: import("@reactive-agents/llm-provider").RateLimiterConfig;
  readonly _requiredToolsConfig?: {
    tools?: readonly string[];
    adaptive?: boolean;
    maxRetries?: number;
  };
  /**
   * Optional TaskContract from {@link ReactiveAgentBuilder.withContract}. Its
   * `kind === "required"` tool names are unioned into the resolved
   * `requiredTools` config at construction (P2b execute-time enforcement) so
   * they reach `KernelInput.requiredTools`.
   */
  readonly _taskContract?: import("@reactive-agents/core").TaskContract;
  readonly _toolsOptions?: ToolsOptions;
  readonly _enableMemory: boolean;
  readonly _enableExperienceLearning: boolean;
  readonly _enableMemoryConsolidation: boolean;
  readonly _consolidationConfig?: {
    threshold?: number;
    decayFactor?: number;
    pruneThreshold?: number;
  };
  readonly _executionTimeoutMs?: number;
  readonly _ollamaTimeoutMs?: number;
  readonly _retryPolicy?: { maxRetries: number; backoffMs: number };
  readonly _cacheTimeoutMs?: number;
  readonly _sessionPersist: boolean;
  readonly _sessionMaxAgeDays?: number;
  readonly _skillPersistence?: boolean;
  readonly _loggingConfig?: {
    level?: string;
    format?: string;
    output?: string | WritableStream;
  };
  readonly _enableHealthCheck: boolean;
  readonly _minIterations?: number;
  readonly _taskContext?: Record<string, string>;
  readonly _progressCheckpoint?: { every: number; autoResume?: boolean };
  readonly _verificationStep?: { mode: "reflect"; prompt?: string };
  readonly _outputValidator?: (output: string) => {
    valid: boolean;
    feedback?: string;
  };
  readonly _outputValidatorOptions?: { maxRetries?: number };
  readonly _customTermination?: (state: { output: string }) => boolean;
  readonly _enableReactiveIntelligence: boolean;
  readonly _reactiveIntelligenceOptions?: Partial<
    import("@reactive-agents/reactive-intelligence").ReactiveIntelligenceConfig
  >;
  readonly _skillsConfig?: {
    paths?: string[];
    packages?: string[];
    evolution?: {
      mode?: string;
      refinementThreshold?: number;
      rollbackOnRegression?: boolean;
    };
    overrides?: Record<string, { evolutionMode?: string }>;
  };
  readonly _fallbackConfig?: {
    providers?: string[];
    models?: string[];
    errorThreshold?: number;
  };
  readonly _pricingRegistry: Record<
    string,
    { readonly input: number; readonly output: number }
  >;
  readonly _calibration: CalibrationMode;
  readonly _metaTools?: import("../../types.js").MetaToolsConfig | false;
  readonly _cortexUrl: string | null;
  readonly _leanHarness: boolean;
  /**
   * Declarative budget caps forwarded to the Arbitrator pre-intent guard.
   * Set via `.withBudget()`; mirrored into `RuntimeOptions.budgetLimits`.
   */
  readonly _budgetLimits: import("../../builder.js").BudgetLimits | undefined;
  /** Opt-in numeric evidence-grounding config. Absent = off (default). */
  readonly _groundingConfig: import("../types.js").GroundingOptions | undefined;
  /** Fabrication-guard mode. Absent = "block" (always-on default). */
  readonly _fabricationGuard: import("@reactive-agents/reasoning").FabricationGuardMode | undefined;
  /** Stall/no-progress policy override. Absent = sensible defaults. */
  readonly _stallPolicy: import("@reactive-agents/reasoning").StallPolicy | undefined;
  /** Opt-in long-horizon guard profile. false = absolute-count guards (default). */
  readonly _longHorizon: boolean;
  /** Opt-in adaptive harness (Phase 6 / G1). false = no plan compiled (default). */
  readonly _adaptiveHarness: boolean;
  /** Opt-in cost-aware model routing. Absent = off (default). */
  readonly _modelRouting: ModelRoutingOptions | undefined;
  /** Opt-in durable run persistence config. Absent = off (zero overhead, default). */
  readonly _durableRuns: import("../types.js").DurableRunsOptions | undefined;
  /** Opt-in durable HITL approval policy (Phase D). Absent = off (default). */
  readonly _approvalPolicy: import("../types.js").ApprovalPolicyConfig | undefined;
  /** Agentic-UI (Task 11): opt-in agent-initiated user interaction. Threaded into kernel metaTools.userInteraction. */
  readonly _userInteraction: boolean;
  /** Registrations collected by `.withHarness()` calls — compiled into a HarnessPipeline. */
  readonly _harnessRegistrations: ReadonlyArray<(harness: import("@reactive-agents/core").Harness) => void>;
}

/** Result bundle returned to the caller of {@link buildBaseRuntimeAndEngine}.
 *
 * The Layer triples are erased to `unknown` because `createRuntime()` is
 * dynamically composed (conditional merges across ~15 optional layers) and
 * currently relies on internal `as any` to flatten the service union —
 * tightening the `ROut/E/RIn` channels to concrete unions is out of scope
 * for W2-A and would require typing `createRuntime` end-to-end first. Using
 * `unknown` (not `any`) keeps consumers honest: every service resolution
 * has to go through an explicit `Effect.provide(...)` or
 * `ManagedRuntime.make(...)` boundary, where the runtime materialises the
 * actual services.
 */
export interface BuildBaseRuntimeResult {
  readonly baseRuntime: Layer.Layer<unknown, unknown, unknown>;
  readonly runtimeWithCortex: Layer.Layer<unknown, unknown, unknown>;
  readonly engine: Context.Tag.Service<typeof ExecutionEngine>;
  readonly kernelMetaTools: KernelMetaToolsConfig | undefined;
}

/** Inputs needed to build the base runtime + engine bundle. */
export interface BuildBaseRuntimeDeps {
  readonly agentId: string;
  readonly composedSystemPrompt: string | undefined;
  readonly state: BuilderRuntimeStateView;
}

/**
 * Resolve meta-tools, build the cortex reporter layer, call `createRuntime`,
 * resolve `ExecutionEngine`, and conditionally merge the cortex reporter
 * into `runtimeWithCortex`. Returns the bundle expected by the rest of
 * `buildEffect()`.
 *
 * Pure refactor — body is verbatim from the four pre-W25-T10 sub-blocks
 * (lines 2138–2316 + 2346–2361 in the 4,641-LOC builder.ts checkpoint).
 */
export const buildBaseRuntimeAndEngine = (
  deps: BuildBaseRuntimeDeps,
): Effect.Effect<BuildBaseRuntimeResult> => {
  const { agentId, composedSystemPrompt, state } = deps;

  return Effect.gen(function* () {
    // Task-facing defaults only (2026-07-10). Wire measurement: the old
    // default set (brief+find+pulse+recall) consumed 67% of the tool-schema
    // budget on EVERY request while live traces showed zero meta-tool calls —
    // and `find`'s scope:"auto" silently fell back to WEB SEARCH on a run
    // whose caller allowlisted two file tools. Leading harnesses (Claude
    // Agent SDK / Claude Code) expose task tools only; harness state is
    // INJECTED into the prompt, never offered back to the model as callable
    // schemas.
    //
    // - brief/pulse: opt-in. Introspection the harness already knows and can
    //   inject; asking the model to fetch it costs schema tokens every turn.
    // - find: on ONLY when documents are configured — then it is their
    //   retrieval surface. Otherwise opt-in, which also removes the silent
    //   web-egress default. (Post-build `agent.ingest()` users enable via
    //   .withMetaTools({ find: true }).)
    // - recall: stays. Load-bearing — tool-result preview+ref projections
    //   instruct "use recall(<key>)" for overflow data.
    // Explicit .withMetaTools(config|false) still overrides everything.
    const effectiveMetaTools:
      | import("../../types.js").MetaToolsConfig
      | false
      | undefined =
      state._metaTools !== undefined
        ? state._metaTools // explicit config or false
        : state._enableTools
        ? {
            brief: false,
            find: state._documents.length > 0,
            pulse: false,
            recall: true,
            // todo (P6a) stays opt-in until it passes the cross-tier lift gate
            // (default-on requires ablation per project rule — see
            // wiki/Research/Harness-Reports/2026-07-07-capability-gap-synthesis.md).
            harnessSkill: true,
          }
        : undefined; // no tools enabled — no meta-tools either

    // Resolve meta-tools configuration before building the runtime
    let kernelMetaTools: KernelMetaToolsConfig | undefined;
    if (effectiveMetaTools) {
      const mt = effectiveMetaTools;

      // Determine model tier for harness skill selection
      const tier: "frontier" | "local" =
        state._provider === "ollama" || state._provider === "litellm"
          ? "local"
          : "frontier";

      // Resolve harness content (filesystem or inline string)
      let harnessContent: string | undefined;
      if (mt.harnessSkill !== false) {
        const { resolveHarnessSkill } = yield* Effect.promise(
          () => import("../../harness-resolver.js"),
        );
        // The skill text is GENERATED from the enabled set so the prompt can
        // never teach a tool the model cannot call (harness-resolver.ts).
        const resolved = yield* Effect.promise(() =>
          resolveHarnessSkill(mt.harnessSkill ?? true, tier, {
            brief: mt.brief === true,
            find: mt.find === true,
            pulse: mt.pulse === true,
            recall: mt.recall === true,
            todo: mt.todo === true,
          }),
        );
        if (resolved) harnessContent = resolved;
      }

      kernelMetaTools = {
        brief: mt.brief,
        find: mt.find,
        pulse: mt.pulse,
        recall: mt.recall,
        todo: mt.todo,
        // Overhaul A/B (branch overhaul/agentic-core): register write_result_to_file
        // when RA_OVERHAUL=1 so the model can materialize a deliverable by reference
        // instead of transcribing / copying the [STORED:] marker.
        writeResultToFile: process.env.RA_OVERHAUL === "1",
        staticBriefInfo: {
          indexedDocuments: [],
          availableSkills: [],
          memoryBootstrap: {
            semanticLines: 0,
            episodicEntries: 0,
          },
        },
        harnessContent,
        // Agentic-UI (Task 11): thread .withUserInteraction() into the kernel so
        // think.ts offers request_user_input and act.ts intercepts it.
        userInteraction: state._userInteraction === true,
      };
    }

    // Agentic-UI (Task 11): .withUserInteraction() must reach the kernel even when
    // the other meta-tools are disabled (e.g. no .withTools()). Ensure a minimal
    // metaTools payload carries the flag so the act gate can intercept the pause.
    if (state._userInteraction === true && !kernelMetaTools) {
      kernelMetaTools = { userInteraction: true };
    }

    const composedExtraLayers = state._extraLayers;
    const llmOverrideLayer = state._llmOverrideLayer;
    /** Merged after `ExecutionEngine` is resolved so init does not run under transient `provide` scope (see CortexReporterLive). */
    let cortexReporterLayer: Layer.Layer<unknown> | null = null;
    if (state._cortexUrl !== null) {
      const { RuntimeCortexReporterLive } = yield* Effect.promise(
        () => import("../../cortex-reporter.js"),
      );
      cortexReporterLayer = RuntimeCortexReporterLive(
        state._cortexUrl,
      ) as Layer.Layer<unknown>;
    }

    // Compile harness registrations into a HarnessPipeline when `.withHarness()` was called.
    const harnessPipeline: HarnessPipeline | undefined =
      state._harnessRegistrations.length > 0
        ? (() => {
            const reg = new RegistrationHarness();
            for (const fn of state._harnessRegistrations) fn(reg);
            return new HarnessPipeline(reg._collected);
          })()
        : undefined;

    const baseRuntime = createRuntime({
      agentId,
      provider: state._provider,
      model: state._model,
      receiptSigningKey: state._receiptSigningKey,
      thinking: state._thinking,
      thinkingOptions: state._thinkingOptions,
      temperature: state._temperature,
      maxTokens: state._maxTokens,
      numCtx: state._numCtx,
      ollamaTimeoutMs: state._ollamaTimeoutMs,
      memoryTier: state._memoryTier,
      maxIterations: state._maxIterations,
      enableGuardrails: state._enableGuardrails,
      enableVerification: state._enableVerification,
      verificationOnReject: state._verificationOptions?.onReject,
      enableCostTracking: state._enableCostTracking,
      enableAudit: state._enableAudit,
      enableReasoning: state._enableReasoning,
      enableTools: state._enableTools,
      enableIdentity: state._enableIdentity,
      enableObservability: state._enableObservability,
      observabilityOptions: state._observabilityOptions,
      enableInteraction: state._enableInteraction,
      enablePrompts: state._enablePrompts,
      enableOrchestration: state._enableOrchestration,
      enableKillSwitch: state._enableKillSwitch,
      enableBehavioralContracts: state._enableBehavioralContracts,
      behavioralContract: state._behavioralContract,
      enableSelfImprovement: state._enableSelfImprovement,
      testScenario: state._testScenario,
      extraLayers: composedExtraLayers,
      // Erasure cast: the builder field is Layer<any,any,any> (public seam);
      // the option contract is a fully-resolved LLMService layer.
      llmOverrideLayer: llmOverrideLayer as Layer.Layer<LLMService> | undefined,
      systemPrompt: composedSystemPrompt,
      environmentContext: state._environmentContext,
      mcpServers:
        state._mcpServers.length > 0 ? state._mcpServers : undefined,
      reasoningOptions: state._reasoningOptions,
      enableA2A: !!state._a2aOptions,
      a2aPort: state._a2aOptions?.port,
      a2aBasePath: state._a2aOptions?.basePath,
      enableGateway: !!state._gatewayOptions,
      gatewayOptions: state._gatewayOptions,
      contextProfile: state._contextProfile,
      resultCompression: state._resultCompression,
      telemetryConfig: state._telemetryConfig,
      // When memory is enabled without an explicit dbPath (v0.12: memory is
      // off in a bare builder, so this means the user opted in via
      // `.withMemory()` / `.withLearning()` / a HarnessProfile without
      // passing `{ dbPath }`) resolve a stable
      // user-scope db path (`~/.reactive-agents/<agentId>/memory.db`).
      // Explicit `.withMemory({ dbPath: ... })` consumers keep their
      // configured path; explicit-disable paths bypass this entirely.
      //
      // Test environment isolation: when `_provider === "test"` OR
      // `NODE_ENV === "test"` (bun:test sets the latter automatically)
      // auto-resolve to SQLite's `:memory:` in-process db instead of the
      // OS-scope path. Catches both the TestLLMServiceLayer convention
      // AND builder-contracts tests that use `.withProvider("anthropic")`
      // for shape-only validation without real LLM calls. Avoids
      // accumulating `~/.reactive-agents/<agentId>/memory.db` files on
      // dev machines + CI runners; tests still exercise the full memory
      // stack but discard state on process exit.
      memoryOptions:
        state._enableMemory &&
        (!state._memoryOptions || !state._memoryOptions.dbPath)
          ? {
              ...(state._memoryOptions ?? {}),
              dbPath:
                state._provider === "test" ||
                process.env.NODE_ENV === "test"
                  ? ":memory:"
                  : defaultUserMemoryPath(agentId),
            }
          : state._memoryOptions,
      guardrailsOptions: state._guardrailsOptions,
      verificationOptions: state._verificationOptions,
      costTrackingOptions: state._costTrackingOptions,
      circuitBreakerConfig: state._circuitBreakerConfig,
      rateLimiterConfig: state._rateLimiterConfig,
      // Auto-enable adaptive required tools when reasoning + tools are both active
      // and the user hasn't explicitly configured required tools. This ensures the
      // kernel's completion guard can enforce that task-critical tools are called.
      // A `.withContract()` declaring `kind: "required"` tools unions those names
      // into this config (P2b execute-time enforcement) so they reach
      // KernelInput.requiredTools via classifier.ts:73-74 → pre-loop-dispatch.ts:149.
      requiredTools: mergeContractRequiredTools(
        state._requiredToolsConfig,
        state._taskContract,
        state._enableReasoning,
        state._enableTools,
      ),
      allowedTools: state._toolsOptions?.allowedTools,
      focusedTools: state._toolsOptions?.focusedTools,
      // A `.withContract()` declaring `kind: "forbidden"` tools excludes those
      // names from the execute-time exposed schema (P2b forbidden-half). Per
      // task-contract.ts:33-34 forbidden = "MUST NOT be visible to the LLM";
      // tool-schemas.ts reads this and drops the names AFTER MCP discovery.
      forbiddenTools: contractForbiddenTools(state._taskContract),
      // C2: the FULL declared TaskContract → reasoning-think → reasoning-service
      // → strategy → KernelInput.taskContract → compileRunContract. Required/
      // forbidden tools are also flattened above (requiredTools/forbiddenTools)
      // for the execute-time gate; this carries the whole contract (incl.
      // outputShape.mustInclude) so the RunContract compiles declared output
      // sections as deterministic requirements.
      taskContract: state._taskContract,
      adaptiveToolFiltering: state._toolsOptions?.adaptive,
      builtins: state._toolsOptions?.builtins,
      enableMemory: state._enableMemory,
      enableExperienceLearning: state._enableExperienceLearning,
      enableMemoryConsolidation: state._enableMemoryConsolidation,
      consolidationConfig: state._consolidationConfig,
      executionTimeoutMs: state._executionTimeoutMs,
      retryPolicy: state._retryPolicy,
      cacheTimeoutMs: state._cacheTimeoutMs,
      sessionPersist: state._sessionPersist,
      sessionMaxAgeDays: state._sessionMaxAgeDays,
      skillPersistence: state._skillPersistence,
      loggingConfig: state._loggingConfig as
        | import("@reactive-agents/observability").LoggingConfig
        | undefined,
      enableHealthCheck: state._enableHealthCheck,
      minIterations: state._minIterations,
      taskContext: state._taskContext,
      progressCheckpoint: state._progressCheckpoint,
      verificationStep: state._verificationStep,
      outputValidator: state._outputValidator,
      outputValidatorOptions: state._outputValidatorOptions,
      customTermination: state._customTermination,
      enableReactiveIntelligence: state._enableReactiveIntelligence,
      reactiveIntelligenceOptions: state._reactiveIntelligenceOptions,
      ...(state._skillsConfig?.paths?.length
        ? {
            skills: {
              paths: [...state._skillsConfig.paths],
              ...(state._skillsConfig.evolution
                ? {
                    evolution: {
                      ...state._skillsConfig.evolution,
                    },
                  }
                : {}),
            },
          }
        : {}),
      fallbackConfig: state._fallbackConfig,
      pricingRegistry:
        Object.keys(state._pricingRegistry).length > 0
          ? state._pricingRegistry
          : undefined,
      metaTools: kernelMetaTools,
      // Auto-enable calibration when reasoning is active and user hasn't explicitly skipped.
      // This ensures per-model adaptation (steering channel, parallel capability, classifier
      // reliability) works by default — users only need .withCalibration("skip") to opt out.
      calibration:
        state._calibration !== "skip"
          ? state._calibration
          : state._enableReasoning
          ? "auto"
          : undefined,
      leanHarness: state._leanHarness || undefined,
      budgetLimits: state._budgetLimits,
      grounding: state._groundingConfig,
      fabricationGuard: state._fabricationGuard,
      stallPolicy: state._stallPolicy,
      horizonProfile: state._longHorizon ? "long" : undefined,
      adaptiveHarness: state._adaptiveHarness || undefined,
      modelRouting: state._modelRouting,
      durableRuns: state._durableRuns,
      approvalPolicy: state._approvalPolicy
        ? {
            mode:
              state._approvalPolicy.mode ??
              (state._durableRuns ? "detach" : "block"),
            // F2: auto-feed per-tool requiresApproval flags into the policy so
            // shell-execute / code-execute / file-write (and any custom tool
            // that declares the flag) are gated without the integrator
            // re-listing each name. Only the actually-registered tools are
            // considered (built-ins always; the terminal/shell tool only when
            // enabled; custom tools as provided).
            tools: foldApprovalRequiredTools(state._approvalPolicy.tools ?? [], [
              ...builtinTools.map((t) => t.definition),
              ...(state._toolsOptions?.terminal ? [shellExecuteTool] : []),
              ...(state._toolsOptions?.tools ?? []).map((t) => t.definition),
            ]),
            requireFor: state._approvalPolicy.requireFor,
          }
        : undefined,
      harnessPipeline,
    });

    const engine = yield* (ExecutionEngine.pipe(
      Effect.provide(baseRuntime),
    ) as Effect.Effect<Context.Tag.Service<typeof ExecutionEngine>, never>);

    // `createRuntime` returns an inferred Layer whose R/E channels leak `any`
    // due to internal `as any` casts in runtime.ts; widen to a local
    // `Layer.Layer<unknown, unknown, unknown>` view at this boundary so the
    // rest of buildEffect (and {@link BuildBaseRuntimeResult}) can consume it
    // without `any`.
    const baseRuntimeView = baseRuntime as unknown as Layer.Layer<
      unknown,
      unknown,
      unknown
    >;

    const runtimeWithCortex: Layer.Layer<unknown, unknown, unknown> =
      cortexReporterLayer
        ? Layer.merge(
            baseRuntimeView,
            cortexReporterLayer.pipe(
              // Layer.merge does not auto-feed sibling outputs into sibling requirements.
              // Explicitly provide baseRuntime so reporter can resolve EventBus.
              Layer.provide(baseRuntimeView),
            ),
          )
        : baseRuntimeView;

    return {
      baseRuntime: baseRuntimeView,
      runtimeWithCortex,
      engine,
      kernelMetaTools,
    };
  });
};
