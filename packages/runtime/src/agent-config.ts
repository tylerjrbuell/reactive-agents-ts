/**
 * AgentConfig — JSON-serializable representation of a fully configured agent.
 *
 * Enables agent definitions to be stored, versioned, transmitted, and reconstructed
 * without code. Supports roundtrip serialization via toJSON/fromJSON and reconstruction
 * via agentConfigToBuilder.
 */
import { Schema } from "effect";
import type { ReactiveAgentBuilder } from "./builder.js";

// ─── Provider Schema ──────────────────────────────────────────────────────────

export const ProviderNameSchema = Schema.Literal(
  "anthropic",
  "openai",
  "ollama",
  "gemini",
  "litellm",
  "test",
);

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

export const PersonaConfigSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  role: Schema.optional(Schema.String),
  background: Schema.optional(Schema.String),
  instructions: Schema.optional(Schema.String),
  tone: Schema.optional(Schema.String),
});

export type PersonaConfig = Schema.Schema.Type<typeof PersonaConfigSchema>;

export const ReasoningConfigSchema = Schema.Struct({
  defaultStrategy: Schema.optional(
    Schema.Literal(
      "reactive",
      "plan-execute-reflect",
      "tree-of-thought",
      "reflexion",
      "adaptive",
    ),
  ),
  enableStrategySwitching: Schema.optional(Schema.Boolean),
  maxStrategySwitches: Schema.optional(Schema.Number),
  fallbackStrategy: Schema.optional(Schema.String),
});

export const ToolsConfigSchema = Schema.Struct({
  allowedTools: Schema.optional(Schema.Array(Schema.String)),
  adaptive: Schema.optional(Schema.Boolean),
});

export const GuardrailsConfigSchema = Schema.Struct({
  injection: Schema.optional(Schema.Boolean),
  pii: Schema.optional(Schema.Boolean),
  toxicity: Schema.optional(Schema.Boolean),
  customBlocklist: Schema.optional(Schema.Array(Schema.String)),
});

export const MemoryConfigSchema = Schema.Struct({
  tier: Schema.optional(Schema.Literal("standard", "enhanced")),
  dbPath: Schema.optional(Schema.String),
  maxEntries: Schema.optional(Schema.Number),
  capacity: Schema.optional(Schema.Number),
  evictionPolicy: Schema.optional(
    Schema.Literal("fifo", "lru", "importance"),
  ),
  retainDays: Schema.optional(Schema.Number),
  importanceThreshold: Schema.optional(Schema.Number),
  experienceLearning: Schema.optional(Schema.Boolean),
  memoryConsolidation: Schema.optional(Schema.Boolean),
});

export const ObservabilityConfigSchema = Schema.Struct({
  verbosity: Schema.optional(
    Schema.Literal("minimal", "normal", "verbose", "debug"),
  ),
  live: Schema.optional(Schema.Boolean),
  file: Schema.optional(Schema.String),
  logModelIO: Schema.optional(Schema.Boolean),
});

export const CostTrackingConfigSchema = Schema.Struct({
  perRequest: Schema.optional(Schema.Number),
  perSession: Schema.optional(Schema.Number),
  daily: Schema.optional(Schema.Number),
  monthly: Schema.optional(Schema.Number),
});

export const ExecutionConfigSchema = Schema.Struct({
  maxIterations: Schema.optional(Schema.Number),
  timeoutMs: Schema.optional(Schema.Number),
  retryPolicy: Schema.optional(
    Schema.Struct({
      maxRetries: Schema.Number,
      backoffMs: Schema.Number,
    }),
  ),
  cacheTimeoutMs: Schema.optional(Schema.Number),
  strictValidation: Schema.optional(Schema.Boolean),
});

export const GatewayCronSchema = Schema.Struct({
  schedule: Schema.String,
  instruction: Schema.String,
  agentId: Schema.optional(Schema.String),
  priority: Schema.optional(
    Schema.Literal("low", "normal", "high", "critical"),
  ),
  timezone: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
});

export const GatewayWebhookSchema = Schema.Struct({
  path: Schema.String,
  adapter: Schema.String,
  secret: Schema.optional(Schema.String),
  events: Schema.optional(Schema.Array(Schema.String)),
});

export const GatewayConfigSchema = Schema.Struct({
  timezone: Schema.optional(Schema.String),
  heartbeat: Schema.optional(
    Schema.Struct({
      intervalMs: Schema.optional(Schema.Number),
      policy: Schema.optional(
        Schema.Literal("always", "adaptive", "conservative"),
      ),
      instruction: Schema.optional(Schema.String),
      maxConsecutiveSkips: Schema.optional(Schema.Number),
    }),
  ),
  crons: Schema.optional(Schema.Array(GatewayCronSchema)),
  webhooks: Schema.optional(Schema.Array(GatewayWebhookSchema)),
  policies: Schema.optional(
    Schema.Struct({
      dailyTokenBudget: Schema.optional(Schema.Number),
      maxActionsPerHour: Schema.optional(Schema.Number),
      heartbeatPolicy: Schema.optional(
        Schema.Literal("always", "adaptive", "conservative"),
      ),
      mergeWindowMs: Schema.optional(Schema.Number),
      requireApprovalFor: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
  port: Schema.optional(Schema.Number),
});

export const MCPServerConfigSchema = Schema.Struct({
  name: Schema.String,
  transport: Schema.Literal("stdio", "sse", "websocket", "streamable-http"),
  command: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  url: Schema.optional(Schema.String),
  env: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
});

export const ReactiveIntelligenceConfigSchema = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
});

export const LoggingConfigSchema = Schema.Struct({
  level: Schema.optional(
    Schema.Literal("debug", "info", "warn", "error"),
  ),
  format: Schema.optional(Schema.Literal("text", "json")),
  output: Schema.optional(Schema.Literal("console", "file")),
  filePath: Schema.optional(Schema.String),
  maxFileSizeBytes: Schema.optional(Schema.Number),
  maxFiles: Schema.optional(Schema.Number),
});

export const FallbackConfigSchema = Schema.Struct({
  providers: Schema.optional(Schema.Array(Schema.String)),
  models: Schema.optional(Schema.Array(Schema.String)),
  errorThreshold: Schema.optional(Schema.Number),
});

export const VerificationConfigSchema = Schema.Struct({
  semanticEntropy: Schema.optional(Schema.Boolean),
  factDecomposition: Schema.optional(Schema.Boolean),
  multiSource: Schema.optional(Schema.Boolean),
  selfConsistency: Schema.optional(Schema.Boolean),
  nli: Schema.optional(Schema.Boolean),
  hallucinationDetection: Schema.optional(Schema.Boolean),
  hallucinationThreshold: Schema.optional(Schema.Number),
  passThreshold: Schema.optional(Schema.Number),
  riskThreshold: Schema.optional(Schema.Number),
});

// ─── Root AgentConfig Schema ──────────────────────────────────────────────────

export const AgentConfigSchema = Schema.Struct({
  /** Agent display name. Required. */
  name: Schema.String,
  /** LLM provider. Required. */
  provider: ProviderNameSchema,
  /** LLM model identifier (e.g. "claude-opus-4-20250514"). */
  model: Schema.optional(Schema.String),
  /** System prompt text. */
  systemPrompt: Schema.optional(Schema.String),
  /** Agent persona configuration. */
  persona: Schema.optional(PersonaConfigSchema),
  /** Reasoning layer configuration. */
  reasoning: Schema.optional(ReasoningConfigSchema),
  /** Tools configuration. */
  tools: Schema.optional(ToolsConfigSchema),
  /** Guardrails configuration. */
  guardrails: Schema.optional(GuardrailsConfigSchema),
  /** Memory configuration. */
  memory: Schema.optional(MemoryConfigSchema),
  /** Observability configuration. */
  observability: Schema.optional(ObservabilityConfigSchema),
  /** Cost tracking configuration. */
  costTracking: Schema.optional(CostTrackingConfigSchema),
  /** Execution configuration (timeout, retry, iterations, etc.). */
  execution: Schema.optional(ExecutionConfigSchema),
  /** Gateway configuration. */
  gateway: Schema.optional(GatewayConfigSchema),
  /** MCP server configurations. */
  mcpServers: Schema.optional(Schema.Array(MCPServerConfigSchema)),
  /** Reactive intelligence configuration. */
  reactiveIntelligence: Schema.optional(ReactiveIntelligenceConfigSchema),
  /** Logging configuration. */
  logging: Schema.optional(LoggingConfigSchema),
  /** Fallback provider/model configuration. */
  fallbacks: Schema.optional(FallbackConfigSchema),
  /** Verification configuration. */
  verification: Schema.optional(VerificationConfigSchema),
  /** Model parameters: thinking mode, temperature, max tokens. */
  thinking: Schema.optional(Schema.Boolean),
  temperature: Schema.optional(Schema.Number),
  maxTokens: Schema.optional(Schema.Number),
  /** Feature flags. */
  features: Schema.optional(
    Schema.Struct({
      guardrails: Schema.optional(Schema.Boolean),
      verification: Schema.optional(Schema.Boolean),
      costTracking: Schema.optional(Schema.Boolean),
      reasoning: Schema.optional(Schema.Boolean),
      tools: Schema.optional(Schema.Boolean),
      memory: Schema.optional(Schema.Boolean),
      observability: Schema.optional(Schema.Boolean),
      identity: Schema.optional(Schema.Boolean),
      interaction: Schema.optional(Schema.Boolean),
      prompts: Schema.optional(Schema.Boolean),
      orchestration: Schema.optional(Schema.Boolean),
      killSwitch: Schema.optional(Schema.Boolean),
      audit: Schema.optional(Schema.Boolean),
      selfImprovement: Schema.optional(Schema.Boolean),
      healthCheck: Schema.optional(Schema.Boolean),
      reactiveIntelligence: Schema.optional(Schema.Boolean),
      streaming: Schema.optional(Schema.Boolean),
    }),
  ),
  /** Custom pricing registry. */
  pricingRegistry: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.Struct({ input: Schema.Number, output: Schema.Number }),
    }),
  ),
});

// ─── Derived Types ────────────────────────────────────────────────────────────

export type AgentConfig = Schema.Schema.Type<typeof AgentConfigSchema>;

// ─── Serialization ────────────────────────────────────────────────────────────

/**
 * Serialize an AgentConfig to a JSON string.
 *
 * Validates the config against the schema before serializing.
 * Throws a ParseError if the config is invalid.
 *
 * @param config - The AgentConfig to serialize
 * @returns Pretty-printed JSON string
 */
export function agentConfigToJSON(config: AgentConfig): string {
  const validated = Schema.decodeUnknownSync(AgentConfigSchema)(config);
  return JSON.stringify(validated, null, 2);
}

/**
 * Deserialize an AgentConfig from a JSON string.
 *
 * Parses the JSON and validates it against the schema.
 * Throws a ParseError if the JSON is invalid or does not conform to the schema.
 *
 * @param json - JSON string to parse
 * @returns Validated AgentConfig
 */
export function agentConfigFromJSON(json: string): AgentConfig {
  const raw = JSON.parse(json);
  return Schema.decodeUnknownSync(AgentConfigSchema)(raw);
}

// ─── Builder Reconstruction ───────────────────────────────────────────────────

/**
 * Map an AgentConfig to a ReactiveAgentBuilder instance.
 *
 * Applies all config fields to the builder in the correct order.
 * The returned builder can be further customized before calling `.build()`.
 *
 * @param config - The AgentConfig to reconstruct from
 * @returns A configured ReactiveAgentBuilder
 */
export async function agentConfigToBuilder(config: AgentConfig): Promise<ReactiveAgentBuilder> {
  // Use lazy import() to avoid circular dependency — builder.ts imports types from
  // this file at the top level, so we defer the runtime import.
  const { ReactiveAgents } = await import("./builder.js");

  let builder = ReactiveAgents.create()
    .withName(config.name)
    .withProvider(config.provider);

  // Model / model params
  if (config.model) {
    if (config.thinking === undefined && config.temperature === undefined && config.maxTokens === undefined) {
      builder = builder.withModel(config.model);
    } else {
      builder = builder.withModel({
        model: config.model,
        thinking: config.thinking,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
      });
    }
  }

  // System prompt
  if (config.systemPrompt) {
    builder = builder.withSystemPrompt(config.systemPrompt);
  }

  // Persona
  if (config.persona) {
    builder = builder.withPersona(config.persona);
  }

  // Reasoning
  if (config.features?.reasoning || config.reasoning) {
    const r = config.reasoning;
    const opts = {
      ...(r?.defaultStrategy ? { defaultStrategy: r.defaultStrategy } : {}),
      ...(r?.enableStrategySwitching !== undefined ? { enableStrategySwitching: r.enableStrategySwitching } : {}),
      ...(r?.maxStrategySwitches !== undefined ? { maxStrategySwitches: r.maxStrategySwitches } : {}),
      ...(r?.fallbackStrategy ? { fallbackStrategy: r.fallbackStrategy } : {}),
    };
    builder = builder.withReasoning(Object.keys(opts).length > 0 ? opts : undefined);
  }

  // Tools
  if (config.features?.tools || config.tools) {
    const t = config.tools;
    const opts = {
      ...(t?.allowedTools ? { allowedTools: t.allowedTools } : {}),
      ...(t?.adaptive !== undefined ? { adaptive: t.adaptive } : {}),
    };
    builder = builder.withTools(Object.keys(opts).length > 0 ? opts : undefined);
  }

  // Guardrails
  if (config.features?.guardrails || config.guardrails) {
    const g = config.guardrails;
    const opts = {
      ...(g?.injection !== undefined ? { injection: g.injection } : {}),
      ...(g?.pii !== undefined ? { pii: g.pii } : {}),
      ...(g?.toxicity !== undefined ? { toxicity: g.toxicity } : {}),
      ...(g?.customBlocklist ? { customBlocklist: g.customBlocklist } : {}),
    };
    builder = builder.withGuardrails(Object.keys(opts).length > 0 ? opts : undefined);
  }

  // Memory
  if (config.features?.memory || config.memory) {
    const m = config.memory;
    const opts = {
      ...(m?.tier ? { tier: m.tier } : {}),
      ...(m?.dbPath ? { dbPath: m.dbPath } : {}),
      ...(m?.maxEntries !== undefined ? { maxEntries: m.maxEntries } : {}),
      ...(m?.capacity !== undefined ? { capacity: m.capacity } : {}),
      ...(m?.evictionPolicy ? { evictionPolicy: m.evictionPolicy } : {}),
      ...(m?.retainDays !== undefined ? { retainDays: m.retainDays } : {}),
      ...(m?.importanceThreshold !== undefined ? { importanceThreshold: m.importanceThreshold } : {}),
    };
    builder = builder.withMemory(Object.keys(opts).length > 0 ? opts : undefined);
    if (m?.experienceLearning) builder = builder.withExperienceLearning();
    if (m?.memoryConsolidation) builder = builder.withMemoryConsolidation();
  }

  // Observability
  if (config.features?.observability || config.observability) {
    const obs = config.observability;
    const opts = {
      ...(obs?.verbosity ? { verbosity: obs.verbosity } : {}),
      ...(obs?.live !== undefined ? { live: obs.live } : {}),
      ...(obs?.file ? { file: obs.file } : {}),
      ...(obs?.logModelIO !== undefined ? { logModelIO: obs.logModelIO } : {}),
    };
    builder = builder.withObservability(Object.keys(opts).length > 0 ? opts : undefined);
  }

  // Cost tracking
  if (config.features?.costTracking || config.costTracking) {
    const ct = config.costTracking;
    const opts = {
      ...(ct?.perRequest !== undefined ? { perRequest: ct.perRequest } : {}),
      ...(ct?.perSession !== undefined ? { perSession: ct.perSession } : {}),
      ...(ct?.daily !== undefined ? { daily: ct.daily } : {}),
      ...(ct?.monthly !== undefined ? { monthly: ct.monthly } : {}),
    };
    builder = builder.withCostTracking(Object.keys(opts).length > 0 ? opts : undefined);
  }

  // Verification
  if (config.features?.verification || config.verification) {
    const v = config.verification;
    const opts = {
      ...(v?.semanticEntropy !== undefined ? { semanticEntropy: v.semanticEntropy } : {}),
      ...(v?.factDecomposition !== undefined ? { factDecomposition: v.factDecomposition } : {}),
      ...(v?.multiSource !== undefined ? { multiSource: v.multiSource } : {}),
      ...(v?.selfConsistency !== undefined ? { selfConsistency: v.selfConsistency } : {}),
      ...(v?.nli !== undefined ? { nli: v.nli } : {}),
      ...(v?.hallucinationDetection !== undefined ? { hallucinationDetection: v.hallucinationDetection } : {}),
      ...(v?.hallucinationThreshold !== undefined ? { hallucinationThreshold: v.hallucinationThreshold } : {}),
      ...(v?.passThreshold !== undefined ? { passThreshold: v.passThreshold } : {}),
      ...(v?.riskThreshold !== undefined ? { riskThreshold: v.riskThreshold } : {}),
    };
    builder = builder.withVerification(Object.keys(opts).length > 0 ? opts : undefined);
  }

  // Execution
  if (config.execution?.maxIterations !== undefined) {
    builder = builder.withMaxIterations(config.execution.maxIterations);
  }
  if (config.execution?.timeoutMs !== undefined) {
    builder = builder.withTimeout(config.execution.timeoutMs);
  }
  if (config.execution?.retryPolicy) {
    builder = builder.withRetryPolicy(config.execution.retryPolicy);
  }
  if (config.execution?.cacheTimeoutMs !== undefined) {
    builder = builder.withCacheTimeout(config.execution.cacheTimeoutMs);
  }
  if (config.execution?.strictValidation) {
    builder = builder.withStrictValidation();
  }

  // Gateway
  if (config.gateway) {
    builder = builder.withGateway(config.gateway as any);
  }

  // MCP servers
  if (config.mcpServers && config.mcpServers.length > 0) {
    builder = builder.withMCP(config.mcpServers as any);
  }

  // Reactive intelligence
  if (config.features?.reactiveIntelligence || config.reactiveIntelligence?.enabled) {
    builder = builder.withReactiveIntelligence();
  }

  // Logging
  if (config.logging) {
    builder = builder.withLogging(config.logging as any);
  }

  // Fallbacks
  if (config.fallbacks) {
    builder = builder.withFallbacks(config.fallbacks as any);
  }

  // Feature flags (remaining ones not handled inline above)
  if (config.features?.identity) builder = builder.withIdentity();
  if (config.features?.interaction) builder = builder.withInteraction();
  if (config.features?.prompts) builder = builder.withPrompts();
  if (config.features?.orchestration) builder = builder.withOrchestration();
  if (config.features?.killSwitch) builder = builder.withKillSwitch();
  if (config.features?.audit) builder = builder.withAudit();
  if (config.features?.selfImprovement) builder = builder.withSelfImprovement();
  if (config.features?.healthCheck) builder = builder.withHealthCheck();
  if (config.features?.streaming) builder = builder.withStreaming();

  // Pricing registry
  if (config.pricingRegistry) {
    builder = builder.withModelPricing(config.pricingRegistry);
  }

  return builder;
}

// ─── toConfig helper (used by builder.toConfig()) ────────────────────────────

/**
 * Build an AgentConfig from the internal state of a ReactiveAgentBuilder.
 *
 * This is the reverse of agentConfigToBuilder — used by builder.toConfig().
 *
 * @internal
 */
export function builderToConfig(state: {
  _name: string;
  _provider: string;
  _model?: string;
  _thinking?: boolean;
  _temperature?: number;
  _maxTokens?: number;
  _systemPrompt?: string;
  _persona?: Record<string, unknown>;
  _enableReasoning: boolean;
  _reasoningOptions?: Record<string, unknown>;
  _enableTools: boolean;
  _toolsOptions?: Record<string, unknown>;
  _enableGuardrails: boolean;
  _guardrailsOptions?: Record<string, unknown>;
  _enableMemory: boolean;
  _memoryTier: "1" | "2";
  _memoryOptions?: Record<string, unknown>;
  _enableExperienceLearning: boolean;
  _enableMemoryConsolidation: boolean;
  _enableObservability: boolean;
  _observabilityOptions?: Record<string, unknown>;
  _enableCostTracking: boolean;
  _costTrackingOptions?: Record<string, unknown>;
  _enableVerification: boolean;
  _verificationOptions?: Record<string, unknown>;
  _maxIterations: number;
  _executionTimeoutMs?: number;
  _retryPolicy?: { maxRetries: number; backoffMs: number };
  _cacheTimeoutMs?: number;
  _strictValidation: boolean;
  _gatewayOptions?: Record<string, unknown>;
  _mcpServers: unknown[];
  _enableReactiveIntelligence: boolean;
  _reactiveIntelligenceOptions?: Record<string, unknown>;
  _loggingConfig?: Record<string, unknown>;
  _fallbackConfig?: Record<string, unknown>;
  _enableIdentity: boolean;
  _enableInteraction: boolean;
  _enablePrompts: boolean;
  _enableOrchestration: boolean;
  _enableKillSwitch: boolean;
  _enableAudit: boolean;
  _enableSelfImprovement: boolean;
  _enableHealthCheck: boolean;
  _streamDensity?: string;
  _pricingRegistry?: Record<string, { readonly input: number; readonly output: number }>;
}): AgentConfig {
  const config: Record<string, unknown> = {
    name: state._name,
    provider: state._provider,
  };

  if (state._model) config["model"] = state._model;
  if (state._thinking !== undefined) config["thinking"] = state._thinking;
  if (state._temperature !== undefined) config["temperature"] = state._temperature;
  if (state._maxTokens !== undefined) config["maxTokens"] = state._maxTokens;
  if (state._systemPrompt) config["systemPrompt"] = state._systemPrompt;
  if (state._persona) config["persona"] = state._persona;

  // Reasoning
  if (state._enableReasoning || state._reasoningOptions) {
    const r: Record<string, unknown> = {};
    const ro = state._reasoningOptions as any;
    if (ro?.defaultStrategy) r["defaultStrategy"] = ro.defaultStrategy;
    if (ro?.enableStrategySwitching !== undefined) r["enableStrategySwitching"] = ro.enableStrategySwitching;
    if (ro?.maxStrategySwitches !== undefined) r["maxStrategySwitches"] = ro.maxStrategySwitches;
    if (ro?.fallbackStrategy) r["fallbackStrategy"] = ro.fallbackStrategy;
    config["reasoning"] = r;
  }

  // Tools
  if (state._enableTools || state._toolsOptions) {
    const t: Record<string, unknown> = {};
    const to = state._toolsOptions as any;
    if (to?.allowedTools) t["allowedTools"] = [...to.allowedTools];
    if (to?.adaptive !== undefined) t["adaptive"] = to.adaptive;
    config["tools"] = t;
  }

  // Guardrails
  if (state._enableGuardrails || state._guardrailsOptions) {
    const g: Record<string, unknown> = {};
    const go = state._guardrailsOptions as any;
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
    const mo = state._memoryOptions as any;
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
    const oo = state._observabilityOptions as any;
    if (oo?.verbosity) o["verbosity"] = oo.verbosity;
    if (oo?.live !== undefined) o["live"] = oo.live;
    if (oo?.file) o["file"] = oo.file;
    if (oo?.logModelIO !== undefined) o["logModelIO"] = oo.logModelIO;
    config["observability"] = o;
  }

  // Cost tracking
  if (state._enableCostTracking || state._costTrackingOptions) {
    const c: Record<string, unknown> = {};
    const co = state._costTrackingOptions as any;
    if (co?.perRequest !== undefined) c["perRequest"] = co.perRequest;
    if (co?.perSession !== undefined) c["perSession"] = co.perSession;
    if (co?.daily !== undefined) c["daily"] = co.daily;
    if (co?.monthly !== undefined) c["monthly"] = co.monthly;
    config["costTracking"] = c;
  }

  // Verification
  if (state._enableVerification || state._verificationOptions) {
    const v: Record<string, unknown> = {};
    const vo = state._verificationOptions as any;
    if (vo?.semanticEntropy !== undefined) v["semanticEntropy"] = vo.semanticEntropy;
    if (vo?.factDecomposition !== undefined) v["factDecomposition"] = vo.factDecomposition;
    if (vo?.multiSource !== undefined) v["multiSource"] = vo.multiSource;
    if (vo?.selfConsistency !== undefined) v["selfConsistency"] = vo.selfConsistency;
    if (vo?.nli !== undefined) v["nli"] = vo.nli;
    if (vo?.hallucinationDetection !== undefined) v["hallucinationDetection"] = vo.hallucinationDetection;
    if (vo?.hallucinationThreshold !== undefined) v["hallucinationThreshold"] = vo.hallucinationThreshold;
    if (vo?.passThreshold !== undefined) v["passThreshold"] = vo.passThreshold;
    if (vo?.riskThreshold !== undefined) v["riskThreshold"] = vo.riskThreshold;
    config["verification"] = v;
  }

  // Execution
  const exec: Record<string, unknown> = {};
  if (state._maxIterations !== undefined) exec["maxIterations"] = state._maxIterations;
  if (state._executionTimeoutMs !== undefined) exec["timeoutMs"] = state._executionTimeoutMs;
  if (state._retryPolicy) exec["retryPolicy"] = { ...state._retryPolicy };
  if (state._cacheTimeoutMs !== undefined) exec["cacheTimeoutMs"] = state._cacheTimeoutMs;
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
  if (state._enableIdentity) features["identity"] = true;
  if (state._enableInteraction) features["interaction"] = true;
  if (state._enablePrompts) features["prompts"] = true;
  if (state._enableOrchestration) features["orchestration"] = true;
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

  return config as AgentConfig;
}
