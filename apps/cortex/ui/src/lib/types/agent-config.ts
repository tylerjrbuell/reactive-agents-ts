/** Shared AgentConfig type and defaults used across Cortex UI */

export interface AgentConfig {
  provider: string;
  model: string;
  temperature: number;
  strategy: "react" | "plan-execute-reflect" | "tree-of-thought" | "reflexion" | "adaptive";
  maxIterations: number;
  strategySwitching: boolean;
  minIterations: number;
  verificationStep: "none" | "reflect";
  tools: string[];
  memory: { working: boolean; episodic: boolean; semantic: boolean };
  guardrails: {
    enabled: boolean;
    injectionThreshold: number;
    piiThreshold: number;
    toxicityThreshold: number;
  };
  contextSynthesis: "auto" | "template" | "llm" | "none";
  systemPrompt: string;
  agentName: string;
}

export function defaultConfig(): AgentConfig {
  return {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    temperature: 0.7,
    strategy: "react",
    maxIterations: 10,
    strategySwitching: false,
    minIterations: 0,
    verificationStep: "none",
    tools: ["web-search"],
    memory: { working: true, episodic: false, semantic: false },
    guardrails: { enabled: false, injectionThreshold: 0.8, piiThreshold: 0.9, toxicityThreshold: 0.7 },
    contextSynthesis: "auto",
    systemPrompt: "",
    agentName: "",
  };
}
