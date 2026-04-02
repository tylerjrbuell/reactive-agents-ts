/** Shared AgentConfig type and defaults used across Cortex UI */

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
  memory: { working: boolean; episodic: boolean; semantic: boolean };
  contextSynthesis: "auto" | "template" | "llm" | "none";
  guardrails: {
    enabled: boolean;
    injectionThreshold: number;
    piiThreshold: number;
    toxicityThreshold: number;
  };
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
    memory: { working: true, episodic: false, semantic: false },
    contextSynthesis: "auto",
    guardrails: { enabled: false, injectionThreshold: 0.8, piiThreshold: 0.9, toxicityThreshold: 0.7 },
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
  };
}
