/**
 * AgentConfig — JSON-serializable representation of a fully configured agent.
 *
 * Enables agent definitions to be stored, versioned, transmitted, and reconstructed
 * without code. Supports roundtrip serialization via toJSON/fromJSON and reconstruction
 * via agentConfigToBuilder.
 */
import { Schema } from "effect";
import { DurableRetentionSchema } from "./services/run-store-retention.js";
import type { WebSearchConfig } from "@reactive-agents/tools";
import { ReasoningStrategy } from "@reactive-agents/core";
import { LLMProviderType, ModelPricingSchema } from "@reactive-agents/llm-provider";
import { RouteSpec } from "@reactive-agents/channels";
import type { ReactiveAgentBuilder } from "./builder.js";
import type { AuthoredApprovalPolicy } from "@reactive-agents/reasoning";
import { HarnessConfigSchema } from "./harness-schema.js";
import { ReasoningOptionsJsonSchema } from "./reasoning-options-schema.js";
import { agentConfigToBuilderCalls, applyBuilderCall } from "./builder/config-calls.js";

// ─── Provider Schema ──────────────────────────────────────────────────────────

// Derived from the canonical LLMProviderType union (single source — a provider
// added there is accepted here automatically; a stale inline copy previously
// rejected groq/xai from createAgent for two releases). "custom" is excluded:
// the declarative config cannot carry a user-defined service layer, so
// accepting it would only defer the failure to a more confusing place. "test"
// (the deterministic in-repo provider) is runtime-side only, appended here.
export const ProviderNameSchema = Schema.Literal(
  ...LLMProviderType.literals.filter((p) => p !== "custom"),
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
  /** Harness mechanism switches (W3). Set via `.withHarness({...})`; precedence config over environment variable over built-in default. */
  harness: Schema.optional(HarnessConfigSchema),
  /**
   * Context synthesis mode (`.withReasoning({ synthesis })`). `"custom"` also
   * needs a `synthesisStrategy` function, which is code-only. Absent = "auto".
   */
  synthesis: Schema.optional(Schema.Literal("auto", "fast", "deep", "custom", "off")),
  /** Model for LLM synthesis (`"deep"`). Absent = the agent's model. */
  synthesisModel: Schema.optional(Schema.String),
  /** Provider for LLM synthesis. Absent = the agent's provider. */
  synthesisProvider: Schema.optional(Schema.String),
  /** Sampling temperature for LLM synthesis. */
  synthesisTemperature: Schema.optional(Schema.Number),
  /**
   * Per-strategy settings (`reactive`, `planExecute`, `treeOfThought`,
   * `reflexion`), each with optional synthesis overrides. Same shape as
   * `.withReasoning({ strategies })`.
   */
  strategies: ReasoningOptionsJsonSchema.fields.strategies,
  /** Adaptive strategy selection: `{ enabled, learning }`. */
  adaptive: ReasoningOptionsJsonSchema.fields.adaptive,
  /** `false` runs the tool calls of one model response one at a time. Default: `true`. */
  parallelToolCalls: ReasoningOptionsJsonSchema.fields.parallelToolCalls,
  /** Model-based fact extraction for large tool results: `true`, `false` (default) or `"auto"`. */
  observationSummary: ReasoningOptionsJsonSchema.fields.observationSummary,
});

/**
 * The data half of `ShellExecuteConfig` (`@reactive-agents/tools`), the object
 * form of `.withTools({ terminal })`. `blockedPatterns` (RegExp), `onAudit`
 * (function) and `dockerEscalation` stay code-only.
 */
export const ShellConfigSchema = Schema.Struct({
  /** Working directory. Must be under /tmp unless `allowUnsafeCwd` is true. */
  cwd: Schema.optional(Schema.String),
  /** Allow `cwd` outside /tmp. */
  allowUnsafeCwd: Schema.optional(Schema.Boolean),
  /** Per-command timeout in ms. Default: 30000. */
  timeoutMs: Schema.optional(Schema.Number),
  /** Max characters of output returned. Default: 4000. */
  maxOutputChars: Schema.optional(Schema.Number),
  /** Replace the default command allow-list. */
  allowedCommands: Schema.optional(Schema.Array(Schema.String)),
  /** Commands to allow on top of the allow-list (for example `"gh"`). */
  additionalCommands: Schema.optional(Schema.Array(Schema.String)),
  /** Grant commands by group (`github`, `web`, `javascript`, ...) and by name. */
  commandAccess: Schema.optional(
    Schema.Struct({
      capabilities: Schema.optional(
        Schema.Array(Schema.Literal("github", "web", "javascript", "python", "archive", "environment")),
      ),
      commands: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
  /** `"host"` (default) or `"docker"` (throwaway hardened container). */
  sandbox: Schema.optional(Schema.Literal("host", "docker")),
});

/** Object form of `.withThinking(options)`. A plain boolean is the quick on/off. */
export const ThinkingConfigSchema = Schema.Struct({
  /** `false` disables thinking. Absent = enabled. */
  enabled: Schema.optional(Schema.Boolean),
  /** Reasoning effort (OpenAI `reasoning_effort`; advisory elsewhere). */
  effort: Schema.optional(Schema.Literal("low", "medium", "high")),
  /** Thinking budget in tokens (clamped by the provider). */
  budgetTokens: Schema.optional(Schema.Number),
});

/** `.withSkills(options)`: SKILL.md directories and pinned skills. */
export const SkillsConfigSchema = Schema.Struct({
  /** Extra skill directories (each holds `<skill>/SKILL.md`). */
  paths: Schema.optional(Schema.Array(Schema.String)),
  /** Skill names always activated at bootstrap. */
  activate: Schema.optional(Schema.Array(Schema.String)),
  /** Also scan `~/.agents/skills` and `~/.reactive-agents/skills`. Default: false. */
  global: Schema.optional(Schema.Boolean),
});

const HarnessSkillValueSchema = Schema.Union(Schema.Boolean, Schema.String);

/** `.withMetaTools(config)`: mirrors `MetaToolsConfig` (types.ts). */
export const MetaToolsConfigSchema = Schema.Struct({
  brief: Schema.optional(Schema.Boolean),
  find: Schema.optional(Schema.Boolean),
  pulse: Schema.optional(Schema.Boolean),
  recall: Schema.optional(Schema.Boolean),
  relate: Schema.optional(Schema.Boolean),
  todo: Schema.optional(Schema.Boolean),
  todoGuidance: Schema.optional(
    Schema.Struct({
      reminder: Schema.optional(Schema.Boolean),
      systemLine: Schema.optional(Schema.Boolean),
    }),
  ),
  harnessSkill: Schema.optional(
    Schema.Union(
      HarnessSkillValueSchema,
      Schema.Struct({
        frontier: Schema.optional(HarnessSkillValueSchema),
        local: Schema.optional(HarnessSkillValueSchema),
      }),
    ),
  ),
  findConfig: Schema.optional(
    Schema.Struct({
      autoStoreThreshold: Schema.optional(Schema.Number),
      minRagScore: Schema.optional(Schema.Number),
      webFallback: Schema.optional(Schema.Boolean),
      preferredScope: Schema.optional(Schema.Literal("documents", "web")),
    }),
  ),
  pulseConfig: Schema.optional(
    Schema.Struct({
      useLLMRecommendation: Schema.optional(Schema.Boolean),
      includeControllerDecisions: Schema.optional(Schema.Boolean),
      includeBehavior: Schema.optional(Schema.Boolean),
    }),
  ),
  recallConfig: Schema.optional(
    Schema.Struct({
      previewLength: Schema.optional(Schema.Number),
      autoFullThreshold: Schema.optional(Schema.Number),
      maxEntries: Schema.optional(Schema.Number),
      maxTotalBytes: Schema.optional(Schema.Number),
    }),
  ),
});

/**
 * One sub-agent tool: a local agent (`.withAgentTool(name, agent)`) or a remote
 * A2A agent (`.withRemoteAgent(name, remoteUrl)`). Mirrors `AgentToolOptions`
 * (builder/types.ts); `agent.parameters` is stored as a JSON Schema object.
 */
export const AgentToolConfigSchema = Schema.Struct({
  /** Tool name the parent model calls. */
  name: Schema.String,
  /** Local sub-agent settings (mutually exclusive with `remoteUrl`). */
  agent: Schema.optional(
    Schema.Struct({
      name: Schema.String,
      description: Schema.optional(Schema.String),
      provider: Schema.optional(Schema.String),
      model: Schema.optional(Schema.String),
      tools: Schema.optional(Schema.Array(Schema.String)),
      maxIterations: Schema.optional(Schema.Number),
      systemPrompt: Schema.optional(Schema.String),
      persona: Schema.optional(PersonaConfigSchema),
      /**
       * Typed input for the tool as a JSON Schema object (`{ type: "object",
       * properties, required }`). The parent model passes these as arguments;
       * a call whose arguments violate the schema fails with a typed error.
       */
      parameters: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
      requiresApproval: Schema.optional(Schema.Boolean),
      timeoutMs: Schema.optional(Schema.Number),
      maxCallsPerTool: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Number })),
    }),
  ),
  /** Base URL of a remote A2A agent (mutually exclusive with `agent`). */
  remoteUrl: Schema.optional(Schema.String),
});

/** `.withDynamicSubAgents(options)`. Present (even `{}`) = enabled. */
export const DynamicSubAgentsConfigSchema = Schema.Struct({
  maxIterations: Schema.optional(Schema.Number),
  maxRecursionDepth: Schema.optional(Schema.Number),
});

/** `.withVerificationStep(config)`: one post-answer reflect pass. */
export const VerificationStepConfigSchema = Schema.Struct({
  mode: Schema.optional(Schema.Literal("reflect")),
  prompt: Schema.optional(Schema.String),
});

/** One `.withDocuments([...])` entry. The shared `store` option is code-only. */
export const DocumentConfigSchema = Schema.Struct({
  /** File path, URL or label. Read from disk or fetched when `content` is absent. */
  source: Schema.String,
  content: Schema.optional(Schema.String),
  format: Schema.optional(Schema.String),
  chunkStrategy: Schema.optional(Schema.String),
  maxChunkSize: Schema.optional(Schema.Number),
  allowPrivateHosts: Schema.optional(Schema.Boolean),
});

/** `.withModelRouting(options)`. Present (even `{}`) = enabled. */
export const ModelRoutingConfigSchema = Schema.Struct({
  tierModels: Schema.optional(
    Schema.Struct({
      haiku: Schema.optional(Schema.String),
      sonnet: Schema.optional(Schema.String),
      opus: Schema.optional(Schema.String),
    }),
  ),
  minTier: Schema.optional(Schema.Literal("haiku", "sonnet", "opus")),
});

export const ToolsConfigSchema = Schema.Struct({
  allowedTools: Schema.optional(Schema.Array(Schema.String)),
  focusedTools: Schema.optional(Schema.Array(Schema.String)),
  adaptive: Schema.optional(Schema.Boolean),
  /** Shell access (`shell-execute`): `true` for defaults or the shell's data options. */
  terminal: Schema.optional(Schema.Union(Schema.Boolean, ShellConfigSchema)),
  /** Built-in opt-in: `true`, one name (sugar for `[name]`), or names/toolsets. See `ToolsOptions.builtins`. */
  builtins: Schema.optional(Schema.Union(Schema.Boolean, Schema.String, Schema.Array(Schema.String))),
  /** How permitted tools are shown to the model. See `ToolsOptions.disclosure`. Default: undefined (tier default). */
  disclosure: Schema.optional(Schema.Literal("all", "index", "discover")),
  /**
   * Override the risk level of any tool by name, built-ins included.
   * The level decides, for example, whether a tool call embedded in prose or
   * code (`const x = fileRead("/abs")`) executes: only `"low"` tools do.
   * Unknown names log a build warning and are ignored.
   *
   * @example
   * ```typescript
   * agent.withTools({ builtins: ["file-read"], riskLevels: { "file-read": "low" } })
   * ```
   *
   * Default: undefined (every tool keeps its declared level; `file-read` is "medium").
   */
  riskLevels: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.Literal("low", "medium", "high", "critical"),
    }),
  ),
  /**
   * Cap how many times each named tool may run in one agent run. A call past
   * its tool's cap is not executed; the model gets a tool result saying the
   * tool was not run and why, and keeps working. The cap counts calls for the
   * whole run (every turn, every pass), including several calls in one turn.
   * Tools you do not name have no cap. Names that match no tool are allowed
   * and have no effect. Each value must be a positive integer, or
   * `.withTools()` throws.
   *
   * Enforced by the `reactive` (default) and `adaptive` strategies.
   *
   * @example
   * ```typescript
   * agent.withTools({ builtins: ["web-search"], maxCallsPerTool: { "web-search": 3 } })
   * ```
   *
   * Default: undefined (no tool is capped).
   */
  maxCallsPerTool: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Number }),
  ),
  /**
   * The agent's working directory. File tools (`file-read`, `file-write`,
   * `file-edit`, `list-directory`, `grep`) resolve relative paths against it
   * and refuse paths outside it. `shell-execute` (`terminal: true`) runs with
   * it as its working directory; a `terminal.cwd` is resolved inside it and
   * refused if it escapes, unless `terminal.allowUnsafeCwd` is set.
   *
   * A relative path resolves against `process.cwd()` when `.withTools()` runs
   * and is stored absolute. It must be an existing directory, or
   * `.withTools()` throws `ToolsOptionError`. Sub-agents inherit it. Override
   * it for one run with `agent.run(task, { workspace })` (also `runStream`,
   * `runEffect`). Precedence: run option, then this option, then an ambient
   * `withFileRoot()`, then none.
   *
   * @example
   * ```typescript
   * agent.withTools({ builtins: ["file-read", "file-write"], terminal: true, workspace: "/home/me/project" })
   * ```
   *
   * Default: undefined (file tools use `process.cwd()`; `shell-execute` uses a fresh /tmp sandbox dir).
   */
  workspace: Schema.optional(Schema.String),
  /**
   * Web-search backend order for the `web-search` built-in: an ordered subset
   * of `tavily`, `brave`, `serper`, `keenable`, `duckduckgo`. A provider left
   * out is never tried. API keys are NOT part of the serialized config: pass
   * them in code with `.withTools({ webSearch: { apiKeys } })` (see
   * `WebSearchOptionField`).
   *
   * @example
   * ```typescript
   * agent.withTools({ builtins: ["web-search"], webSearch: { providers: ["tavily", "duckduckgo"] } })
   * ```
   *
   * Default: undefined (full chain: tavily, brave, serper, keenable, duckduckgo; keys from env vars).
   */
  webSearch: Schema.optional(
    Schema.Struct({
      providers: Schema.optional(
        Schema.Array(Schema.Literal("tavily", "brave", "serper", "keenable", "duckduckgo")),
      ),
    }),
  ),
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
  /** Per-LLM-call timeout in ms for local providers (`.withLlmTimeout(ms)`). */
  llmTimeoutMs: Schema.optional(Schema.Number),
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
  /** Inbound event queue bounds (see GatewayOptions.queue). */
  queue: Schema.optional(
    Schema.Struct({
      capacity: Schema.optional(Schema.Number),
      overflow: Schema.optional(Schema.Literal("drop-oldest", "drop-newest")),
    }),
  ),
  port: Schema.optional(Schema.Number),
  /** Framework ingress for channel adapters (see GatewayOptions.ingress). */
  ingress: Schema.optional(
    Schema.Struct({
      channels: Schema.optional(
        Schema.Union(Schema.Literal(false), Schema.Array(Schema.String)),
      ),
    }),
  ),
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
  /** Operator-declared read-only: `true` = all tools, or the listed tool names. */
  readOnly: Schema.optional(Schema.Union(Schema.Boolean, Schema.Array(Schema.String))),
  /** Honor this server's `readOnlyHint` annotations. */
  trustAnnotations: Schema.optional(Schema.Boolean),
  /** `false` = never reuse a stored `rax mcp login` for this URL. OAuth objects stay code-only (secrets). */
  auth: Schema.optional(Schema.Literal(false)),
});

/**
 * Reactive intelligence config: `enabled` plus the JSON-safe options of
 * `.withReactiveIntelligence({...})` (`ReactiveIntelligenceConfig` from
 * @reactive-agents/reactive-intelligence). Hook callbacks are code-only.
 */
export const ReactiveIntelligenceConfigSchema = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  entropy: Schema.optional(
    Schema.Struct({
      enabled: Schema.Boolean,
      tokenEntropy: Schema.optional(Schema.Boolean),
      semanticEntropy: Schema.optional(Schema.Boolean),
      trajectoryTracking: Schema.optional(Schema.Boolean),
    }),
  ),
  controller: Schema.optional(
    Schema.Struct({
      earlyStop: Schema.optional(Schema.Boolean),
      branching: Schema.optional(Schema.Boolean),
      contextCompression: Schema.optional(Schema.Boolean),
      strategySwitch: Schema.optional(Schema.Boolean),
      causalAttribution: Schema.optional(Schema.Boolean),
    }),
  ),
  learning: Schema.optional(
    Schema.Struct({
      skillSynthesis: Schema.optional(Schema.Boolean),
      skillDir: Schema.optional(Schema.String),
      banditStrategySelection: Schema.optional(
        Schema.Struct({
          enabled: Schema.Boolean,
          armIds: Schema.optional(Schema.Array(Schema.String)),
        }),
      ),
    }),
  ),
  /** Anonymous run telemetry. Opt-in: absent = off. Env `DO_NOT_TRACK` overrides `true`. */
  telemetry: Schema.optional(
    Schema.Union(
      Schema.Boolean,
      Schema.Struct({ enabled: Schema.Boolean, endpoint: Schema.optional(Schema.String) }),
    ),
  ),
  notice: Schema.optional(Schema.Boolean),
  models: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.Struct({
        contextLimit: Schema.Number,
        tier: Schema.Literal("frontier", "local", "unknown"),
        logprobSupport: Schema.Boolean,
      }),
    }),
  ),
  calibrationDbPath: Schema.optional(Schema.String),
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
  /** Live checklist display (TUI + stream, full density). Display only; absent = on. */
  checklist: Schema.optional(Schema.Boolean),
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
 * A JSON Schema document as plain data: the declarative form of
 * `.withOutputSchema()`'s schema. Any JSON object is accepted here; the
 * keywords are checked when the config is applied to a builder
 * (`OutputSchemaError` names any the runtime cannot validate).
 */
export const OutputJsonSchemaSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown });

/**
 * Declarative options for typed structured output (`mode`, `onParseFail`,
 * `abstainBelow`). They apply together with `outputSchema`; without a schema
 * they map to no builder call.
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

/** Data form of `.withCalibration(mode, { learned, community })`; a `ModelCalibration` object stays code-only. */
export const CalibrationConfigSchema = Schema.Struct({
  mode: Schema.Literal("auto", "skip"),
  learned: Schema.optional(Schema.Boolean),
  community: Schema.optional(Schema.Boolean),
});

/** Durable run persistence (crash-resume) configuration. */
export const DurableRunsConfigSchema = Schema.Struct({
  dir: Schema.optional(Schema.String),
  checkpointEvery: Schema.optional(Schema.Number),
  retention: Schema.optional(DurableRetentionSchema),
});

/**
 * The data half of `.withApprovalPolicy()`. `requireFor` and `onApprove` are
 * functions and stay code-only: a stored policy re-applied without `onApprove`
 * in block mode refuses every gated call (deny by default).
 */
export const ApprovalPolicyConfigSchema = Schema.Struct({
  /** "detach" (a person decides; waits live, or pauses durably with durableRuns) or "block" (decide in process). */
  mode: Schema.optional(Schema.Literal("detach", "block")),
  /** Tool names whose calls need approval. */
  tools: Schema.optional(Schema.Array(Schema.String)),
  /** Shell command rules (`"git push"`): a matching shell call needs approval. */
  commands: Schema.optional(Schema.Array(Schema.String)),
  /** How long an approval waits for a person, in ms; no decision in time denies the call. */
  timeoutMs: Schema.optional(Schema.Number),
});

// Compile-time guard: the schema stays a subset of the canonical authored
// policy shape (reasoning approval-gate.ts), so a renamed field fails here.
type ApprovalPolicySchemaType = Schema.Schema.Type<typeof ApprovalPolicyConfigSchema>;
type _ApprovalSchemaFitsAuthored = Assert<
  keyof ApprovalPolicySchemaType extends keyof AuthoredApprovalPolicy
    ? ApprovalPolicySchemaType extends AuthoredApprovalPolicy
      ? true
      : false
    : false
>;
type Assert<T extends true> = T;

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
  /** Channel routes (who may reach which agent through a shared channel); see `.withChannels({ routes })`. */
  channelRoutes: Schema.optional(Schema.Array(RouteSpec)),
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
   * Typed structured output schema, as a JSON Schema object
   * (`.withOutputSchema(jsonSchema, outputSchemaOptions)`). `toConfig()` writes it
   * for any schema with a JSON Schema form (Effect, Zod, Valibot, ArkType, JSON Schema).
   *
   * @example { "type": "object", "properties": { "city": { "type": "string" } }, "required": ["city"] }
   */
  outputSchema: Schema.optional(OutputJsonSchemaSchema),
  /**
   * Behavioural options for typed structured output (mode, onParseFail, abstainBelow).
   * Applied with `outputSchema`; on their own they map to no builder call.
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
  /** Synthesize and store a post-run debrief. Default: follows memory (on with `.withMemory()`, off otherwise); set it to override either way. */
  debrief: Schema.optional(Schema.Boolean),
  /** Per-model calibration: `mode` plus the opt-in `learned` / `community` tiers. Absent = auto when reasoning is on, tiers off. */
  calibration: Schema.optional(CalibrationConfigSchema),
  /** Durable run persistence (crash-resume) configuration. */
  durableRuns: Schema.optional(DurableRunsConfigSchema),
  /** Approval policy: mode, gated tool names and shell command rules. */
  approvalPolicy: Schema.optional(ApprovalPolicyConfigSchema),
  /** Agent-initiated user interaction (`.withUserInteraction()`): the model may call `request_user_input`. */
  userInteraction: Schema.optional(
    Schema.Union(
      Schema.Boolean,
      /** `timeoutMs`: how long a live question waits for an answer, in ms. */
      Schema.Struct({ timeoutMs: Schema.optional(Schema.Number) }),
    ),
  ),
  /**
   * Thinking mode. A boolean is `.withModel({ thinking })`; an object is
   * `.withThinking({ enabled, effort, budgetTokens })`.
   */
  thinking: Schema.optional(Schema.Union(Schema.Boolean, ThinkingConfigSchema)),
  /** SKILL.md directories and pinned skills (`.withSkills()`). */
  skills: Schema.optional(SkillsConfigSchema),
  /** Meta-tools (`.withMetaTools()`). `false` turns them off. */
  metaTools: Schema.optional(Schema.Union(Schema.Literal(false), MetaToolsConfigSchema)),
  /** Sub-agent tools: local (`.withAgentTool()`) and remote (`.withRemoteAgent()`). */
  agentTools: Schema.optional(Schema.Array(AgentToolConfigSchema)),
  /** Dynamic sub-agent spawning (`.withDynamicSubAgents()`). Present = on. */
  dynamicSubAgents: Schema.optional(DynamicSubAgentsConfigSchema),
  /** Post-answer reflect pass (`.withVerificationStep()`). */
  verificationStep: Schema.optional(VerificationStepConfigSchema),
  /** Documents ingested for RAG retrieval (`.withDocuments()`). */
  documents: Schema.optional(Schema.Array(DocumentConfigSchema)),
  /** Cost-aware model routing (`.withModelRouting()`). Present = on. */
  modelRouting: Schema.optional(ModelRoutingConfigSchema),
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
  /** Custom pricing registry, $/1M tokens (cache rates optional; user pricing wins). */
  pricingRegistry: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: ModelPricingSchema,
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

/**
 * The `webSearch` option of `.withTools()` in code: the serializable
 * `providers` order plus runtime-only `apiKeys` (plain strings or `Redacted`).
 * Keys are per agent and win over environment variables; they are never
 * written to `toConfig()`, JSON, traces or tool results.
 */
export interface WebSearchOptionField {
  readonly webSearch?: WebSearchConfig;
}
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
 * Applies the calls from `agentConfigToBuilderCalls(config)`, in order, to a
 * fresh builder. `agentConfigToSource(config)` prints the same list, so the
 * printed code and this builder cannot drift apart.
 * The returned builder can be further customized before calling `.build()`.
 *
 * @param config - The AgentConfig to reconstruct from
 * @returns A configured ReactiveAgentBuilder
 */
export async function agentConfigToBuilder(config: AgentConfig): Promise<ReactiveAgentBuilder> {
  // Use lazy import() to avoid circular dependency — builder.ts imports types from
  // this file at the top level, so we defer the runtime import.
  const { ReactiveAgents } = await import("./builder.js");
  return agentConfigToBuilderCalls(config).reduce(applyBuilderCall, ReactiveAgents.create());
}
