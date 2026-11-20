import { Elysia, t } from "elysia";
import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import {
  deleteMcpServer,
  getMcpServer,
  insertMcpServer,
  listCachedToolsForServer,
  listCachedToolsForServers,
  listMcpServers,
  parseMcpConfig,
  recordMcpCheck,
  replaceMcpCachedTools,
  setMcpServerEnabled,
  updateMcpServer,
  type McpCachedToolRow,
  type McpServerRow,
} from "../db/mcp-queries.js";
import { cortexLog } from "../cortex-log.js";
import { parseConfigBody } from "../services/mcp-config-import.js";
import { executeMcpJsonImport } from "../services/mcp-json-import-apply.js";
import { cleanupMcpTransport } from "@reactive-agents/tools";
import {
  applyMcpSecretUpdate,
  maskMcpConfig,
  mcpSecretUpdateProblem,
  restoreMaskedMcpConfig,
} from "../services/mcp-secrets.js";
import { makeMcpServerTester, type McpServerTester } from "../services/mcp-server-test.js";
import { defaultMcpProbeDeps, probeMcpServer, type McpProbeDeps } from "../services/mcp-probe.js";

/** `input_schema_json` text back to the schema object (null when absent or not an object). */
const parseSchema = (json: string | null): Record<string, unknown> | undefined => {
  if (json === null) return undefined;
  try {
    const v: unknown = JSON.parse(json);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
};

const toolWire = (r: McpCachedToolRow) => {
  const inputSchema = parseSchema(r.input_schema_json);
  return {
    toolName: r.tool_name,
    description: r.description ?? undefined,
    ...(inputSchema !== undefined ? { inputSchema } : {}),
  };
};

/** The probe state a server row carries to the UI. */
const statusWire = (s: McpServerRow) => ({
  enabled: s.enabled !== 0,
  lastStatus: s.last_status === "ok" || s.last_status === "error" ? s.last_status : null,
  lastError: s.last_error,
  lastCheckedAt: s.last_checked_at,
});

const secretEdit = t.Optional(
  t.Object({
    set: t.Optional(t.Record(t.String(), t.String())),
    remove: t.Optional(t.Array(t.String())),
  }),
);

export const mcpServersRouter = (
  db: Database,
  probeDeps: McpProbeDeps = defaultMcpProbeDeps,
  testServer: McpServerTester = makeMcpServerTester(db, probeDeps),
) =>
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
        // Credentials (env / header values, OAuth secrets) are write-only: masked here, kept on save.
        config: maskMcpConfig(parseMcpConfig(s)),
        ...statusWire(s),
        // Names and descriptions only here; schemas come from GET /:serverId/tools.
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
        if (!updateMcpServer(db, params.serverId, restoreMaskedMcpConfig(cfg, parseMcpConfig(row)))) {
          set.status = 404;
          return { error: "MCP server not found" };
        }
        return { ok: true as const, name: cfg.name };
      },
      { params: t.Object({ serverId: t.String() }), body: t.Record(t.String(), t.Unknown()) },
    )
    /** Switch a server on or off. A disabled server is never started by an agent build path. */
    .patch(
      "/:serverId/enabled",
      async ({ params, body, set }) => {
        const row = getMcpServer(db, params.serverId);
        if (!row) {
          set.status = 404;
          return { error: "MCP server not found" };
        }
        if (!setMcpServerEnabled(db, params.serverId, body.enabled)) {
          set.status = 404;
          return { error: "MCP server not found" };
        }
        // Switching off also releases a transport a past run or probe left open.
        if (!body.enabled) probeDeps.cleanup(row.name);
        cortexLog("info", "mcp", `${body.enabled ? "enable" : "disable"} "${row.name}"`);
        return { ok: true as const, enabled: body.enabled };
      },
      { params: t.Object({ serverId: t.String() }), body: t.Object({ enabled: t.Boolean() }) },
    )
    /**
     * Write-only credentials: set, replace or remove individual env / header keys. Values are never
     * echoed; the response lists key names only.
     */
    .put(
      "/:serverId/secrets",
      async ({ params, body, set }) => {
        const row = getMcpServer(db, params.serverId);
        if (!row) {
          set.status = 404;
          return { error: "MCP server not found" };
        }
        const problem = mcpSecretUpdateProblem(body);
        if (problem !== null) {
          set.status = 400;
          return { error: problem };
        }
        const next = applyMcpSecretUpdate(parseMcpConfig(row), body);
        if (!updateMcpServer(db, params.serverId, next)) {
          set.status = 404;
          return { error: "MCP server not found" };
        }
        return { ok: true as const, env: Object.keys(next.env ?? {}), headers: Object.keys(next.headers ?? {}) };
      },
      { params: t.Object({ serverId: t.String() }), body: t.Object({ env: secretEdit, headers: secretEdit }) },
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
        cortexLog("info", "mcp", `delete "${row.name}" (${params.serverId}) removed and transport cleaned up`);
        return { ok: true as const };
      },
      { params: t.Object({ serverId: t.String() }) },
    )
    /** The cached tools of one server with the JSON input schema each reported at the last refresh. */
    .get(
      "/:serverId/tools",
      async ({ params, set }) => {
        if (!getMcpServer(db, params.serverId)) {
          set.status = 404;
          return { error: "MCP server not found" };
        }
        return { tools: listCachedToolsForServer(db, params.serverId).map(toolWire) };
      },
      { params: t.Object({ serverId: t.String() }) },
    )
    /**
     * Test the connection: connect, list tools, release the transport. Writes the status fields only,
     * never the tool cache. A failed probe is still HTTP 200 with `ok: false` (the test ran). The page's
     * background checks pass `timeoutMs` (a shorter cap); one probe per server runs at a time
     * (`services/mcp-server-test.ts`).
     */
    .post(
      "/:serverId/test",
      async ({ params, query, set }) => {
        const out = await testServer(params.serverId, query.timeoutMs === undefined ? {} : { timeoutMs: query.timeoutMs });
        if (out === null) {
          set.status = 404;
          return { error: "MCP server not found" };
        }
        // `authRequired`: the server refused for lack of a login; the UI offers Sign in (api/mcp-oauth.ts).
        if (!out.ok) return { ok: false as const, error: out.error, checkedAt: out.checkedAt, ...(out.authRequired ? { authRequired: true as const } : {}) };
        return {
          ok: true as const,
          checkedAt: out.checkedAt,
          toolCount: out.tools.length,
          tools: out.tools.map((x) => ({
            toolName: x.toolName,
            description: x.description,
            ...(x.inputSchema !== undefined ? { inputSchema: x.inputSchema } : {}),
          })),
        };
      },
      { params: t.Object({ serverId: t.String() }), query: t.Object({ timeoutMs: t.Optional(t.Numeric()) }) },
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
        // Name and transport only: endpoints and command lines often carry tokens in the query string or args.
        cortexLog("info", "mcp", `refresh-tools "${cfg.name}" transport=${cfg.transport}`);
        const result = await probeMcpServer(cfg, probeDeps);
        if (!result.ok) {
          recordMcpCheck(db, params.serverId, { status: "error", error: result.error });
          cortexLog("error", "mcp", `refresh-tools "${cfg.name}" FAILED`);
          set.status = 502;
          return { error: result.error, ...(result.authRequired ? { authRequired: true as const } : {}) };
        }
        replaceMcpCachedTools(db, params.serverId, result.tools);
        recordMcpCheck(db, params.serverId, { status: "ok" });
        cortexLog("info", "mcp", `refresh-tools "${cfg.name}" stored ${result.tools.length} tool(s) in DB`);
        return { ok: true as const, tools: result.tools };
      },
      { params: t.Object({ serverId: t.String() }) },
    );
