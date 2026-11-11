import { tmpdir } from "node:os";
import type { CortexShellOptions } from "../../services/cortex-agent-config.js";

/**
 * A "maximal" POST body covering every wired AgentConfig field.
 * When you add a new field to AgentConfig, add it here AND assert it in
 * `config-parity.test.ts`. Also read by `cortex-agent-source.test.ts`
 * ("Export as code" round trip).
 */
export const FULL_CONFIG_BODY = {
  prompt:             "test prompt",
  provider:           "anthropic",
  model:              "claude-sonnet-4-6",
  temperature:        0.5,
  maxTokens:          1000,
  strategy:           "reactive",
  maxIterations:      8,
  minIterations:      2,
  verificationStep:   "reflect",
  runtimeVerification: true,
  auditRationale:     true,
  terminalTools:      true,
  terminalShellAdditionalCommands: "bun, gh",
  tools:              ["web-search"],
  additionalToolNames: "http-get, my-lab-tool",
  systemPrompt:       "You are helpful",
  agentName:          "parity-agent",
  timeout:            30000,
  retryPolicy:        { enabled: true, maxRetries: 2, backoffMs: 500 },
  fallbacks:          { enabled: true, providers: ["openai"], errorThreshold: 2 },
  metaTools:          { enabled: true, brief: true, find: true, pulse: false, recall: true, harnessSkill: false, todo: true },
  observability:      { checklist: false },
  agentTools:         [
    { kind: "local", toolName: "researcher", agent: { name: "Research", tools: ["web-search"], maxIterations: 5 } },
  ],
  dynamicSubAgents:   { enabled: true, maxIterations: 6 },
  /** Phase 1 — background context for reasoning (`withTaskContext`) */
  taskContext:        { project: "acme", environment: "staging" },
  /** Phase 1 — enables `agent.health()` on built agents */
  healthCheck:        true,
  skills: {
    paths: ["./.claude/skills", "./skills"],
    activate: ["forced-skill"],
    /** `withSkills({ global })`: also scan the user-global skill dirs */
    global: true,
  },
  /** Phase A — cost-aware model routing (`withModelRouting`) */
  modelRouting:       { enabled: true, minTier: "haiku" },
  /** Fabrication guard override — `.withFabricationGuard()`. Always-on at "block" without this. */
  fabricationGuard:   "warn",
  /** Working directory for file tools + shell — must exist (checked by the route). */
  workspace:          tmpdir(),
  terminalShellOptions: { cwd: "sub", allowUnsafeCwd: true, timeoutMs: 9000, maxOutputChars: 800, commandAccess: ["github"], sandbox: "docker" } satisfies CortexShellOptions,
  guardrails:         { enabled: true, injection: true, pii: false, toxicity: true, customBlocklist: ["secret"] },
  durableRuns:        { enabled: true },
  approvalPolicy:     { mode: "block" as const, tools: ["file-write"], commands: ["git push", "gh pr create"] },
  rawConfig:          { profile: "lean", tools: { maxCallsPerTool: { "web-search": 3 } } },
};
