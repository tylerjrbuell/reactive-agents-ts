// Run: bun run repo test apps/cortex/server/tests/channel-hub-mcp-turns.test.ts
//
// A gateway agent with an MCP server (streamable-http) answers owner turns through the channel hub, MCP
// tools included; a non-owner's build never carries the MCP server. A failed turn carries its real
// (sanitized) cause to the activity feed instead of the opaque `turn_failed`.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { Effect, Layer } from "effect";
import type { AgentConfig } from "@reactive-agents/runtime";
import { applySchema } from "../db/schema.js";
import { createGatewayAgent, updateGatewayAgent } from "../db/queries.js";
import { insertMcpServer } from "../db/mcp-queries.js";
import { ChannelHub } from "../services/channel-hub.js";
import { gatewayConfigToBuildParams } from "../services/gateway-process-manager.js";
import { CortexEventBridge, CortexEventBridgeLive } from "../services/event-bridge.js";
import { CortexIngestServiceLive } from "../services/ingest-service.js";
import { scriptedChannel, until, type ScriptedChannel } from "./helpers/scripted-channel.js";

const CH = "ch-mcp0001";
const OWNER = "telegram:1";
const MCP_ID = "mcp-stub-0001";

/** Enough of the streamable-http MCP protocol for connect + tools/list + tools/call. */
const startMcpStub = () =>
  Bun.serve({
    port: 0,
    idleTimeout: 5,
    async fetch(req) {
      if (req.method === "DELETE") return new Response(null, { status: 200 });
      if (req.method !== "POST") return new Response("Not Found", { status: 404 });
      const body = (await req.json()) as { id?: number | string; method: string; params?: { name?: string } };
      if (body.method === "initialize") {
        return Response.json(
          { jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "stub", version: "1.0.0" } } },
          { headers: { "Mcp-Session-Id": "s-1" } },
        );
      }
      if (body.method.startsWith("notifications/")) return new Response(null, { status: 202 });
      if (body.method === "tools/list") {
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: { tools: [{ name: "list_websites", description: "List websites", inputSchema: { type: "object", properties: {} } }] },
        });
      }
      if (body.method === "tools/call") {
        return Response.json({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "site-a, site-b" }] } });
      }
      return new Response("Not Found", { status: 404 });
    },
  });

let db: Database;
let hubs: ChannelHub[];
let stub: ReturnType<typeof startMcpStub>;
beforeEach(() => {
  db = new Database(":memory:");
  applySchema(db);
  hubs = [];
  stub = startMcpStub();
  insertMcpServer(db, MCP_ID, { name: "umami", transport: "streamable-http", endpoint: `http://127.0.0.1:${stub.port}/mcp`, headers: { Authorization: "Bearer stub" } });
});
afterEach(async () => {
  await Promise.all(hubs.map((h) => h.stop()));
  stub.stop(true);
});

const ingestLayer = (database: Database) => {
  const bridge = Effect.runSync(CortexEventBridge.pipe(Effect.provide(CortexEventBridgeLive)));
  return CortexIngestServiceLive(database).pipe(Layer.provide(Layer.succeed(CortexEventBridge, bridge))) as Layer.Layer<never>;
};

const savedConfig = () => ({
  provider: "test",
  model: "test-model",
  tools: ["web-search", "http-get"],
  mcpServerIds: [MCP_ID],
  approvalPolicy: { mode: "detach", tools: [], commands: [] },
  askBeforeRiskyTools: true,
  memory: { working: true, episodic: false, semantic: false },
  maxIterations: 14,
  channels: [{ id: CH, kind: "telegram", label: "Support" }],
  gateway: { accessControl: { accessPolicy: "open", allowedSenders: [OWNER] } },
});

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

describe("hub turns with an MCP server", () => {
  it("an owner turn is answered, MCP server configured on the built agent", async () => {
    createGatewayAgent(db, "gateway-1", "Bot", JSON.stringify(savedConfig()), null, "gateway");
    const ch = scriptedChannel(CH);
    const { hub, built } = makeHub(ch, [{ text: "here are your sites" }]);
    await hub.start();
    const reply = await converse(ch, "1", "List my Umami websites", "o1");
    expect(reply?.text).toBe("here are your sites");
    const owner = built.find((b) => b.role === "owner")!.config;
    expect(owner.mcpServers?.map((s) => s.name)).toEqual(["umami"]);
  }, 60_000);

  it("a saved-agent change rebuilds the hub agent: the next turn in an open conversation succeeds on the NEW config", async () => {
    createGatewayAgent(db, "gateway-1", "Bot", JSON.stringify(savedConfig()), null, "gateway");
    const ch = scriptedChannel(CH);
    const { hub, built } = makeHub(ch, [{ text: "answer" }]);
    await hub.start();
    expect((await converse(ch, "1", "first", "o1"))?.text).toBe("answer");
    updateGatewayAgent(db, "gateway-1", { config: JSON.stringify({ ...savedConfig(), systemPrompt: "NEW PROMPT" }) });
    await hub.agentChanged("gateway-1");
    expect((await converse(ch, "1", "second", "o2"))?.text).toBe("answer");
    const owners = built.filter((b) => b.role === "owner");
    expect(owners.length).toBe(2);
    expect(JSON.stringify(owners[1]!.config)).toContain("NEW PROMPT");
  }, 60_000);

  it("a failed turn shows its real, secret-free cause in the activity feed and the simulate result", async () => {
    createGatewayAgent(db, "gateway-1", "Bot", JSON.stringify(savedConfig()), null, "gateway");
    const ch = scriptedChannel(CH);
    // The agent cannot be built (e.g. an MCP server that will not connect); the message carries a token.
    const failing = new ChannelHub({
      db,
      ingestLayer: ingestLayer(db) as never,
      toBuildParams: () => { throw new Error("model said no at http://x.test/p?token=SECRET123 Bearer abcdef123456"); },
      makeAdapters: () => ({ adapters: [ch.adapter], webhooks: [], skipped: [] }),
    });
    hubs.push(failing);
    await failing.start();
    const out = await failing.simulate({ channelId: CH, userId: "1", text: "hi" });
    expect(out?.outcome).toBe("failed");
    const feed = JSON.stringify((await failing.status()).activity);
    const sim = JSON.stringify(out);
    // The feed words the router reason ("could not open the agent"); the simulate result keeps the machine code.
    expect(feed).toContain("could not open the agent for this route");
    expect(sim).toContain("resolve_failed");
    for (const text of [feed, sim]) {
      expect(text).not.toContain("SECRET123");
      expect(text).not.toContain("abcdef123456");
    }
    expect(feed).toContain("model said no");
  }, 60_000);

  it("a non-owner's build never carries the MCP server", async () => {
    createGatewayAgent(db, "gateway-1", "Bot", JSON.stringify(savedConfig()), null, "gateway");
    const ch = scriptedChannel(CH);
    const { hub, built } = makeHub(ch, [{ text: "hi" }]);
    await hub.start();
    await converse(ch, "2", "hello", "s1");
    const sender = built.find((b) => b.role === "sender")!.config;
    expect(sender.mcpServers ?? []).toEqual([]);
  }, 60_000);
});
