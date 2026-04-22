import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { Database } from "bun:sqlite";
import { applySchema } from "../db/schema.js";
import { mcpServersRouter } from "../api/mcp-servers.js";

function makeApp() {
  const db = new Database(":memory:");
  applySchema(db);
  return { db, app: new Elysia().use(mcpServersRouter(db)) };
}

async function post(app: { handle: (req: Request) => Promise<Response> }, path: string, body: unknown) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function patch(app: { handle: (req: Request) => Promise<Response> }, path: string, body: unknown) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("/api/mcp-servers — CRUD", () => {
  it("creates, lists, and deletes a stdio server", async () => {
    const { app } = makeApp();

    const res = await post(app, "/api/mcp-servers", {
      name: "test-fs",
      transport: "stdio",
      command: "echo",
      args: ["noop"],
    });
    expect(res.status).toBe(200);
    const { serverId } = (await res.json()) as { serverId: string };
    expect(serverId).toBeTruthy();

    const list = await app.handle(new Request("http://localhost/api/mcp-servers"));
    const rows = (await list.json()) as Array<{ serverId: string; name: string }>;
    expect(rows.some((r) => r.serverId === serverId && r.name === "test-fs")).toBe(true);

    const del = await app.handle(
      new Request(`http://localhost/api/mcp-servers/${serverId}`, { method: "DELETE" }),
    );
    expect(del.status).toBe(200);

    const list2 = await app.handle(new Request("http://localhost/api/mcp-servers"));
    const rows2 = (await list2.json()) as Array<{ serverId: string }>;
    expect(rows2.some((r) => r.serverId === serverId)).toBe(false);
  });

  it("infers stdio transport from docker command (no explicit transport)", async () => {
    const { app } = makeApp();
    const res = await post(app, "/api/mcp-servers", {
      name: "context7",
      command: "docker",
      args: ["run", "-i", "--rm", "mcp/context7"],
    });
    expect(res.status).toBe(200);
    const { serverId } = (await res.json()) as { serverId: string };

    const list = await app.handle(new Request("http://localhost/api/mcp-servers"));
    const rows = (await list.json()) as Array<{ serverId: string; config: { transport: string; command: string; args: string[] } }>;
    const row = rows.find((r) => r.serverId === serverId);
    expect(row?.config.transport).toBe("stdio");
    expect(row?.config.command).toBe("docker");
    expect(row?.config.args).toEqual(["run", "-i", "--rm", "mcp/context7"]);
  });

  it("infers streamable-http from /mcp endpoint", async () => {
    const { app } = makeApp();
    const res = await post(app, "/api/mcp-servers", {
      name: "remote-mcp",
      url: "http://api.example.com/mcp",
    });
    expect(res.status).toBe(200);
    const { serverId } = (await res.json()) as { serverId: string };

    const list = await app.handle(new Request("http://localhost/api/mcp-servers"));
    const rows = (await list.json()) as Array<{ serverId: string; config: { transport: string } }>;
    const row = rows.find((r) => r.serverId === serverId);
    expect(row?.config.transport).toBe("streamable-http");
  });

  it("returns 400 for invalid config (no name)", async () => {
    const { app } = makeApp();
    const res = await post(app, "/api/mcp-servers", { command: "docker" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for config with no command or endpoint", async () => {
    const { app } = makeApp();
    const res = await post(app, "/api/mcp-servers", { name: "empty" });
    expect(res.status).toBe(400);
  });
});

describe("/api/mcp-servers — PATCH", () => {
  it("updates an existing server", async () => {
    const { app } = makeApp();
    const res = await post(app, "/api/mcp-servers", {
      name: "to-update",
      command: "npx",
      args: ["-y", "old-mcp"],
    });
    const { serverId } = (await res.json()) as { serverId: string };

    const patchRes = await patch(app, `/api/mcp-servers/${serverId}`, {
      name: "to-update",
      command: "npx",
      args: ["-y", "new-mcp"],
    });
    expect(patchRes.status).toBe(200);

    const list = await app.handle(new Request("http://localhost/api/mcp-servers"));
    const rows = (await list.json()) as Array<{ serverId: string; config: { args: string[] } }>;
    const row = rows.find((r) => r.serverId === serverId);
    expect(row?.config.args).toEqual(["-y", "new-mcp"]);
  });

  it("returns 404 for non-existent server", async () => {
    const { app } = makeApp();
    const res = await patch(app, "/api/mcp-servers/does-not-exist", {
      name: "ghost",
      command: "echo",
    });
    expect(res.status).toBe(404);
  });
});

describe("/api/mcp-servers — DELETE", () => {
  it("returns 404 for non-existent server", async () => {
    const { app } = makeApp();
    const res = await app.handle(
      new Request("http://localhost/api/mcp-servers/no-such-id", { method: "DELETE" }),
    );
    expect(res.status).toBe(404);
  });
});

describe("/api/mcp-servers — import-json", () => {
  it("imports Cursor-style mcpServers JSON", async () => {
    const { app } = makeApp();
    const json = JSON.stringify({
      mcpServers: {
        "context7": { command: "docker", args: ["run", "-i", "--rm", "mcp/context7"] },
        "remote": { endpoint: "http://api.example.com/mcp" },
      },
    });
    const res = await post(app, "/api/mcp-servers/import-json", { json });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; count: number };
    expect(body.ok).toBe(true);
    expect(body.count).toBe(2);

    const list = await app.handle(new Request("http://localhost/api/mcp-servers"));
    const rows = (await list.json()) as Array<{ name: string }>;
    expect(rows.some((r) => r.name === "context7")).toBe(true);
    expect(rows.some((r) => r.name === "remote")).toBe(true);
  });

  it("returns 400 for invalid JSON string", async () => {
    const { app } = makeApp();
    const res = await post(app, "/api/mcp-servers/import-json", { json: "not valid json {{" });
    expect(res.status).toBe(400);
  });
});
