import type { AgentConfig, CortexAgentToolConfig } from "$lib/types/agent-config.js";

/** The config AgentConfigPanel and its section components edit. */
export type PanelAgentConfig = AgentConfig & {
  maxTokens: number;
  timeout: number;
  retryPolicy: { enabled: boolean; maxRetries: number; backoffMs: number };
  metaTools: { enabled: boolean; brief: boolean; find: boolean; pulse: boolean; recall: boolean; harnessSkill: boolean; todo?: boolean; todoGuidance?: { reminder?: boolean; systemLine?: boolean } };
  /** Display-only live checklist toggle; absent = framework default (on). */
  observability?: { checklist?: boolean };
  fallbacks: { enabled: boolean; providers: string[]; errorThreshold: number };
  observabilityVerbosity: "off" | "minimal" | "normal" | "verbose";
  mcpServerIds: string[];
  agentTools: CortexAgentToolConfig[];
  dynamicSubAgents: { enabled: boolean; maxIterations: number; maxRecursionDepth?: number };
  skills: { paths: string[]; activate?: string[]; global?: boolean };
};

/** One saved MCP server and its cached tools (GET /api/mcp-servers). */
export type McpCatalogRow = {
  serverId: string;
  name: string;
  tools: { toolName: string; description?: string }[];
  /** The saved config (credentials masked): the attach list reads `readOnly` from it. */
  config?: Record<string, unknown>;
  /** False when switched off in Lab > Tools > Servers; absent on an older server build (on). */
  enabled?: boolean;
};

/** A strategy option in the Reasoning section. */
export type StrategyOption = { value: string; label: string; desc: string };
