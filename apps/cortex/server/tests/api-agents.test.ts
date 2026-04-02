import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { Database } from "bun:sqlite";
import { Effect, Layer } from "effect";
import { applySchema } from "../db/schema.js";
import { createGatewayAgent, getGatewayAgent } from "../db/queries.js";
import { agentsRouter } from "../api/agents.js";
import { GatewayProcessManager } from "../services/gateway-process-manager.js";
import { CortexEventBridge, CortexEventBridgeLive } from "../services/event-bridge.js";
import { CortexIngestServiceLive } from "../services/ingest-service.js";

function makeGateway(db: Database): GatewayProcessManager {
  const bridgeService = Effect.runSync(CortexEventBridge.pipe(Effect.provide(CortexEventBridgeLive)));
  const bridgeLayer = Layer.succeed(CortexEventBridge, bridgeService);
  const ingestLayer = CortexIngestServiceLive(db).pipe(Layer.provide(bridgeLayer)) as Layer.Layer<any>;
  return new GatewayProcessManager(db, ingestLayer);
}

function makeApp(db: Database) {
  applySchema(db);
  const gateway = makeGateway(db);
  const app = new Elysia().use(agentsRouter(db, gateway));
  return { app, gateway };
}

describe("GET /api/agents", () => {
  it("returns empty array when no agents exist", async () => {
    const db = new Database(":memory:");
    const { app, gateway } = makeApp(db);

    const res = await app.handle(new Request("http://localhost/api/agents"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);

    gateway.destroy();
  });

  it("returns agents with processRunning field", async () => {
    const db = new Database(":memory:");
    const { app, gateway } = makeApp(db);

    createGatewayAgent(db, "ag-1", "Test Agent", JSON.stringify({ prompt: "Go" }), null);

    const res = await app.handle(new Request("http://localhost/api/agents"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ agentId: string; processRunning: boolean; type: "gateway" | "ad-hoc" }>;
    expect(body).toHaveLength(1);
    expect(body[0]?.agentId).toBe("ag-1");
    expect(typeof body[0]?.processRunning).toBe("boolean");
    expect(body[0]?.type).toBe("gateway");

    gateway.destroy();
  });
});

describe("GET /api/agents/:agentId", () => {
  it("returns 404 when agent does not exist", async () => {
    const db = new Database(":memory:");
    const { app, gateway } = makeApp(db);

    const res = await app.handle(new Request("http://localhost/api/agents/missing"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Not found");

    gateway.destroy();
  });

  it("returns agent detail when found", async () => {
    const db = new Database(":memory:");
    const { app, gateway } = makeApp(db);
    createGatewayAgent(db, "ag-detail", "Detail Agent", JSON.stringify({ prompt: "Go" }), "0 9 * * *");

    const res = await app.handle(new Request("http://localhost/api/agents/ag-detail"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agentId: string; name: string; schedule: string };
    expect(body.agentId).toBe("ag-detail");
    expect(body.name).toBe("Detail Agent");
    expect(body.schedule).toBe("0 9 * * *");

    gateway.destroy();
  });
});

describe("POST /api/agents", () => {
  it("creates a new agent and returns agentId", async () => {
    const db = new Database(":memory:");
    const { app, gateway } = makeApp(db);

    const res = await app.handle(
      new Request("http://localhost/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "New Agent",
          config: { prompt: "Do something", model: "claude-sonnet-4-6", provider: "anthropic" },
          schedule: "0 8 * * MON",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agentId: string; created: boolean };
    expect(body.created).toBe(true);
    expect(typeof body.agentId).toBe("string");
    expect(body.agentId.startsWith("gateway-")).toBe(true);

    gateway.destroy();
  });

  it("creates a process entry for the new agent", async () => {
    const db = new Database(":memory:");
    const { app, gateway } = makeApp(db);

    await app.handle(
      new Request("http://localhost/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Proc Agent", config: {}, schedule: null }),
      }),
    );

    // The gateway should have a process registered for the new agent
    expect(gateway.listProcesses()).toHaveLength(1);
    expect(gateway.listProcesses()[0]?.name).toBe("Proc Agent");

    gateway.destroy();
  });

  it("does not create a managed process for ad-hoc agents", async () => {
    const db = new Database(":memory:");
    const { app, gateway } = makeApp(db);

    await app.handle(
      new Request("http://localhost/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Adhoc Agent", type: "ad-hoc", config: {}, schedule: null }),
      }),
    );

    expect(gateway.listProcesses()).toHaveLength(0);
    gateway.destroy();
  });

  it("returns ad-hoc type for saved ad-hoc agents", async () => {
    const db = new Database(":memory:");
    const { app, gateway } = makeApp(db);

    await app.handle(
      new Request("http://localhost/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Adhoc Typed Agent", type: "ad-hoc", config: {}, schedule: null }),
      }),
    );

    const listRes = await app.handle(new Request("http://localhost/api/agents"));
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as Array<{ type: "gateway" | "ad-hoc"; name: string }>;
    const created = list.find((a) => a.name === "Adhoc Typed Agent");
    expect(created?.type).toBe("ad-hoc");

    gateway.destroy();
  });

  it("supports runNow at create time", async () => {
    const db = new Database(":memory:");
    const { app, gateway } = makeApp(db);

    const res = await app.handle(
      new Request("http://localhost/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "RunNow Agent",
          type: "ad-hoc",
          runNow: true,
          config: { prompt: "Do a quick run" },
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { created: boolean; runId?: string; agentId: string };
    expect(body.created).toBe(true);
    expect(typeof body.runId).toBe("string");
    expect(typeof body.agentId).toBe("string");

    gateway.destroy();
  });

  it("stores all config fields in DB", async () => {
    const db = new Database(":memory:");
    const { app, gateway } = makeApp(db);

    const config = {
      prompt: "Run analysis",
      model: "claude-sonnet-4-6",
      provider: "anthropic",
      maxIterations: 5,
      temperature: 0.5,
      strategy: "react",
      timeout: 60000,
    };

    const res = await app.handle(
      new Request("http://localhost/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Config Agent", config }),
      }),
    );
    const body = (await res.json()) as { agentId: string };

    const row = getGatewayAgent(db, body.agentId);
    expect(row).not.toBeNull();
    const storedConfig = JSON.parse(row!.config) as typeof config;
    expect(storedConfig.prompt).toBe("Run analysis");
    expect(storedConfig.maxIterations).toBe(5);
    expect(storedConfig.temperature).toBe(0.5);

    gateway.destroy();
  });
});

describe("PATCH /api/agents/:agentId", () => {
  it("updates agent name", async () => {
    const db = new Database(":memory:");
    const { app, gateway } = makeApp(db);
    createGatewayAgent(db, "patch-ag", "Old Name", "{}", null);

    await app.handle(
      new Request("http://localhost/api/agents/patch-ag", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Name" }),
      }),
    );

    const row = getGatewayAgent(db, "patch-ag");
    expect(row?.name).toBe("New Name");

    gateway.destroy();
  });

  it("pausing an agent stops its process", async () => {
    const db = new Database(":memory:");
    const { app, gateway } = makeApp(db);
    createGatewayAgent(db, "pause-ag", "Pause Me", "{}", null);
    gateway.startProcess("pause-ag", "Pause Me", null, {});
    expect(gateway.listProcesses()).toHaveLength(1);

    await app.handle(
      new Request("http://localhost/api/agents/pause-ag", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paused" }),
      }),
    );

    expect(gateway.listProcesses()).toHaveLength(0);

    gateway.destroy();
  });

  it("re-activating an agent restarts its process", async () => {
    const db = new Database(":memory:");
    const { app, gateway } = makeApp(db);
    createGatewayAgent(db, "reactivate-ag", "Restart Me", "{}", null);
    // Simulate paused state
    db.prepare("UPDATE cortex_agents SET status = 'paused' WHERE agent_id = ?").run("reactivate-ag");
    expect(gateway.listProcesses()).toHaveLength(0);

    await app.handle(
      new Request("http://localhost/api/agents/reactivate-ag", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      }),
    );

    expect(gateway.listProcesses()).toHaveLength(1);

    gateway.destroy();
  });
});

describe("DELETE /api/agents/:agentId", () => {
  it("deletes an existing agent", async () => {
    const db = new Database(":memory:");
    const { app, gateway } = makeApp(db);
    createGatewayAgent(db, "del-ag", "Delete Me", "{}", null);

    const res = await app.handle(
      new Request("http://localhost/api/agents/del-ag", { method: "DELETE" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: boolean };
    expect(body.deleted).toBe(true);
    expect(getGatewayAgent(db, "del-ag")).toBeNull();

    gateway.destroy();
  });

  it("returns 404 when agent does not exist", async () => {
    const db = new Database(":memory:");
    const { app, gateway } = makeApp(db);

    const res = await app.handle(
      new Request("http://localhost/api/agents/no-such-agent", { method: "DELETE" }),
    );
    expect(res.status).toBe(404);

    gateway.destroy();
  });

  it("removes the process entry on delete", async () => {
    const db = new Database(":memory:");
    const { app, gateway } = makeApp(db);
    createGatewayAgent(db, "proc-del", "Process Delete", "{}", null);
    gateway.startProcess("proc-del", "Process Delete", null, {});
    expect(gateway.listProcesses()).toHaveLength(1);

    await app.handle(
      new Request("http://localhost/api/agents/proc-del", { method: "DELETE" }),
    );

    expect(gateway.listProcesses()).toHaveLength(0);

    gateway.destroy();
  });
});

describe("POST /api/agents/:agentId/trigger", () => {
  it("returns 404 when agent not found in DB", async () => {
    const db = new Database(":memory:");
    const { app, gateway } = makeApp(db);

    const res = await app.handle(
      new Request("http://localhost/api/agents/missing-trigger/trigger", { method: "POST" }),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("not found in DB");

    gateway.destroy();
  });

  it("returns triggered result or build error (not DB not-found) when agent exists", async () => {
    const db = new Database(":memory:");
    const { app, gateway } = makeApp(db);
    createGatewayAgent(db, "trig-ag", "Trigger Agent", JSON.stringify({ prompt: "Go" }), null);

    const res = await app.handle(
      new Request("http://localhost/api/agents/trig-ag/trigger", { method: "POST" }),
    );
    const body = (await res.json()) as { error?: string; triggered?: boolean; runId?: string };

    // Either a successful trigger OR a build failure — but NOT a "not found in DB" error
    if (body.error) {
      expect(body.error).not.toContain("not found in DB");
    } else {
      expect(body.triggered).toBe(true);
      expect(typeof body.runId).toBe("string");
    }

    gateway.destroy();
  });
});
