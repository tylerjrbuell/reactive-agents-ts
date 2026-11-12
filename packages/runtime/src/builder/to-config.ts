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
import { parametersToJsonSchema } from "./build-effect/sub-agent-parameters.js";
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
  /** Only the serializable part of `.withChannels()`: the routes (adapters are live objects). */
  _channelsConfig?: { readonly routes?: readonly unknown[] };
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
    contract?: { toJsonSchema: () => Record<string, unknown> | undefined };
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
  _debrief?: boolean;
  _durableRuns?: { dir?: string; checkpointEvery?: number };
  _approvalPolicy?: import("@reactive-agents/reasoning").AuthoredApprovalPolicy;
  _userInteraction?: false | { readonly timeoutMs?: number };
  _ollamaTimeoutMs?: number;
  _skillsConfig?: { paths?: readonly string[]; activate?: readonly string[]; global?: boolean };
  _metaTools?: import("../types.js").MetaToolsConfig | false;
  _agentTools: readonly import("./types.js").AgentToolOptions[];
  _allowDynamicSubAgents: boolean;
  _dynamicSubAgentOptions?: { maxIterations?: number; maxRecursionDepth?: number };
  _verificationStep?: { mode: "reflect"; prompt?: string };
  _documents: readonly import("../context-ingestion.js").DocumentSpec[];
  _modelRouting?: import("./types.js").ModelRoutingOptions;
}

/** Keep only the keys whose value is not `undefined`. */
const defined = (obj: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
};

type ShellConfig = Exclude<NonNullable<ToolsOptions["terminal"]>, boolean>;

/** The data fields of a shell config; RegExp and function fields are code-only. */
const shellData = (t: ShellConfig): Record<string, unknown> =>
  defined({
    cwd: t.cwd,
    allowUnsafeCwd: t.allowUnsafeCwd,
    timeoutMs: t.timeoutMs,
    maxOutputChars: t.maxOutputChars,
    allowedCommands: t.allowedCommands ? [...t.allowedCommands] : undefined,
    additionalCommands: t.additionalCommands ? [...t.additionalCommands] : undefined,
    commandAccess: t.commandAccess
      ? defined({
          capabilities: t.commandAccess.capabilities ? [...t.commandAccess.capabilities] : undefined,
          commands: t.commandAccess.commands ? [...t.commandAccess.commands] : undefined,
        })
      : undefined,
    sandbox: t.sandbox,
  });

/** One sub-agent tool as config data; `agent.parameters` is stored as a JSON Schema object. */
const agentToolData = (t: import("./types.js").AgentToolOptions): Record<string, unknown> => {
  if (t.remoteUrl !== undefined) return { name: t.name, remoteUrl: t.remoteUrl };
  if (!t.agent) return { name: t.name };
  const { parameters, ...agent } = t.agent;
  return {
    name: t.name,
    agent: defined({
      ...agent,
      tools: agent.tools ? [...agent.tools] : undefined,
      parameters: parameters ? parametersToJsonSchema(parameters) : undefined,
    }),
  };
};

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
  // Thinking: the object form only when it carries more than on/off.
  const th = state._thinkingOptions;
  if (th && (th.effort !== undefined || th.budgetTokens !== undefined)) config["thinking"] = { ...th };
  else if (state._thinking !== undefined) config["thinking"] = state._thinking;
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
    if (ro?.harness !== undefined) r["harness"] = ro.harness;
    if (ro?.synthesis !== undefined) r["synthesis"] = ro.synthesis;
    if (ro?.synthesisModel !== undefined) r["synthesisModel"] = ro.synthesisModel;
    if (ro?.synthesisProvider !== undefined) r["synthesisProvider"] = ro.synthesisProvider;
    if (ro?.synthesisTemperature !== undefined) r["synthesisTemperature"] = ro.synthesisTemperature;
    // Copied whole: the shapes are the JSON schema's own (ReasoningOptionsJsonSchema).
    if (ro?.strategies !== undefined) r["strategies"] = structuredClone(ro.strategies);
    if (ro?.adaptive !== undefined) r["adaptive"] = { ...ro.adaptive };
    if (ro?.parallelToolCalls !== undefined) r["parallelToolCalls"] = ro.parallelToolCalls;
    if (ro?.observationSummary !== undefined) r["observationSummary"] = ro.observationSummary;
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
      t["terminal"] = typeof to.terminal === "boolean" ? to.terminal : shellData(to.terminal);
    }
    if (to?.builtins !== undefined) {
      t["builtins"] = Array.isArray(to.builtins) ? [...to.builtins] : to.builtins;
    }
    if (to?.riskLevels !== undefined) t["riskLevels"] = { ...to.riskLevels };
    if (to?.maxCallsPerTool !== undefined) t["maxCallsPerTool"] = { ...to.maxCallsPerTool };
    if (to?.workspace !== undefined) t["workspace"] = to.workspace;
    if (to?.disclosure !== undefined) t["disclosure"] = to.disclosure;
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

  // Observability. Gate on the flag alone: the builder always holds default
  // options (`{ verbosity: "minimal" }`) even when observability is off, and
  // emitting them would make agentConfigToBuilder turn observability on.
  // Options only take effect when the flag is on (runtime-construction.ts).
  if (state._enableObservability) {
    const o: Record<string, unknown> = {};
    const oo = state._observabilityOptions;
    if (oo?.verbosity) o["verbosity"] = oo.verbosity;
    if (oo?.live !== undefined) o["live"] = oo.live;
    if (oo?.file) o["file"] = oo.file;
    if (oo?.logModelIO !== undefined) o["logModelIO"] = oo.logModelIO;
    if (oo?.checklist !== undefined) o["checklist"] = oo.checklist;
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
  if (state._ollamaTimeoutMs !== undefined) exec["llmTimeoutMs"] = state._ollamaTimeoutMs;
  if (Object.keys(exec).length > 0) config["execution"] = exec;

  // Gateway
  if (state._gatewayOptions) config["gateway"] = state._gatewayOptions;

  // Channel routes (data); the adapters and agent factories of `.withChannels()` stay code-only.
  const channelRoutes = state._channelsConfig?.routes;
  if (channelRoutes && channelRoutes.length > 0) config["channelRoutes"] = [...channelRoutes];

  // MCP servers
  if (state._mcpServers.length > 0) config["mcpServers"] = [...state._mcpServers];

  // Reactive intelligence: `enabled` plus the options object of
  // `.withReactiveIntelligence({...})` (hooks were split off when it was applied).
  if (state._enableReactiveIntelligence) {
    const riOptions =
      typeof state._reactiveIntelligenceOptions === "object" && state._reactiveIntelligenceOptions !== null
        ? (state._reactiveIntelligenceOptions as Record<string, unknown>)
        : {};
    config["reactiveIntelligence"] = { enabled: true, ...riOptions };
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

  // Structured output: the schema as JSON Schema (when the source schema can be
  // converted: Effect, Zod, Valibot, ArkType, or a JSON Schema given as-is) plus
  // the behavioural options. A schema with no JSON Schema form (e.g. a custom
  // Standard Schema vendor) emits only the options.
  const outputJsonSchema = state._outputSchemaConfig?.contract?.toJsonSchema();
  if (outputJsonSchema !== undefined) config["outputSchema"] = structuredClone(outputJsonSchema);
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
  if (state._debrief !== undefined) config["debrief"] = state._debrief;

  // Durable runs (crash-resume)
  if (state._durableRuns) config["durableRuns"] = { ...state._durableRuns };

  // Approval policy: the data half only. `requireFor` / `onApprove` are
  // functions and must be re-supplied in code after `fromConfig()`.
  if (state._approvalPolicy) {
    const ap = state._approvalPolicy;
    const a: Record<string, unknown> = {};
    if (ap.mode !== undefined) a["mode"] = ap.mode;
    if (ap.tools !== undefined) a["tools"] = [...ap.tools];
    if (ap.commands !== undefined) a["commands"] = [...ap.commands];
    if (ap.timeoutMs !== undefined) a["timeoutMs"] = ap.timeoutMs;
    config["approvalPolicy"] = a;
  }

  // Agent-initiated user interaction (`.withUserInteraction()`): `true`, or
  // `{ timeoutMs }` when a live-wait bound is set.
  if (state._userInteraction) {
    const timeoutMs = state._userInteraction.timeoutMs;
    config["userInteraction"] = timeoutMs !== undefined ? { timeoutMs } : true;
  }

  if (state._skillsConfig) {
    const s = state._skillsConfig;
    config["skills"] = defined({
      paths: s.paths ? [...s.paths] : undefined,
      activate: s.activate ? [...s.activate] : undefined,
      global: s.global,
    });
  }
  if (state._metaTools !== undefined) {
    config["metaTools"] = state._metaTools === false ? false : { ...state._metaTools };
  }
  if (state._agentTools.length > 0) config["agentTools"] = state._agentTools.map(agentToolData);
  if (state._allowDynamicSubAgents) config["dynamicSubAgents"] = defined({ ...state._dynamicSubAgentOptions });
  if (state._verificationStep) config["verificationStep"] = defined({ ...state._verificationStep });
  if (state._documents.length > 0) {
    config["documents"] = state._documents.map((d) => defined({ ...d }));
  }
  if (state._modelRouting) config["modelRouting"] = defined({ ...state._modelRouting });

  return config as AgentConfig;
}
