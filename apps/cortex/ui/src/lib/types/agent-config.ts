/** Shared AgentConfig type and defaults used across Cortex UI */

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

export interface AgentConfig {
  provider: string;
  model: string;
  temperature: number;
  maxTokens: number;
  /** Provider context window override. Honored by local providers (Ollama `num_ctx`); cloud providers without a context knob ignore it. `0` = provider default. */
  numCtx: number;
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
  /**
   * Run the full reasoning kernel (calibration, tool-call healing, strategy
   * selection, durable seam). Default `true` — a standard Reactive Agent.
   * `false` → lighter inline-think single-loop path.
   */
  useReasoning: boolean;
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
  /**
   * Extra tool IDs merged into {@link tools} when launching (comma or newline separated).
   * Use for Lab custom tools, `http-get`, or any registered name not shown as a quick pick.
   */
  additionalToolNames: string;
  /** MCP servers (Cortex Tools tab) to connect at run time — tool names use `name/tool` form in `tools`. */
  mcpServerIds: string[];
  agentTools: CortexAgentToolConfig[];
  dynamicSubAgents: { enabled: boolean; maxIterations: number };
  memory: { working: boolean; episodic: boolean; semantic: boolean };
  contextSynthesis: "auto" | "template" | "llm" | "none";
  guardrails: {
    enabled: boolean;
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
  progressCheckpoint: number; // every N iterations, 0 = disabled
  // ── Conductor's Suite meta-tools ────────────────────────────────────
  metaTools: { enabled: boolean; brief: boolean; find: boolean; pulse: boolean; recall: boolean; harnessSkill: boolean };
  // ── Provider fallbacks ───────────────────────────────────────────────
  fallbacks: { enabled: boolean; providers: string[]; errorThreshold: number };
  // ── Observability ────────────────────────────────────────────────────
  observabilityVerbosity: "off" | "minimal" | "normal" | "verbose";
  /** Background key/value facts for framework `withTaskContext` (Lab: KEY=value per line). */
  taskContext: Record<string, string>;
  /** Enables framework health probes (`agent.health()`). */
  healthCheck: boolean;
  /**
   * Durable execution (v0.12): crash-resume via SQLite RunStore + durable HITL.
   * `approvalTools` are tool names that pause the run for human approval
   * (surfaced in the Approval panel on the runs page). Forces the reasoning
   * kernel on. Framework: `.withDurableRuns()` / `.withApprovalPolicy()`.
   */
  durableRuns: { enabled: boolean; approvalTools: string[] };
  /**
   * Typed structured output (v0.12): a JSON Schema (as text) the run's answer is
   * extracted into. Empty = off. Sent as `outputSchema` → `.withOutputSchema()`;
   * the extracted value surfaces in the run's Structured Output view.
   */
  outputSchema: string;
  /** Cost/token budget caps (v0.12). 0 = unset. `.withBudget()`. */
  budget: { tokenLimit: number; costLimit: number };
  /** Numeric evidence-grounding (v0.12). "off" = disabled. `.withGrounding()`. */
  grounding: { mode: "off" | "warn" | "block" };
  /** Cost-aware model routing (v0.13). enabled=false → not applied. `.withModelRouting()`. */
  modelRouting: { enabled: boolean; minTier?: "haiku" | "sonnet" | "opus"; tierModels?: Record<string, string> };
  /** Generic framework-config overrides from the type-introspected renderer — a
   * nested partial AgentConfig keyed by manifest configField paths. Empty by default. */
  rawConfig: Record<string, unknown>;
  /** Living skills: SKILL.md directories + optional evolution (framework `withSkills`). */
  skills: {
    paths: string[];
    evolution?: { mode?: string; refinementThreshold?: number; rollbackOnRegression?: boolean };
  };
  /**
   * Lifecycle webhooks — server fires a POST to each URL on run start/completion/failure.
   * `events` empty or `["all"]` = every lifecycle event. Fire-and-forget, best-effort.
   */
  lifecycleWebhooks: { url: string; events: string[] }[];
  /** Template variables for parameterized runs. `{{name}}` in any string field resolves against these. */
  variables: VariableDef[];
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
    useReasoning: true,
    durableRuns: { enabled: false, approvalTools: [] },
    outputSchema: "",
    budget: { tokenLimit: 0, costLimit: 0 },
    grounding: { mode: "off" },
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
    additionalToolNames: "",
    mcpServerIds: [],
    agentTools: [],
    dynamicSubAgents: { enabled: false, maxIterations: 8 },
    memory: { working: true, episodic: false, semantic: false },
    contextSynthesis: "auto",
    guardrails: { enabled: false, injectionThreshold: 0.8, piiThreshold: 0.9, toxicityThreshold: 0.7 },
    prompt: "",
    systemPrompt: "",
    agentName: "",
    persona: { enabled: false, role: "", tone: "concise", traits: "", responseStyle: "prose" },
    timeout: 0,
    retryPolicy: { enabled: false, maxRetries: 3, backoffMs: 1000 },
    progressCheckpoint: 0,
    metaTools: { enabled: false, brief: false, find: false, pulse: false, recall: false, harnessSkill: false },
    fallbacks: { enabled: false, providers: [], errorThreshold: 3 },
    observabilityVerbosity: "off",
    taskContext: {},
    healthCheck: false,
    skills: { paths: [] },
    variables: [],
  };
}
