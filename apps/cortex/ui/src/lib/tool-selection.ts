import type { AgentConfig } from "./types/agent-config.js";

/** True when the config selects anything the agent could call (tools, MCP, sub-agents, host shell). */
export function hasToolSelection(cfg: Pick<AgentConfig, "tools" | "mcpServerIds" | "agentTools" | "dynamicSubAgents" | "terminalTools" | "additionalToolNames">): boolean {
  return (
    cfg.tools.length > 0 ||
    (cfg.mcpServerIds?.length ?? 0) > 0 ||
    (cfg.agentTools?.length ?? 0) > 0 ||
    cfg.dynamicSubAgents?.enabled === true ||
    cfg.terminalTools === true ||
    (cfg.additionalToolNames ?? "").trim() !== ""
  );
}

/**
 * Whether tools run. An explicit choice wins; otherwise tools are on exactly
 * when something is selected — so a selection can never be silently ignored.
 */
export function effectiveToolsEnabled(
  cfg: Parameters<typeof hasToolSelection>[0],
  explicit: boolean | undefined,
): boolean {
  return explicit ?? hasToolSelection(cfg);
}
