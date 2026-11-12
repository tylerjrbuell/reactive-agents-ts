/**
 * Quick add of an MCP server from one line: `/mcp add <command or URL>` in the chat
 * composer and the one-line input in Lab Tools. The line becomes a body for
 * `POST /api/mcp-servers` (the server infers `stdio` / `sse` / `streamable-http` from
 * the command or endpoint, `mcp-config-import.ts`). Pure parsing plus one small client.
 */
import { CORTEX_SERVER_URL } from "./constants.js";
import { toggleMcpServerPatch } from "./chat-quickbar.js";

/** Body for `POST /api/mcp-servers`. */
export type McpQuickBody =
  | { readonly name: string; readonly endpoint: string; readonly transport?: "websocket" }
  | { readonly name: string; readonly command: string; readonly args?: readonly string[] };

/** Result of reading the line. */
export type McpQuickParse = { readonly ok: true; readonly body: McpQuickBody } | { readonly ok: false; readonly error: string };

const URL_START = /^(https?|wss?):\/\//i;

/** Split on spaces, keeping "double" and 'single' quoted runs whole. */
function words(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  return out;
}

/** A readable server name from an endpoint host: `mcp.context7.com` → `context7`. */
function nameFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^(www|mcp|api)\./i, "");
    const labels = host.split(".").filter(Boolean);
    return (labels.length > 1 ? labels[0] : host) || "mcp-server";
  } catch {
    return "mcp-server";
  }
}

/** A readable server name from a command line: the package or script it launches. */
function nameFromCommand(command: string, args: readonly string[]): string {
  const target = args.find((a) => !a.startsWith("-") && a !== "run" && a !== "exec") ?? command;
  const base = target.replace(/@[\d.]+[\w.-]*$/, "").split(/[\\/]/).filter(Boolean).pop() ?? command;
  return base.replace(/^(mcp-)?server-/, "").replace(/\.(m?js|ts|py)$/, "") || command;
}

/**
 * Read `[name] <URL>` or `<command> [args…]`. A leading word is a name only when a URL
 * follows it (`context7 https://mcp.context7.com/mcp`), so `npx -y pkg` stays a command.
 */
export function parseMcpQuickAdd(line: string): McpQuickParse {
  const parts = words(line.trim());
  if (parts.length === 0) return { ok: false, error: "Give a command (npx -y @scope/server) or a URL (https://host/mcp)" };
  const first = parts[0] ?? "";
  const second = parts[1] ?? "";
  const named = !URL_START.test(first) && URL_START.test(second);
  const target = named ? second : first;
  if (URL_START.test(target)) {
    if (parts.length > (named ? 2 : 1)) return { ok: false, error: "A URL takes no extra words; use Lab Tools for headers" };
    const name = named ? first : nameFromUrl(target);
    return { ok: true, body: { name, endpoint: target, ...(/^wss?:/i.test(target) ? { transport: "websocket" as const } : {}) } };
  }
  const args = parts.slice(1);
  return { ok: true, body: { name: nameFromCommand(first, args), command: first, ...(args.length > 0 ? { args } : {}) } };
}

/** A saved server as `POST /api/mcp-servers` + tool discovery reports it. */
export interface AddedMcpServer {
  readonly serverId: string;
  readonly name: string;
  readonly tools: readonly string[];
  /** Why discovery failed; the server is saved anyway and can be refreshed in Lab Tools. */
  readonly discoveryError?: string;
}

/** Save the server, then discover its tools (a failed discovery keeps the save). */
export async function addMcpServer(body: McpQuickBody, fetchFn: typeof fetch = fetch): Promise<AddedMcpServer> {
  const created = await fetchFn(`${CORTEX_SERVER_URL}/api/mcp-servers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const made = (await created.json().catch(() => ({}))) as { serverId?: string; name?: string; error?: string };
  if (!created.ok || typeof made.serverId !== "string") throw new Error(made.error ?? `Could not save the server (${created.status})`);
  const found = await fetchFn(`${CORTEX_SERVER_URL}/api/mcp-servers/${made.serverId}/refresh-tools`, { method: "POST" });
  const res = (await found.json().catch(() => ({}))) as { tools?: { toolName?: string; name?: string }[]; error?: string };
  if (!found.ok) return { serverId: made.serverId, name: body.name, tools: [], discoveryError: res.error ?? `Tool discovery failed (${found.status})` };
  const tools = (res.tools ?? []).map((t) => t.toolName ?? t.name).filter((n): n is string => typeof n === "string");
  return { serverId: made.serverId, name: body.name, tools };
}

/** What `quickAddMcpToChat` needs from the page: the session's config and the actions it ends with. */
export interface McpChatDeps {
  readonly cfg: () => Record<string, unknown>;
  /** PATCH the session config (applies next turn). */
  readonly patch: (what: string, patch: Record<string, unknown>) => Promise<void>;
  readonly reloadCatalog: () => Promise<void>;
  readonly notify: (kind: "info" | "warning" | "error", title: string, detail?: string) => void;
  readonly add?: typeof addMcpServer;
}

/**
 * `/mcp add <line>`: parse, save, discover and turn the server on for this chat. A server
 * whose discovery failed stays saved but is not turned on (it would offer no tools); the
 * reason is shown and Lab Tools can refresh it.
 */
export async function quickAddMcpToChat(line: string, deps: McpChatDeps): Promise<void> {
  const parsed = parseMcpQuickAdd(line);
  if (!parsed.ok) return deps.notify("error", "Cannot add this server", parsed.error);
  try {
    const added = await (deps.add ?? addMcpServer)(parsed.body);
    await deps.reloadCatalog();
    if (added.discoveryError !== undefined) {
      return deps.notify("warning", `${added.name} saved, but its tools could not be listed`, `${added.discoveryError}. Refresh it in Lab Tools, then turn it on with /mcp.`);
    }
    await deps.patch(`${added.name} on (${added.tools.length} tool${added.tools.length === 1 ? "" : "s"})`, toggleMcpServerPatch(deps.cfg(), added.serverId, added.tools));
  } catch (e) {
    deps.notify("error", "Could not add the server", e instanceof Error ? e.message : String(e));
  }
}
