/**
 * Pure rules behind the chat quick bar (strategy / terminal / workspace /
 * iterations / tools chips and their slash pickers). Every function takes the
 * session's stored agent config and returns a display value or a
 * `PATCH /api/chat/sessions/:id/config` body, so the panel and tests share them.
 */
import { toggleServerTools } from "./tool-selection.js";

type Cfg = Record<string, unknown>;

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Iteration cap a tool-using chat turn runs with when the session sets none (server `CHAT_DEFAULT_MAX_ITERATIONS`). */
export const CHAT_DEFAULT_MAX_ITERATIONS = 16;
export const ITERATION_PRESETS = [4, 8, 16, 32, 64] as const;

/** Same rule as the server's `resolveEnableTools`: an explicit choice wins, else tools are on when anything is selected. */
export function toolsOn(cfg: Cfg): boolean {
  if (cfg.agentControl === true) return true;
  if (typeof cfg.enableTools === "boolean") return cfg.enableTools;
  return (
    strings(cfg.tools).length > 0 ||
    strings(cfg.mcpServerIds).length > 0 ||
    (Array.isArray(cfg.agentTools) && cfg.agentTools.length > 0) ||
    obj(cfg.dynamicSubAgents).enabled === true ||
    cfg.terminalTools === true ||
    (typeof cfg.additionalToolNames === "string" && cfg.additionalToolNames.trim() !== "")
  );
}

/** Every tool name the agent is offered (selection + host shell), deduped. */
export function selectedTools(cfg: Cfg): string[] {
  const names = new Set(strings(cfg.tools));
  if (cfg.terminalTools === true) names.add("shell-execute");
  return [...names];
}

/** Chip text for the current toolset: always visible, never empty. */
export function toolsetSummary(cfg: Cfg): string {
  if (!toolsOn(cfg)) return "Tools off";
  const names = selectedTools(cfg);
  const mcp = strings(cfg.mcpServerIds).length;
  if (names.length === 0 && mcp === 0) return "No tools";
  const shown = names.slice(0, 2).join(", ");
  const rest = names.length - 2;
  return [shown, rest > 0 ? `+${rest}` : "", mcp > 0 && names.length === 0 ? `${mcp} MCP` : ""].filter(Boolean).join(" ");
}

/** Toggle a whole toolset (alias members or an MCP server's tools): add all, or remove all when already all selected. */
export function toggleToolsetPatch(cfg: Cfg, members: readonly string[]): { tools: string[]; enableTools: true } {
  return { tools: toggleServerTools(strings(cfg.tools), members), enableTools: true };
}

/** Toggle one tool. */
export function toggleToolPatch(cfg: Cfg, name: string): { tools: string[]; enableTools: true } {
  const tools = strings(cfg.tools);
  return { tools: tools.includes(name) ? tools.filter((t) => t !== name) : [...tools, name], enableTools: true };
}

/** Toggle an MCP server: its id in `mcpServerIds` and its tools in `tools` move together (allowedTools filters MCP tools too). */
export function toggleMcpServerPatch(cfg: Cfg, serverId: string, serverTools: readonly string[]): { tools: string[]; mcpServerIds: string[]; enableTools: true } {
  const ids = strings(cfg.mcpServerIds);
  const on = ids.includes(serverId);
  const tools = strings(cfg.tools);
  return {
    tools: on ? tools.filter((t) => !serverTools.includes(t)) : [...new Set([...tools, ...serverTools])],
    mcpServerIds: on ? ids.filter((i) => i !== serverId) : [...ids, serverId],
    enableTools: true,
  };
}

/** Copy a saved agent's toolset (tools, MCP servers, host shell) onto the chat. */
export function presetPatch(agentConfig: Cfg): { tools: string[]; mcpServerIds: string[]; terminalTools: boolean; enableTools: true } {
  return {
    tools: strings(agentConfig.tools),
    mcpServerIds: strings(agentConfig.mcpServerIds),
    terminalTools: agentConfig.terminalTools === true,
    enableTools: true,
  };
}

export type TerminalChoice = "off" | "host" | "docker";

export function terminalChoice(cfg: Cfg): TerminalChoice {
  if (cfg.terminalTools !== true) return "off";
  return obj(cfg.terminalShellOptions).sandbox === "docker" ? "docker" : "host";
}

/** Turning the shell on also turns tools on; the other shell options are kept. */
export function terminalPatch(cfg: Cfg, choice: TerminalChoice): Record<string, unknown> {
  const opts = { ...obj(cfg.terminalShellOptions) };
  if (choice === "off") return { terminalTools: false };
  if (choice === "docker") opts.sandbox = "docker";
  else delete opts.sandbox;
  return { terminalTools: true, enableTools: true, terminalShellOptions: opts };
}

export const terminalLabel: Readonly<Record<TerminalChoice, string>> = {
  off: "Shell off",
  host: "Shell on this machine",
  docker: "Shell in Docker sandbox",
};

/** `/iterations 12` → 12; anything but a whole number from 1 to 200 → undefined. */
export function parseIterations(arg: string): number | undefined {
  const n = Number(arg.trim());
  return Number.isInteger(n) && n >= 1 && n <= 200 ? n : undefined;
}

/** The cap the next tool-using turn runs with. */
export function effectiveIterations(cfg: Cfg): number {
  return typeof cfg.maxIterations === "number" && cfg.maxIterations > 0 ? cfg.maxIterations : CHAT_DEFAULT_MAX_ITERATIONS;
}
