import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { Database } from "bun:sqlite";
import { applySchema } from "../db/schema.js";
import { mcpServersRouter } from "../api/mcp-servers.js";

describe("/api/mcp-servers", () => {
  it("creates, lists, and deletes an MCP server", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const app = new Elysia().use(mcpServersRouter(db));

    const post = await app.handle(
      new Request("http://localhost/api/mcp-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "test-fs",
          transport: "stdio",
          command: "echo",
          args: ["noop"],
        }),
      }),
    );
    expect(post.status).toBe(200);
    const created = (await post.json()) as { serverId: string };
    expect(created.serverId).toBeTruthy();

    const list = await app.handle(new Request("http://localhost/api/mcp-servers"));
    expect(list.status).toBe(200);
    const rows = (await list.json()) as Array<{ serverId: string; name: string }>;
    expect(rows.some((r) => r.serverId === created.serverId && r.name === "test-fs")).toBe(true);

    const del = await app.handle(
      new Request(`http://localhost/api/mcp-servers/${created.serverId}`, { method: "DELETE" }),
    );
    expect(del.status).toBe(200);

    const list2 = await app.handle(new Request("http://localhost/api/mcp-servers"));
    const rows2 = (await list2.json()) as Array<{ serverId: string }>;
    expect(rows2.some((r) => r.serverId === created.serverId)).toBe(false);
  });
});
