// Run: bun run repo test apps/cortex/server/tests/channel-hub-owner-tools.test.ts
//
// A channel owner gets the saved agent's full tool surface, exactly as on the legacy gateway path:
//  - the hub's owner build registers the same tools as the legacy build of the same saved row
//  - a chat turn takes the tool loop: `session.chat` otherwise guesses from the wording
//    ("what is bitcoin worth?" matches no tool-intent pattern), and the agent answers
//    "I have no tools" although the tool is registered (live, 2026-11-12)
//  - a sender's narrowed build still has tools, so it takes the tool loop on its read-only subset;
//    a build with no tool at all stays on the direct path
//  Cortex passes no `useTools`: the framework's capability default decides (`agent.chat`).
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { Effect, Layer } from "effect";
import type { AgentConfig } from "@reactive-agents/runtime";
import { applySchema } from "../db/schema.js";
import { createGatewayAgent } from "../db/queries.js";
import { ChannelHub } from "../services/channel-hub.js";
import { cortexAgentBuilder } from "../services/build-cortex-agent.js";
import { normalizeCortexAgentConfig } from "../services/cortex-agent-config.js";
import { gatewayConfigToBuildParams } from "../services/gateway-process-manager.js";
import { CortexEventBridge, CortexEventBridgeLive } from "../services/event-bridge.js";
import { CortexIngestServiceLive } from "../services/ingest-service.js";
import { scriptedChannel, until, type ScriptedChannel } from "./helpers/scripted-channel.js";

const CH = "ch-bbbb2222";
const OWNER = "telegram:1";

const savedConfig = (extra: Record<string, unknown> = {}) => ({
  provider: "test",
  model: "test-model",
  tools: ["web-search", "crypto-price", "file-read"],
  additionalToolNames: "my-lab-tool",
  memory: { working: true, episodic: false },
  channels: [{ id: CH, kind: "telegram", label: "Support" }],
  gateway: { accessControl: { accessPolicy: "open", allowedSenders: [OWNER] } },
  ...extra,
});

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

const makeHub = (channel: ScriptedChannel, scenario: readonly Record<string, unknown>[]) => {
  const built: { role: string; config: AgentConfig }[] = [];
  const hub = new ChannelHub({
    db,
    ingestLayer: ingestLayer(db) as never,
    toBuildParams: gatewayConfigToBuildParams,
    makeAdapters: () => ({ adapters: [channel.adapter], webhooks: [], skipped: [] }),
    prepare: (p) => ({ ...p, testScenario: [...scenario] as never }),
    onBuilt: (i) => built.push({ role: i.role, config: i.config }),
  });
  hubs.push(hub);
  return { hub, built };
};

const converse = async (ch: ScriptedChannel, userId: string, text: string, id: string) => {
  const before = ch.sent.length;
  await until(() => {
    ch.push(userId, text, id);
    return new Promise<number>((r) => setTimeout(() => r(ch.sent.length), 100));
  }, (n) => n > before, 80);
  return ch.sent[before];
};

const toolEventsOf = (): number =>
  (db.prepare("SELECT COUNT(*) AS n FROM cortex_events WHERE type LIKE '%ToolCall%'").get() as { n: number }).n;

describe("owner tool surface", () => {
  it("the hub's owner build registers the same tools as the legacy build of the same saved row", async () => {
    createGatewayAgent(db, "gateway-1", "Bot", JSON.stringify(savedConfig()), null, "gateway");
    const ch = scriptedChannel(CH);
    const { hub, built } = makeHub(ch, [{ text: "ok" }]);
    await hub.start();
    await converse(ch, "1", "hello", "o1");

    const config = normalizeCortexAgentConfig(savedConfig());
    const legacy = (await cortexAgentBuilder({ ...gatewayConfigToBuildParams({ agentId: "gateway-1", name: "Bot", config, mcpConfigs: [] }), testScenario: [{ text: "ok" }] })).toConfig();
    const owner = built.find((b) => b.role === "owner")!.config;
    expect(owner.tools?.allowedTools).toEqual(legacy.tools?.allowedTools);
    expect(owner.tools?.allowedTools).toContain("crypto-price");
    expect(owner.tools?.allowedTools).toContain("my-lab-tool");
    expect(owner.mcpServers).toEqual(legacy.mcpServers);
  }, 60_000);

  it("an owner turn that does not read like a tool request still takes the tool loop", async () => {
    createGatewayAgent(db, "gateway-1", "Bot", JSON.stringify(savedConfig()), null, "gateway");
    const ch = scriptedChannel(CH);
    const { hub } = makeHub(ch, [
      { toolCall: { name: "file-read", args: { path: "/definitely/not/here.txt" } } },
      { text: "final answer" },
    ]);
    await hub.start();
    await converse(ch, "1", "what is bitcoin worth?", "o1");
    expect(toolEventsOf()).toBeGreaterThan(0);
  }, 60_000);

  it("a stranger's read-only turn takes the tool loop on the framework default (Cortex passes no useTools)", async () => {
    createGatewayAgent(db, "gateway-1", "Bot", JSON.stringify(savedConfig()), null, "gateway");
    const ch = scriptedChannel(CH);
    const { hub } = makeHub(ch, [
      { toolCall: { name: "file-read", args: { path: "/definitely/not/here.txt" } } },
      { text: "final answer" },
    ]);
    await hub.start();
    await converse(ch, "2", "what is bitcoin worth?", "s1");
    expect(toolEventsOf()).toBeGreaterThan(0);
  }, 60_000);

  it("an agent with no tool at all stays on the direct path", async () => {
    createGatewayAgent(db, "gateway-1", "Bot", JSON.stringify({ provider: "test", model: "test-model", channels: [{ id: CH, kind: "telegram", label: "Support" }], gateway: { accessControl: { accessPolicy: "open", allowedSenders: [OWNER] } } }), null, "gateway");
    const ch = scriptedChannel(CH);
    const { hub } = makeHub(ch, [{ text: "direct answer" }]);
    await hub.start();
    const reply = await converse(ch, "1", "what is bitcoin worth?", "o1");
    expect(reply?.text).toBe("direct answer");
    expect(toolEventsOf()).toBe(0);
  }, 60_000);
});
