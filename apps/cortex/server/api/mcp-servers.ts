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
import { cleanupMcpTransport } from "@reactive-agents/tools";

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
        const row = getMcpServer(db, params.serverId);
        if (!row) {
          set.status = 404;
          return { error: "MCP server not found" };
        }
        // Kill any active transport (subprocess / SSE / WS) before removing from DB.
        // This stops docker containers and other long-running processes from leaking.
        cleanupMcpTransport(row.name);
        if (!deleteMcpServer(db, params.serverId)) {
          set.status = 404;
          return { error: "MCP server not found" };
        }
        console.log(`[MCP delete] "${row.name}" (${params.serverId}) removed and transport cleaned up`);
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
        console.log(`[MCP refresh-tools] "${cfg.name}" transport=${cfg.transport}${cfg.endpoint ? ` endpoint=${cfg.endpoint}` : ""}${cfg.command ? ` command=${cfg.command}` : ""}`);

        // 10-minute hard cap — covers the worst-case first `docker pull` of a large image.
        // On expiry the subprocess is killed so the server process does not leak.
        const DISCOVERY_TIMEOUT_MS = 600_000;

        const discoveryPromise = discoverMcpTools(cfg);
        // Prevent unhandled-rejection if the timeout settles first
        discoveryPromise.catch(() => {});

        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            cleanupMcpTransport(cfg.name);
            reject(new Error(`MCP tool discovery timed out after ${DISCOVERY_TIMEOUT_MS / 60_000} minutes`));
          }, DISCOVERY_TIMEOUT_MS);
        });

        try {
          const discovered = await Promise.race([discoveryPromise, timeoutPromise]);
          replaceMcpCachedTools(db, params.serverId, discovered);
          console.log(`[MCP refresh-tools] "${cfg.name}" stored ${discovered.length} tool(s) in DB`);
          return { ok: true as const, tools: discovered };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[MCP refresh-tools] "${cfg.name}" FAILED: ${msg}`);
          set.status = 502;
          return { error: msg };
        } finally {
          clearTimeout(timeoutId);
        }
      },
      { params: t.Object({ serverId: t.String() }) },
    );
