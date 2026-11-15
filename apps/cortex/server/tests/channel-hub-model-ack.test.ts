// Run: bun run repo test apps/cortex/server/tests/channel-hub-model-ack.test.ts
//
// A route with `ack.source: "model"` sends a model-written acknowledgement while a slow turn runs:
// the hub resolver supplies `RoutedSession.acknowledge` (a tool-less side completion). A failed
// completion falls back to the canned text; the activity feed records the ack with its source.
// New Telegram routes default to a model ack only when the owner set none.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { Effect, Layer } from "effect";
import type { RouteSpecInput } from "@reactive-agents/channels";
import { applySchema } from "../db/schema.js";
import { createGatewayAgent } from "../db/queries.js";
import { getRoute, replaceRoute, routeToSpecInput } from "../db/channel-hub-queries.js";
import { ChannelHub } from "../services/channel-hub.js";
import { migratedRouteId, planMigration } from "../services/channel-hub-migration.js";
import { withDefaultAck } from "../services/channel-ack-default.js";
import { gatewayConfigToBuildParams } from "../services/gateway-process-manager.js";
import { HubActivityTracker } from "../services/channel-hub-activity.js";
import { CortexEventBridge, CortexEventBridgeLive } from "../services/event-bridge.js";
import { CortexIngestServiceLive } from "../services/ingest-service.js";
import { scriptedChannel, until, type ScriptedChannel } from "./helpers/scripted-channel.js";

const CH = "ch-ack00001";
const AGENT = "gateway-1";
const OWNER = "telegram:1";
const MODEL_ACK = "Starting on your pizza question now.";
const ANSWER = "pizza answer";

let db: Database;
let hubs: ChannelHub[];
beforeEach(() => {
  db = new Database(":memory:");
  applySchema(db);
  hubs = [];
});
afterEach(async () => {
  await Promise.all(hubs.map((h) => h.stop()));
});

const ingestLayer = (database: Database) => {
  const bridge = Effect.runSync(CortexEventBridge.pipe(Effect.provide(CortexEventBridgeLive)));
  return CortexIngestServiceLive(database).pipe(Layer.provide(Layer.succeed(CortexEventBridge, bridge))) as Layer.Layer<never>;
};

const savedConfig = () => ({
  provider: "test",
  model: "test-model",
  tools: [],
  approvalPolicy: { mode: "detach", tools: [], commands: [] },
  askBeforeRiskyTools: true,
  memory: { working: true, episodic: false, semantic: false },
  maxIterations: 4,
  channels: [{ id: CH, kind: "telegram", label: "Support" }],
  gateway: { accessControl: { accessPolicy: "open", allowedSenders: [OWNER] } },
});

/**
 * Hub over a scripted channel. The ack completion is keyed on its system prompt, the agent's slow answer
 * on the absence of it. The ack turn appears on both sides of the answer so the script holds whichever
 * call (the agent's or the ack's) reaches the provider first under load.
 */
const startHub = async (ackTurn: Record<string, unknown>) => {
  createGatewayAgent(db, AGENT, "Bot", JSON.stringify(savedConfig()), null, "gateway");
  const ch = scriptedChannel(CH);
  const hub = new ChannelHub({
    db,
    ingestLayer: ingestLayer(db) as never,
    toBuildParams: gatewayConfigToBuildParams,
    makeAdapters: () => ({ adapters: [ch.adapter], webhooks: [], skipped: [] }),
    prepare: (p) => ({ ...p, testScenario: [ackTurn, { text: ANSWER, match: "^(?![\\s\\S]*starting on it)", delayMs: 900 }, ackTurn] as never }),
  });
  hubs.push(hub);
  await hub.start();
  // The migrated route is the hub's own default (model ack); shorten its delay so the test is quick.
  const route = getRoute(db, migratedRouteId(AGENT, CH))!;
  const spec: RouteSpecInput = { ...routeToSpecInput(route), ack: { afterMs: 100, source: "model", text: "CANNED ACK" } };
  replaceRoute(db, spec);
  await hub.refresh();
  return { hub, ch };
};

const converse = async (ch: ScriptedChannel, text: string) => {
  ch.push("1", text, "m1");
  return until(() => ch.sent.map((m) => m.text), (texts) => texts.includes(ANSWER), 400);
};

describe("model-written acknowledgement", () => {
  it("sends the model's line while the turn runs, then the answer; the feed records source model", async () => {
    const { hub, ch } = await startHub({ text: MODEL_ACK, match: "starting on it" });
    const texts = await converse(ch, "pizza please");
    expect(texts).toContain(MODEL_ACK);
    expect(texts).not.toContain("CANNED ACK");
    expect(texts.indexOf(MODEL_ACK)).toBeLessThan(texts.indexOf(ANSWER));
    const feed = (await hub.status()).activity.map((a) => a.detail);
    expect(feed.some((d) => d.startsWith("acknowledged (model"))).toBe(true);
    // The ack completion is a side call: it is not part of any persisted conversation.
    const dump = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((t) => JSON.stringify(db.query(`SELECT * FROM "${t.name}"`).all()))
      .join("\n");
    expect(dump).not.toContain(MODEL_ACK);
  }, 60_000);

  it("falls back to the canned text when the model completion fails", async () => {
    const { hub, ch } = await startHub({ error: "model down", match: "starting on it" });
    const texts = await converse(ch, "pizza please");
    expect(texts).toContain("CANNED ACK");
    const feed = (await hub.status()).activity.map((a) => a.detail);
    expect(feed.some((d) => d.startsWith("acknowledged (canned") && d.includes("model ack fell back: error"))).toBe(true);
  }, 60_000);
});

describe("default ack for new routes", () => {
  const base: RouteSpecInput = { id: "r", match: { channelId: CH }, target: { agentId: AGENT } };
  it("a Telegram route with no ack gets source model; an explicit ack (even false) is kept; other platforms are untouched", () => {
    expect(withDefaultAck(base, "telegram").ack).toEqual({ source: "model" });
    expect(withDefaultAck({ ...base, ack: false }, "telegram").ack).toBe(false);
    expect(withDefaultAck({ ...base, ack: { text: "Hi" } }, "telegram").ack).toEqual({ text: "Hi" });
    expect(withDefaultAck(base, "signal")).toBe(base);
    expect(withDefaultAck(base, "webhook")).toBe(base);
  });
  it("migration gives a Telegram route the model ack", () => {
    const plan = planMigration([{ agentId: AGENT, name: "Bot", status: "active", agentType: "gateway", config: savedConfig() }]);
    expect(plan.routes[0]?.spec.ack).toEqual({ source: "model" });
  });
});

describe("activity feed", () => {
  it("folds ChannelTurnAcknowledged with its source", () => {
    const t = new HubActivityTracker(() => 1);
    t.observe({ _tag: "ChannelTurnAcknowledged", routeId: "r", role: "owner", source: "narration" });
    t.observe({ _tag: "ChannelTurnAcknowledged", routeId: "r", role: "sender" });
    expect(t.snapshot().map((a) => [a.kind, a.detail])).toEqual([
      ["acknowledged", "acknowledged (canned, sender)"],
      ["acknowledged", "acknowledged (narration, owner)"],
    ]);
  });

  it("shows the ack latency in seconds, with and without a fallback", () => {
    const t = new HubActivityTracker(() => 1);
    t.observe({ _tag: "ChannelTurnAcknowledged", routeId: "r", role: "owner", source: "model", ackLatencyMs: 5800 });
    t.observe({ _tag: "ChannelTurnAcknowledged", routeId: "r", role: "owner", ackFallbackReason: "timeout", ackLatencyMs: 12000 });
    const [fell, ok] = t.snapshot();
    expect(ok?.detail).toBe("acknowledged (model, owner; 5.8s)");
    expect(ok?.ackLatencyMs).toBe(5800);
    expect(fell?.detail).toBe("acknowledged (canned, owner; model ack fell back: timeout after 12.0s)");
  });

  it.each(["timeout", "empty", "thinking_only", "error"] as const)("shows why a model ack fell back: %s", (reason) => {
    const t = new HubActivityTracker(() => 1);
    t.observe({ _tag: "ChannelTurnAcknowledged", routeId: "r", role: "owner", ackFallbackReason: reason });
    const [a] = t.snapshot();
    expect(a?.detail).toBe(`acknowledged (canned, owner; model ack fell back: ${reason})`);
    expect(a?.ackFallbackReason).toBe(reason);
  });
});
