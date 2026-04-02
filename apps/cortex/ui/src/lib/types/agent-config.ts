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

export interface AgentConfig {
  provider: string;
  model: string;
  temperature: number;
  maxTokens: number;
  /** `reactive` = ReAct loop (registry name; UI label "ReAct"). */
  strategy: "reactive" | "plan-execute-reflect" | "tree-of-thought" | "reflexion" | "adaptive";
  maxIterations: number;
  minIterations: number;
  strategySwitching: boolean;
  verificationStep: "none" | "reflect";
  tools: string[];
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
  cacheTimeout: number;       // ms, 0 = no cache
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
  /** Living skills: SKILL.md directories + optional evolution (framework `withSkills`). */
  skills: {
    paths: string[];
    evolution?: { mode?: string; refinementThreshold?: number; rollbackOnRegression?: boolean };
  };
}

export function defaultConfig(): AgentConfig {
  return {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    temperature: 0.7,
    maxTokens: 0,
    strategy: "reactive",
    maxIterations: 10,
    minIterations: 0,
    strategySwitching: false,
    verificationStep: "none",
    tools: ["web-search"],
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
    cacheTimeout: 0,
    progressCheckpoint: 0,
    metaTools: { enabled: false, brief: false, find: false, pulse: false, recall: false, harnessSkill: false },
    fallbacks: { enabled: false, providers: [], errorThreshold: 3 },
    observabilityVerbosity: "off",
    taskContext: {},
    healthCheck: false,
    skills: { paths: [] },
  };
}
