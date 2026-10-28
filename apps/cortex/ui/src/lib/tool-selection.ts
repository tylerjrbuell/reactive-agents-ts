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

/**
 * One-click server toggle: select every tool of an MCP server, or clear them all
 * when they are already all selected. Tools from other servers are untouched.
 */
export function toggleServerTools(selected: readonly string[], serverTools: readonly string[]): string[] {
  const all = serverTools.length > 0 && serverTools.every((t) => selected.includes(t));
  return all ? selected.filter((t) => !serverTools.includes(t)) : [...new Set([...selected, ...serverTools])];
}
