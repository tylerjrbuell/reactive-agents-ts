/**
 * On-demand MCP tool listing for the chat tools chip. The server answers `GET /api/mcp-servers`
 * with each saved server's CACHED tools, empty until `POST /api/mcp-servers/:id/refresh-tools`
 * has connected once. This asks the server to connect (bounded by a client timeout) and reports
 * the tool names or why it failed, so the chip can show loading / failed instead of a server
 * that contributes nothing.
 */
import { CORTEX_SERVER_URL } from "./constants.js";
import type { QuickbarCatalog } from "./chat-quickbar-data.js";

/** Per-server discovery state the chip shows; absent means not attempted. */
export type McpDiscoveryState = { readonly status: "loading" } | { readonly status: "failed"; readonly error: string };

/** Result of one discovery attempt. */
export type McpDiscoveryResult = { readonly ok: true; readonly tools: readonly string[] } | { readonly ok: false; readonly error: string };

/** How long the UI waits for a server to connect and list tools before showing it as failed. */
export const MCP_DISCOVERY_TIMEOUT_MS = 45_000;

/** Ask the Cortex server to connect to the saved server and list its tools. Never throws. */
export async function discoverMcpServerTools(serverId: string, fetchFn: typeof fetch = fetch, timeoutMs: number = MCP_DISCOVERY_TIMEOUT_MS): Promise<McpDiscoveryResult> {
  try {
    const res = await fetchFn(`${CORTEX_SERVER_URL}/api/mcp-servers/${encodeURIComponent(serverId)}/refresh-tools`, { method: "POST", signal: AbortSignal.timeout(timeoutMs) });
    const body = (await res.json().catch(() => ({}))) as { tools?: { toolName?: string }[]; error?: string };
    if (!res.ok) return { ok: false, error: body.error ?? `Tool discovery failed (${res.status})` };
    return { ok: true, tools: (body.tools ?? []).map((t) => t.toolName).filter((n): n is string => typeof n === "string") };
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, error: timedOut ? `no answer after ${Math.round(timeoutMs / 1000)}s` : e instanceof Error ? e.message : String(e) };
  }
}

/** What `runMcpDiscovery` reads and writes on the page. */
export interface McpDiscoveryDeps {
  readonly state: () => Readonly<Record<string, McpDiscoveryState>>;
  readonly setState: (next: Record<string, McpDiscoveryState>) => void;
  /** Reload the catalog so the new tool names show up (the per-server cache). */
  readonly reload: () => Promise<void>;
  readonly discover?: typeof discoverMcpServerTools;
}

/** List one server's tools unless a listing is already running. Success clears the state; failure keeps the reason. */
export async function runMcpDiscovery(serverId: string, deps: McpDiscoveryDeps): Promise<void> {
  if (deps.state()[serverId]?.status === "loading") return;
  deps.setState({ ...deps.state(), [serverId]: { status: "loading" } });
  const result = await (deps.discover ?? discoverMcpServerTools)(serverId);
  if (result.ok) await deps.reload().catch(() => {});
  const { [serverId]: _done, ...rest } = deps.state();
  deps.setState(result.ok ? rest : { ...rest, [serverId]: { status: "failed", error: result.error } });
}

/** Attached servers with no cached tools and no attempt yet: the ones to list automatically. */
export function serversToDiscover(
  attachedIds: readonly string[],
  servers: readonly { readonly serverId: string; readonly tools: readonly string[] }[],
  state: Readonly<Record<string, McpDiscoveryState>>,
): string[] {
  return servers.filter((s) => attachedIds.includes(s.serverId) && s.tools.length === 0 && state[s.serverId] === undefined).map((s) => s.serverId);
}

const autoTried = new Set<string>();

/**
 * Chat panel hook: list the tools of every attached server that has none cached, once per
 * server per page load (a server that truly has no tools must not be retried in a loop; a
 * failed one is retried by reloading). The state rides on the catalog (`mcpDiscovery`) so the
 * Tools chip reads it with the server list; success reloads the catalog for the new names.
 */
export function autoDiscoverMcp(
  attachedIds: unknown,
  catalog: QuickbarCatalog,
  setCatalog: (next: QuickbarCatalog) => void,
  reload: () => Promise<QuickbarCatalog>,
): void {
  const ids = Array.isArray(attachedIds) ? attachedIds.filter((i): i is string => typeof i === "string") : [];
  let latest = catalog;
  for (const id of serversToDiscover(ids, catalog.mcpServers, catalog.mcpDiscovery ?? {})) {
    if (autoTried.has(id)) continue;
    autoTried.add(id);
    void runMcpDiscovery(id, {
      state: () => latest.mcpDiscovery ?? {},
      setState: (n) => setCatalog((latest = { ...latest, mcpDiscovery: n })),
      reload: async () => setCatalog((latest = { ...(await reload()), mcpDiscovery: latest.mcpDiscovery })),
    });
  }
}
