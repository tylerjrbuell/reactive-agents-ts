/**
 * The chat quick bar's chip row (beside the composer): one chip per commonly changed
 * setting, each opening its slash picker. Pure, so ChatQuickBar and tests share it.
 */
import { agentControlEnabled } from "./proposal-view.js";
import { enabledControlGroups } from "./agent-control.js";
import { effectiveIterations, selectedTools, terminalChoice, terminalLabel, toolsOn } from "./chat-quickbar.js";
import { mcpToolAvailable } from "./tool-selection.js";
import type { McpDiscoveryState } from "./mcp-tool-discovery.js";
import { workspaceLabel } from "./workspace-api.js";
import { shellOffLabel, shellPickReason, shellState, type ShellPresets } from "./shell-from-picks.js";
import type { IconName } from "./icons.js";

/** One quick-bar chip; clicking it puts `cmd` in the composer. `on` marks a setting that is switched on (a workspace set, tools picked). */
export type QuickBarChip = { text: string; icon: IconName; cmd: string; title?: string; on?: boolean };

/** Values the panel already derives that the chips display. */
export type QuickBarChipContext = {
  provider: string;
  model: string;
  /** `false` when the selected model has no thinking mode; `null` when unknown. */
  modelThinking: boolean | null;
  thinkingChoice: "on" | "off" | "auto";
  strategyLabel: string;
  pinnedSkillCount: number;
  /** Skills the session's agent can load (its workspace skills); a chip lists them when none is pinned. */
  availableSkillCount?: number;
  documentCount: number;
  /** Shell toolsets → programs (`GET /api/tools/shell-presets`); a picked one brings `shell-execute`. */
  shellPresets?: ShellPresets;
  /** Saved MCP servers with their cached tool names (`/api/mcp-servers`), so the tools chip counts what the servers add. */
  mcpServers?: readonly { serverId: string; name: string; tools: readonly string[] }[];
  /** Tool listing state per MCP server id (`mcp-tool-discovery.ts`); absent = not attempted. */
  mcpDiscovery?: Readonly<Record<string, McpDiscoveryState>>;
};

/**
 * The tools chip: the real tool surface of the session. Selected built-in and custom tools,
 * plus what each attached MCP server contributes under the runtime rule: no `server/tool`
 * name selected = every tool of the server; some named = only those (`tool-selection.ts`).
 * A server still being listed or that failed to connect says so instead of adding nothing.
 */
export function toolsChip(cfg: Record<string, unknown>, servers: readonly { serverId: string; name: string; tools: readonly string[] }[], discovery: Readonly<Record<string, McpDiscoveryState>> = {}): QuickBarChip {
  const ids = Array.isArray(cfg.mcpServerIds) ? cfg.mcpServerIds.filter((i): i is string => typeof i === "string") : [];
  const attached = ids.map((id) => servers.find((s) => s.serverId === id) ?? { serverId: id, name: "MCP server", tools: [] as string[] });
  const mcpNames = new Set(attached.flatMap((s) => s.tools));
  const own = selectedTools(cfg).filter((t) => !mcpNames.has(t));
  const selection = { tools: selectedTools(cfg), mcpServerIds: ids };
  const lines = [...own];
  let mcpCount = 0;
  let pending = 0;
  for (const s of attached) {
    const state = discovery[s.serverId];
    const on = s.tools.filter((t) => mcpToolAvailable(selection, s, t));
    mcpCount += on.length;
    if (s.tools.length > 0) lines.push(`${s.name}: ${on.length === 1 ? "1 tool" : `${on.length} tools`} (${on.map((t) => t.replace(`${s.name}/`, "")).join(", ")})`);
    else if (state?.status === "failed") lines.push(`${s.name}: could not list tools (${state.error})`);
    else {
      pending++;
      lines.push(`${s.name}: listing tools…`);
    }
  }
  if (!toolsOn(cfg)) return { text: "Tools off", icon: "tool", cmd: "/tools ", title: "Choose tools" };
  const total = own.length + mcpCount;
  if (own.length === 0 && attached.length === 0) return { text: "No tools", icon: "tool", cmd: "/tools ", title: "Choose tools", on: false };
  const shown = own.slice(0, 2).join(", ");
  const rest = total - Math.min(own.length, 2);
  const text = [shown, rest > 0 ? (shown === "" ? `${rest} MCP` : `+${rest}`) : "", pending > 0 && rest === 0 ? "MCP…" : ""].filter(Boolean).join(" ");
  return { text, icon: "tool", cmd: "/tools ", title: `Tools: ${lines.join("; ")}`, on: true };
}

/** Shell chip, same three states as the builder checkbox: off, toolset-only (`Shell: git · gh only`), or the full shell's choice. */
function shellChip(cfg: Record<string, unknown>, presets: ShellPresets): QuickBarChip {
  const choice = terminalChoice(cfg);
  const tools = selectedTools(cfg);
  if (shellState(choice !== "off", tools, presets) !== "toolset") {
    return { text: terminalLabel[choice], icon: "shell", cmd: "/terminal ", title: "Shell: off, this machine, or Docker sandbox", on: choice !== "off" };
  }
  return {
    text: shellOffLabel(tools, presets),
    icon: "shell",
    on: true,
    cmd: "/terminal ",
    title: `shell-execute ${shellPickReason(tools, presets) ?? ""}; /terminal turns on the full shell`,
  };
}

/** Chips for a session config, in display order. No provider ⇒ only the skill / agent / doc chips. */
export function quickBarChips(cfg: Record<string, unknown>, ctx: QuickBarChipContext): QuickBarChip[] {
  const { provider, model } = ctx;
  const workspace = typeof cfg.workspace === "string" ? cfg.workspace : "";
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return [
    ...(provider
      ? [
          { text: provider, icon: "cloud", cmd: "/provider ", title: "Change provider" },
          { text: model || "default model", icon: "model", cmd: "/model ", title: "Change model" },
        ] satisfies QuickBarChip[]
      : []),
    ...(provider && model
      ? [{ text: ctx.modelThinking === false ? "No thinking mode" : `Thinking ${ctx.thinkingChoice}`, icon: "think", cmd: "/thinking " } satisfies QuickBarChip]
      : []),
    ...(provider
      ? [
          { text: ctx.strategyLabel, icon: "strategy", cmd: "/strategy ", title: "Change the reasoning strategy" },
          toolsChip(cfg, ctx.mcpServers ?? [], ctx.mcpDiscovery),
          shellChip(cfg, ctx.shellPresets ?? {}),
          {
            text: workspace ? workspaceLabel(workspace) : "No workspace",
            icon: "folder",
            cmd: "/workspace ",
            title: workspace || "Set the directory file tools and the shell work in",
            on: workspace !== "",
          },
          { text: `${effectiveIterations(cfg)} steps`, icon: "steps", cmd: "/iterations ", title: "Most steps one turn may take" },
        ] satisfies QuickBarChip[]
      : []),
    ...(ctx.pinnedSkillCount > 0
      ? [{ text: `${plural(ctx.pinnedSkillCount, "skill")} pinned`, icon: "bolt", cmd: "/skills ", on: true } satisfies QuickBarChip]
      : (ctx.availableSkillCount ?? 0) > 0
        ? [{ text: plural(ctx.availableSkillCount ?? 0, "skill"), icon: "bolt", cmd: "/skill ", title: "Workspace skills the agent can load; pick one to use it for your next message" } satisfies QuickBarChip]
        : []),
    ...(agentControlEnabled(cfg)
      ? [{ text: enabledControlGroups(cfg).length > 0 ? `Agent control +${enabledControlGroups(cfg).length}` : "Agent control", icon: "agents", cmd: "/agent ", title: "The agent may propose changes to this chat; nothing applies until you click Apply", on: true } satisfies QuickBarChip]
      : []),
    ...(ctx.documentCount > 0 ? [{ text: plural(ctx.documentCount, "document"), icon: "book", cmd: "/docs ", on: true } satisfies QuickBarChip] : []),
  ];
}
