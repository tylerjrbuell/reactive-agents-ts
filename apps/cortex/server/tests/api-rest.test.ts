import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { Database } from "bun:sqlite";
import { applySchema } from "../db/schema.js";
import { CortexStoreServiceLive } from "../services/store-service.js";
import { agentsRouter } from "../api/agents.js";
import { toolsRouter } from "../api/tools.js";
import { skillsRouter } from "../api/skills.js";
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
