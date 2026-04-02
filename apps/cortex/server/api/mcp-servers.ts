import { Elysia, t } from "elysia";
import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { MCPServerConfig } from "@reactive-agents/runtime";
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

const TRANSPORTS = new Set(["stdio", "sse", "websocket", "streamable-http"]);

function parseConfigBody(body: Record<string, unknown>): MCPServerConfig | null {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const transport = body.transport;
  if (!name || typeof transport !== "string" || !TRANSPORTS.has(transport)) return null;
  const cfg: MCPServerConfig = {
    name,
    transport: transport as MCPServerConfig["transport"],
  };
  if (typeof body.command === "string" && body.command.trim()) cfg.command = body.command.trim();
  if (Array.isArray(body.args)) {
    const args = body.args.filter((a): a is string => typeof a === "string");
    if (args.length > 0) cfg.args = args;
  }
  if (typeof body.cwd === "string" && body.cwd.trim()) cfg.cwd = body.cwd.trim();
  if (body.env && typeof body.env === "object" && !Array.isArray(body.env)) {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.env as Record<string, unknown>)) {
      if (typeof v === "string") env[k] = v;
    }
    if (Object.keys(env).length > 0) cfg.env = env;
  }
  if (typeof body.endpoint === "string" && body.endpoint.trim()) cfg.endpoint = body.endpoint.trim();
  if (body.headers && typeof body.headers === "object" && !Array.isArray(body.headers)) {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.headers as Record<string, unknown>)) {
      if (typeof v === "string") headers[k] = v;
    }
    if (Object.keys(headers).length > 0) cfg.headers = headers;
  }
  return cfg;
}

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
    .post(
      "/",
      async ({ body, set }) => {
        const cfg = parseConfigBody(body as Record<string, unknown>);
        if (!cfg) {
          set.status = 400;
          return { error: "Invalid MCP server config (need name + transport)" };
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
