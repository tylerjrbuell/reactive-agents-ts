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
import type { GroundingOptions, DurableRunsOptions } from "../types.js";
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
  _temperature?: number;
  _maxTokens?: number;
  _numCtx?: number;
  _persona?: AgentPersona;
  _systemPrompt?: string;
  _environmentContext?: Record<string, string>;

  // memory + learning
  _memoryTier: "1" | "2";
  _enableMemory: boolean;
  _memoryExplicitlyDisabled: boolean;
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
    paths?: string[];
    packages?: string[];
    evolution?: {
      mode?: string;
      refinementThreshold?: number;
      rollbackOnRegression?: boolean;
    };
    overrides?: Record<string, { evolutionMode?: string }>;
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
  /** Opt-in durable run persistence. Absent = off (zero overhead, default). */
  _durableRuns: DurableRunsOptions | undefined;
  _executionTimeoutMs?: number;
  _retryPolicy?: { maxRetries: number; backoffMs: number };
  _cacheTimeoutMs?: number;

  // capabilities (flags + configs)
  _enableGuardrails: boolean;
  _enableVerification: boolean;
  _enableCostTracking: boolean;
  _enableAudit: boolean;
  _enableReasoning: boolean;
  _reasoningOptions?: ReasoningOptions;
  _enableTools: boolean;
  _toolsOptions?: ToolsOptions;
  _resultCompression?: ResultCompressionConfig;
  _requiredToolsConfig?: {
    tools?: readonly string[];
    adaptive?: boolean;
    maxRetries?: number;
  };
  _taskContract?: import("@reactive-agents/core").TaskContract;
  _enableIdentity: boolean;
  _enableObservability: boolean;
  _observabilityOptions: ObservabilityOptions;
  _cortexUrl: string | null;
  _enableInteraction: boolean;
  _enablePrompts: boolean;
  _promptsOptions?: PromptsOptions;
  _enableOrchestration: boolean;
  _testScenario?: TestTurn[];
  _extraLayers?: Layer.Layer<any, any, any>;
  _tracingConfig: { dir: string } | null;
  _mcpServers: MCPServerConfig[];
  _a2aOptions?: A2AOptions;
  _gatewayOptions?: GatewayOptions;
  _channelsConfig?: ChannelsConfig;
  _agentTools: AgentToolOptions[];
  _contextProfile?: Partial<ContextProfile>;
  _allowDynamicSubAgents: boolean;
  _dynamicSubAgentOptions?: { maxIterations?: number };
  _enableKillSwitch: boolean;
  _enableBehavioralContracts: boolean;
  _behavioralContract?: import("@reactive-agents/guardrails").BehavioralContract;
  _strictValidation: boolean;
  _enableEvents: boolean;
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
    models?: string[];
    errorThreshold?: number;
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
  _progressCheckpoint?: { every: number; autoResume?: boolean };
  _verificationStep?: { mode: "reflect" | "loop"; prompt?: string };
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
  _riConstraints?: {
    allowedStrategySwitch?: string[];
    maxTemperatureAdjustment?: number;
    neverEarlyStop?: boolean;
    neverHumanEscalate?: boolean;
    protectedSkills?: string[];
    lockedSkills?: string[];
  };
  _riAutonomy?: "full" | "suggest" | "observe";
  _metaTools?: import("../../types.js").MetaToolsConfig | false;

  // calibration / lean
  _calibration: CalibrationMode;
  _leanHarness: boolean;

  // RAG
  _documents: DocumentSpec[];

  // pricing
  _pricingRegistry: Record<
    string,
    { readonly input: number; readonly output: number }
  >;
  _pricingProvider?: import("@reactive-agents/llm-provider").PricingProvider;
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

// Re-export `ExecutionContext` for helpers that need it.
export type { ExecutionContext, ModelParams };

