import type { Database } from "bun:sqlite";
import type { MCPServerConfig } from "@reactive-agents/runtime";
import { normalizeMcpHttpTransport } from "../services/mcp-config-import.js";

export type McpServerRow = {
  server_id: string;
  name: string;
  config_json: string;
  created_at: number;
  updated_at: number;
  /** 1 = agents may start this server; 0 = switched off in the Tools Lab. */
  enabled: number;
  /** Result of the last probe or tool refresh: `ok`, `error`, or null when never checked. */
  last_status: string | null;
  last_error: string | null;
  last_checked_at: number | null;
};

export type McpCachedToolRow = {
  server_id: string;
  tool_name: string;
  description: string | null;
  /** JSON Schema of the tool's input as the server reported it (JSON text), or null. */
  input_schema_json: string | null;
};

const SERVER_COLS = `server_id, name, config_json, created_at, updated_at, enabled, last_status, last_error, last_checked_at`;
const TOOL_COLS = `server_id, tool_name, description, input_schema_json`;

export function listMcpServers(db: Database): McpServerRow[] {
  return db.prepare(`SELECT ${SERVER_COLS} FROM cortex_mcp_servers ORDER BY name ASC`).all() as McpServerRow[];
}

export function getMcpServer(db: Database, serverId: string): McpServerRow | null {
  const row = db
    .prepare(`SELECT ${SERVER_COLS} FROM cortex_mcp_servers WHERE server_id = ?`)
    .get(serverId) as McpServerRow | undefined;
  return row ?? null;
}

export function getMcpServersByIds(db: Database, ids: readonly string[]): McpServerRow[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  return db
    .prepare(`SELECT ${SERVER_COLS} FROM cortex_mcp_servers WHERE server_id IN (${placeholders})`)
    .all(...ids) as McpServerRow[];
}

export function parseMcpConfig(row: McpServerRow): MCPServerConfig {
  const raw = JSON.parse(row.config_json) as MCPServerConfig;
  return normalizeMcpHttpTransport(raw);
}

/**
 * The configs an agent may start for these saved-server ids: disabled servers are left out.
 * The one resolver every build path (desk run, chat, gateway, channel hub) goes through, so a
 * server switched off in the Tools Lab can never be started by an agent that still lists it.
 */
export function getEnabledMcpConfigsByIds(db: Database, ids: readonly string[]): MCPServerConfig[] {
  return getMcpServersByIds(db, ids)
    .filter((row) => row.enabled !== 0)
    .map(parseMcpConfig);
}

export function insertMcpServer(db: Database, serverId: string, config: MCPServerConfig): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO cortex_mcp_servers (server_id, name, config_json, created_at, updated_at) VALUES (?,?,?,?,?)`,
  ).run(serverId, config.name, JSON.stringify(config), now, now);
}

/**
 * Insert a new MCP server or update its config if a server with the same name already exists.
 * The existing `server_id` is preserved on conflict so agent configs referencing it stay valid.
 * Returns the server_id that was inserted or kept.
 */
export function upsertMcpServer(db: Database, serverId: string, config: MCPServerConfig): string {
  const now = Date.now();
  db.prepare(
    `INSERT INTO cortex_mcp_servers (server_id, name, config_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       config_json = excluded.config_json,
       updated_at  = excluded.updated_at`,
  ).run(serverId, config.name, JSON.stringify(config), now, now);
  // Fetch whichever server_id ended up in the table (may differ from the passed-in UUID)
  const row = db
    .prepare(`SELECT server_id FROM cortex_mcp_servers WHERE name = ?`)
    .get(config.name) as { server_id: string } | undefined;
  return row?.server_id ?? serverId;
}

export function updateMcpServer(db: Database, serverId: string, config: MCPServerConfig): boolean {
  const now = Date.now();
  const r = db
    .prepare(
      `UPDATE cortex_mcp_servers SET name = ?, config_json = ?, updated_at = ? WHERE server_id = ?`,
    )
    .run(config.name, JSON.stringify(config), now, serverId);
  return r.changes > 0;
}

export function deleteMcpServer(db: Database, serverId: string): boolean {
  db.prepare(`DELETE FROM cortex_mcp_cached_tools WHERE server_id = ?`).run(serverId);
  const r = db.prepare(`DELETE FROM cortex_mcp_servers WHERE server_id = ?`).run(serverId);
  return r.changes > 0;
}

/** Switch a server on or off. False when the server does not exist. */
export function setMcpServerEnabled(db: Database, serverId: string, enabled: boolean): boolean {
  const r = db
    .prepare(`UPDATE cortex_mcp_servers SET enabled = ?, updated_at = ? WHERE server_id = ?`)
    .run(enabled ? 1 : 0, Date.now(), serverId);
  return r.changes > 0;
}

/** Store the outcome of a probe or tool refresh (`error` is the already-sanitized message). */
export function recordMcpCheck(
  db: Database,
  serverId: string,
  result: { readonly status: "ok" } | { readonly status: "error"; readonly error: string },
  checkedAt: number = Date.now(),
): void {
  db.prepare(`UPDATE cortex_mcp_servers SET last_status = ?, last_error = ?, last_checked_at = ? WHERE server_id = ?`).run(
    result.status,
    result.status === "error" ? result.error : null,
    checkedAt,
    serverId,
  );
}

export function replaceMcpCachedTools(
  db: Database,
  serverId: string,
  tools: readonly { toolName: string; description?: string; inputSchema?: Record<string, unknown> }[],
): void {
  db.prepare(`DELETE FROM cortex_mcp_cached_tools WHERE server_id = ?`).run(serverId);
  const ins = db.prepare(
    `INSERT INTO cortex_mcp_cached_tools (server_id, tool_name, description, input_schema_json) VALUES (?,?,?,?)`,
  );
  for (const t of tools) {
    ins.run(serverId, t.toolName, t.description ?? null, t.inputSchema !== undefined ? JSON.stringify(t.inputSchema) : null);
  }
}

export function listCachedToolsForServer(db: Database, serverId: string): McpCachedToolRow[] {
  return db
    .prepare(`SELECT ${TOOL_COLS} FROM cortex_mcp_cached_tools WHERE server_id = ? ORDER BY tool_name ASC`)
    .all(serverId) as McpCachedToolRow[];
}

export function listCachedToolsForServers(db: Database, serverIds: readonly string[]): McpCachedToolRow[] {
  if (serverIds.length === 0) return [];
  const placeholders = serverIds.map(() => "?").join(",");
  return db
    .prepare(`SELECT ${TOOL_COLS} FROM cortex_mcp_cached_tools WHERE server_id IN (${placeholders}) ORDER BY tool_name ASC`)
    .all(...serverIds) as McpCachedToolRow[];
}
