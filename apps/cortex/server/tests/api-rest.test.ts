import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { Database } from "bun:sqlite";
import { applySchema } from "../db/schema.js";
import { CortexStoreServiceLive } from "../services/store-service.js";
import { agentsRouter } from "../api/agents.js";
import { toolsRouter } from "../api/tools.js";
import { skillsRouter } from "../api/skills.js";

describe("GET /api/agents", () => {
  it("returns empty array (gateway stub)", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const app = new Elysia().use(agentsRouter(db));
    const res = await app.handle(new Request("http://localhost/api/agents"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe("GET /api/tools", () => {
  it("returns JSON array", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const app = new Elysia().use(toolsRouter(CortexStoreServiceLive(db)));
    const res = await app.handle(new Request("http://localhost/api/tools"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe("GET /api/skills", () => {
  it("returns JSON array", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const app = new Elysia().use(skillsRouter(CortexStoreServiceLive(db)));
    const res = await app.handle(new Request("http://localhost/api/skills"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
