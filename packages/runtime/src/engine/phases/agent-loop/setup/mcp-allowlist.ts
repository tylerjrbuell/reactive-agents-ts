/**
 * Attached-MCP-server visibility under an `allowedTools` allowlist.
 *
 * `allowedTools` is a hard restriction, which used to hide every tool of an
 * attached MCP server unless each `server/tool` name was listed by hand (23
 * Umami tools invisible). Attaching a server is itself the operator's intent to
 * use it, so its tools join the allowlist by default. Two things still narrow:
 *
 *  - an allowlist entry naming a tool of that server (`umami/get-stats`) makes
 *    the entry list authoritative for that server (explicit subset wins);
 *  - `forbiddenTools` (applied later, last) still hides a tool outright.
 *
 * With no allowlist nothing is restricted, so this is a no-op.
 */
import type { ToolDefinition } from "@reactive-agents/tools";

/** Server prefix of a registered MCP tool name (`umami/get-stats` -> `umami`). */
const serverOf = (toolName: string): string | undefined => {
  const i = toolName.indexOf("/");
  return i > 0 ? toolName.slice(0, i) : undefined;
};

/**
 * Extend `allowedTools` with the tools of attached MCP servers.
 *
 * @param allowedTools resolved allowlist (empty = unrestricted, returned as-is)
 * @param toolDefs registered tool definitions for the run
 * @param forbiddenTools names that must stay hidden
 */
export const withAttachedMcpTools = (
  allowedTools: readonly string[],
  toolDefs: readonly ToolDefinition[],
  forbiddenTools: readonly string[] | undefined,
): readonly string[] => {
  if (allowedTools.length === 0) return allowedTools;
  const restrictedServers = new Set<string>();
  for (const name of allowedTools) {
    const server = serverOf(name);
    if (server !== undefined) restrictedServers.add(server);
  }
  const forbidden = new Set(forbiddenTools ?? []);
  const have = new Set(allowedTools);
  const added: string[] = [];
  for (const def of toolDefs) {
    if (def.source !== "mcp" || have.has(def.name) || forbidden.has(def.name)) continue;
    const server = serverOf(def.name);
    if (server !== undefined && restrictedServers.has(server)) continue;
    added.push(def.name);
  }
  return added.length === 0 ? allowedTools : [...allowedTools, ...added];
};
