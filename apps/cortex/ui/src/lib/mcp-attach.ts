/**
 * The shared "attach MCP servers" surface (`McpServerAttach.svelte`, used by the Builder's Tools
 * section and the chat panel's Tools section): one row per saved server with how it is attached,
 * and the effects strip (what the current selection lets an agent read, ask about or run).
 *
 * The attach rule is `tool-selection.ts` only: attached = every tool, naming tools = just those.
 * Nothing here adds a config field or path.
 */
import { autoGatedTools, hasFullShell, type ApprovalPolicyConfig } from "./approval-policy.js";
import { mcpAvailableCount, mcpServerMode, mcpToolAvailable, type McpSelectionCfg, type McpServerMode } from "./tool-selection.js";
import { isReadOnlyTool, bareToolName } from "./mcp-servers-view.js";

/** A saved server as the attach list reads it (`GET /api/mcp-servers`; the state fields are absent on an older server build). */
export interface AttachServer {
  readonly serverId: string;
  readonly name: string;
  readonly tools: readonly { readonly toolName: string; readonly description?: string }[];
  readonly config?: Record<string, unknown>;
  readonly enabled?: boolean;
}

/** One row of the attach list. */
export interface AttachRow {
  readonly serverId: string;
  readonly name: string;
  readonly mode: McpServerMode;
  readonly available: number;
  readonly total: number;
  /** Switched off in Lab > Tools > Servers: an agent never starts it. */
  readonly disabled: boolean;
  /** Whether a click on the name does anything: detaching always works; attaching needs an enabled server with tools. */
  readonly canToggle: boolean;
  /** Tooltip for the name button. */
  readonly nameTip: string;
  /** The line under the name, or empty. */
  readonly note: string;
}

/** The row for `srv` under `cfg`. */
export function attachRow(cfg: McpSelectionCfg, srv: AttachServer): AttachRow {
  const names = srv.tools.map((t) => t.toolName);
  const server = { serverId: srv.serverId, tools: names };
  const mode = mcpServerMode(cfg, server);
  const disabled = srv.enabled === false;
  const canToggle = mode !== "off" || (!disabled && names.length > 0);
  const nameTip =
    mode !== "off"
      ? "Stop using this server"
      : disabled
        ? "Switched off. Enable it in Lab > Tools > Servers"
        : names.length === 0
          ? "No tools listed yet. Refresh it in Lab > Tools > Servers"
          : "Use this server: all its tools become available";
  const note =
    disabled && mode !== "off"
      ? "Switched off in Lab, so an agent skips it. Detach it or enable it there."
      : disabled
        ? "Switched off in Lab > Tools > Servers."
        : names.length === 0
          ? "No tools listed. Refresh the server in Lab > Tools > Servers."
          : mode === "all"
            ? "Every tool is available. Click a tool to leave it out."
            : mode === "subset"
              ? "Only the highlighted tools are available. Click a tool to add or remove it."
              : "";
  return { serverId: srv.serverId, name: srv.name, mode, available: mcpAvailableCount(cfg, server), total: names.length, disabled, canToggle, nameTip, note };
}

/** What the effects strip lists. */
export interface Effects {
  /** `server/tool` names an agent can call that the server's read-only option covers. */
  readonly readOnly: readonly string[];
  /** Selected tools the framework asks about before running. */
  readonly approval: readonly string[];
  /** The shell: off, on the host, or in a Docker container. */
  readonly shell: "off" | "host" | "docker";
}

/** The slice of the agent config the strip reads. */
export interface EffectsCfg extends McpSelectionCfg {
  readonly terminalTools: boolean;
  readonly askBeforeRiskyTools?: boolean;
  readonly approvalPolicy?: Pick<ApprovalPolicyConfig, "tools" | "commands">;
  readonly terminalShellOptions?: { readonly sandbox?: "host" | "docker" };
}

/** Effects of the current selection. `approvalRequired` is `GET /api/tools/approval-required`. */
export function effectsOf(cfg: EffectsCfg, servers: readonly AttachServer[], approvalRequired: readonly string[]): Effects {
  const readOnly: string[] = [];
  for (const srv of servers) {
    if (srv.enabled === false) continue;
    const server = { serverId: srv.serverId, tools: srv.tools.map((t) => t.toolName) };
    for (const t of srv.tools) {
      if (mcpToolAvailable(cfg, server, t.toolName) && isReadOnlyTool(srv.config ?? {}, srv.name, t.toolName)) readOnly.push(`${srv.name}/${bareToolName(srv.name, t.toolName)}`);
    }
  }
  const fullShell = hasFullShell(cfg.tools, cfg.terminalTools);
  const policy = cfg.approvalPolicy ?? { tools: [], commands: [] };
  const approval = autoGatedTools(policy, cfg.tools, fullShell, approvalRequired, cfg.askBeforeRiskyTools !== false);
  const shell = fullShell ? (cfg.terminalShellOptions?.sandbox === "docker" ? "docker" : "host") : "off";
  return { readOnly, approval, shell };
}

/** Short words for the strip's three entries. */
export function effectsLines(e: Effects): { readonly id: "read-only" | "approval" | "shell"; readonly label: string; readonly detail: string; readonly names: readonly string[] }[] {
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  return [
    {
      id: "read-only",
      label: e.readOnly.length === 0 ? "No read-only MCP tools" : `${plural(e.readOnly.length, "read-only MCP tool")}`,
      detail: "Stay available when a chat or channel is limited to read-only.",
      names: e.readOnly,
    },
    {
      id: "approval",
      label: e.approval.length === 0 ? "Nothing asks first" : `${plural(e.approval.length, "tool")} ask first`,
      detail: "The framework asks you before these run.",
      names: e.approval,
    },
    {
      id: "shell",
      label: e.shell === "off" ? "Shell off" : e.shell === "docker" ? "Shell in Docker" : "Shell on this machine",
      detail: e.shell === "off" ? "The agent cannot run commands." : e.shell === "docker" ? "Commands run in a throwaway container." : "Commands run on the host. Not isolated.",
      names: e.shell === "off" ? [] : ["shell-execute"],
    },
  ];
}
