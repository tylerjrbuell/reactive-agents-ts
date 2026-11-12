/** Shared AgentConfig type and defaults used across Cortex UI */
import { approvalPolicyFrom, asksBeforeRiskyToolsFrom, defaultApprovalPolicy, type ApprovalPolicyConfig } from "../approval-policy.js";
import { defaultJudgment, judgmentFrom, type JudgmentFormConfig } from "../judgment-config.js";
import type { ChannelEntry } from "../channels.js";
import type { GatewayBlock } from "../channel-access.js";

/** Matches server `CortexAgentToolEntry` for POST /api/runs and saved gateway config. */
export type CortexAgentToolConfig =
  | {
      kind: "local";
      toolName: string;
      agent: {
        name: string;
        description?: string;
        provider?: string;
        model?: string;
        tools?: string[];
        maxIterations?: number;
        systemPrompt?: string;
      };
    }
  | { kind: "remote"; toolName: string; remoteUrl: string };

export interface AgentPersona {
  enabled: boolean;
  role: string;
  tone: "concise" | "formal" | "casual" | "technical";
  traits: string;
  responseStyle: "prose" | "bullet-points" | "structured";
}

export type VariableType = "string" | "number" | "enum" | "multiline";

/** A template variable. `{{name}}` tokens in any string config field resolve against these. */
export interface VariableDef {
  name: string;
  type: VariableType;
  description?: string;
  default?: string | number;
  required: boolean;
  enumValues?: string[];
  /** Reserved for the future secret store; Phase 1 leaves `{{secret.X}}` unresolved. */
  secret?: boolean;
}

export interface ShellOptions {
  /** Shell working directory, resolved inside the workspace when one is set. "" = workspace / sandbox. */
  cwd: string;
  /** Allow a `cwd` outside the workspace (or outside /tmp with no workspace). */
  allowUnsafeCwd: boolean;
  /** Per-command timeout, ms. 0 = framework default (30 s). */
  timeoutMs: number;
  /** Output truncation, characters. 0 = framework default (4000). */
  maxOutputChars: number;
  /**
   * Legacy `commandAccess` groups (`ShellExecuteConfig.commandAccess.capabilities`). The builder
   * no longer sets them: it folds stored groups into its one allowed-commands list and clears
   * this on the first edit (`shell-allowlist.ts`). Still sent when present, so no command is lost.
   */
  commandAccess: string[];
  /** `docker` runs each command in a throwaway container with no host files. */
  sandbox: "host" | "docker";
}

export function defaultShellOptions(): ShellOptions {
  return { cwd: "", allowUnsafeCwd: false, timeoutMs: 0, maxOutputChars: 0, commandAccess: [], sandbox: "host" };
}

/** Only the non-default shell options, as the server's `terminalShellOptions`; undefined when none. */
export function shellOptionsBody(o: Partial<ShellOptions> | undefined): Record<string, unknown> | undefined {
  if (!o) return undefined;
  const out: Record<string, unknown> = {
    ...(o.cwd?.trim() ? { cwd: o.cwd.trim() } : {}),
    ...(o.allowUnsafeCwd ? { allowUnsafeCwd: true } : {}),
    ...(o.timeoutMs && o.timeoutMs > 0 ? { timeoutMs: o.timeoutMs } : {}),
    ...(o.maxOutputChars && o.maxOutputChars > 0 ? { maxOutputChars: o.maxOutputChars } : {}),
    ...(o.commandAccess && o.commandAccess.length > 0 ? { commandAccess: o.commandAccess } : {}),
    ...(o.sandbox === "docker" ? { sandbox: "docker" } : {}),
  };
  return Object.keys(out).length > 0 ? out : undefined;
}

export interface AgentConfig {
  provider: string;
  model: string;
  temperature: number;
  maxTokens: number;
  /** Provider context window override. Honored by local providers (Ollama `num_ctx`); cloud providers without a context knob ignore it. `0` = provider default. */
  numCtx: number;
  /** Extended thinking: `true`/`false` forces it; absent = auto (the model's own default). */
  thinking?: boolean;
  /**
   * Canonical registry strategy name. Superset — the option list is served by
   * the capability manifest (`GET /api/capabilities`) at runtime, so new
   * framework strategies (blueprint/code-action/direct/…) appear automatically.
   * `reactive` = ReAct loop (UI label "ReAct").
   */
  strategy: string;
  maxIterations: number;
  minIterations: number;
  strategySwitching: boolean;
  verificationStep: "none" | "reflect";
  /**
   * When true, enables the framework **verification** package (semantic entropy, etc.) on the agent.
   * Distinct from {@link verificationStep} “reflect”, which is a single post-answer LLM review pass.
   */
  runtimeVerification: boolean;
  /**
   * Opt-in: emit per-tool-call decision rationale into the debrief. Audit feature —
   * a cross-tier ablation showed it adds latency/tokens with no quality lift, and can
   * degrade output on smaller/less-capable local models. Default OFF.
   */
  auditRationale: boolean;
  tools: string[];
  /**
   * Registers `shell-execute` with default allowlist/blocklist on the host (**not** Docker-isolated).
   * You are responsible for risk; only enable on trusted machines and with awareness of allowed commands.
   */
  terminalTools: boolean;
  /**
   * Extra first-token command names for `shell-execute` (`ShellExecuteConfig.additionalCommands`), e.g. `node`, `bun`, `gh`.
   * Only applied when {@link terminalTools} is true (or `shell-execute` is in the tool list). Comma or newline separated.
   */
  terminalShellAdditionalCommands: string;
  /**
   * When non-empty, replaces the framework default shell allowlist (`ShellExecuteConfig.allowedCommands`).
   * Advanced — you must list every executable you want the agent to run. Leave empty to use defaults + extras above.
   */
  terminalShellAllowedCommands: string;
  /** Host-shell options beyond the command lists (`ShellExecuteConfig`). 0 / "" = framework default. */
  terminalShellOptions: ShellOptions;
  /**
   * Agent working directory (absolute, existing). File tools resolve and confine to it and
   * `shell-execute` runs in it (`.withTools({ workspace })`). "" = none.
   */
  workspace: string;
  /**
   * Extra tool IDs merged into {@link tools} when launching (comma or newline separated).
   * Use for Lab custom tools, `http-get`, or any registered name not shown as a quick pick.
   */
  additionalToolNames: string;
  /** MCP servers (Cortex Tools tab) to connect at run time — tool names use `name/tool` form in `tools`. */
  mcpServerIds: string[];
  agentTools: CortexAgentToolConfig[];
  /** `.withDynamicSubAgents`: `maxRecursionDepth` unset = spawned agents cannot spawn their own (framework default). */
  dynamicSubAgents: { enabled: boolean; maxIterations: number; maxRecursionDepth?: number };
  memory: { working: boolean; episodic: boolean; semantic: boolean };
  contextSynthesis: "auto" | "template" | "llm" | "none";
  guardrails: {
    enabled: boolean;
    /** Detector switches (framework `withGuardrails`); absent on old saves = on. */
    injection?: boolean;
    pii?: boolean;
    toxicity?: boolean;
    /** Extra phrases the guardrail blocks. */
    customBlocklist?: string[];
    /** Legacy: the framework has no thresholds; only > 0 (on) vs 0 (off) was ever read. */
    injectionThreshold: number;
    piiThreshold: number;
    toxicityThreshold: number;
  };
  /**
   * Default task instruction for saved agents (Builder “Prompt”): used when triggering
   * gateway/cron runs or ad-hoc saved agents. Distinct from `systemPrompt` (LLM system message).
   */
  prompt: string;
  systemPrompt: string;
  agentName: string;
  persona: AgentPersona;
  // ── Execution controls ──────────────────────────────────────────────
  timeout: number;            // ms, 0 = no timeout
  retryPolicy: { enabled: boolean; maxRetries: number; backoffMs: number };
  // ── Conductor's Suite meta-tools ────────────────────────────────────
  metaTools: { enabled: boolean; brief: boolean; find: boolean; pulse: boolean; recall: boolean; harnessSkill: boolean; todo?: boolean; todoGuidance?: { reminder?: boolean; systemLine?: boolean } };
  /** Display-only live checklist toggle; absent = framework default (on). */
  observability?: { checklist?: boolean };
  // ── Provider fallbacks ───────────────────────────────────────────────
  fallbacks: { enabled: boolean; providers: string[]; errorThreshold: number };
  // ── Observability ────────────────────────────────────────────────────
  observabilityVerbosity: "off" | "minimal" | "normal" | "verbose";
  /** Background key/value facts for framework `withTaskContext` (Lab: KEY=value per line). */
  taskContext: Record<string, string>;
  /** Enables framework health probes (`agent.health()`). */
  healthCheck: boolean;
  /** Durable execution (v0.12): crash-resume via SQLite RunStore. Framework: `.withDurableRuns()`. */
  durableRuns: {
    enabled: boolean;
  };
  /**
   * Which tool calls and shell commands need approval, and what happens then:
   * the framework's `AgentConfig.approvalPolicy` (`.withApprovalPolicy()`).
   * Empty lists = no gate. Rules in `lib/approval-policy.ts`.
   */
  approvalPolicy: ApprovalPolicyConfig;
  /**
   * Cortex asks before risky tools (file-write, code-execute, the shell...) even with
   * no rule above. On by default; only `false` opts out. Cortex-only (the framework's
   * own default stays off); sent as `askBeforeRiskyTools`.
   */
  askBeforeRiskyTools: boolean;
  /**
   * Messaging channels (Lab · Channels): Telegram, Signal and webhook adapters a saved gateway
   * agent keeps connected. Non-secret settings only; credentials are saved separately
   * (`lib/gateway-api.ts`). Gateway agents only: a desk run or chat turn never connects them.
   */
  channels?: ChannelEntry[];
  /**
   * The gateway block Cortex curates (`gateway.accessControl`, `gateway.queue`, `gateway.crons`).
   * Absent access control is the framework's fail-closed default: nobody may message the agent.
   */
  gateway?: GatewayBlock;
  /**
   * Typed structured output (v0.12): a JSON Schema (as text) the run's answer is
   * extracted into. Empty = off. Sent as `outputSchema` → `.withOutputSchema()`;
   * the extracted value surfaces in the run's Structured Output view.
   */
  outputSchema: string;
  /**
   * What happens when the answer does not parse into {@link outputSchema}
   * (`.withOutputSchema(schema, { onParseFail })`): "degrade" (framework default) returns
   * the text with `objectError`; "throw" fails the run. Sent only with a valid schema.
   */
  outputSchemaOnParseFail: "degrade" | "throw";
  /** Cost/token budget caps (v0.12). 0 = unset. `.withBudget()`. */
  budget: { tokenLimit: number; costLimit: number };
  /** Numeric evidence-grounding (v0.12). "off" = disabled. `.withGrounding()`. */
  grounding: { mode: "off" | "warn" | "block" };
  /**
   * Fabrication guard override. The framework runs this ALWAYS ON at "block"
   * even if never configured — "default" here means "send no override, keep
   * that framework default"; "off"/"warn"/"block" send an explicit override.
   * `.withFabricationGuard()`.
   */
  fabricationGuard: { mode: "default" | "off" | "warn" | "block" };
  /** Judgment backend (`.withJudgment()`, applied as an overlay: no AgentConfig form). Off = not sent. */
  judgment: JudgmentFormConfig;
  /** Harness typed control surface (0.16) — JSON object → `.withHarness()`. Empty = off. */
  harness: string;
  /** RAG documents (JSON array of {source, content?, ...}) — `.withDocuments()`. Empty = off. */
  documents: string;
  /** Cost-aware model routing (v0.13). enabled=false → not applied. `.withModelRouting()`. */
  modelRouting: { enabled: boolean; minTier?: "haiku" | "sonnet" | "opus"; tierModels?: Record<string, string> };
  /** Generic framework-config overrides from the type-introspected renderer — a
   * nested partial AgentConfig keyed by manifest configField paths. Empty by default. */
  rawConfig: Record<string, unknown>;
  /**
   * Living skills: SKILL.md directories + optional forced-activation names
   * (framework `withSkills`). NOTE: there is no `evolution` field — the
   * framework's `withSkills()` THROWS if an `evolution` key is present
   * (removed v0.14, DEBT-REGISTER P0-10). Never reintroduce it here.
   */
  skills: {
    /** Extra skill folders; relative ones resolve against the run's workspace. */
    paths: string[];
    activate?: string[];
    /** Also scan `~/.agents/skills` and `~/.reactive-agents/skills` (framework `withSkills({ global })`). */
    global?: boolean;
  };
  /**
   * Lifecycle webhooks — server fires a POST to each URL on run start/completion/failure.
   * `events` empty or `["all"]` = every lifecycle event. Fire-and-forget, best-effort.
   */
  lifecycleWebhooks: { url: string; events: string[] }[];
  /** Template variables for parameterized runs. `{{name}}` in any string field resolves against these. */
  variables: VariableDef[];
}

/** A JSON-text panel field from a stored value: text stays as is, a parsed object/array is re-serialised. */
function jsonText(v: unknown): string {
  if (typeof v === "string") return v;
  return v !== null && typeof v === "object" ? JSON.stringify(v, null, 2) : "";
}

/**
 * A full `AgentConfig` from a stored (server-normalised) config blob. The server keeps only
 * non-default nested fields and the build shape of `durableRuns` (`approvalPolicy`), so nested
 * objects are merged over their defaults instead of replacing them.
 */
export function hydrateAgentConfig(raw: Record<string, unknown>): AgentConfig {
  const base = defaultConfig();
  const cfg = { ...base, ...(raw as Partial<AgentConfig>) };
  const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const dr = obj(raw.durableRuns);
  return {
    ...cfg,
    terminalShellOptions: { ...defaultShellOptions(), ...obj(raw.terminalShellOptions) } as ShellOptions,
    guardrails: { ...base.guardrails, ...obj(raw.guardrails) } as AgentConfig["guardrails"],
    durableRuns: { enabled: dr.enabled === true },
    // Old saves kept the gate under durableRuns; approvalPolicyFrom reads both shapes.
    approvalPolicy: approvalPolicyFrom(raw),
    askBeforeRiskyTools: asksBeforeRiskyToolsFrom(raw),
    rawConfig: Object.keys(obj(raw.rawConfig)).length > 0 ? obj(raw.rawConfig) : {},
    outputSchemaOnParseFail: raw.outputSchemaOnParseFail === "throw" ? "throw" : "degrade",
    // The panel edits these as JSON text; the server stores them parsed.
    outputSchema: jsonText(raw.outputSchema),
    harness: jsonText(raw.harness),
    documents: jsonText(raw.documents),
    workspace: typeof raw.workspace === "string" ? raw.workspace : "",
    judgment: judgmentFrom(raw.judgment),
  };
}

export function defaultConfig(): AgentConfig {
  return {
    provider: "anthropic",
    // Empty → the builder seeds the framework's current default for the provider
    // (AgentConfigPanel auto-selects it), and an empty model resolves to the
    // framework provider default at run time. Never hardcode a model id here —
    // it would drift when the framework bumps defaults (e.g. a model retiring).
    model: "",
    temperature: 0.7,
    maxTokens: 0,
    numCtx: 0,
    strategy: "reactive",
    maxIterations: 10,
    minIterations: 0,
    strategySwitching: false,
    durableRuns: { enabled: false },
    approvalPolicy: defaultApprovalPolicy(),
    askBeforeRiskyTools: true,
    outputSchema: "",
    outputSchemaOnParseFail: "degrade",
    budget: { tokenLimit: 0, costLimit: 0 },
    grounding: { mode: "off" },
    fabricationGuard: { mode: "default" },
    judgment: defaultJudgment(),
    harness: "",
    documents: "",
    modelRouting: { enabled: false },
    rawConfig: {},
    verificationStep: "none",
    runtimeVerification: false,
    auditRationale: false,
    lifecycleWebhooks: [],
    tools: ["web-search"],
    terminalTools: false,
    terminalShellAdditionalCommands: "",
    terminalShellAllowedCommands: "",
    terminalShellOptions: defaultShellOptions(),
    workspace: "",
    additionalToolNames: "",
    mcpServerIds: [],
    agentTools: [],
    dynamicSubAgents: { enabled: false, maxIterations: 8 },
    memory: { working: true, episodic: false, semantic: false },
    contextSynthesis: "auto",
    guardrails: { enabled: false, injection: true, pii: true, toxicity: true, customBlocklist: [], injectionThreshold: 0.8, piiThreshold: 0.9, toxicityThreshold: 0.7 },
    prompt: "",
    systemPrompt: "",
    agentName: "",
    persona: { enabled: false, role: "", tone: "concise", traits: "", responseStyle: "prose" },
    timeout: 0,
    retryPolicy: { enabled: false, maxRetries: 3, backoffMs: 1000 },
    metaTools: { enabled: false, brief: false, find: false, pulse: false, recall: false, harnessSkill: false, todo: false },
    fallbacks: { enabled: false, providers: [], errorThreshold: 3 },
    observabilityVerbosity: "off",
    taskContext: {},
    healthCheck: false,
    skills: { paths: [] },
    variables: [],
  };
}
