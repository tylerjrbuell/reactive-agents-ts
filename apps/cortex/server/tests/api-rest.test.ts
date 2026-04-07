import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { Database } from "bun:sqlite";
import { applySchema } from "../db/schema.js";
import { CortexStoreServiceLive } from "../services/store-service.js";
import { agentsRouter } from "../api/agents.js";
import { toolsRouter } from "../api/tools.js";
import { skillsRouter } from "../api/skills.js";
import { mcpServersRouter } from "../api/mcp-servers.js";
import { GatewayProcessManager } from "../services/gateway-process-manager.js";
import { CortexEventBridgeLive, CortexEventBridge } from "../services/event-bridge.js";
import { CortexIngestServiceLive } from "../services/ingest-service.js";
import { Effect, Layer } from "effect";

function makeTestGateway(db: Database) {
  const bridgeService = Effect.runSync(CortexEventBridge.pipe(Effect.provide(CortexEventBridgeLive)));
  const bridgeLayer = Layer.succeed(CortexEventBridge, bridgeService);
  const ingestLayer = CortexIngestServiceLive(db).pipe(Layer.provide(bridgeLayer)) as Layer.Layer<any>;
  return new GatewayProcessManager(db, ingestLayer);
}

describe("GET /api/agents", () => {
  it("returns empty array when no agents", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const gateway = makeTestGateway(db);
    const app = new Elysia().use(agentsRouter(db, gateway));
    const res = await app.handle(new Request("http://localhost/api/agents"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    gateway.destroy();
  });
});

describe("GET /api/tools", () => {
  it("returns JSON array", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const app = new Elysia().use(toolsRouter(CortexStoreServiceLive(db), db));
    const res = await app.handle(new Request("http://localhost/api/tools"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe("GET /api/tools/catalog", () => {
  it("returns unified catalog with built-in entries", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const app = new Elysia().use(toolsRouter(CortexStoreServiceLive(db), db));
    const res = await app.handle(new Request("http://localhost/api/tools/catalog"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; kind: string; name: string }>;
    expect(Array.isArray(body)).toBe(true);
    const web = body.find((t) => t.name === "web-search");
    expect(web).toBeDefined();
    expect(web!.kind).toBe("built-in");
    expect(web!.id.startsWith("bi:")).toBe(true);
  });
});

describe("POST /api/tools/lab-custom + invoke", () => {
  it("echoes args for lab custom tool", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const app = new Elysia().use(toolsRouter(CortexStoreServiceLive(db), db));
    const create = await app.handle(
      new Request("http://localhost/api/tools/lab-custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "echo-demo",
          description: "test",
          parameters: [{ name: "msg", type: "string", required: true, description: "message" }],
        }),
      }),
    );
    expect(create.status).toBe(200);
    const { toolId } = (await create.json()) as { toolId: string };
    const inv = await app.handle(
      new Request("http://localhost/api/tools/invoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolId: `lab:${toolId}`,
          arguments: { msg: "hi" },
        }),
      }),
    );
    expect(inv.status).toBe(200);
    const out = (await inv.json()) as { result?: { received?: { msg?: string } } };
    expect(out.result?.received?.msg).toBe("hi");
  });
});

describe("GET /api/skills", () => {
  it("returns JSON array", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const app = new Elysia().use(skillsRouter(CortexStoreServiceLive(db), db));
    const res = await app.handle(new Request("http://localhost/api/skills"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("GET /api/skills/discover returns { paths: string[] }", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const app = new Elysia().use(skillsRouter(CortexStoreServiceLive(db), db));
    const res = await app.handle(new Request("http://localhost/api/skills/discover"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { paths: string[] };
    expect(Array.isArray(body.paths)).toBe(true);
  });

  it("GET /api/skills/files returns { skills: array }", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const app = new Elysia().use(skillsRouter(CortexStoreServiceLive(db), db));
    const res = await app.handle(new Request("http://localhost/api/skills/files"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { skills: unknown[] };
    expect(Array.isArray(body.skills)).toBe(true);
  });

  it("GET /api/skills/file parses discovered SKILL.md when any exist", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const app = new Elysia().use(skillsRouter(CortexStoreServiceLive(db), db));
    const listRes = await app.handle(new Request("http://localhost/api/skills/files"));
    const { skills } = (await listRes.json()) as { skills: { relPath: string }[] };
    if (skills.length === 0) return;

    const res = await app.handle(
      new Request(
        `http://localhost/api/skills/file?path=${encodeURIComponent(skills[0]!.relPath)}`,
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; instructions: string };
    expect(typeof body.name).toBe("string");
    expect(body.name.length).toBeGreaterThan(0);
    expect(typeof body.instructions).toBe("string");
  });

  it("GET /api/skills/sqlite/:id returns parsed row", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    db.exec(
      "CREATE TABLE skills (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, description TEXT, content TEXT)",
    );
    db.prepare(
      "INSERT INTO skills (name, description, content) VALUES (?, ?, ?)",
    ).run("row-skill", "Row desc", "---\nname: yaml-name\ndescription: Yaml desc\n---\n\n# Body\n");
    const app = new Elysia().use(skillsRouter(CortexStoreServiceLive(db), db));
    const res = await app.handle(new Request("http://localhost/api/skills/sqlite/1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; instructions: string };
    expect(body.name).toBe("yaml-name");
    expect(body.instructions).toContain("# Body");
  });
});

describe("POST /api/mcp-servers/import-json", () => {
  it("rejects invalid JSON", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const app = new Elysia().use(mcpServersRouter(db));
    const res = await app.handle(
      new Request("http://localhost/api/mcp-servers/import-json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: "not-json" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects empty expansion", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const app = new Elysia().use(mcpServersRouter(db));
    const res = await app.handle(
      new Request("http://localhost/api/mcp-servers/import-json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: "{}" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("imports Cursor-style mcpServers map", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const app = new Elysia().use(mcpServersRouter(db));
    const payload = {
      mcpServers: {
        alpha: { command: "echo", args: ["mcp"] },
      },
    };
    const res = await app.handle(
      new Request("http://localhost/api/mcp-servers/import-json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: JSON.stringify(payload) }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; count: number; created: { name: string }[] };
    expect(body.ok).toBe(true);
    expect(body.count).toBe(1);
    expect(body.created[0]!.name).toBe("alpha");

    const list = await app.handle(new Request("http://localhost/api/mcp-servers"));
    expect(list.status).toBe(200);
    const rows = (await list.json()) as { name: string }[];
    expect(rows.some((r) => r.name === "alpha")).toBe(true);
  });

  it("imports array and rolls back on duplicate name", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const app = new Elysia().use(mcpServersRouter(db));
    const first = await app.handle(
      new Request("http://localhost/api/mcp-servers/import-json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          json: JSON.stringify([{ name: "dup", command: "a" }, { name: "dup", command: "b" }]),
        }),
      }),
    );
    expect(first.status).toBe(400);

    const second = await app.handle(
      new Request("http://localhost/api/mcp-servers/import-json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          json: JSON.stringify([
            { name: "one", command: "x" },
            { name: "two", command: "y" },
          ]),
        }),
      }),
    );
    expect(second.status).toBe(200);
    const body = (await second.json()) as { count: number };
    expect(body.count).toBe(2);
    const list = await app.handle(new Request("http://localhost/api/mcp-servers"));
    const rows = (await list.json()) as { name: string }[];
    expect(rows.length).toBe(2);
  });
});

describe("POST /api/tools/mcp-import-json", () => {
  it("imports MCP configs (same logic as /api/mcp-servers/import-json)", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const app = new Elysia().use(toolsRouter(CortexStoreServiceLive(db), db));
    const res = await app.handle(
      new Request("http://localhost/api/tools/mcp-import-json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          json: JSON.stringify({ mcpServers: { viaTools: { command: "true", args: [] } } }),
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; count: number };
    expect(body.ok).toBe(true);
    expect(body.count).toBe(1);
  });
});
