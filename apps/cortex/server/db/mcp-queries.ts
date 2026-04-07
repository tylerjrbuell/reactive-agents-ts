import type { Database } from "bun:sqlite";
import type { MCPServerConfig } from "@reactive-agents/runtime";
import { normalizeMcpHttpTransport } from "../services/mcp-config-import.js";

export type McpServerRow = {
  server_id: string;
  name: string;
  config_json: string;
  created_at: number;
  updated_at: number;
};

export type McpCachedToolRow = {
  server_id: string;
  tool_name: string;
  description: string | null;
};

export function listMcpServers(db: Database): McpServerRow[] {
  return db
    .prepare(
      `SELECT server_id, name, config_json, created_at, updated_at FROM cortex_mcp_servers ORDER BY name ASC`,
    )
    .all() as McpServerRow[];
}

export function getMcpServer(db: Database, serverId: string): McpServerRow | null {
  const row = db
    .prepare(`SELECT server_id, name, config_json, created_at, updated_at FROM cortex_mcp_servers WHERE server_id = ?`)
    .get(serverId) as McpServerRow | undefined;
  return row ?? null;
}

export function getMcpServersByIds(db: Database, ids: readonly string[]): McpServerRow[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT server_id, name, config_json, created_at, updated_at FROM cortex_mcp_servers WHERE server_id IN (${placeholders})`,
    )
    .all(...ids) as McpServerRow[];
}

export function parseMcpConfig(row: McpServerRow): MCPServerConfig {
  const raw = JSON.parse(row.config_json) as MCPServerConfig;
  return normalizeMcpHttpTransport(raw);
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

export function replaceMcpCachedTools(
  db: Database,
  serverId: string,
  tools: readonly { toolName: string; description?: string }[],
): void {
  db.prepare(`DELETE FROM cortex_mcp_cached_tools WHERE server_id = ?`).run(serverId);
  const ins = db.prepare(
    `INSERT INTO cortex_mcp_cached_tools (server_id, tool_name, description) VALUES (?,?,?)`,
  );
  for (const t of tools) {
    ins.run(serverId, t.toolName, t.description ?? null);
  }
}

export function listCachedToolsForServer(db: Database, serverId: string): McpCachedToolRow[] {
  return db
    .prepare(
      `SELECT server_id, tool_name, description FROM cortex_mcp_cached_tools WHERE server_id = ? ORDER BY tool_name ASC`,
    )
    .all(serverId) as McpCachedToolRow[];
}

export function listCachedToolsForServers(db: Database, serverIds: readonly string[]): McpCachedToolRow[] {
  if (serverIds.length === 0) return [];
  const placeholders = serverIds.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT server_id, tool_name, description FROM cortex_mcp_cached_tools WHERE server_id IN (${placeholders}) ORDER BY tool_name ASC`,
    )
    .all(...serverIds) as McpCachedToolRow[];
}
