/**
 * What the chat quick-bar pickers offer, loaded once per chat panel from the
 * server: strategies (capability manifest), built-in toolsets and tools, MCP
 * servers, saved agents (as toolset presets) and suggested workspaces. Every
 * source fails soft to an empty list so one bad endpoint never blanks the bar.
 */
import { CORTEX_SERVER_URL } from "./constants.js";
import type { McpDiscoveryState } from "./mcp-tool-discovery.js";
import { loadCapabilities } from "./capabilities.js";
import { availableMcpServers, disabledMcpServers } from "./mcp-servers-view.js";
import { workspaceCandidates, type WorkspaceCandidate } from "./workspace-api.js";

export interface QuickbarCatalog {
  readonly strategies: readonly { value: string; label: string; description: string }[];
  /** Built-in toolset shortcuts → member tool names (framework `BUILTIN_TOOLSET_ALIASES`). */
  readonly toolsets: Readonly<Record<string, readonly string[]>>;
  /** Shell toolsets → programs their scoped `shell-execute` runs (framework `BUILTIN_SHELL_PRESETS`). */
  readonly shellPresets: Readonly<Record<string, readonly string[]>>;
  readonly builtinTools: readonly { name: string; label: string }[];
  /** Enabled saved servers only: what an agent can use (`availableMcpServers`). */
  readonly mcpServers: readonly { serverId: string; name: string; tools: readonly string[] }[];
  /** Switched-off saved servers: never offered, kept so a config that still lists one can say so and name its tools as unavailable. */
  readonly disabledMcpServers?: readonly { serverId: string; name: string; tools: readonly string[] }[];
  /** Tool listing state per MCP server id while Cortex connects to list its tools (`mcp-tool-discovery.ts`). */
  readonly mcpDiscovery?: Readonly<Record<string, McpDiscoveryState>>;
  readonly presets: readonly { name: string; config: Record<string, unknown> }[];
  /** Ranked workspace suggestions (launch project first, then recent). */
  readonly workspaces: readonly WorkspaceCandidate[];
  /** Tools the framework gates by itself once any approval is set (`GET /api/tools/approval-required`). */
  readonly approvalRequired: readonly string[];
}

export const EMPTY_CATALOG: QuickbarCatalog = { strategies: [], toolsets: {}, shellPresets: {}, builtinTools: [], mcpServers: [], presets: [], workspaces: [], approvalRequired: [] };

async function getJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${CORTEX_SERVER_URL}${path}`);
    return res.ok ? ((await res.json()) as T) : fallback;
  } catch {
    return fallback;
  }
}

const quickbarServer = (s: { serverId: string; name: string; tools?: { toolName: string }[] }) => ({
  serverId: s.serverId,
  name: s.name,
  tools: (s.tools ?? []).map((t) => t.toolName),
});

export async function loadQuickbarCatalog(): Promise<QuickbarCatalog> {
  const [manifest, toolsets, shellPresets, catalog, mcp, agents, workspaces, approvalRequired] = await Promise.all([
    loadCapabilities().catch(() => null),
    getJson<Record<string, string[]>>("/api/tools/toolsets", {}),
    getJson<Record<string, string[]>>("/api/tools/shell-presets", {}),
    getJson<{ kind: string; name: string; displayName?: string; disabled?: boolean }[]>("/api/tools/catalog", []),
    getJson<{ serverId: string; name: string; enabled?: boolean; tools?: { toolName: string }[] }[]>("/api/mcp-servers", []),
    getJson<{ name: string; config?: Record<string, unknown> }[]>("/api/agents", []),
    workspaceCandidates().then((r) => r.candidates),
    getJson<{ tools: string[] }>("/api/tools/approval-required", { tools: [] }).then((r) => r.tools),
  ]);
  return {
    strategies: manifest?.strategies.map((s) => ({ value: s.name, label: s.label, description: s.description })) ?? [],
    toolsets,
    shellPresets,
    builtinTools: catalog
      .filter((t) => t.kind === "built-in" && !t.disabled)
      .map((t) => ({ name: t.name, label: t.displayName || t.name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    mcpServers: availableMcpServers(mcp).map(quickbarServer),
    disabledMcpServers: disabledMcpServers(mcp).map(quickbarServer),
    presets: agents
      .filter((a) => a.config && (Array.isArray(a.config.tools) || Array.isArray(a.config.mcpServerIds)))
      .map((a) => ({ name: a.name, config: a.config! })),
    workspaces,
    approvalRequired,
  };
}
