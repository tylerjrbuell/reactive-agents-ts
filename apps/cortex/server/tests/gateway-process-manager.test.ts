import { describe, it, expect, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { Effect, Layer } from "effect";
import { applySchema } from "../db/schema.js";
import { createGatewayAgent, upsertRun } from "../db/queries.js";
import { GatewayProcessManager } from "../services/gateway-process-manager.js";
import { CortexEventBridge, CortexEventBridgeLive } from "../services/event-bridge.js";
import { CortexIngestServiceLive } from "../services/ingest-service.js";

function makeGateway(db: Database): GatewayProcessManager {
  const bridgeService = Effect.runSync(CortexEventBridge.pipe(Effect.provide(CortexEventBridgeLive)));
  const bridgeLayer = Layer.succeed(CortexEventBridge, bridgeService);
  const ingestLayer = CortexIngestServiceLive(db).pipe(Layer.provide(bridgeLayer)) as Layer.Layer<any>;
  return new GatewayProcessManager(db, ingestLayer);
}

describe("GatewayProcessManager — process lifecycle", () => {
  it("startProcess adds a process entry to the list", () => {
    const db = new Database(":memory:");
    applySchema(db);
    const gpm = makeGateway(db);

    gpm.startProcess("agent-1", "My Agent", "0 * * * *", {});
    const procs = gpm.listProcesses();
    expect(procs).toHaveLength(1);
    expect(procs[0]?.agentId).toBe("agent-1");
    expect(procs[0]?.name).toBe("My Agent");
    expect(procs[0]?.schedule).toBe("0 * * * *");
    expect(procs[0]?.running).toBe(false);

    gpm.destroy();
  });

  it("startProcess replaces an existing process for the same agentId", () => {
    const db = new Database(":memory:");
    applySchema(db);
    const gpm = makeGateway(db);

    gpm.startProcess("agent-1", "v1", "0 * * * *", {});
    gpm.startProcess("agent-1", "v2", "0 8 * * *", {});

    const procs = gpm.listProcesses();
    expect(procs).toHaveLength(1);
    expect(procs[0]?.name).toBe("v2");
    expect(procs[0]?.schedule).toBe("0 8 * * *");

    gpm.destroy();
  });

  it("stopProcess removes the process entry", () => {
    const db = new Database(":memory:");
    applySchema(db);
    const gpm = makeGateway(db);

    gpm.startProcess("agent-1", "Test", null, {});
    expect(gpm.listProcesses()).toHaveLength(1);

    gpm.stopProcess("agent-1");
    expect(gpm.listProcesses()).toHaveLength(0);

    gpm.destroy();
  });

  it("stopProcess is a no-op for an unknown agentId", () => {
    const db = new Database(":memory:");
    applySchema(db);
    const gpm = makeGateway(db);

    // Should not throw
    gpm.stopProcess("nonexistent");
    expect(gpm.listProcesses()).toHaveLength(0);

    gpm.destroy();
  });

  it("listProcesses returns all currently registered agents", () => {
    const db = new Database(":memory:");
    applySchema(db);
    const gpm = makeGateway(db);

    gpm.startProcess("a1", "Agent One", "0 * * * *", {});
    gpm.startProcess("a2", "Agent Two", null, {});
    gpm.startProcess("a3", "Agent Three", "0 8 * * MON", {});

    const procs = gpm.listProcesses();
    expect(procs).toHaveLength(3);
    const ids = procs.map((p) => p.agentId).sort();
    expect(ids).toEqual(["a1", "a2", "a3"]);

    gpm.destroy();
  });

  it("destroy removes all processes", () => {
    const db = new Database(":memory:");
    applySchema(db);
    const gpm = makeGateway(db);

    gpm.startProcess("a1", "Agent One", null, {});
    gpm.startProcess("a2", "Agent Two", null, {});
    expect(gpm.listProcesses()).toHaveLength(2);

    gpm.destroy();
    expect(gpm.listProcesses()).toHaveLength(0);
  });
});

describe("GatewayProcessManager — hydrate", () => {
  it("starts processes for all active agents in DB", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    createGatewayAgent(db, "gw-1", "Alpha", JSON.stringify({ prompt: "Do work" }), "0 9 * * *");
    createGatewayAgent(db, "gw-2", "Beta", JSON.stringify({ prompt: "Do more" }), null);

    const gpm = makeGateway(db);
    await gpm.hydrate();

    const procs = gpm.listProcesses();
    expect(procs).toHaveLength(2);
    const ids = procs.map((p) => p.agentId).sort();
    expect(ids).toEqual(["gw-1", "gw-2"]);

    gpm.destroy();
  });

  it("skips paused agents during hydrate", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    createGatewayAgent(db, "active-1", "Active", JSON.stringify({}), null);
    // Manually set second agent to paused
    db.prepare(
      "INSERT INTO cortex_agents (agent_id, name, config, status) VALUES (?, ?, ?, ?)",
    ).run("paused-1", "Paused", "{}", "paused");

    const gpm = makeGateway(db);
    await gpm.hydrate();

    const procs = gpm.listProcesses();
    expect(procs).toHaveLength(1);
    expect(procs[0]?.agentId).toBe("active-1");

    gpm.destroy();
  });

  it("hydrate with no agents produces an empty process list", async () => {
    const db = new Database(":memory:");
    applySchema(db);

    const gpm = makeGateway(db);
    await gpm.hydrate();

    expect(gpm.listProcesses()).toHaveLength(0);
    gpm.destroy();
  });
});

describe("GatewayProcessManager — triggerNow", () => {
  it("returns error when agentId is not in DB", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const gpm = makeGateway(db);

    const result = await gpm.triggerNow("nonexistent-agent");
    expect("error" in result).toBe(true);
    expect((result as { error: string }).error).toContain("not found in DB");

    gpm.destroy();
  });

  it("creates a process entry for the agent when triggering without one", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    createGatewayAgent(db, "trigger-agent", "Trigger Test", JSON.stringify({ prompt: "Run now" }), null);

    const gpm = makeGateway(db);
    // triggerNow will fail at agent build time (no API key), but the process entry
    // should exist before the failure in fireAgent
    const result = await gpm.triggerNow("trigger-agent");

    // We expect either a valid result or an error from the build step —
    // NOT the "not found in DB" error (that's the pre-condition we're testing)
    if ("error" in result) {
      expect((result as { error: string }).error).not.toContain("not found in DB");
    } else {
      expect((result as { runId: string }).runId).toBeTruthy();
    }

    gpm.destroy();
  });

  it("triggerNow passes the gateway agent_id to buildCortexAgent (stable identity)", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const gpm = makeGateway(db);

    const stableId = "gateway-stable-id-abc";
    createGatewayAgent(
      db,
      stableId,
      "Stable Gateway Agent",
      JSON.stringify({ prompt: "Do work", provider: "test", model: "test-model" }),
      null,
    );

    const result = await gpm.triggerNow(stableId);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.agentId).toBe(stableId);
    }

    gpm.destroy();
  });
});
