// Run: bun run repo test apps/cortex/server/tests/mcp-tools-lab.test.ts
//
// Tools Lab server half: MCP server status / test / enable / per-key credentials / tool schemas,
// custom-tool edit, and "a disabled server is never started by an agent".
import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Elysia } from "elysia";
import { Database } from "bun:sqlite";
import { applySchema } from "../db/schema.js";
import { mcpServersRouter } from "../api/mcp-servers.js";
import { toolsRouter } from "../api/tools.js";
import { CortexStoreServiceLive } from "../services/store-service.js";
import { Effect } from "effect";
import { CortexStoreService } from "../services/store-service.js";
import { getEnabledMcpConfigsByIds, getMcpServer, insertMcpServer, listCachedToolsForServer } from "../db/mcp-queries.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import { MCP_SECRET_MASK } from "../services/mcp-secrets.js";
import type { McpProbeDeps } from "../services/mcp-probe.js";
import type { DiscoveredMcpTool } from "../services/mcp-discovery.js";

const SECRET = "sk-live-very-secret-1234";
const SCHEMA = { type: "object", properties: { q: { type: "string" } }, required: ["q"] };

type Handle = { handle: (req: Request) => Promise<Response> };

function fakeDeps(over: Partial<McpProbeDeps> & { tools?: DiscoveredMcpTool[] } = {}) {
  const cleaned: string[] = [];
  const deps: McpProbeDeps = {
    discover: over.discover ?? (async () => over.tools ?? [{ toolName: "srv/search", description: "Search", inputSchema: SCHEMA }]),
    cleanup: (name) => {
      cleaned.push(name);
    },
    timeoutMs: over.timeoutMs ?? 5_000,
  };
  return { deps, cleaned };
}

function makeApp(deps?: McpProbeDeps) {
  const db = new Database(":memory:");
  applySchema(db);
  return { db, app: new Elysia().use(mcpServersRouter(db, deps)) };
}

const send = (app: Handle, method: string, path: string, body?: unknown) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );

async function addServer(app: Handle, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await send(app, "POST", "/api/mcp-servers", {
    name: "srv",
    transport: "streamable-http",
    endpoint: `https://example.com/mcp?token=${SECRET}`,
    headers: { Authorization: `Bearer ${SECRET}` },
    env: { API_KEY: SECRET },
    ...extra,
  });
  return ((await res.json()) as { serverId: string }).serverId;
}

describe("migration", () => {
  it("adds the new columns to an existing database; old rows read as enabled and unchecked", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE cortex_mcp_servers (server_id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, config_json TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE cortex_mcp_cached_tools (server_id TEXT NOT NULL, tool_name TEXT NOT NULL, description TEXT, PRIMARY KEY (server_id, tool_name));
      INSERT INTO cortex_mcp_servers (server_id, name, config_json) VALUES ('old', 'old-srv', '{"name":"old-srv","transport":"stdio","command":"echo"}');
      INSERT INTO cortex_mcp_cached_tools (server_id, tool_name) VALUES ('old', 'old-srv/t');`);
    applySchema(db);
    applySchema(db); // idempotent
    const row = getMcpServer(db, "old")!;
    expect([row.enabled, row.last_status, row.last_error, row.last_checked_at]).toEqual([1, null, null, null]);
    expect(listCachedToolsForServer(db, "old")[0]?.input_schema_json).toBeNull();
  });
});

describe("POST /api/mcp-servers/:id/test", () => {
  it("probes without touching the tool cache, records ok status, releases the transport", async () => {
    const { deps, cleaned } = fakeDeps();
    const { db, app } = makeApp(deps);
    const id = await addServer(app);
    const res = await send(app, "POST", `/api/mcp-servers/${id}/test`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; toolCount: number; tools: { toolName: string; inputSchema?: unknown }[]; checkedAt: number };
    expect(body.ok).toBe(true);
    expect(body.toolCount).toBe(1);
    expect(body.tools[0]?.inputSchema).toEqual(SCHEMA);
    expect(listCachedToolsForServer(db, id)).toEqual([]);
    const row = getMcpServer(db, id)!;
    expect([row.last_status, row.last_error, row.last_checked_at]).toEqual(["ok", null, body.checkedAt]);
    expect(cleaned).toEqual(["srv"]);
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it("a failed probe is 200 ok:false; the stored and returned error carry no credential", async () => {
    const { deps, cleaned } = fakeDeps({
      discover: async () => {
        throw new Error(`connect failed with Authorization: Bearer ${SECRET} for key ${SECRET}`);
      },
    });
    const { db, app } = makeApp(deps);
    const id = await addServer(app);
    const res = await send(app, "POST", `/api/mcp-servers/${id}/test`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    const body = JSON.parse(text) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    const row = getMcpServer(db, id)!;
    expect(row.last_status).toBe("error");
    expect(row.last_error).toBe(body.error);
    expect(row.last_error).not.toContain(SECRET);
    expect(cleaned).toEqual(["srv"]);
  });

  it("times out at the cap: ok:false and the transport is cleaned", async () => {
    const { deps, cleaned } = fakeDeps({ discover: () => new Promise(() => {}), timeoutMs: 20 });
    const { app } = makeApp(deps);
    const id = await addServer(app);
    const res = await send(app, "POST", `/api/mcp-servers/${id}/test`);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("timed out");
    expect(cleaned.length).toBeGreaterThanOrEqual(1);
  });

  it("404 for an unknown server", async () => {
    const { app } = makeApp(fakeDeps().deps);
    expect((await send(app, "POST", "/api/mcp-servers/nope/test")).status).toBe(404);
  });
});

describe("refresh-tools, tool schemas and status", () => {
  it("stores tools with input schemas, records status, and GET /:id/tools returns them", async () => {
    const { deps } = fakeDeps();
    const { app } = makeApp(deps);
    const id = await addServer(app);
    expect((await send(app, "POST", `/api/mcp-servers/${id}/refresh-tools`)).status).toBe(200);
    const tools = (await (await send(app, "GET", `/api/mcp-servers/${id}/tools`)).json()) as { tools: { toolName: string; description?: string; inputSchema?: unknown }[] };
    expect(tools.tools).toEqual([{ toolName: "srv/search", description: "Search", inputSchema: SCHEMA }]);
    const list = (await (await send(app, "GET", "/api/mcp-servers")).json()) as Array<Record<string, unknown>>;
    expect(list[0]).toMatchObject({ enabled: true, lastStatus: "ok", lastError: null });
    expect(typeof list[0]?.lastCheckedAt).toBe("number");
  });

  it("a failed refresh is 502, keeps the old cache and records the error", async () => {
    let fail = false;
    const { deps } = fakeDeps({ discover: async () => { if (fail) throw new Error("boom"); return [{ toolName: "srv/a" }]; } });
    const { db, app } = makeApp(deps);
    const id = await addServer(app);
    await send(app, "POST", `/api/mcp-servers/${id}/refresh-tools`);
    fail = true;
    const res = await send(app, "POST", `/api/mcp-servers/${id}/refresh-tools`);
    expect(res.status).toBe(502);
    expect(listCachedToolsForServer(db, id).map((t) => t.tool_name)).toEqual(["srv/a"]);
    expect(getMcpServer(db, id)).toMatchObject({ last_status: "error", last_error: "boom" });
  });

  it("GET /:id/tools is 404 for an unknown server", async () => {
    const { app } = makeApp(fakeDeps().deps);
    expect((await send(app, "GET", "/api/mcp-servers/nope/tools")).status).toBe(404);
  });
});

describe("PATCH /api/mcp-servers/:id/enabled", () => {
  it("switches a server off and on, releases the transport when switching off", async () => {
    const { deps, cleaned } = fakeDeps();
    const { app } = makeApp(deps);
    const id = await addServer(app);
    expect((await send(app, "PATCH", `/api/mcp-servers/${id}/enabled`, { enabled: false })).status).toBe(200);
    expect(cleaned).toEqual(["srv"]);
    let list = (await (await send(app, "GET", "/api/mcp-servers")).json()) as Array<{ enabled: boolean }>;
    expect(list[0]?.enabled).toBe(false);
    await send(app, "PATCH", `/api/mcp-servers/${id}/enabled`, { enabled: true });
    list = (await (await send(app, "GET", "/api/mcp-servers")).json()) as Array<{ enabled: boolean }>;
    expect(list[0]?.enabled).toBe(true);
  });

  it("validates the body and 404s an unknown server", async () => {
    const { app } = makeApp(fakeDeps().deps);
    const id = await addServer(app);
    expect((await send(app, "PATCH", `/api/mcp-servers/${id}/enabled`, { enabled: "yes" })).status).toBe(422);
    expect((await send(app, "PATCH", "/api/mcp-servers/nope/enabled", { enabled: false })).status).toBe(404);
  });

  it("editing a disabled server's config keeps it disabled", async () => {
    const { app } = makeApp(fakeDeps().deps);
    const id = await addServer(app);
    await send(app, "PATCH", `/api/mcp-servers/${id}/enabled`, { enabled: false });
    await send(app, "PATCH", `/api/mcp-servers/${id}`, { name: "srv", transport: "streamable-http", endpoint: "https://example.com/mcp" });
    const list = (await (await send(app, "GET", "/api/mcp-servers")).json()) as Array<{ enabled: boolean }>;
    expect(list[0]?.enabled).toBe(false);
  });
});

describe("PUT /api/mcp-servers/:id/secrets", () => {
  it("sets, replaces and removes single keys; other stored values stay; nothing is echoed", async () => {
    const { db, app } = makeApp(fakeDeps().deps);
    const id = await addServer(app, { env: { A: "keep-a-1234", B: "old-b-1234" }, headers: { Authorization: "Bearer keep-1234" } });
    const NEW = "brand-new-value-9876";
    const res = await send(app, "PUT", `/api/mcp-servers/${id}/secrets`, {
      env: { set: { B: NEW, C: "added-c-1234" }, remove: ["A"] },
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(NEW);
    expect(text).not.toContain("added-c-1234");
    expect(JSON.parse(text)).toEqual({ ok: true, env: ["B", "C"], headers: ["Authorization"] });
    const stored = JSON.parse(getMcpServer(db, id)!.config_json) as { env: Record<string, string>; headers: Record<string, string> };
    expect(stored.env).toEqual({ B: NEW, C: "added-c-1234" });
    expect(stored.headers).toEqual({ Authorization: "Bearer keep-1234" });
    const listText = await (await send(app, "GET", "/api/mcp-servers")).text();
    expect(listText).not.toContain(NEW);
    expect(listText).toContain(MCP_SECRET_MASK);
  });

  it("removing the last key drops the record; headers work the same", async () => {
    const { db, app } = makeApp(fakeDeps().deps);
    const id = await addServer(app);
    await send(app, "PUT", `/api/mcp-servers/${id}/secrets`, { env: { remove: ["API_KEY"] }, headers: { set: { "X-Key": "header-value-1" } } });
    const stored = JSON.parse(getMcpServer(db, id)!.config_json) as { env?: unknown; headers: Record<string, string> };
    expect(stored.env).toBeUndefined();
    expect(stored.headers["X-Key"]).toBe("header-value-1");
  });

  it("refuses the mask, an empty value or an empty key without echoing values", async () => {
    const { db, app } = makeApp(fakeDeps().deps);
    const id = await addServer(app);
    const before = getMcpServer(db, id)!.config_json;
    for (const body of [
      { env: { set: { API_KEY: MCP_SECRET_MASK } } },
      { env: { set: { API_KEY: "" } } },
      { env: { set: { " ": "value-1234" } } },
      { headers: { remove: [""] } },
    ]) {
      const res = await send(app, "PUT", `/api/mcp-servers/${id}/secrets`, body);
      expect(res.status).toBe(400);
      expect(await res.text()).not.toContain("value-1234");
    }
    expect(getMcpServer(db, id)!.config_json).toBe(before);
  });

  it("404 for an unknown server", async () => {
    const { app } = makeApp(fakeDeps().deps);
    expect((await send(app, "PUT", "/api/mcp-servers/nope/secrets", { env: { set: { A: "value-1234" } } })).status).toBe(404);
  });
});

describe("disabled servers are never started by an agent", () => {
  it("getEnabledMcpConfigsByIds skips a disabled server and unknown ids", async () => {
    const { db, app } = makeApp(fakeDeps().deps);
    insertMcpServer(db, "on", { name: "on-srv", transport: "stdio", command: "echo" });
    insertMcpServer(db, "off", { name: "off-srv", transport: "stdio", command: "echo" });
    await send(app, "PATCH", "/api/mcp-servers/off/enabled", { enabled: false });
    expect(getEnabledMcpConfigsByIds(db, ["on", "off", "missing"]).map((c) => c.name)).toEqual(["on-srv"]);
    expect(getEnabledMcpConfigsByIds(db, [])).toEqual([]);
  });

  it("the store resolver (desk runs) and the chat build path both drop it", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    insertMcpServer(db, "on", { name: "on-srv", transport: "stdio", command: "echo" });
    insertMcpServer(db, "off", { name: "off-srv", transport: "stdio", command: "echo" });
    const app = new Elysia().use(mcpServersRouter(db, fakeDeps().deps));
    await send(app, "PATCH", "/api/mcp-servers/off/enabled", { enabled: false });

    const viaStore = await Effect.runPromise(
      CortexStoreService.pipe(Effect.flatMap((s) => s.getMcpServerConfigsByIds(["on", "off"])), Effect.provide(CortexStoreServiceLive(db))),
    );
    expect(viaStore.map((c) => c.name)).toEqual(["on-srv"]);

    type ChatParamsOf = (sessionId: string, cfg: Record<string, unknown>, stableAgentId: string | undefined) => { mcpConfigs?: { name: string }[] };
    const svc = new ChatSessionService(db);
    const params = (svc as unknown as { buildChatAgentParams: ChatParamsOf }).buildChatAgentParams(
      "s1",
      { provider: "test", enableTools: true, tools: ["web-search"], mcpServerIds: ["on", "off"] },
      undefined,
    );
    expect(params.mcpConfigs?.map((c) => c.name)).toEqual(["on-srv"]);
  });

  it("no service resolves saved servers except through the enabled-only helper", () => {
    // Gateway, channel hub, chat, desk runs: a path that calls getMcpServersByIds / listMcpServers
    // to build an agent would start a disabled server. Only the helper may use the raw resolver.
    const root = join(import.meta.dir, "..", "services");
    const offenders = readdirSync(root)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .filter((f) => /getMcpServersByIds\(/.test(readFileSync(join(root, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("PATCH /api/tools/lab-custom/:id", () => {
  const setup = async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const app = new Elysia().use(toolsRouter(CortexStoreServiceLive(db), db));
    const make = async (name: string) =>
      ((await (await send(app, "POST", "/api/tools/lab-custom", { name, description: "d", parameters: [] })).json()) as { toolId: string }).toolId;
    return { db, app, make };
  };
  const catalogRow = async (app: Handle, id: string) =>
    ((await (await send(app, "GET", "/api/tools/catalog")).json()) as Array<{ id: string; name: string; description: string; parameters: unknown[]; disabled?: boolean }>).find((r) => r.id === `lab:${id}`);

  it("edits name, description and parameters; disabled alone still works", async () => {
    const { app, make } = await setup();
    const id = await make("first-tool");
    const params = [{ name: "q", type: "string", required: true, description: "query" }];
    const res = await send(app, "PATCH", `/api/tools/lab-custom/${id}`, { name: "renamed-tool", description: "New text", parameters: params });
    expect(res.status).toBe(200);
    expect(await catalogRow(app, id)).toMatchObject({ name: "renamed-tool", description: "New text", parameters: params });
    await send(app, "PATCH", `/api/tools/lab-custom/${id}`, { disabled: true });
    expect(await catalogRow(app, id)).toMatchObject({ name: "renamed-tool", disabled: true });
  });

  it("a partial edit keeps the other fields", async () => {
    const { app, make } = await setup();
    const id = await make("partial-tool");
    await send(app, "PATCH", `/api/tools/lab-custom/${id}`, { description: "Only this" });
    expect(await catalogRow(app, id)).toMatchObject({ name: "partial-tool", description: "Only this" });
  });

  it("validates like create: kebab-case name, non-empty description, something to change", async () => {
    const { app, make } = await setup();
    const id = await make("valid-tool");
    expect((await send(app, "PATCH", `/api/tools/lab-custom/${id}`, { name: "Not Kebab" })).status).toBe(400);
    expect((await send(app, "PATCH", `/api/tools/lab-custom/${id}`, { description: "  " })).status).toBe(400);
    expect((await send(app, "PATCH", `/api/tools/lab-custom/${id}`, {})).status).toBe(400);
    expect((await send(app, "PATCH", `/api/tools/lab-custom/${id}`, { parameters: [{ name: "q" }] })).status).toBe(422);
  });

  it("a name another tool holds is 400; an unknown tool is 404", async () => {
    const { app, make } = await setup();
    await make("taken-tool");
    const id = await make("other-tool");
    expect((await send(app, "PATCH", `/api/tools/lab-custom/${id}`, { name: "taken-tool" })).status).toBe(400);
    expect((await send(app, "PATCH", "/api/tools/lab-custom/missing", { description: "x" })).status).toBe(404);
  });
});

describe("catalog marks tools of a disabled server", () => {
  it("carries disabled:true for its cached tools", async () => {
    const { db, app } = makeApp(fakeDeps().deps);
    const id = await addServer(app);
    await send(app, "POST", `/api/mcp-servers/${id}/refresh-tools`);
    await send(app, "PATCH", `/api/mcp-servers/${id}/enabled`, { enabled: false });
    const tools = new Elysia().use(toolsRouter(CortexStoreServiceLive(db), db));
    const rows = (await (await send(tools, "GET", "/api/tools/catalog")).json()) as Array<{ kind: string; disabled?: boolean }>;
    expect(rows.filter((r) => r.kind === "mcp").every((r) => r.disabled === true)).toBe(true);
  });
});
