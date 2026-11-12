import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { MCPServerConfig } from "@reactive-agents/runtime";
import { listMcpServers, parseMcpConfig, upsertMcpServer } from "../db/mcp-queries.js";
import { restoreMaskedMcpConfig } from "./mcp-secrets.js";
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
      // upsert: update config if a server with this name already exists, keeping its server_id
      // A masked credential (pasted from a GET response) keeps the stored one.
      const existing = listMcpServers(db).find((s) => s.name === cfg.name);
      const next = restoreMaskedMcpConfig(cfg, existing ? parseMcpConfig(existing) : undefined);
      const serverId = upsertMcpServer(db, randomUUID(), next);
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
