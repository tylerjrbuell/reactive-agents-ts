/**
 * Builder → AgentConfig serialization.
 *
 * Lifted from agent-config.ts (`builderToConfig`) and the inline
 * `toConfig()` mapper on `ReactiveAgentBuilder` (W25-A step 3).
 *
 * Pure refactor — no behavior change. The function reads the builder's
 * underscore-prefixed state fields directly and maps them to a plain
 * JSON `AgentConfig` object.
 *
 * To avoid a runtime circular import with `../builder.js`, the function
 * is typed against a structural `BuilderStateForSerialization` interface
 * rather than `ReactiveAgentBuilder` itself. The builder class
 * structurally satisfies this interface.
 */
import type { AgentConfig } from "../agent-config.js";
import type { ReasoningOptions } from "../types.js";
import type {
  ToolsOptions,
  GuardrailsOptions,
  MemoryOptions,
  ObservabilityOptions,
  CostTrackingOptions,
  VerificationOptions,
} from "./types.js";

/**
 * Structural slice of `ReactiveAgentBuilder` that the serializer reads.
 *
 * The builder class fields are mutable (set by `with*()` methods), so
 * this is intentionally a non-readonly view. Its only purpose is to
 * make the serializer's read coupling TypeScript-checkable without
 * requiring a runtime import of the builder class.
 */
export interface BuilderStateForSerialization {
  _name: string;
  _provider: string;
  _model?: string;
  _thinking?: boolean;
  _thinkingOptions?: import("@reactive-agents/llm-provider").ThinkingOptions;
  _temperature?: number;
  _maxTokens?: number;
  _numCtx?: number;
  _systemPrompt?: string;
  _persona?: unknown;
  _enableReasoning: boolean;
  _reasoningOptions?: ReasoningOptions;
  _enableTools: boolean;
  _toolsOptions?: ToolsOptions;
  _enableGuardrails: boolean;
  _guardrailsOptions?: GuardrailsOptions;
  _enableMemory: boolean;
  _memoryTier: "1" | "2";
  _memoryOptions?: MemoryOptions;
  _enableExperienceLearning: boolean;
  _enableMemoryConsolidation: boolean;
  _enableObservability: boolean;
  _observabilityOptions?: ObservabilityOptions;
  _enableCostTracking: boolean;
  _costTrackingOptions?: CostTrackingOptions;
  _enableVerification: boolean;
  _verificationOptions?: VerificationOptions;
  _maxIterations: number | undefined;
  _executionTimeoutMs?: number;
  _retryPolicy?: { maxRetries: number; backoffMs: number };
  _strictValidation: boolean;
  _gatewayOptions?: unknown;
  _mcpServers: unknown[];
  _enableReactiveIntelligence: boolean;
  _reactiveIntelligenceOptions?: unknown;
  _loggingConfig?: unknown;
  _fallbackConfig?: unknown;
  _enablePrompts: boolean;
  _enableKillSwitch: boolean;
  _enableAudit: boolean;
  _enableSelfImprovement: boolean;
  _enableHealthCheck: boolean;
  _streamDensity?: string;
  _pricingRegistry?: Record<string, { readonly input: number; readonly output: number }>;
  _groundingConfig?: { mode: "block" | "warn"; tolerance?: number; maxRetries?: number };
  _fabricationGuard?: "off" | "warn" | "block";
  _stallPolicy?: { ignoredNudgeTolerance?: number; escalateNudgeContent?: boolean };
  _longHorizon?: boolean;
  _adaptiveHarness?: boolean;
  _taskContext?: Record<string, string>;
  _outputSchemaConfig?: {
    options?: {
      mode?: "auto" | "fast" | "grounded";
      onParseFail?: "degrade" | "throw";
      abstainBelow?: number;
    };
  };
  _stableAgentId?: string;
  _minIterations?: number;
  _requiredToolsConfig?: { tools?: readonly string[]; adaptive?: boolean; maxRetries?: number };
  _budgetLimits?: { tokenLimit?: number; costLimit?: number; warningRatio?: number };
  _circuitBreakerConfig?:
    | { failureThreshold?: number; cooldownMs?: number; halfOpenRequests?: number }
    | false;
  _rateLimiterConfig?: { requestsPerMinute?: number; tokensPerMinute?: number; maxConcurrent?: number };
  _skillPersistence?: boolean;
  _durableRuns?: { dir?: string; checkpointEvery?: number };
}

/**
 * Build an `AgentConfig` from the internal state of a `ReactiveAgentBuilder`.
 *
 * This is the reverse of `agentConfigToBuilder` — used by `builder.toConfig()`.
 *
 * @internal
 */
export function serializeBuilder(state: BuilderStateForSerialization): AgentConfig {
  const config: Record<string, unknown> = {
    name: state._name,
    provider: state._provider,
  };

  if (state._stableAgentId) config["agentId"] = state._stableAgentId;

  if (state._model) config["model"] = state._model;
  if (state._thinking !== undefined) config["thinking"] = state._thinking;
  if (state._thinkingOptions !== undefined) config["thinkingOptions"] = state._thinkingOptions;
  if (state._temperature !== undefined) config["temperature"] = state._temperature;
  if (state._maxTokens !== undefined) config["maxTokens"] = state._maxTokens;
  if (state._numCtx !== undefined) config["numCtx"] = state._numCtx;
  if (state._systemPrompt) config["systemPrompt"] = state._systemPrompt;
  if (state._persona) config["persona"] = state._persona;

  // Reasoning
  if (state._enableReasoning || state._reasoningOptions) {
    const r: Record<string, unknown> = {};
    const ro = state._reasoningOptions;
    if (ro?.defaultStrategy) r["defaultStrategy"] = ro.defaultStrategy;
    if (ro?.enableStrategySwitching !== undefined) r["enableStrategySwitching"] = ro.enableStrategySwitching;
    if (ro?.maxStrategySwitches !== undefined) r["maxStrategySwitches"] = ro.maxStrategySwitches;
    if (ro?.fallbackStrategy) r["fallbackStrategy"] = ro.fallbackStrategy;
    if (ro?.auditRationale !== undefined) r["auditRationale"] = ro.auditRationale;
    config["reasoning"] = r;
  }

  // Tools
  if (state._enableTools || state._toolsOptions) {
    const t: Record<string, unknown> = {};
    const to = state._toolsOptions;
    if (to?.allowedTools) t["allowedTools"] = [...to.allowedTools];
    if (to?.focusedTools) t["focusedTools"] = [...to.focusedTools];
    if (to?.adaptive !== undefined) t["adaptive"] = to.adaptive;
    if (to?.terminal !== undefined) {
      t["terminal"] =
        typeof to.terminal === "boolean" ? to.terminal : true;
    }
    config["tools"] = t;
  }

  // Guardrails
  if (state._enableGuardrails || state._guardrailsOptions) {
    const g: Record<string, unknown> = {};
    const go = state._guardrailsOptions;
    if (go?.injection !== undefined) g["injection"] = go.injection;
    if (go?.pii !== undefined) g["pii"] = go.pii;
    if (go?.toxicity !== undefined) g["toxicity"] = go.toxicity;
    if (go?.customBlocklist) g["customBlocklist"] = [...go.customBlocklist];
    config["guardrails"] = g;
  }

  // Memory
  if (state._enableMemory || state._memoryOptions) {
    const m: Record<string, unknown> = {};
    // Map internal "1"/"2" back to "standard"/"enhanced"
    m["tier"] = state._memoryTier === "2" ? "enhanced" : "standard";
    const mo = state._memoryOptions;
    if (mo?.dbPath) m["dbPath"] = mo.dbPath;
    if (mo?.maxEntries !== undefined) m["maxEntries"] = mo.maxEntries;
    if (mo?.capacity !== undefined) m["capacity"] = mo.capacity;
    if (mo?.evictionPolicy) m["evictionPolicy"] = mo.evictionPolicy;
    if (mo?.retainDays !== undefined) m["retainDays"] = mo.retainDays;
    if (mo?.importanceThreshold !== undefined) m["importanceThreshold"] = mo.importanceThreshold;
    if (state._enableExperienceLearning) m["experienceLearning"] = true;
    if (state._enableMemoryConsolidation) m["memoryConsolidation"] = true;
    config["memory"] = m;
  }

  // Observability
  if (state._enableObservability || state._observabilityOptions) {
    const o: Record<string, unknown> = {};
    const oo = state._observabilityOptions;
    if (oo?.verbosity) o["verbosity"] = oo.verbosity;
    if (oo?.live !== undefined) o["live"] = oo.live;
    if (oo?.file) o["file"] = oo.file;
    if (oo?.logModelIO !== undefined) o["logModelIO"] = oo.logModelIO;
    // Fan-out sub-options (P3/G8/G11) — emitted from the raw options object so
    // `withObservability({ cortex, tracing, ... })` round-trips through config.
    if (oo?.cortex !== undefined) o["cortex"] = oo.cortex;
    if (oo?.telemetry !== undefined) o["telemetry"] = oo.telemetry;
    if (oo?.logging !== undefined) o["logging"] = oo.logging;
    if (oo?.tracing !== undefined) o["tracing"] = oo.tracing;
    if (oo?.health !== undefined) o["health"] = oo.health;
    if (oo?.audit !== undefined) o["audit"] = oo.audit;
    if (oo?.costs !== undefined) o["costs"] = oo.costs;
    config["observability"] = o;
  }

  // Cost tracking
  if (state._enableCostTracking || state._costTrackingOptions) {
    const c: Record<string, unknown> = {};
    const co = state._costTrackingOptions;
    if (co?.perRequest !== undefined) c["perRequest"] = co.perRequest;
    if (co?.perSession !== undefined) c["perSession"] = co.perSession;
    if (co?.daily !== undefined) c["daily"] = co.daily;
    if (co?.monthly !== undefined) c["monthly"] = co.monthly;
    config["costTracking"] = c;
  }

  // Verification
  if (state._enableVerification || state._verificationOptions) {
    const v: Record<string, unknown> = {};
    const vo = state._verificationOptions;
    if (vo?.semanticEntropy !== undefined) v["semanticEntropy"] = vo.semanticEntropy;
    if (vo?.factDecomposition !== undefined) v["factDecomposition"] = vo.factDecomposition;
    if (vo?.multiSource !== undefined) v["multiSource"] = vo.multiSource;
    if (vo?.selfConsistency !== undefined) v["selfConsistency"] = vo.selfConsistency;
    if (vo?.nli !== undefined) v["nli"] = vo.nli;
    if (vo?.hallucinationDetection !== undefined) v["hallucinationDetection"] = vo.hallucinationDetection;
    if (vo?.hallucinationThreshold !== undefined) v["hallucinationThreshold"] = vo.hallucinationThreshold;
    if (vo?.passThreshold !== undefined) v["passThreshold"] = vo.passThreshold;
    if (vo?.riskThreshold !== undefined) v["riskThreshold"] = vo.riskThreshold;
    if (vo?.useLLMTier !== undefined) v["useLLMTier"] = vo.useLLMTier;
    if (vo?.onReject !== undefined) v["onReject"] = vo.onReject;
    config["verification"] = v;
  }

  // Execution
  const exec: Record<string, unknown> = {};
  if (state._maxIterations !== undefined) exec["maxIterations"] = state._maxIterations;
  if (state._minIterations !== undefined) exec["minIterations"] = state._minIterations;
  if (state._executionTimeoutMs !== undefined) exec["timeoutMs"] = state._executionTimeoutMs;
  if (state._retryPolicy) exec["retryPolicy"] = { ...state._retryPolicy };
  if (state._strictValidation) exec["strictValidation"] = true;
  if (Object.keys(exec).length > 0) config["execution"] = exec;

  // Gateway
  if (state._gatewayOptions) config["gateway"] = state._gatewayOptions;

  // MCP servers
  if (state._mcpServers.length > 0) config["mcpServers"] = [...state._mcpServers];

  // Reactive intelligence
  if (state._enableReactiveIntelligence) {
    config["reactiveIntelligence"] = { enabled: true };
  }

  // Logging
  if (state._loggingConfig) config["logging"] = state._loggingConfig;

  // Fallbacks
  if (state._fallbackConfig) config["fallbacks"] = state._fallbackConfig;

  // Feature flags
  const features: Record<string, boolean> = {};
  if (state._enableGuardrails) features["guardrails"] = true;
  if (state._enableVerification) features["verification"] = true;
  if (state._enableCostTracking) features["costTracking"] = true;
  if (state._enableReasoning) features["reasoning"] = true;
  if (state._enableTools) features["tools"] = true;
  if (state._enableMemory) features["memory"] = true;
  if (state._enableObservability) features["observability"] = true;
  if (state._enablePrompts) features["prompts"] = true;
  if (state._enableKillSwitch) features["killSwitch"] = true;
  if (state._enableAudit) features["audit"] = true;
  if (state._enableSelfImprovement) features["selfImprovement"] = true;
  if (state._enableHealthCheck) features["healthCheck"] = true;
  features["reactiveIntelligence"] = state._enableReactiveIntelligence;
  if (state._streamDensity) features["streaming"] = true;
  if (Object.keys(features).length > 0) config["features"] = features;

  if (state._pricingRegistry && Object.keys(state._pricingRegistry).length > 0) {
    config["pricingRegistry"] = state._pricingRegistry;
  }

  // Grounding (opt-in; absent = off)
  if (state._groundingConfig) {
    const gr: Record<string, unknown> = { mode: state._groundingConfig.mode };
    if (state._groundingConfig.tolerance !== undefined) gr["tolerance"] = state._groundingConfig.tolerance;
    if (state._groundingConfig.maxRetries !== undefined) gr["maxRetries"] = state._groundingConfig.maxRetries;
    config["grounding"] = gr;
  }

  // Fabrication guard (always-on by default; serialize explicit override)
  if (state._fabricationGuard !== undefined) config["fabricationGuard"] = state._fabricationGuard;

  // Stall/no-progress policy
  if (state._stallPolicy) {
    const sp: Record<string, unknown> = {};
    if (state._stallPolicy.ignoredNudgeTolerance !== undefined) sp["ignoredNudgeTolerance"] = state._stallPolicy.ignoredNudgeTolerance;
    if (state._stallPolicy.escalateNudgeContent !== undefined) sp["escalateNudgeContent"] = state._stallPolicy.escalateNudgeContent;
    config["stallPolicy"] = sp;
  }

  // Long-horizon guard profile (opt-in; absent = off)
  if (state._longHorizon) config["horizonProfile"] = "long";

  // Adaptive harness / policy compiler (opt-in; absent = off, byte-identical)
  if (state._adaptiveHarness) config["adaptiveHarness"] = true;

  // Structured-output behavioural options. The schema object itself is not
  // JSON-serializable, but the options round-trip OUT so a config snapshot is
  // lossless; re-applying them requires `.withOutputSchema(schema, options)` in
  // code (see agent-config.ts roundtrip note).
  if (state._outputSchemaConfig?.options) {
    const o = state._outputSchemaConfig.options;
    const oso: Record<string, unknown> = {};
    if (o.mode !== undefined) oso["mode"] = o.mode;
    if (o.onParseFail !== undefined) oso["onParseFail"] = o.onParseFail;
    if (o.abstainBelow !== undefined) oso["abstainBelow"] = o.abstainBelow;
    if (Object.keys(oso).length > 0) config["outputSchemaOptions"] = oso;
  }

  // Task context (background data injected into reasoning memory)
  if (state._taskContext && Object.keys(state._taskContext).length > 0) {
    config["taskContext"] = { ...state._taskContext };
  }

  // Required tools
  if (state._requiredToolsConfig) {
    const rt: Record<string, unknown> = {};
    const rtc = state._requiredToolsConfig;
    if (rtc.tools) rt["tools"] = [...rtc.tools];
    if (rtc.adaptive !== undefined) rt["adaptive"] = rtc.adaptive;
    if (rtc.maxRetries !== undefined) rt["maxRetries"] = rtc.maxRetries;
    config["requiredTools"] = rt;
  }

  // Budget caps
  if (state._budgetLimits) config["budget"] = { ...state._budgetLimits };

  // Circuit breaker (`false` = disabled; object pins thresholds)
  if (state._circuitBreakerConfig === false) {
    config["circuitBreaker"] = false;
  } else if (state._circuitBreakerConfig) {
    config["circuitBreaker"] = { ...state._circuitBreakerConfig };
  }

  // Rate limiting
  if (state._rateLimiterConfig) config["rateLimiting"] = { ...state._rateLimiterConfig };

  // Skill persistence
  if (state._skillPersistence !== undefined) config["skillPersistence"] = state._skillPersistence;

  // Durable runs (crash-resume)
  if (state._durableRuns) config["durableRuns"] = { ...state._durableRuns };

  return config as AgentConfig;
}
