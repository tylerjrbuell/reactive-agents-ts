/**
 * AgentConfig — JSON-serializable representation of a fully configured agent.
 *
 * Enables agent definitions to be stored, versioned, transmitted, and reconstructed
 * without code. Supports roundtrip serialization via toJSON/fromJSON and reconstruction
 * via agentConfigToBuilder.
 */
import { Schema } from "effect";
import { ReasoningStrategy } from "@reactive-agents/core";
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
  // Single source: the canonical ReasoningStrategy literal from core (all 8
  // registered strategies — reactive/reflexion/plan-execute-reflect/
  // tree-of-thought/adaptive/direct/code-action/blueprint). Previously an inline
  // 5-member duplicate that silently dropped blueprint/code-action/direct and
  // made them un-launchable through AgentConfig decode.
  defaultStrategy: Schema.optional(ReasoningStrategy),
  enableStrategySwitching: Schema.optional(Schema.Boolean),
  maxStrategySwitches: Schema.optional(Schema.Number),
  fallbackStrategy: Schema.optional(Schema.String),
  /** Opt-in: emit per-tool-call decision rationale into the debrief (audit feature; speed/token tax on smaller models). */
  auditRationale: Schema.optional(Schema.Boolean),
});

export const ToolsConfigSchema = Schema.Struct({
  allowedTools: Schema.optional(Schema.Array(Schema.String)),
  focusedTools: Schema.optional(Schema.Array(Schema.String)),
  adaptive: Schema.optional(Schema.Boolean),
  terminal: Schema.optional(Schema.Boolean),
});

export const GuardrailsConfigSchema = Schema.Struct({
  // NOTE (P9, deferred): detectors default to `true` when guardrails are enabled
  // (mirrors `GuardrailsOptions`, builder/types.ts). Encoding that default via
  // `Schema.optionalWith(..., { default })` would make serialized config
  // self-documenting, BUT it promotes these fields to REQUIRED in the inferred
  // `AgentConfig` type — a breaking change to the public declarative contract
  // (a `{ guardrails: { injection: true } }` literal would no longer typecheck).
  // The task gates P9 on "only if it doesn't change behavior", so it stays as
  // plain optional; the default is applied at runtime by the guardrails layer.
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

export const CostTrackingConfigSchema = Schema.Struct({
  perRequest: Schema.optional(Schema.Number),
  perSession: Schema.optional(Schema.Number),
  daily: Schema.optional(Schema.Number),
  monthly: Schema.optional(Schema.Number),
});

export const ExecutionConfigSchema = Schema.Struct({
  maxIterations: Schema.optional(Schema.Number),
  minIterations: Schema.optional(Schema.Number),
  timeoutMs: Schema.optional(Schema.Number),
  retryPolicy: Schema.optional(
    Schema.Struct({
      maxRetries: Schema.Number,
      backoffMs: Schema.Number,
    }),
  ),
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
  persistMemoryAcrossRuns: Schema.optional(Schema.Boolean),
  port: Schema.optional(Schema.Number),
  /**
   * Channel access control (messaging platforms). Mirrors
   * `GatewayOptions.accessControl` (builder/types.ts) so gateway config gets
   * field-level validation instead of `as any` passthrough (P4/G12).
   */
  accessControl: Schema.optional(
    Schema.Struct({
      accessPolicy: Schema.optional(
        Schema.Literal("allowlist", "blocklist", "open"),
      ),
      allowedSenders: Schema.optional(Schema.Array(Schema.String)),
      blockedSenders: Schema.optional(Schema.Array(Schema.String)),
      unknownSenderAction: Schema.optional(Schema.Literal("skip", "escalate")),
      replyToUnknown: Schema.optional(Schema.String),
      mode: Schema.optional(Schema.Literal("chat", "task")),
      sessionTtlDays: Schema.optional(Schema.Number),
    }),
  ),
});

export const MCPServerConfigSchema = Schema.Struct({
  name: Schema.String,
  transport: Schema.optional(Schema.Literal("stdio", "sse", "websocket", "streamable-http")),
  command: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  endpoint: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.String),
  env: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  headers: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
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

/**
 * Anonymous telemetry (differential privacy) config — the JSON-safe subset of
 * `TelemetryConfig` (@reactive-agents/observability). Mirrors the
 * `withObservability({ telemetry })` fan-out (builder/types.ts).
 */
export const TelemetryConfigSchema = Schema.Struct({
  mode: Schema.optional(
    Schema.Literal("contribute", "consume", "both", "isolated"),
  ),
  privacy: Schema.optional(
    Schema.Struct({
      epsilon: Schema.optional(Schema.Number),
      sensitivity: Schema.optional(Schema.Number),
      minClamp: Schema.optional(Schema.Number),
    }),
  ),
});

/**
 * Observability config. Beyond the display knobs (`verbosity`/`live`/`file`/
 * `logModelIO`), the fan-out sub-options mirror `ObservabilityOptions`
 * (builder/types.ts) so `withObservability({ cortex, tracing, health, audit,
 * logging, costs, telemetry })` round-trips through config (P3/G8/G11). The
 * code-only overlays (`logPrefix`, `redactors`, and a live `WritableStream`
 * logging output) stay out of the schema by design.
 */
export const ObservabilityConfigSchema = Schema.Struct({
  verbosity: Schema.optional(
    Schema.Literal("minimal", "normal", "verbose", "debug"),
  ),
  live: Schema.optional(Schema.Boolean),
  file: Schema.optional(Schema.String),
  logModelIO: Schema.optional(Schema.Boolean),
  /** Cortex event reporting. `true` resolves the URL from env/default; `{ url }` sets it. */
  cortex: Schema.optional(
    Schema.Union(Schema.Boolean, Schema.Struct({ url: Schema.optional(Schema.String) })),
  ),
  /** Anonymous telemetry (differential privacy). */
  telemetry: Schema.optional(Schema.Union(Schema.Boolean, TelemetryConfigSchema)),
  /** Structured logging (JSON-safe subset; a live `WritableStream` output is code-only). */
  logging: Schema.optional(LoggingConfigSchema),
  /** JSONL trace persistence. `{ dir }` enables; `false` disables. */
  tracing: Schema.optional(
    Schema.Union(Schema.Boolean, Schema.Struct({ dir: Schema.optional(Schema.String) })),
  ),
  /** Health checks. */
  health: Schema.optional(Schema.Boolean),
  /** Per-tool-call rationale auditing. */
  audit: Schema.optional(Schema.Boolean),
  /** Cost tracking. `true` enables; an object also sets budget caps. */
  costs: Schema.optional(Schema.Union(Schema.Boolean, CostTrackingConfigSchema)),
});

// P0-3: `models` and `errorThreshold` removed in v0.14 — they were never wired
// (no cheaper-model chain, no consecutive-error threshold). Only the ordered
// provider cascade is real.
export const FallbackConfigSchema = Schema.Struct({
  providers: Schema.optional(Schema.Array(Schema.String)),
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
  /**
   * When true (default), verification uses the runtime `LLMService` for
   * LLM-backed layers; false runs tier-1 heuristics only. Matches
   * `VerificationOptions.useLLMTier` (builder/types.ts). `serializeBuilder`
   * emits this, so it must live in the schema or `toConfig()` output would
   * fail re-decode (P2/G10).
   */
  useLLMTier: Schema.optional(Schema.Boolean),
  /**
   * What to do when verification still rejects after retries. Absent = "proceed".
   * Matches `VerificationOptions.onReject` (builder/types.ts) (P2/G10).
   */
  onReject: Schema.optional(Schema.Literal("block", "annotate", "proceed")),
});

export const GroundingConfigSchema = Schema.Struct({
  mode: Schema.Literal("block", "warn"),
  tolerance: Schema.optional(Schema.Number),
  maxRetries: Schema.optional(Schema.Number),
});

/**
 * Declarative options for typed structured output.
 *
 * NOTE: The schema object itself is NOT JSON-serializable, so declarative config
 * supports only the behavioural knobs (`mode`, `onParseFail`, `abstainBelow`).
 * The schema must be provided in code via `.withOutputSchema(schema, options)`.
 * This field allows config files to set/round-trip the options without rejecting
 * an otherwise-valid agent definition.
 */
export const OutputSchemaOptionsSchema = Schema.Struct({
  mode: Schema.optional(Schema.Literal("auto", "fast", "grounded")),
  onParseFail: Schema.optional(Schema.Literal("degrade", "throw")),
  abstainBelow: Schema.optional(Schema.Number),
});

/** Tools that must be called before the agent may declare success. */
export const RequiredToolsConfigSchema = Schema.Struct({
  tools: Schema.optional(Schema.Array(Schema.String)),
  adaptive: Schema.optional(Schema.Boolean),
  maxRetries: Schema.optional(Schema.Number),
});

/**
 * Declarative budget caps enforced by the Arbitrator's pre-intent guard.
 * At least one of `tokenLimit` / `costLimit` must be present for the builder
 * to accept it (mirrors `withBudget()` validation).
 */
export const BudgetConfigSchema = Schema.Struct({
  tokenLimit: Schema.optional(Schema.Number),
  costLimit: Schema.optional(Schema.Number),
  warningRatio: Schema.optional(Schema.Number),
});

/**
 * Circuit-breaker override. `false` disables the default-on breaker;
 * an object pins the trip thresholds.
 */
export const CircuitBreakerConfigSchema = Schema.Union(
  Schema.Literal(false),
  Schema.Struct({
    failureThreshold: Schema.optional(Schema.Number),
    cooldownMs: Schema.optional(Schema.Number),
    halfOpenRequests: Schema.optional(Schema.Number),
  }),
);

/** Outbound LLM request rate-limiting thresholds (sliding window). */
export const RateLimitingConfigSchema = Schema.Struct({
  requestsPerMinute: Schema.optional(Schema.Number),
  tokensPerMinute: Schema.optional(Schema.Number),
  maxConcurrent: Schema.optional(Schema.Number),
});

/** Durable run persistence (crash-resume) configuration. */
export const DurableRunsConfigSchema = Schema.Struct({
  dir: Schema.optional(Schema.String),
  checkpointEvery: Schema.optional(Schema.Number),
});

// ─── Root AgentConfig Schema ──────────────────────────────────────────────────

export const AgentConfigSchema = Schema.Struct({
  /** Agent display name. Required. */
  name: Schema.String,
  /**
   * Preset baseline capability profile (Q6). Applied FIRST, before any other
   * key, so explicit sibling keys override it — `{ profile: "lean", memory: {
   * tier: "enhanced" } }` = lean baseline with memory re-enabled. Maps to
   * `.withProfile(HarnessProfile[profile]())`. Absent = a bare builder (today's
   * production defaults; no profile patch). Cross-field patch, not a serialized
   * leaf — `toConfig()` re-emits the fields it mutated, not `profile` itself.
   */
  profile: Schema.optional(Schema.Literal("lean", "balanced", "intelligent")),
  /** Stable agent identifier (used for durable-run db paths, identity). */
  agentId: Schema.optional(Schema.String),
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
  /** Opt-in numeric evidence-grounding. Absent = off (default). */
  grounding: Schema.optional(GroundingConfigSchema),
  /** Fabrication-guard mode. Absent = "block" (always-on). */
  fabricationGuard: Schema.optional(Schema.Literal("off", "warn", "block")),
  /** Stall/no-progress policy. Absent = defaults (tolerate 2 ignored nudges, escalate wording). */
  stallPolicy: Schema.optional(
    Schema.Struct({
      ignoredNudgeTolerance: Schema.optional(Schema.Number),
      escalateNudgeContent: Schema.optional(Schema.Boolean),
    })
  ),
  /** Opt-in long-horizon guard profile. Absent = absolute-count guards (default). */
  horizonProfile: Schema.optional(Schema.Literal("long")),
  /** Opt-in adaptive harness / policy compiler (G1). Absent = off (byte-identical). */
  adaptiveHarness: Schema.optional(Schema.Boolean),
  /**
   * Behavioural options for typed structured output (mode, onParseFail, abstainBelow).
   *
   * The schema object cannot be expressed in declarative config (not JSON-serializable).
   * Call `.withOutputSchema(schema, options)` in code to activate extraction; this field
   * allows config files to carry the options so they round-trip without error.
   */
  outputSchemaOptions: Schema.optional(OutputSchemaOptionsSchema),
  /** Tools that must be called before the agent may declare success. */
  requiredTools: Schema.optional(RequiredToolsConfigSchema),
  /** Declarative spend caps (USD). */
  budget: Schema.optional(BudgetConfigSchema),
  /** Circuit-breaker override (`false` disables; object pins thresholds). */
  circuitBreaker: Schema.optional(CircuitBreakerConfigSchema),
  /** Outbound LLM rate-limiting thresholds. */
  rateLimiting: Schema.optional(RateLimitingConfigSchema),
  /** Persist evolved skills across runs. */
  skillPersistence: Schema.optional(Schema.Boolean),
  /** Durable run persistence (crash-resume) configuration. */
  durableRuns: Schema.optional(DurableRunsConfigSchema),
  /** Model parameters: thinking mode, temperature, max tokens. */
  thinking: Schema.optional(Schema.Boolean),
  temperature: Schema.optional(Schema.Number),
  maxTokens: Schema.optional(Schema.Number),
  /** Context window size for local providers (Ollama `options.num_ctx`); ignored by hosted providers. */
  numCtx: Schema.optional(Schema.Number),
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
      prompts: Schema.optional(Schema.Boolean),
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
  /** Background data injected into reasoning memory context. */
  taskContext: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.String }),
  ),
});

// ─── Derived Types ────────────────────────────────────────────────────────────

export type AgentConfig = Schema.Schema.Type<typeof AgentConfigSchema>;

// ─── Keystone: sub-schema-derived option types (spec §6.5 G13) ──────────────────
// The schema is the SOLE author of each JSON-safe option shape. The builder's
// `XOptions` interfaces must COVER these (every schema field present, compatible
// type) — enforced by compile-time assertions in `builder/types.ts`, so a
// dropped/renamed schema field becomes a COMPILE ERROR, not a silent serialize
// drop. Code-only option fields (functions/streams/secrets) are appended to the
// `XOptions` interface and descriptor-marked `overlay`.
export type ToolsConfig = Schema.Schema.Type<typeof ToolsConfigSchema>;
export type MemoryConfig = Schema.Schema.Type<typeof MemoryConfigSchema>;
export type VerificationConfig = Schema.Schema.Type<typeof VerificationConfigSchema>;
export type ObservabilityConfig = Schema.Schema.Type<typeof ObservabilityConfigSchema>;
export type BudgetConfig = Schema.Schema.Type<typeof BudgetConfigSchema>;
export type CostTrackingConfig = Schema.Schema.Type<typeof CostTrackingConfigSchema>;
export type GuardrailsConfig = Schema.Schema.Type<typeof GuardrailsConfigSchema>;

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
  const { HarnessProfile } = await import("./capabilities/profile.js");

  let builder = ReactiveAgents.create()
    .withName(config.name)
    .withProvider(config.provider);

  // Profile baseline (Q6): apply FIRST so every explicit key below overrides it.
  // `.withProfile()` is a cross-field patch (memory/RI/verifier/strategy-switching/
  // skill-persistence toggles); the subsequent field application wins on conflict,
  // mirroring `profile.ts` "later calls override earlier patches".
  if (config.profile) {
    builder = builder.withProfile(HarnessProfile[config.profile]());
  }

  if (config.agentId) {
    builder = builder.withAgentId(config.agentId);
  }

  // Model / model params — params apply independently of `model` so a config
  // that sets temperature/maxTokens/thinking/numCtx without an explicit model
  // (or with the legacy `model: ""` sentinel) still threads them through; the
  // provider supplies the default model. (Fixes silent param-drop, audit C1.)
  {
    const hasParams =
      config.thinking !== undefined ||
      config.temperature !== undefined ||
      config.maxTokens !== undefined ||
      config.numCtx !== undefined;
    if (config.model && !hasParams) {
      builder = builder.withModel(config.model);
    } else if (config.model || hasParams) {
      builder = builder.withModel({
        ...(config.model ? { model: config.model } : {}),
        thinking: config.thinking,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        numCtx: config.numCtx,
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
      ...(r?.auditRationale !== undefined ? { auditRationale: r.auditRationale } : {}),
    };
    builder = builder.withReasoning(Object.keys(opts).length > 0 ? opts : undefined);
  }

  // Tools
  if (config.features?.tools || config.tools) {
    const t = config.tools;
    const opts = {
      ...(t?.allowedTools ? { allowedTools: t.allowedTools } : {}),
      ...(t?.focusedTools ? { focusedTools: t.focusedTools } : {}),
      ...(t?.adaptive !== undefined ? { adaptive: t.adaptive } : {}),
      ...(t?.terminal !== undefined ? { terminal: t.terminal } : {}),
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
      ...(obs?.cortex !== undefined ? { cortex: obs.cortex } : {}),
      ...(obs?.telemetry !== undefined ? { telemetry: obs.telemetry } : {}),
      ...(obs?.logging !== undefined ? { logging: obs.logging } : {}),
      ...(obs?.tracing !== undefined ? { tracing: obs.tracing } : {}),
      ...(obs?.health !== undefined ? { health: obs.health } : {}),
      ...(obs?.audit !== undefined ? { audit: obs.audit } : {}),
      ...(obs?.costs !== undefined ? { costs: obs.costs } : {}),
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
      ...(v?.useLLMTier !== undefined ? { useLLMTier: v.useLLMTier } : {}),
      ...(v?.onReject !== undefined ? { onReject: v.onReject } : {}),
    };
    builder = builder.withVerification(Object.keys(opts).length > 0 ? opts : undefined);
  }

  // Grounding
  if (config.grounding) {
    builder = builder.withGrounding(config.grounding);
  }

  // Fabrication guard (always-on by default; declarative override)
  if (config.fabricationGuard) {
    builder = builder.withFabricationGuard(config.fabricationGuard);
  }

  // Stall/no-progress policy (defaults apply; declarative override)
  if (config.stallPolicy) {
    builder = builder.withStallPolicy(config.stallPolicy);
  }

  // Long-horizon guard profile (opt-in; declarative override)
  if (config.horizonProfile === "long") {
    builder = builder.withLongHorizon();
  }

  // Adaptive harness / policy compiler (opt-in; declarative override)
  if (config.adaptiveHarness) {
    builder = builder.withAdaptiveHarness();
  }

  // Execution
  if (config.execution?.maxIterations !== undefined) {
    builder = builder.withMaxIterations(config.execution.maxIterations);
  }
  if (config.execution?.minIterations !== undefined) {
    builder = builder.withMinIterations(config.execution.minIterations);
  }
  if (config.execution?.timeoutMs !== undefined) {
    builder = builder.withTimeout(config.execution.timeoutMs);
  }
  if (config.execution?.retryPolicy) {
    builder = builder.withRetryPolicy(config.execution.retryPolicy);
  }
  if (config.execution?.strictValidation) {
    builder = builder.withStrictValidation();
  }

  // Gateway
  if (config.gateway) {
    builder = builder.withGateway(config.gateway);
  }

  // MCP servers
  if (config.mcpServers && config.mcpServers.length > 0) {
    builder = builder.withMCP(config.mcpServers as Parameters<typeof builder.withMCP>[0]);
  }

  // Reactive intelligence
  if (config.features?.reactiveIntelligence || config.reactiveIntelligence?.enabled) {
    builder = builder.withReactiveIntelligence();
  }

  // Logging
  if (config.logging) {
    builder = builder.withLogging(config.logging as Parameters<typeof builder.withLogging>[0]);
  }

  // Fallbacks
  if (config.fallbacks) {
    builder = builder.withFallbacks(config.fallbacks as Parameters<typeof builder.withFallbacks>[0]);
  }

  // Feature flags (remaining ones not handled inline above)
  if (config.features?.prompts) builder = builder.withPrompts();
  if (config.features?.killSwitch) builder = builder.withKillSwitch();
  if (config.features?.audit) builder = builder.withAudit();
  if (config.features?.selfImprovement) builder = builder.withSelfImprovement();
  if (config.features?.healthCheck) builder = builder.withHealthCheck();
  if (config.features?.streaming) builder = builder.withStreaming();

  // Required tools
  if (config.requiredTools) {
    builder = builder.withRequiredTools({
      ...(config.requiredTools.tools ? { tools: config.requiredTools.tools } : {}),
      ...(config.requiredTools.adaptive !== undefined ? { adaptive: config.requiredTools.adaptive } : {}),
      ...(config.requiredTools.maxRetries !== undefined ? { maxRetries: config.requiredTools.maxRetries } : {}),
    });
  }

  // Budget caps
  if (config.budget) {
    builder = builder.withBudget(config.budget);
  }

  // Circuit breaker (default-on; `false` disables, object pins thresholds)
  if (config.circuitBreaker === false) {
    builder = builder.withoutCircuitBreaker();
  } else if (config.circuitBreaker) {
    builder = builder.withCircuitBreaker(config.circuitBreaker);
  }

  // Rate limiting
  if (config.rateLimiting) {
    builder = builder.withRateLimiting(config.rateLimiting);
  }

  // Skill persistence
  if (config.skillPersistence !== undefined) {
    builder = builder.withSkillPersistence(config.skillPersistence);
  }

  // Durable runs (crash-resume)
  if (config.durableRuns) {
    builder = builder.withDurableRuns(config.durableRuns);
  }

  // Pricing registry
  if (config.pricingRegistry) {
    builder = builder.withModelPricing(config.pricingRegistry);
  }

  if (config.taskContext && Object.keys(config.taskContext).length > 0) {
    builder = builder.withTaskContext(config.taskContext);
  }

  return builder;
}

