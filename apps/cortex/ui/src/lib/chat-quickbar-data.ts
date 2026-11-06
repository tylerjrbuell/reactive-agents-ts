/**
 * What the chat quick-bar pickers offer, loaded once per chat panel from the
 * server: strategies (capability manifest), built-in toolsets and tools, MCP
 * servers, saved agents (as toolset presets) and recent workspaces. Every
 * source fails soft to an empty list so one bad endpoint never blanks the bar.
 */
import { CORTEX_SERVER_URL } from "./constants.js";
import { loadCapabilities } from "./capabilities.js";
import { recentWorkspaces } from "./workspace-api.js";

export interface QuickbarCatalog {
  readonly strategies: readonly { value: string; label: string; description: string }[];
  /** Built-in toolset shortcuts → member tool names (framework `BUILTIN_TOOLSET_ALIASES`). */
  readonly toolsets: Readonly<Record<string, readonly string[]>>;
  readonly builtinTools: readonly { name: string; label: string }[];
  readonly mcpServers: readonly { serverId: string; name: string; tools: readonly string[] }[];
  readonly presets: readonly { name: string; config: Record<string, unknown> }[];
  readonly workspaces: readonly string[];
}

export const EMPTY_CATALOG: QuickbarCatalog = { strategies: [], toolsets: {}, builtinTools: [], mcpServers: [], presets: [], workspaces: [] };

async function getJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${CORTEX_SERVER_URL}${path}`);
    return res.ok ? ((await res.json()) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function loadQuickbarCatalog(): Promise<QuickbarCatalog> {
  const [manifest, toolsets, catalog, mcp, agents, workspaces] = await Promise.all([
    loadCapabilities().catch(() => null),
    getJson<Record<string, string[]>>("/api/tools/toolsets", {}),
    getJson<{ kind: string; name: string; displayName?: string; disabled?: boolean }[]>("/api/tools/catalog", []),
    getJson<{ serverId: string; name: string; tools?: { toolName: string }[] }[]>("/api/mcp-servers", []),
    getJson<{ name: string; config?: Record<string, unknown> }[]>("/api/agents", []),
    recentWorkspaces(),
  ]);
  return {
    strategies: manifest?.strategies.map((s) => ({ value: s.name, label: s.label, description: s.description })) ?? [],
    toolsets,
    builtinTools: catalog
      .filter((t) => t.kind === "built-in" && !t.disabled)
      .map((t) => ({ name: t.name, label: t.displayName || t.name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    mcpServers: mcp.map((s) => ({ serverId: s.serverId, name: s.name, tools: (s.tools ?? []).map((t) => t.toolName) })),
    presets: agents
      .filter((a) => a.config && (Array.isArray(a.config.tools) || Array.isArray(a.config.mcpServerIds)))
      .map((a) => ({ name: a.name, config: a.config! })),
    workspaces,
  };
}
