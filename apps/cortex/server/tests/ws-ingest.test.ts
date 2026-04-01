import { describe, it, expect, beforeEach } from "bun:test";
import { Layer } from "effect";
import { Database } from "bun:sqlite";
import { applySchema } from "../db/schema.js";
import { handleIngestMessage } from "../ws/ingest.js";
import { CortexIngestServiceLive } from "../services/ingest-service.js";
import { CortexEventBridgeLive } from "../services/event-bridge.js";

const makeLayer = (db: Database) =>
  CortexIngestServiceLive(db).pipe(Layer.provide(CortexEventBridgeLive));

describe("handleIngestMessage", () => {
  let db: Database;
  let layer: ReturnType<typeof makeLayer>;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    layer = makeLayer(db);
  });

  const rowCount = () =>
    (db.prepare("SELECT COUNT(*) as c FROM cortex_events").get() as { c: number }).c;

  it("ignores invalid JSON", async () => {
    handleIngestMessage(null, "not-json{{{", layer);
    await new Promise((r) => setTimeout(r, 20));
    expect(rowCount()).toBe(0);
  });

  it("ignores wrong protocol version", async () => {
    handleIngestMessage(
      null,
      JSON.stringify({ v: 2, agentId: "a", runId: "r", event: { _tag: "TaskCreated", taskId: "t" } }),
      layer,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(rowCount()).toBe(0);
  });

  it("ignores missing agentId", async () => {
    handleIngestMessage(
      null,
      JSON.stringify({ v: 1, runId: "r", event: { _tag: "TaskCreated", taskId: "t" } }),
      layer,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(rowCount()).toBe(0);
  });

  it("ignores missing event", async () => {
    handleIngestMessage(null, JSON.stringify({ v: 1, agentId: "a", runId: "r" }), layer);
    await new Promise((r) => setTimeout(r, 20));
    expect(rowCount()).toBe(0);
  });

  it("persists valid ingest message", async () => {
    handleIngestMessage(
      null,
      JSON.stringify({
        v: 1,
        agentId: "a1",
        runId: "r1",
        event: { _tag: "TaskCreated", taskId: "t1" },
      }),
      layer,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(rowCount()).toBe(1);
  });

  it("accepts Buffer body", async () => {
    const raw = Buffer.from(
      JSON.stringify({
        v: 1,
        agentId: "a2",
        runId: "r2",
        event: { _tag: "TaskCreated", taskId: "t2" },
      }),
      "utf8",
    );
    handleIngestMessage(null, raw, layer);
    await new Promise((r) => setTimeout(r, 50));
    const n = (db.prepare("SELECT COUNT(*) as c FROM cortex_events WHERE run_id = 'r2'").get() as { c: number })
      .c;
    expect(n).toBe(1);
  });

  it("accepts object body (already-decoded JSON)", async () => {
    handleIngestMessage(
      null,
      {
        v: 1,
        agentId: "a3",
        runId: "r3",
        event: { _tag: "TaskCreated", taskId: "t3" },
      },
      layer,
    );
    await new Promise((r) => setTimeout(r, 50));
    const n = (db.prepare("SELECT COUNT(*) as c FROM cortex_events WHERE run_id = 'r3'").get() as { c: number })
      .c;
    expect(n).toBe(1);
  });
});
