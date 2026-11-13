// Run: bun run repo test apps/cortex/server/tests/channel-hub-reset.test.ts
//
// Owner `/new` in a route served by the hub clears that conversation's PERSISTED history:
//  - turns are saved in the agent's session store (`chat_sessions`, one row per session id; `:memory:` under the test provider)
//  - `/new` empties that row (the resolver's `RoutedSession.reset`), so a reopen starts empty
//  - the explicit delete is what REPORTS a store failure: `session.end()` swallows save errors, so without
//    it a broken store would still answer "Started a new conversation." (cutting the delete fails that test)
//  - `resetCommands` rides the route model: stored, patched, `[]` disables, bad values refused
//  - the activity feed folds `ChannelConversationReset` (ok / failed) with no text
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { Effect, Layer } from "effect";
import { MemoryDatabase, SessionStoreService } from "@reactive-agents/memory";
import { applySchema } from "../db/schema.js";
import { createGatewayAgent } from "../db/queries.js";
import { insertChannel, insertRoute, getRoute, routeToSpecInput } from "../db/channel-hub-queries.js";
import { ChannelHub } from "../services/channel-hub.js";
import type { HubAgent } from "../services/channel-hub-resolver.js";
import { HubActivityTracker } from "../services/channel-hub-activity.js";
import { clearPersistedHistory } from "../services/channel-hub-history.js";
import { gatewayConfigToBuildParams } from "../services/gateway-process-manager.js";
import { CortexEventBridge, CortexEventBridgeLive } from "../services/event-bridge.js";
import { CortexIngestServiceLive } from "../services/ingest-service.js";
import { channelHubRouter } from "../api/channel-hub.js";
import { scriptedChannel, until, type ScriptedChannel } from "./helpers/scripted-channel.js";

const CH = "ch-reset0001";
const OWNER_ID = "1";

let db: Database;
let hubs: ChannelHub[];
let agents: HubAgent[];
beforeEach(() => {
  db = new Database(":memory:");
  applySchema(db);
  hubs = [];
  agents = [];
});
afterEach(async () => {
  await Promise.all(hubs.map((h) => h.stop()));
});

const ingestLayer = (database: Database) => {
  const bridge = Effect.runSync(CortexEventBridge.pipe(Effect.provide(CortexEventBridgeLive)));
  return CortexIngestServiceLive(database).pipe(Layer.provide(Layer.succeed(CortexEventBridge, bridge))) as Layer.Layer<never>;
};

const savedAgent = () => ({
  provider: "test",
  model: "test-model",
  tools: ["file-read"],
  memory: { working: true, episodic: true },
  channels: [{ id: CH, kind: "telegram", label: "Support" }],
  gateway: { accessControl: { accessPolicy: "open", allowedSenders: [`telegram:${OWNER_ID}`] } },
});

const makeHub = (channel: ScriptedChannel) => {
  const hub = new ChannelHub({
    db,
    ingestLayer: ingestLayer(db) as never,
    toBuildParams: gatewayConfigToBuildParams,
    makeAdapters: () => ({ adapters: [channel.adapter], webhooks: [], skipped: [] }),
    prepare: (p) => ({ ...p, testScenario: [{ text: "hello from the agent" }] }),
    onAgent: (a) => agents.push(a),
  });
  hubs.push(hub);
  return hub;
};

const converse = async (ch: ScriptedChannel, userId: string, text: string, id: string) => {
  const before = ch.sent.length;
  await until(() => {
    ch.push(userId, text, id);
    return new Promise<number>((r) => setTimeout(() => r(ch.sent.length), 100));
  }, (n) => n > before, 80);
  return ch.sent[before];
};

/** The persisted message count of every chat session saved by the built agents (read from their session store). */
const persistedCounts = async (): Promise<number[]> => {
  const counts: number[] = [];
  for (const agent of agents) {
    const records = await agent.runtime.runPromise(
      Effect.gen(function* () {
        const store = yield* Effect.serviceOption(SessionStoreService);
        return store._tag === "Some" ? yield* store.value.listByAgent(agent.agentId, 50) : [];
      }),
    );
    for (const r of records) counts.push(r.messages.length);
  }
  return counts;
};

describe("owner /new clears the persisted conversation", () => {
  it("send turns, /new, reopen the same conversation: the history is empty", async () => {
    createGatewayAgent(db, "gateway-reset", "Bot", JSON.stringify(savedAgent()), null, "gateway");
    const ch = scriptedChannel(CH);
    const hub = makeHub(ch);
    await hub.start();

    expect((await converse(ch, OWNER_ID, "first", "m1"))?.text).toBe("hello from the agent");
    expect((await converse(ch, OWNER_ID, "second", "m2"))?.text).toBe("hello from the agent");
    // Two exchanges are stored (user + assistant each).
    expect(await persistedCounts()).toEqual([4]);

    const ack = await converse(ch, OWNER_ID, "/new", "m3");
    expect(ack?.text).toBe("Started a new conversation.");
    // After the reset the stored history is empty: a reopen loads nothing.
    expect(await persistedCounts()).toEqual([0]);

    // The reopened conversation starts from zero: one exchange is saved, not the old two plus one.
    expect((await converse(ch, OWNER_ID, "third", "m4"))?.text).toBe("hello from the agent");
    expect(await persistedCounts()).toEqual([2]);
  }, 60_000);

  it("when the store cannot be cleared the owner is told, not given a false fresh start (cutting the delete fails this)", async () => {
    createGatewayAgent(db, "gateway-reset", "Bot", JSON.stringify(savedAgent()), null, "gateway");
    const ch = scriptedChannel(CH);
    const hub = makeHub(ch);
    await hub.start();
    expect((await converse(ch, OWNER_ID, "first", "m1"))?.text).toBe("hello from the agent");
    // Break the store under the agent. `session.end()` swallows save errors, so only the explicit clear can report this.
    await agents[0]!.runtime.runPromise(
      Effect.gen(function* () {
        const memory = yield* MemoryDatabase;
        yield* memory.exec("DROP TABLE chat_sessions");
      }),
    );
    expect((await converse(ch, OWNER_ID, "/new", "m2"))?.text).toBe("Could not start a new conversation.");
    expect((await hub.status()).activity.some((a) => a.kind === "reset" && a.detail.startsWith("conversation reset failed"))).toBe(true);
  }, 60_000);

  it("the clear helper rejects when the store fails (a failing store is not a fresh start)", async () => {
    await expect(
      clearPersistedHistory(
        { agentId: "a", runtime: { runPromise: () => Promise.reject(new Error("store down")) } as never },
        "r:owner:1",
      ),
    ).rejects.toThrow("store down");
  });
});

describe("resetCommands on the route", () => {
  const seed = () => {
    createGatewayAgent(db, "gateway-reset", "Bot", JSON.stringify(savedAgent()), null, "gateway");
    insertChannel(db, { id: CH, platform: "telegram", settings: {} });
    insertRoute(db, { id: "r1", match: { channelId: CH }, target: { agentId: "gateway-reset" }, owners: ["telegram:1"] });
  };
  const api = (hub: ChannelHub) => channelHubRouter(db, hub, null);
  const patch = (hub: ChannelHub, route: Record<string, unknown>) =>
    api(hub).handle(
      new Request("http://localhost/api/channels/routes/r1", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ route }) }),
    );

  it("is stored, survives other edits, `[]` disables, null returns to the framework default", async () => {
    seed();
    const hub = makeHub(scriptedChannel(CH));
    expect((await patch(hub, { resetCommands: ["/fresh"] })).status).toBe(200);
    expect(routeToSpecInput(getRoute(db, "r1")!).resetCommands).toEqual(["/fresh"]);
    expect((await patch(hub, { deniedReply: "No." })).status).toBe(200);
    expect(routeToSpecInput(getRoute(db, "r1")!).resetCommands).toEqual(["/fresh"]);
    expect((await patch(hub, { resetCommands: [] })).status).toBe(200);
    expect(routeToSpecInput(getRoute(db, "r1")!).resetCommands).toEqual([]);
    expect((await patch(hub, { resetCommands: null })).status).toBe(200);
    expect(routeToSpecInput(getRoute(db, "r1")!).resetCommands).toBeUndefined();
  });

  it("refuses a command the framework refuses", async () => {
    seed();
    const hub = makeHub(scriptedChannel(CH));
    const res = await patch(hub, { resetCommands: ["new"] });
    expect(res.status).toBe(400);
    expect(getRoute(db, "r1")!.body.resetCommands).toBeUndefined();
  });

  it("a custom command resets, and the default `/new` no longer does", async () => {
    createGatewayAgent(db, "gateway-reset", "Bot", JSON.stringify(savedAgent()), null, "gateway");
    insertChannel(db, { id: CH, platform: "telegram", settings: {} });
    insertRoute(db, { id: "r1", match: { channelId: CH }, target: { agentId: "gateway-reset" }, owners: ["telegram:1"], resetCommands: ["/fresh"] });
    const ch = scriptedChannel(CH);
    const hub = makeHub(ch);
    await hub.start();
    expect((await converse(ch, OWNER_ID, "/fresh", "f1"))?.text).toBe("Started a new conversation.");
    expect((await converse(ch, OWNER_ID, "/new", "f2"))?.text).toBe("hello from the agent");
  }, 60_000);
});

describe("activity feed", () => {
  it("folds ChannelConversationReset ok and failed, without text", () => {
    const t = new HubActivityTracker(() => 1);
    t.observe({ _tag: "ChannelConversationReset", routeId: "r", role: "owner", ok: true, simulated: false });
    t.observe({ _tag: "ChannelConversationReset", routeId: "r", role: "owner", ok: false, reason: "turn_failed", simulated: false });
    expect(t.snapshot().map((a) => [a.kind, a.detail])).toEqual([
      ["reset", "conversation reset failed (owner): turn_failed"],
      ["reset", "conversation reset (owner)"],
    ]);
    expect(t.countersOf("r").failed).toBe(0);
  });
});
