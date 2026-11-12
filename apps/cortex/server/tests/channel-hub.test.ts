// Run: bun run repo test apps/cortex/server/tests/channel-hub.test.ts
//
// The hub end to end with scripted adapters (no network) and the scripted test LLM:
//  - an inbound message is routed to a saved gateway agent and the reply is delivered
//  - the owner's agent has the full tools and memory; a non-owner's is built read-only with no memory
//  - one bot token is never polled by two hosts (the legacy host skips what the hub owns)
//  - a second process on the same account fails closed; a replayed message id is deduped across a restart
//  - CORTEX_CHANNEL_HUB=off hands everything back (nothing migrated, nothing owned)
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { Effect, Layer } from "effect";
import type { AgentConfig } from "@reactive-agents/runtime";
import { applySchema } from "../db/schema.js";
import { createGatewayAgent } from "../db/queries.js";
import { ChannelHub } from "../services/channel-hub.js";
import { makeDbLeases } from "../services/channel-hub-store.js";
import { GatewayChannelHost } from "../services/gateway-channel-host.js";
import { gatewayConfigToBuildParams } from "../services/gateway-process-manager.js";
import { CortexEventBridge, CortexEventBridgeLive } from "../services/event-bridge.js";
import { CortexIngestServiceLive } from "../services/ingest-service.js";
import { scriptedChannel, until, type ScriptedChannel } from "./helpers/scripted-channel.js";

const CH = "ch-aaaa1111";
const OWNER = "telegram:1";

const agentConfig = (extra: Record<string, unknown> = {}) => ({
  provider: "test",
  model: "test-model",
  tools: ["file-read", "file-write"],
  memory: { working: true, episodic: true },
  channels: [{ id: CH, kind: "telegram", label: "Support" }],
  gateway: { accessControl: { accessPolicy: "open", allowedSenders: [OWNER] } },
  ...extra,
});

let db: Database;
let hubs: ChannelHub[];
let hosts: GatewayChannelHost[];

const ingestLayer = (database: Database) => {
  const bridge = Effect.runSync(CortexEventBridge.pipe(Effect.provide(CortexEventBridgeLive)));
  return CortexIngestServiceLive(database).pipe(Layer.provide(Layer.succeed(CortexEventBridge, bridge))) as Layer.Layer<never>;
};

beforeEach(() => {
  db = new Database(":memory:");
  applySchema(db);
  hubs = [];
  hosts = [];
});
afterEach(async () => {
  await Promise.all([...hubs.map((h) => h.stop()), ...hosts.map((h) => h.destroy())]);
});

const makeHub = (channel: ScriptedChannel, extra: Partial<ConstructorParameters<typeof ChannelHub>[0]> = {}) => {
  const built: { role: string; config: AgentConfig }[] = [];
  const hub = new ChannelHub({
    db,
    ingestLayer: ingestLayer(db) as never,
    toBuildParams: gatewayConfigToBuildParams,
    makeAdapters: () => ({ adapters: [channel.adapter], webhooks: [], skipped: [] }),
    prepare: (p) => ({ ...p, testScenario: [{ text: "hello from the agent" }] }),
    onBuilt: (i) => built.push({ role: i.role, config: i.config }),
    ...extra,
  });
  hubs.push(hub);
  return { hub, built };
};

/** Push `text` (same id, so a retry never runs a second turn) until the reply lands. */
const converse = async (ch: ScriptedChannel, userId: string, text: string, id: string) => {
  const before = ch.sent.length;
  await until(() => {
    ch.push(userId, text, id);
    return new Promise<number>((r) => setTimeout(() => r(ch.sent.length), 100));
  }, (n) => n > before, 80);
  return ch.sent[before];
};

describe("routing a message to a saved gateway agent", () => {
  it("delivers the reply; the owner gets full tools and memory, a stranger a read-only build with no memory", async () => {
    createGatewayAgent(db, "gateway-1", "Bot", JSON.stringify(agentConfig()), null, "gateway");
    const ch = scriptedChannel(CH);
    const { hub, built } = makeHub(ch);
    await hub.start();
    expect((await hub.status()).phase).toBe("running");

    const ownerReply = await converse(ch, "1", "hi from me", "o1");
    expect(ownerReply?.text).toBe("hello from the agent");
    expect(ownerReply?.conversation.channelId).toBe("1");
    const strangerReply = await converse(ch, "2", "hi from a stranger", "s1");
    expect(strangerReply?.text).toBe("hello from the agent");

    const owner = built.find((b) => b.role === "owner")!;
    const sender = built.find((b) => b.role === "sender")!;
    expect(owner.config.tools?.allowedTools).toContain("file-write");
    expect(owner.config.memory).toBeDefined();
    expect(sender.config.tools?.allowedTools).toContain("file-read");
    expect(sender.config.tools?.allowedTools).not.toContain("file-write");
    expect(sender.config.memory).toBeUndefined();

    const status = await hub.status();
    expect(status.channels[0]).toMatchObject({ id: CH, state: "connected" });
    expect(status.channels[0]?.received).toBeGreaterThanOrEqual(2);
    expect(status.routes[0]?.counters.answered).toBe(2);
    expect(status.routes[0]?.roleNote).toContain("1 owner(s) run the agent's full tools");
    expect(status.durableStore).toBe(true);
  }, 60_000);

  it("a non-gateway (ad-hoc) saved agent is reachable through a hub route", async () => {
    createGatewayAgent(db, "adhoc-1", "Adhoc", JSON.stringify(agentConfig({ channels: [] })), null, "ad-hoc");
    db.prepare("INSERT INTO cortex_channels (id, platform, label, settings_json) VALUES (?, 'telegram', 'Hub', '{}')").run(CH);
    db.prepare("INSERT INTO cortex_routes (id, channel_id, target_id, spec_json) VALUES ('r1', ?, 'adhoc-1', ?)").run(CH, JSON.stringify({ owners: [OWNER] }));
    const ch = scriptedChannel(CH);
    const { hub } = makeHub(ch);
    await hub.start();
    expect((await converse(ch, "1", "hello", "a1"))?.text).toBe("hello from the agent");
  }, 60_000);
});

describe("one poller per bot token", () => {
  it("the legacy host skips a channel the hub owns (removing the guard makes the account open twice)", async () => {
    const opens = { n: 0 };
    createGatewayAgent(db, "gateway-1", "Bot", JSON.stringify(agentConfig()), null, "gateway");
    const { hub } = makeHub(scriptedChannel(CH, "telegram:tok", opens));
    const legacy = new GatewayChannelHost(
      db,
      ingestLayer(db) as never,
      gatewayConfigToBuildParams,
      () => ({ adapters: [scriptedChannel(CH, "telegram:tok", opens).adapter], webhooks: [], skipped: [] }),
    );
    hosts.push(legacy);
    legacy.setHubOwnership((id) => hub.owns(id));
    await hub.start();
    await legacy.sync("gateway-1", "Bot", agentConfig());
    await new Promise((r) => setTimeout(r, 600)); // the legacy host opens adapters on its own fibers
    expect(opens.n).toBe(1);
    expect((await legacy.status("gateway-1", agentConfig())).channels[0]).toMatchObject({ state: "skipped", reason: expect.stringContaining("channel hub") });
  }, 60_000);

  it("a hub that failed to start still owns its channels (never hand them to a second poller)", async () => {
    createGatewayAgent(db, "gateway-1", "Bot", JSON.stringify(agentConfig()), null, "gateway");
    const { hub } = makeHub(scriptedChannel(CH), { makeAdapters: () => ({ adapters: [], webhooks: [], skipped: [{ id: CH, reason: "No bot token saved." }] }) });
    await hub.start();
    expect((await hub.status()).phase).toBe("failed");
    expect(hub.owns(CH)).toBe(true);
  });

  it("a second process on the same account fails closed with a plain reason", async () => {
    createGatewayAgent(db, "gateway-1", "Bot", JSON.stringify(agentConfig()), null, "gateway");
    const first = makeHub(scriptedChannel(CH, "telegram:tok"));
    await first.hub.start();
    expect((await first.hub.status()).phase).toBe("running");
    const second = makeHub(scriptedChannel(CH, "telegram:tok"), { leases: makeDbLeases(db, { pid: process.pid + 1, pidAlive: () => true }) });
    await second.hub.start();
    const s = await second.hub.status();
    expect(s.phase).toBe("failed");
    expect(s.error).toContain("already owns the account");
  }, 60_000);

  it("two channel rows with one credential open the account once; the later one is skipped", async () => {
    db.prepare("INSERT INTO cortex_channels (id, platform) VALUES ('ch-aaaa1111','telegram'), ('ch-bbbb2222','telegram')").run();
    createGatewayAgent(db, "gw", "Bot", JSON.stringify(agentConfig({ channels: [] })), null, "gateway");
    db.prepare("INSERT INTO cortex_routes (id, channel_id, target_id, spec_json) VALUES ('r1','ch-aaaa1111','gw','{}'), ('r2','ch-bbbb2222','gw','{}')").run();
    const a = scriptedChannel("ch-aaaa1111", "telegram:same");
    const b = scriptedChannel("ch-bbbb2222", "telegram:same");
    const { hub } = makeHub(a, { makeAdapters: () => ({ adapters: [a.adapter, b.adapter], webhooks: [], skipped: [] }) });
    await hub.start();
    const s = await hub.status();
    expect(s.phase).toBe("running");
    expect(s.channels.find((c) => c.id === "ch-bbbb2222")).toMatchObject({ state: "skipped", reason: expect.stringContaining("Same account") });
    expect(b.starts()).toBe(0);
  }, 60_000);
});

describe("durability and rollback", () => {
  it("a replayed message id after a restart is deduped (no second turn, no second reply)", async () => {
    createGatewayAgent(db, "gateway-1", "Bot", JSON.stringify(agentConfig()), null, "gateway");
    const ch1 = scriptedChannel(CH);
    const one = makeHub(ch1);
    await one.hub.start();
    await converse(ch1, "1", "hello", "same-id");
    await one.hub.stop();

    const ch2 = scriptedChannel(CH);
    const two = makeHub(ch2);
    await two.hub.start();
    for (let i = 0; i < 4; i++) {
      ch2.push("1", "hello", "same-id");
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(ch2.sent).toHaveLength(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM cortex_router_seen").get() as { n: number }).n).toBe(1);
  }, 60_000);

  it("CORTEX_CHANNEL_HUB=off: nothing is migrated and the hub owns no channel", async () => {
    createGatewayAgent(db, "gateway-1", "Bot", JSON.stringify(agentConfig()), null, "gateway");
    const { hub } = makeHub(scriptedChannel(CH), { enabled: false });
    await hub.start();
    expect((db.prepare("SELECT COUNT(*) AS n FROM cortex_channels").get() as { n: number }).n).toBe(0);
    expect(hub.owns(CH)).toBe(false);
    expect((await hub.status()).phase).toBe("disabled");
  });

  it("rollback: with the new rows deleted the legacy host hosts the channel again", async () => {
    createGatewayAgent(db, "gateway-1", "Bot", JSON.stringify(agentConfig()), null, "gateway");
    const { hub } = makeHub(scriptedChannel(CH));
    await hub.start();
    expect(hub.owns(CH)).toBe(true);
    await hub.stop();
    db.exec("DELETE FROM cortex_routes; DELETE FROM cortex_channels;");
    expect(hub.owns(CH)).toBe(false);
    const opens = { n: 0 };
    const legacy = new GatewayChannelHost(db, ingestLayer(db) as never, gatewayConfigToBuildParams, () => ({ adapters: [scriptedChannel(CH, "telegram:tok", opens).adapter], webhooks: [], skipped: [] }));
    hosts.push(legacy);
    legacy.setHubOwnership((id) => hub.owns(id));
    await legacy.sync("gateway-1", "Bot", agentConfig());
    expect(await until(() => opens.n, (n) => n >= 1)).toBe(1);
  }, 60_000);
});
