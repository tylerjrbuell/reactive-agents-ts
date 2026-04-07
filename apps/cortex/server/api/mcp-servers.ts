import { Elysia, t } from "elysia";
import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import {
  deleteMcpServer,
  getMcpServer,
  insertMcpServer,
  listCachedToolsForServers,
  listMcpServers,
  parseMcpConfig,
  replaceMcpCachedTools,
  updateMcpServer,
} from "../db/mcp-queries.js";
import { discoverMcpTools } from "../services/mcp-discovery.js";
import { parseConfigBody } from "../services/mcp-config-import.js";
import { executeMcpJsonImport } from "../services/mcp-json-import-apply.js";

export const mcpServersRouter = (db: Database) =>
  new Elysia({ prefix: "/api/mcp-servers" })
    .get("/", () => {
      const servers = listMcpServers(db);
      const ids = servers.map((s) => s.server_id);
      const toolRows = listCachedToolsForServers(db, ids);
      const toolsByServer = new Map<string, typeof toolRows>();
      for (const row of toolRows) {
        const list = toolsByServer.get(row.server_id) ?? [];
        list.push(row);
        toolsByServer.set(row.server_id, list);
      }
      return servers.map((s) => ({
        serverId: s.server_id,
        name: s.name,
        config: parseMcpConfig(s),
        tools: (toolsByServer.get(s.server_id) ?? []).map((r) => ({
          toolName: r.tool_name,
          description: r.description ?? undefined,
        })),
      }));
    })
    /** Static path before POST / so older Elysia / path-normalization quirks cannot shadow it. */
    .post(
      "/import-json",
      async ({ body, set }) => {
        const out = executeMcpJsonImport(db, body.json);
        if (!out.ok) {
          set.status = out.status;
          return { error: out.error };
        }
        return { ok: true as const, count: out.count, created: out.created };
      },
      { body: t.Object({ json: t.String() }) },
    )
    .post(
      "/",
      async ({ body, set }) => {
        const cfg = parseConfigBody(body as Record<string, unknown>);
        if (!cfg) {
          set.status = 400;
          return { error: "Invalid MCP server config (need name + transport, or infer from command/endpoint/url)" };
        }
        const serverId = randomUUID();
        insertMcpServer(db, serverId, cfg);
        return { serverId, name: cfg.name };
      },
      { body: t.Record(t.String(), t.Unknown()) },
    )
    .patch(
      "/:serverId",
      async ({ params, body, set }) => {
        const row = getMcpServer(db, params.serverId);
        if (!row) {
          set.status = 404;
          return { error: "MCP server not found" };
        }
        const cfg = parseConfigBody(body as Record<string, unknown>);
        if (!cfg) {
          set.status = 400;
          return { error: "Invalid MCP server config" };
        }
        if (!updateMcpServer(db, params.serverId, cfg)) {
          set.status = 404;
          return { error: "MCP server not found" };
        }
        return { ok: true as const, name: cfg.name };
      },
      { params: t.Object({ serverId: t.String() }), body: t.Record(t.String(), t.Unknown()) },
    )
    .delete(
      "/:serverId",
      async ({ params, set }) => {
        if (!deleteMcpServer(db, params.serverId)) {
          set.status = 404;
          return { error: "MCP server not found" };
        }
        return { ok: true as const };
      },
      { params: t.Object({ serverId: t.String() }) },
    )
    .post(
      "/:serverId/refresh-tools",
      async ({ params, set }) => {
        const row = getMcpServer(db, params.serverId);
        if (!row) {
          set.status = 404;
          return { error: "MCP server not found" };
        }
        const cfg = parseMcpConfig(row);
        try {
          const discovered = await discoverMcpTools(cfg);
          replaceMcpCachedTools(db, params.serverId, discovered);
          return { ok: true as const, tools: discovered };
        } catch (e) {
          set.status = 502;
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
      { params: t.Object({ serverId: t.String() }) },
    );
