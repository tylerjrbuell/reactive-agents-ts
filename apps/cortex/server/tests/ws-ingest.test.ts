import { describe, it, expect, beforeEach } from "bun:test";
import { Layer } from "effect";
import { Database } from "bun:sqlite";
import { applySchema } from "../db/schema.js";
import { handleIngestMessage } from "../ws/ingest.js";
import { CortexIngestServiceLive } from "../services/ingest-service.js";
import { CortexEventBridgeLive } from "../services/event-bridge.js";

const makeLayer = (db: Database) =>
  CortexIngestServiceLive(db).pipe(Layer.provide(CortexEventBridgeLive));

// HS-27 (GH #83): replace fixed-delay sleeps with predicate polling.
async function waitForRows(
  getCount: () => number,
  target: number,
  timeoutMs = 2000,
): Promise<number> {
  const start = Date.now();
  let last = getCount();
  while (Date.now() - start < timeoutMs) {
    last = getCount();
    if (last >= target) return last;
    await new Promise((r) => setTimeout(r, 2));
  }
  return last;
}

// For invalid-payload tests we want to assert rowCount stays at 0. The
// handleIngestMessage path for invalid input returns synchronously (no
// Effect.runFork), so a single microtask flush is enough — no fixed wait.
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

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
    await flushMicrotasks();
    expect(rowCount()).toBe(0);
  });

  it("ignores wrong protocol version", async () => {
    handleIngestMessage(
      null,
      JSON.stringify({ v: 2, agentId: "a", runId: "r", event: { _tag: "TaskCreated", taskId: "t" } }),
      layer,
    );
    await flushMicrotasks();
    expect(rowCount()).toBe(0);
  });

  it("ignores missing agentId", async () => {
    handleIngestMessage(
      null,
      JSON.stringify({ v: 1, runId: "r", event: { _tag: "TaskCreated", taskId: "t" } }),
      layer,
    );
    await flushMicrotasks();
    expect(rowCount()).toBe(0);
  });

  it("ignores missing event", async () => {
    handleIngestMessage(null, JSON.stringify({ v: 1, agentId: "a", runId: "r" }), layer);
    await flushMicrotasks();
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
    await waitForRows(rowCount, 1);
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
    const readR2 = () =>
      (db.prepare("SELECT COUNT(*) as c FROM cortex_events WHERE run_id = 'r2'").get() as { c: number }).c;
    await waitForRows(readR2, 1);
    expect(readR2()).toBe(1);
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
    const readR3 = () =>
      (db.prepare("SELECT COUNT(*) as c FROM cortex_events WHERE run_id = 'r3'").get() as { c: number }).c;
    await waitForRows(readR3, 1);
    expect(readR3()).toBe(1);
  });
});
