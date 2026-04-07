import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { MCPServerConfig } from "@reactive-agents/runtime";
import { insertMcpServer } from "../db/mcp-queries.js";
import { expandMcpConfigsFromJson } from "./mcp-config-import.js";

export type McpJsonImportResult =
  | { ok: true; count: number; created: Array<{ serverId: string; name: string }> }
  | { ok: false; status: 400; error: string };

/**
 * Parse pasted JSON, expand configs, insert in one transaction (rollback on any failure).
 */
export function executeMcpJsonImport(db: Database, jsonText: string): McpJsonImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON" };
  }
  const configs = expandMcpConfigsFromJson(parsed);
  if (configs.length === 0) {
    return {
      ok: false,
      status: 400,
      error:
        'No valid MCP servers found. Use a config object, an array, { "servers": [...] }, or { "mcpServers": { "name": { ... } } } (Cursor-style).',
    };
  }
  const runImport = db.transaction((list: MCPServerConfig[]) => {
    const out: Array<{ serverId: string; name: string }> = [];
    for (const cfg of list) {
      const serverId = randomUUID();
      insertMcpServer(db, serverId, cfg);
      out.push({ serverId, name: cfg.name });
    }
    return out;
  });
  try {
    const created = runImport(configs);
    return { ok: true, count: created.length, created };
  } catch (e) {
    return {
      ok: false,
      status: 400,
      error:
        e instanceof Error
          ? e.message
          : "Import failed (duplicate name or database error). All rows were rolled back.",
    };
  }
}
