/**
 * Shared private-field view for ReactiveAgentBuilder wither-body extractions
 * (WS-6 Phase 1).
 *
 * Each `applyXyz(builder, opts)` helper under `builder/withers/` mutates the
 * builder's private fields. TypeScript marks those fields `private` on the
 * public class, so the helpers need a typed view to perform the assignment
 * without `any`. This module concentrates that widening into a single
 * `as unknown as BuilderState` cast — see
 * `packages/runtime/test/as-unknown-as-ceiling.test.ts` for the
 * anti-regression count that this concentration feeds into.
 *
 * Mutation is intentional: withers mutate `this` in place and return `this`
 * for chaining. The shape below is a superset of every field touched by the
 * Phase-1 bucket helpers; if a future extraction needs a new private field,
 * add it here (and to `wither-applies.ts`'s legacy local `asState` once that
 * file migrates to import this module instead).
 *
 * This module is also re-exported from `src/__tests__/_helpers.ts` so test
 * assertions and production helpers share the same cast site.
 */
import type { Layer } from "effect";
import type { ReactiveAgentBuilder } from "../../builder.js";
import type {
  LifecycleHook,
  ReasoningOptions,
  ModelParams,
  ExecutionContext,
} from "../../types.js";
import type {
  ProviderName,
  AgentPersona,
  ToolsOptions,
  PromptsOptions,
  MemoryOptions,
  CostTrackingOptions,
  GuardrailsOptions,
  VerificationOptions,
  ObservabilityOptions,
  A2AOptions,
  GatewayOptions,
  AgentToolOptions,
} from "../types.js";
import type { ContextProfile } from "@reactive-agents/reasoning";
import type { ChannelsConfig } from "@reactive-agents/channels";
import type {
  ResultCompressionConfig,
  ShellExecuteConfig,
} from "@reactive-agents/tools";
import type { TestTurn } from "@reactive-agents/llm-provider";
import type { TelemetryConfig } from "@reactive-agents/observability";
import type { DocumentSpec } from "../../context-ingestion.js";
import type { CalibrationMode } from "../../types.js";
import type { BudgetLimits } from "../../builder.js";
import type { GroundingOptions, DurableRunsOptions, ModelRoutingOptions } from "../types.js";
import type { StreamDensity } from "../../stream-types.js";
import type { RuntimeErrors } from "../../errors.js";
import type { MCPServerConfig } from "../../runtime.js";
import type { RiHooks } from "../ri-wiring.js";

/**
 * Typed superset of the ReactiveAgentBuilder private fields that wither-body
 * helpers under `builder/withers/` may mutate. Field shapes mirror the
 * declarations in `packages/runtime/src/builder.ts`.
 */
export interface BuilderState {
  // identity / model
  _name: string;
  _stableAgentId?: string;
  _provider: ProviderName;
  _model?: string;
  _thinking?: boolean;
  _thinkingOptions?: import("@reactive-agents/llm-provider").ThinkingOptions;
  _temperature?: number;
  _maxTokens?: number;
  _numCtx?: number;
  _persona?: AgentPersona;
  _systemPrompt?: string;
  _environmentContext?: Record<string, string>;

  // memory + learning
  _memoryTier: "1" | "2";
  _enableMemory: boolean;
  _memoryOptions?: MemoryOptions;
  _skillPersistence?: boolean;
  _sessionPersist: boolean;
  _sessionMaxAgeDays?: number;
  _enableExperienceLearning: boolean;
  _enableMemoryConsolidation: boolean;
  _consolidationConfig?: {
    threshold?: number;
    decayFactor?: number;
    pruneThreshold?: number;
  };
  _enableSelfImprovement: boolean;
  _skillsConfig?: {
    paths: readonly string[];
    activate?: readonly string[];
  };

  // hooks / harness
  _hooks: LifecycleHook[];
  _harnessRegistrations: Array<
    (harness: import("@reactive-agents/core").Harness) => void
  >;

  // execution
  _maxIterations: number | undefined;
  _minIterations?: number;
  _budgetLimits: BudgetLimits | undefined;
  /** Opt-in numeric evidence-grounding. Absent = grounding off (default). */
  _groundingConfig: GroundingOptions | undefined;
  /** Fabrication-guard mode. Absent = "block" (always-on default). */
  _fabricationGuard: import("@reactive-agents/reasoning").FabricationGuardMode | undefined;
  /** Stall/no-progress policy override. Absent = sensible defaults. */
  _stallPolicy: import("@reactive-agents/reasoning").StallPolicy | undefined;
  /** Opt-in long-horizon guard profile. false = absolute-count guards (default). */
  _longHorizon: boolean;
  /** Opt-in adaptive harness (Phase 6 / G1). false = no plan compiled (default). */
  _adaptiveHarness: boolean;
  /** Opt-in cost-aware model routing. Absent = off (default). */
  _modelRouting: ModelRoutingOptions | undefined;
  /** Opt-in durable run persistence. Absent = off (zero overhead, default). */
  _durableRuns: DurableRunsOptions | undefined;
  _executionTimeoutMs?: number;
  _ollamaTimeoutMs?: number;
  _retryPolicy?: { maxRetries: number; backoffMs: number };

  // capabilities (flags + configs)
  _enableGuardrails: boolean;
  _enableVerification: boolean;
  _enableCostTracking: boolean;
  _enableAudit: boolean;
  _enableReasoning: boolean;
  _reasoningOptions?: ReasoningOptions;
  _enableTools: boolean;
  _toolsOptions?: ToolsOptions;
  _scratchpad: Map<string, string>;
  _resultCompression?: ResultCompressionConfig;
  _requiredToolsConfig?: {
    tools?: readonly string[];
    adaptive?: boolean;
    maxRetries?: number;
  };
  _taskContract?: import("@reactive-agents/core").TaskContract;
  _enableObservability: boolean;
  _observabilityOptions: ObservabilityOptions;
  _cortexUrl: string | null;
  _enablePrompts: boolean;
  _promptsOptions?: PromptsOptions;
  _testScenario?: TestTurn[];
  _extraLayers?: Layer.Layer<never, unknown, unknown>;
  _tracingConfig: { dir: string } | null;
  _mcpServers: MCPServerConfig[];
  _a2aOptions?: A2AOptions;
  _gatewayOptions?: GatewayOptions;
  _channelsConfig?: ChannelsConfig;
  _agentTools: AgentToolOptions[];
  _contextProfile?: Partial<ContextProfile>;
  _allowDynamicSubAgents: boolean;
  _dynamicSubAgentOptions?: { maxIterations?: number; maxRecursionDepth?: number };
  _enableKillSwitch: boolean;
  _enableBehavioralContracts: boolean;
  _behavioralContract?: import("@reactive-agents/guardrails").BehavioralContract;
  _strictValidation: boolean;
  _streamDensity?: StreamDensity;
  _telemetryConfig?: TelemetryConfig;
  _loggingConfig?: {
    level?: string;
    format?: string;
    output?: string | WritableStream;
  };
  _costTrackingOptions?: CostTrackingOptions;
  _guardrailsOptions?: GuardrailsOptions;
  _verificationOptions?: VerificationOptions;
  _circuitBreakerConfig?:
    | Partial<import("@reactive-agents/llm-provider").CircuitBreakerConfig>
    | false;
  _rateLimiterConfig?: import("@reactive-agents/llm-provider").RateLimiterConfig;
  _fallbackConfig?: {
    providers?: string[];
  };

  // error / health / progress
  _errorHandler?: (
    error: RuntimeErrors | Error,
    context: {
      taskId: string;
      phase: string;
      iteration: number;
      lastStep?: string;
    },
  ) => void;
  _enableHealthCheck: boolean;
  _taskContext?: Record<string, string>;
  _verificationStep?: { mode: "reflect"; prompt?: string };
  _outputValidator?: (output: string) => {
    valid: boolean;
    feedback?: string;
  };
  _outputValidatorOptions?: { maxRetries?: number };
  _customTermination?: (state: { output: string }) => boolean;

  // reactive intelligence
  _enableReactiveIntelligence: boolean;
  _reactiveIntelligenceOptions?: Partial<
    import("@reactive-agents/reactive-intelligence").ReactiveIntelligenceConfig
  >;
  _riHooks?: RiHooks;
  _metaTools?: import("../../types.js").MetaToolsConfig | false;

  // calibration / lean
  // `undefined` = user never called `.withCalibration()` (auto-enabled when
  // reasoning is on); an explicit `"skip"` is a real opt-out. See P0-9 /
  // resolveCalibrationSetting.
  _calibration?: CalibrationMode;
  _leanHarness: boolean;

  // RAG
  _documents: DocumentSpec[];

  // pricing
  _pricingRegistry: Record<
    string,
    { readonly input: number; readonly output: number }
  >;
  _pricingProvider?: import("@reactive-agents/llm-provider").PricingProvider;

  // build()/buildEffect() extraction surfaces (2026-10-20 builder decomp)
  // — fields the moved bodies read/mutate that the Phase-1 wither buckets
  // did not touch. Declared here (same single `as unknown as` cast
  // site via `asBuilderState`) rather than a parallel view.
  // Explicit provider intent (`.withProvider` / `.withTestScenario`).
  _providerExplicit: boolean;
  _providerConfig?: {
    baseUrl?: string;
    apiKey?: string;
    headers?: Record<string, string>;
  };
  _mcpToolkitRequests: import("@reactive-agents/tools").MCPToolkitRequest[];
  _lazyValidation: boolean;
  _enableJudgment: boolean;
  _judgmentOptions?: import("../types.js").JudgmentBuilderOptions;
  _judgmentShadowDbPath?: string;
  _approvalPolicy?: import("../types.js").ApprovalPolicyConfig;
  _userInteraction: boolean;
  _llmOverrideLayer?: Layer.Layer<
    import("@reactive-agents/llm-provider").LLMService
  >;
  _outputSchemaConfig?:
    | {
        readonly contract: import("@reactive-agents/reasoning").SchemaContract<unknown>;
        readonly options: import("../types.js").OutputSchemaOptions;
      }
    | undefined;
  _receiptSigningKey: JsonWebKey | undefined;
  _toolIntentClassifier?: (message: string) => boolean;
  _openInferenceAdded?: boolean;
}

/**
 * Cast a ReactiveAgentBuilder to its private-field view for mutation.
 *
 * Single concentrated `as unknown as` site for all builder/withers/ helpers.
 * Adding new bucket files is cast-budget neutral — they import this helper
 * rather than declare their own local cast.
 */
export const asBuilderState = (
  builder: ReactiveAgentBuilder,
): BuilderState => builder as unknown as BuilderState;

/**
 * Compile-time drift guard for this module's {@link BuilderState} view: the
 * withers-side mirror of `ReactiveAgentBuilder._assertRuntimeStateViewShape`
 * in `packages/runtime/src/builder.ts` (quality program Task 13 / GH #261).
 *
 * `asBuilderState` above is a genuine `as unknown as` widening, and nothing
 * in type space can replace the per-field assertion: TypeScript's
 * class-privacy branding blocks the class from being assignable to a plain
 * interface, and `keyof`/`Pick` over a class type exclude its private
 * members. Inside the class body the sibling guard names each field with
 * `self._field` (private access is legal there); OUTSIDE the class that dot
 * access fails to compile (TS2341), but string-literal element access
 * (`self['_field']`) resolves the private member's REAL type and gives the
 * identical mechanism: rename or remove a backing class field and its
 * `self['_field']` access stops typechecking (TS7053 — no index signature
 * and no such key); drift a backing field's type and the object-literal-to-
 * `BuilderState` assignment fails (TS2322/TS2741); add a `BuilderState`
 * member with no backing field and its access fails the same way. Never
 * constructed at runtime — type-checked only.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _assertBuilderStateViewShape = (
  self: ReactiveAgentBuilder,
): BuilderState => ({
  _name: self['_name'],
  _stableAgentId: self['_stableAgentId'],
  _provider: self['_provider'],
  _model: self['_model'],
  _thinking: self['_thinking'],
  _thinkingOptions: self['_thinkingOptions'],
  _temperature: self['_temperature'],
  _maxTokens: self['_maxTokens'],
  _numCtx: self['_numCtx'],
  _persona: self['_persona'],
  _systemPrompt: self['_systemPrompt'],
  _environmentContext: self['_environmentContext'],
  _memoryTier: self['_memoryTier'],
  _enableMemory: self['_enableMemory'],
  _memoryOptions: self['_memoryOptions'],
  _skillPersistence: self['_skillPersistence'],
  _sessionPersist: self['_sessionPersist'],
  _sessionMaxAgeDays: self['_sessionMaxAgeDays'],
  _enableExperienceLearning: self['_enableExperienceLearning'],
  _enableMemoryConsolidation: self['_enableMemoryConsolidation'],
  _consolidationConfig: self['_consolidationConfig'],
  _enableSelfImprovement: self['_enableSelfImprovement'],
  _skillsConfig: self['_skillsConfig'],
  _hooks: self['_hooks'],
  _harnessRegistrations: self['_harnessRegistrations'],
  _maxIterations: self['_maxIterations'],
  _minIterations: self['_minIterations'],
  _budgetLimits: self['_budgetLimits'],
  _groundingConfig: self['_groundingConfig'],
  _fabricationGuard: self['_fabricationGuard'],
  _stallPolicy: self['_stallPolicy'],
  _longHorizon: self['_longHorizon'],
  _adaptiveHarness: self['_adaptiveHarness'],
  _modelRouting: self['_modelRouting'],
  _durableRuns: self['_durableRuns'],
  _executionTimeoutMs: self['_executionTimeoutMs'],
  _ollamaTimeoutMs: self['_ollamaTimeoutMs'],
  _retryPolicy: self['_retryPolicy'],
  _enableGuardrails: self['_enableGuardrails'],
  _enableVerification: self['_enableVerification'],
  _enableCostTracking: self['_enableCostTracking'],
  _enableAudit: self['_enableAudit'],
  _enableReasoning: self['_enableReasoning'],
  _reasoningOptions: self['_reasoningOptions'],
  _enableTools: self['_enableTools'],
  _toolsOptions: self['_toolsOptions'],
  _scratchpad: self['_scratchpad'],
  _resultCompression: self['_resultCompression'],
  _requiredToolsConfig: self['_requiredToolsConfig'],
  _taskContract: self['_taskContract'],
  _enableObservability: self['_enableObservability'],
  _observabilityOptions: self['_observabilityOptions'],
  _cortexUrl: self['_cortexUrl'],
  _enablePrompts: self['_enablePrompts'],
  _promptsOptions: self['_promptsOptions'],
  _testScenario: self['_testScenario'],
  _extraLayers: self['_extraLayers'],
  _tracingConfig: self['_tracingConfig'],
  _mcpServers: self['_mcpServers'],
  _a2aOptions: self['_a2aOptions'],
  _gatewayOptions: self['_gatewayOptions'],
  _channelsConfig: self['_channelsConfig'],
  _agentTools: self['_agentTools'],
  _contextProfile: self['_contextProfile'],
  _allowDynamicSubAgents: self['_allowDynamicSubAgents'],
  _dynamicSubAgentOptions: self['_dynamicSubAgentOptions'],
  _enableKillSwitch: self['_enableKillSwitch'],
  _enableBehavioralContracts: self['_enableBehavioralContracts'],
  _behavioralContract: self['_behavioralContract'],
  _strictValidation: self['_strictValidation'],
  _streamDensity: self['_streamDensity'],
  _telemetryConfig: self['_telemetryConfig'],
  _loggingConfig: self['_loggingConfig'],
  _costTrackingOptions: self['_costTrackingOptions'],
  _guardrailsOptions: self['_guardrailsOptions'],
  _verificationOptions: self['_verificationOptions'],
  _circuitBreakerConfig: self['_circuitBreakerConfig'],
  _rateLimiterConfig: self['_rateLimiterConfig'],
  _fallbackConfig: self['_fallbackConfig'],
  _errorHandler: self['_errorHandler'],
  _enableHealthCheck: self['_enableHealthCheck'],
  _taskContext: self['_taskContext'],
  _verificationStep: self['_verificationStep'],
  _outputValidator: self['_outputValidator'],
  _outputValidatorOptions: self['_outputValidatorOptions'],
  _customTermination: self['_customTermination'],
  _enableReactiveIntelligence: self['_enableReactiveIntelligence'],
  _reactiveIntelligenceOptions: self['_reactiveIntelligenceOptions'],
  _riHooks: self['_riHooks'],
  _metaTools: self['_metaTools'],
  _calibration: self['_calibration'],
  _leanHarness: self['_leanHarness'],
  _documents: self['_documents'],
  _pricingRegistry: self['_pricingRegistry'],
  _pricingProvider: self['_pricingProvider'],
  _providerExplicit: self['_providerExplicit'],
  _providerConfig: self['_providerConfig'],
  _mcpToolkitRequests: self['_mcpToolkitRequests'],
  _lazyValidation: self['_lazyValidation'],
  _enableJudgment: self['_enableJudgment'],
  _judgmentOptions: self['_judgmentOptions'],
  _judgmentShadowDbPath: self['_judgmentShadowDbPath'],
  _approvalPolicy: self['_approvalPolicy'],
  _userInteraction: self['_userInteraction'],
  _llmOverrideLayer: self['_llmOverrideLayer'],
  _outputSchemaConfig: self['_outputSchemaConfig'],
  _receiptSigningKey: self['_receiptSigningKey'],
  _toolIntentClassifier: self['_toolIntentClassifier'],
  _openInferenceAdded: self['_openInferenceAdded'],
});

// Re-export `ExecutionContext` for helpers that need it.
export type { ExecutionContext, ModelParams };

