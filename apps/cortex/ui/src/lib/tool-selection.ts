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

/** An MCP server and the full names of its tools (`server/tool`), as the pickers see it. */
export type McpServerTools = { serverId: string; tools: readonly string[] };

/** Slice of the config the MCP selection rules read and write. */
export type McpSelectionCfg = { tools: readonly string[]; mcpServerIds: readonly string[] };

/**
 * How an MCP server is selected:
 *  - `off`: not attached;
 *  - `all`: attached with no tool of it named, so the framework makes every tool of it visible;
 *  - `subset`: attached with some of its tools named, so only those are visible.
 */
export type McpServerMode = "off" | "all" | "subset";

/** The selection mode of `server` in `cfg`. */
export function mcpServerMode(cfg: McpSelectionCfg, server: McpServerTools): McpServerMode {
  if (!cfg.mcpServerIds.includes(server.serverId)) return "off";
  return server.tools.some((t) => cfg.tools.includes(t)) ? "subset" : "all";
}

/** Whether one tool of `server` is available to the agent under `cfg`. */
export function mcpToolAvailable(cfg: McpSelectionCfg, server: McpServerTools, tool: string): boolean {
  const mode = mcpServerMode(cfg, server);
  return mode === "all" || (mode === "subset" && cfg.tools.includes(tool));
}

/** Count of `server`'s tools available under `cfg`. */
export function mcpAvailableCount(cfg: McpSelectionCfg, server: McpServerTools): number {
  return server.tools.filter((t) => mcpToolAvailable(cfg, server, t)).length;
}

const without = (list: readonly string[], drop: readonly string[]): string[] => list.filter((x) => !drop.includes(x));

/** Attach the server (every tool available, none named), or detach it with all its tool names. Other servers stay as they are. */
export function toggleMcpServerAttached(cfg: McpSelectionCfg, server: McpServerTools): { tools: string[]; mcpServerIds: string[] } {
  const attached = cfg.mcpServerIds.includes(server.serverId);
  return {
    tools: without(cfg.tools, server.tools),
    mcpServerIds: attached ? without(cfg.mcpServerIds, [server.serverId]) : [...cfg.mcpServerIds, server.serverId],
  };
}

/**
 * Exclude or restore one tool of a server. The framework only knows "server attached" (all
 * tools) or "these tool names" (just those), so an exclusion is written as the remaining names:
 * `all` -> every tool but this one; `subset` -> toggle the name. A subset that becomes complete
 * collapses back to `all`; one that becomes empty detaches the server (an empty subset would
 * mean "every tool"). An unattached server attaches with just this tool.
 */
export function toggleMcpTool(cfg: McpSelectionCfg, server: McpServerTools, tool: string): { tools: string[]; mcpServerIds: string[] } {
  const mode = mcpServerMode(cfg, server);
  const others = without(cfg.tools, server.tools);
  const attach = cfg.mcpServerIds.includes(server.serverId) ? [...cfg.mcpServerIds] : [...cfg.mcpServerIds, server.serverId];
  const named = mode === "all" ? [...server.tools] : mode === "subset" ? server.tools.filter((t) => cfg.tools.includes(t)) : [];
  const next = named.includes(tool) ? without(named, [tool]) : [...named, tool];
  if (next.length === 0) return { tools: others, mcpServerIds: without(cfg.mcpServerIds, [server.serverId]) };
  const complete = server.tools.length > 0 && server.tools.every((t) => next.includes(t));
  return { tools: complete ? others : [...others, ...next], mcpServerIds: attach };
}
