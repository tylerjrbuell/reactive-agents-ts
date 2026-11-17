// Run: bun run repo test apps/cortex/server/tests/channel-hub-restart.test.ts
//
// The hub's numbers survive a restart (owner report 2026-11-17: the Channels tab showed the durable inbox
// after a restart while Gateway showed 0 for everything):
//  - a hub on a file db answers two messages; a NEW hub on the same file reports the same channel
//    received/sent counts and last times (read from the framework's durable inbox and outbox), the same
//    route counters and the same activity feed (the Cortex-side log)
//  - removing the seeding (`HubActivityTracker` store) or the durable read fails the first test
//  - a `:memory:` db has nothing to recover and says so: `countsFrom` / `activityFrom` read "restart"
//  - `HubActivityStore` round trip and bound: newest rows kept, route counters add up
import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { Effect, Layer } from "effect";
import { applySchema } from "../db/schema.js";
import { insertChannel, insertRoute } from "../db/channel-hub-queries.js";
import { HUB_ACTIVITY_KEEP, makeHubActivityStore } from "../db/hub-activity-queries.js";
import { createGatewayAgent } from "../db/queries.js";
import { ChannelHub, type HubStatus } from "../services/channel-hub.js";
import { gatewayConfigToBuildParams } from "../services/gateway-process-manager.js";
import { CortexEventBridge, CortexEventBridgeLive } from "../services/event-bridge.js";
import { CortexIngestServiceLive } from "../services/ingest-service.js";
import { rmDbFiles, tmpDbPath } from "./helpers/tmp-db.js";
import { scriptedChannel, until, type ScriptedChannel } from "./helpers/scripted-channel.js";

const CH = "ch-restart01";
const OWNER = "telegram:1";
const dbs: string[] = [];
const hubs: ChannelHub[] = [];
const handles: Database[] = [];

afterEach(async () => {
  await Promise.all(hubs.splice(0).map((h) => h.stop()));
  for (const h of handles.splice(0)) h.close();
  for (const p of dbs.splice(0)) rmDbFiles(p);
});

const ingestLayer = (database: Database) => {
  const bridge = Effect.runSync(CortexEventBridge.pipe(Effect.provide(CortexEventBridgeLive)));
  return CortexIngestServiceLive(database).pipe(Layer.provide(Layer.succeed(CortexEventBridge, bridge))) as Layer.Layer<never>;
};

const hubOn = (path: string, ch: ScriptedChannel) => {
  const db = new Database(path);
  handles.push(db);
  applySchema(db);
  if (!db.prepare("SELECT 1 FROM cortex_channels WHERE id = ?").get(CH)) {
    createGatewayAgent(db, "gateway-1", "Bot", JSON.stringify({ provider: "test", model: "test-model", tools: ["file-read"] }), null, "gateway");
    insertChannel(db, { id: CH, platform: "telegram", settings: {} });
    insertRoute(db, { id: "r1", match: { channelId: CH }, target: { agentId: "gateway-1" }, owners: [OWNER] });
  }
  const hub = new ChannelHub({
    db,
    ingestLayer: ingestLayer(db) as never,
    toBuildParams: gatewayConfigToBuildParams,
    makeAdapters: () => ({ adapters: [ch.adapter], webhooks: [], skipped: [] }),
    prepare: (p) => ({ ...p, testScenario: [{ text: "hello from the agent" }] }),
  });
  hubs.push(hub);
  return hub;
};

/** Same message id on every retry, so the turn runs once. */
const converse = async (ch: ScriptedChannel, text: string, id: string) => {
  const before = ch.sent.length;
  await until(() => {
    ch.push("1", text, id);
    return new Promise<number>((r) => setTimeout(() => r(ch.sent.length), 100));
  }, (n) => n > before, 80);
};

const traffic = (s: HubStatus) => ({
  channel: s.channels.map((c) => ({ id: c.id, received: c.received, sent: c.sent, failed: c.failed, lastInboundAt: c.lastInboundAt, lastSentAt: c.lastSentAt, countsFrom: c.countsFrom })),
  counters: s.routes.map((r) => ({ id: r.id, ...r.counters })),
  activity: s.activity,
});

describe("hub numbers survive a restart", () => {
  it("a new hub on the same file reports the same counts, last times, route counters and feed", async () => {
    const path = tmpDbPath("hub-restart");
    dbs.push(path);
    const ch = scriptedChannel(CH);
    const a = hubOn(path, ch);
    await a.start();
    await converse(ch, "hi", "m1");
    await converse(ch, "again", "m2");
    const before = await until(
      () => a.status(),
      (s) => s.routes[0]?.counters.answered === 2 && s.channels[0]?.sent === 2,
      80,
    );
    expect(before.channels[0]).toMatchObject({ received: 2, sent: 2, countsFrom: "stored" });
    expect(before.channels[0]?.lastInboundAt).not.toBeNull();
    expect(before.channels[0]?.lastSentAt).not.toBeNull();
    const wanted = traffic(before);
    await a.stop();

    // A brand new hub, a brand new db handle and adapter: nothing in memory survives, only the file.
    const b = hubOn(path, scriptedChannel(CH));
    await b.start();
    const after = await b.status();
    expect(after.phase).toBe("running");
    expect(after.activityFrom).toBe("stored");
    expect(traffic(after)).toEqual(wanted);
    expect(after.routes[0]?.counters).toMatchObject({ matched: 2, answered: 2 });
    expect(after.activity.length).toBeGreaterThan(0);
  }, 90_000);

  it("a :memory: db has nothing to recover: counts are labelled since restart", async () => {
    const db = new Database(":memory:");
    handles.push(db);
    applySchema(db);
    insertChannel(db, { id: CH, platform: "telegram", settings: {} });
    insertRoute(db, { id: "r1", match: { channelId: CH }, target: { agentId: "gateway-1" }, owners: [OWNER] });
    const hub = new ChannelHub({
      db,
      ingestLayer: ingestLayer(db) as never,
      toBuildParams: gatewayConfigToBuildParams,
      makeAdapters: () => ({ adapters: [scriptedChannel(CH).adapter], webhooks: [], skipped: [] }),
    });
    hubs.push(hub);
    await hub.start();
    const s = await hub.status();
    expect(s.activityFrom).toBe("restart");
    expect(s.channels[0]?.countsFrom).toBe("restart");
  });
});

describe("HubActivityStore", () => {
  it("keeps the newest rows, oldest first on load, and adds counters per route", () => {
    const db = new Database(":memory:");
    handles.push(db);
    applySchema(db);
    const store = makeHubActivityStore(db);
    for (let i = 0; i < HUB_ACTIVITY_KEEP + 10; i++) store.append({ at: i, kind: "matched", routeId: "r1", detail: `d${i}`, simulated: false });
    const feed = store.loadFeed(5);
    expect(feed.map((a) => a.at)).toEqual([HUB_ACTIVITY_KEEP + 5, HUB_ACTIVITY_KEEP + 6, HUB_ACTIVITY_KEEP + 7, HUB_ACTIVITY_KEEP + 8, HUB_ACTIVITY_KEEP + 9]);
    expect((db.prepare("SELECT COUNT(*) AS n FROM cortex_hub_activity").get() as { n: number }).n).toBe(HUB_ACTIVITY_KEEP);
    const zero = { matched: 0, denied: 0, answered: 0, failed: 0, dropped: 0, costUsd: 0 };
    store.bump("r1", { ...zero, matched: 1 });
    store.bump("r1", { ...zero, answered: 1, costUsd: 0.5 });
    expect(store.loadCounters().get("r1")).toEqual({ matched: 1, denied: 0, answered: 1, failed: 0, dropped: 0, costUsd: 0.5 });
  });
});
