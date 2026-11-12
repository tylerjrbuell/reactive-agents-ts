// Run: bun run repo test apps/cortex/server/tests/api-gateway.test.ts
//
// /api/gateway: credentials are write-only (no response carries one), the connection probe
// scrubs and does not store, the status endpoint reports live channel state from a hosted
// gateway agent (scripted adapter, no network), and the gateway block reaches the built agent.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { Effect, Layer, PubSub, Ref, Stream } from "effect";
import { Elysia } from "elysia";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { Redacted } from "effect";
import { WebhookChannelAdapter, channelError, type ChannelAdapter, type ConnectionState, type InboundEnvelope } from "@reactive-agents/channels";
import { applySchema } from "../db/schema.js";
import { createGatewayAgent, getGatewayAgent } from "../db/queries.js";
import { gatewayRouter } from "../api/gateway.js";
import { agentsRouter } from "../api/agents.js";
import { buildCortexAgent, cortexAgentBuilder } from "../services/build-cortex-agent.js";
import { ChannelCredentials } from "../services/channel-credentials.js";
import { GatewayChannelHost } from "../services/gateway-channel-host.js";
import { GatewayProcessManager, gatewayConfigToBuildParams } from "../services/gateway-process-manager.js";
import { CortexEventBridge, CortexEventBridgeLive } from "../services/event-bridge.js";
import { CortexIngestServiceLive } from "../services/ingest-service.js";
import { installProviderKeyStore, ProviderKeyStore } from "../services/provider-key-store.js";

const TOKEN = "123456789:AAFakeTelegramBotToken_abcdefgh";
const CH = "ch-aaaa1111";

let dir: string;
let db: Database;
let creds: ChannelCredentials;
let gateway: GatewayProcessManager;

const ingestLayer = (database: Database) => {
  const bridge = Effect.runSync(CortexEventBridge.pipe(Effect.provide(CortexEventBridgeLive)));
  return CortexIngestServiceLive(database).pipe(Layer.provide(Layer.succeed(CortexEventBridge, bridge))) as Layer.Layer<any>;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cortex-gw-"));
  const store = new ProviderKeyStore({ dir, env: {} });
  installProviderKeyStore(store);
  creds = new ChannelCredentials(store);
  db = new Database(":memory:");
  applySchema(db);
  gateway = new GatewayProcessManager(db, ingestLayer(db));
});
afterEach(async () => {
  await gateway.channels.destroy();
  gateway.destroy();
  installProviderKeyStore(null);
  rmSync(dir, { recursive: true, force: true });
});

/** The response shapes the assertions read. */
interface ProbeBody { readonly ok: boolean; readonly detail: string }
interface StatusBody {
  readonly agents: readonly {
    readonly access: { readonly mode: string; readonly allowed: number; readonly blocked: number };
    readonly gateway: { readonly phase: string; readonly channels: readonly { readonly id: string; readonly state: string; readonly label: string | null }[] };
  }[];
}
interface CredBody { readonly fields: readonly { readonly masked: string | null }[] }
type Reply<T> = Omit<Response, "json"> & { json(): Promise<T> };

const call = <T = unknown>(app: { handle: (r: Request) => Promise<Response> }, method: string, path: string, body?: unknown): Promise<Reply<T>> =>
  app.handle(new Request(`http://localhost${path}`, { method, headers: { "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })) as Promise<Reply<T>>;

/** A channel adapter driven by the test: no network, state set from outside. */
function scriptedAdapter(id: string): { adapter: ChannelAdapter; set: (s: ConnectionState) => void; receive: (userId: string, text: string) => void } {
  const state = Effect.runSync(Ref.make<ConnectionState>({ status: "connected" }));
  const states = Effect.runSync(PubSub.unbounded<ConnectionState>());
  const inbound = Effect.runSync(PubSub.unbounded<InboundEnvelope>());
  let n = 0;
  const adapter: ChannelAdapter = {
    id,
    platform: "telegram",
    capabilities: { threads: false, attachments: false, markdown: false, receipts: false, groups: true },
    inbound: Stream.fromPubSub(inbound),
    state: Stream.fromPubSub(states),
    currentState: Ref.get(state),
    start: () => Effect.void,
    send: () => Effect.fail(channelError(id, "unsupported")),
  };
  return {
    adapter,
    set: (s) => Effect.runSync(Effect.zipRight(Ref.set(state, s), PubSub.publish(states, s))),
    receive: (userId, text) =>
      Effect.runSync(PubSub.publish(inbound, {
        id: `m${++n}`, conversation: { channelId: userId, isGroup: false }, sender: { platform: "telegram", userId },
        text, attachments: [], mentionsSelf: true, isEcho: false, receivedAt: Date.now(),
      })),
  };
}

/** Polls `read` until `ok` holds (the framework folds inbound traffic on its own fibers). */
async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const v = await read();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  return read();
}

describe("credential routes", () => {
  const app = () => new Elysia().use(gatewayRouter(db, gateway, creds));

  it("PUT answers with a mask, GET lists masks, and neither carries the token", async () => {
    const put = await call(app(), "PUT", `/api/gateway/channels/${CH}/credentials/token`, { kind: "telegram", value: TOKEN });
    expect(put.status).toBe(200);
    const putText = await put.text();
    expect(putText).not.toContain(TOKEN);
    expect(JSON.parse(putText)).toEqual({ field: "token", masked: `••••${TOKEN.slice(-4)}`, updatedAt: expect.any(Number) });

    const get = await call(app(), "GET", `/api/gateway/channels/${CH}/credentials?kind=telegram`);
    const getText = await get.text();
    expect(getText).not.toContain(TOKEN);
    expect(JSON.parse(getText).fields[0].masked).toBe(`••••${TOKEN.slice(-4)}`);
    expect(creds.value(CH, "token")).toBe(TOKEN);
  });

  it("DELETE removes it", async () => {
    await call(app(), "PUT", `/api/gateway/channels/${CH}/credentials/token`, { kind: "telegram", value: TOKEN });
    const del = await call(app(), "DELETE", `/api/gateway/channels/${CH}/credentials/token?kind=telegram`);
    expect(JSON.parse(await del.text()).fields[0].masked).toBeNull();
    expect(creds.value(CH, "token")).toBeUndefined();
  });

  it("refuses a field the kind does not have and an unknown kind", async () => {
    expect((await call(app(), "PUT", `/api/gateway/channels/${CH}/credentials/secret`, { kind: "telegram", value: "x".repeat(8) })).status).toBe(400);
    expect((await call(app(), "GET", `/api/gateway/channels/${CH}/credentials?kind=pigeon`)).status).toBe(400);
  });

  it("deleting a saved agent removes its channels' credentials", async () => {
    createGatewayAgent(db, "gateway-1", "Bot", JSON.stringify({ provider: "test", channels: [{ id: CH, kind: "telegram" }] }), null, "gateway");
    creds.set(CH, "telegram", "token", TOKEN);
    const agents = new Elysia().use(agentsRouter(db, gateway));
    const res = await call(agents, "DELETE", "/api/agents/gateway-1");
    expect(res.status).toBe(200);
    expect(getGatewayAgent(db, "gateway-1")).toBeNull();
    expect(creds.value(CH, "token")).toBeUndefined();
  });
});

describe("POST /api/gateway/channels/test", () => {
  const probe = (fetchTelegram: Parameters<typeof gatewayRouter>[3] extends infer D ? NonNullable<D> extends { fetchTelegram?: infer F } ? F : never : never) =>
    new Elysia().use(gatewayRouter(db, gateway, creds, { fetchTelegram }));

  it("reports the bot name on success using the saved token, and never echoes it", async () => {
    creds.set(CH, "telegram", "token", TOKEN);
    let url = "";
    const app = probe(async (u) => {
      url = u;
      return { status: 200, json: async () => ({ ok: true, result: { username: "ra_bot" } }) };
    });
    const res = await call<ProbeBody>(app, "POST", "/api/gateway/channels/test", { kind: "telegram", channelId: CH });
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true, detail: "Connected as @ra_bot." });
    expect(text).not.toContain(TOKEN);
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/getMe`);
  });

  it("a rejected token reads plainly", async () => {
    creds.set(CH, "telegram", "token", TOKEN);
    const app = probe(async () => ({ status: 401, json: async () => ({ ok: false, description: "Unauthorized" }) }));
    const body = await (await call<ProbeBody>(app, "POST", "/api/gateway/channels/test", { kind: "telegram", channelId: CH })).json();
    expect(body.ok).toBe(false);
    expect(body.detail).toContain("rejected the token");
  });

  it("scrubs the token from a network error message", async () => {
    creds.set(CH, "telegram", "token", TOKEN);
    const app = probe(async (u) => {
      throw new Error(`fetch failed for ${u}`);
    });
    const text = await (await call<ProbeBody>(app, "POST", "/api/gateway/channels/test", { kind: "telegram", channelId: CH })).text();
    expect(text).not.toContain(TOKEN);
    expect(JSON.parse(text).ok).toBe(false);
  });

  it("a typed token is used for the probe only and is not stored", async () => {
    let url = "";
    const app = probe(async (u) => {
      url = u;
      return { status: 200, json: async () => ({ ok: true, result: { username: "typed_bot" } }) };
    });
    const res = await call<ProbeBody>(app, "POST", "/api/gateway/channels/test", { kind: "telegram", channelId: CH, credentials: { token: TOKEN } });
    expect((await res.json()).ok).toBe(true);
    expect(url).toContain(TOKEN);
    expect(creds.value(CH, "token")).toBeUndefined();
  });

  it("says so when nothing is saved or typed", async () => {
    const app = probe(async () => ({ status: 200, json: async () => ({}) }));
    const body = await (await call<ProbeBody>(app, "POST", "/api/gateway/channels/test", { kind: "telegram", channelId: CH })).json();
    expect(body).toEqual({ ok: false, detail: "No bot token saved." });
  });

  it("signal: probes the daemon socket, and refuses without an account", async () => {
    const app = new Elysia().use(gatewayRouter(db, gateway, creds, { probeSocket: async (t) => t.port === 7583 }));
    expect((await (await call<ProbeBody>(app, "POST", "/api/gateway/channels/test", { kind: "signal", channelId: CH })).json()).ok).toBe(false);
    creds.set(CH, "signal", "account", "+15551234567");
    const ok = await (await call<ProbeBody>(app, "POST", "/api/gateway/channels/test", { kind: "signal", channelId: CH, settings: { port: 7583 } })).text();
    expect(JSON.parse(ok).ok).toBe(true);
    expect(ok).not.toContain("15551234567");
    const down = await (await call<ProbeBody>(app, "POST", "/api/gateway/channels/test", { kind: "signal", channelId: CH, settings: { port: 9 } })).json();
    expect(down.ok).toBe(false);
  });

  it("webhook: an unsigned channel and a metadata reply URL are refused", async () => {
    const app = new Elysia().use(gatewayRouter(db, gateway, creds));
    expect((await (await call<ProbeBody>(app, "POST", "/api/gateway/channels/test", { kind: "webhook", channelId: CH, settings: { ingressPort: 7700 } })).json()).detail).toContain("signing secret");
    creds.set(CH, "webhook", "secret", "whsec_0123456789");
    const bad = await (await call<ProbeBody>(app, "POST", "/api/gateway/channels/test", {
      kind: "webhook", channelId: CH, settings: { ingressPort: 7700, replyUrl: "http://169.254.169.254/latest" },
    })).json();
    expect(bad.ok).toBe(false);
    expect(bad.detail).toContain("Reply URL refused");
  });
});

describe("GET /api/gateway/status", () => {
  const config = (extra: Record<string, unknown> = {}) => ({
    provider: "test",
    model: "test-model",
    channels: [{ id: CH, kind: "telegram", label: "Support" }],
    gateway: { accessControl: { accessPolicy: "allowlist", allowedSenders: ["telegram:42"] }, queue: { capacity: 7, overflow: "drop-newest" }, crons: [{ schedule: "0 9 * * 1", instruction: "Weekly digest" }] },
    ...extra,
  });

  it("lists a gateway agent that is not hosted with its channels as not-started and the access summary", async () => {
    createGatewayAgent(db, "gateway-1", "Bot", JSON.stringify(config()), null, "gateway");
    const app = new Elysia().use(gatewayRouter(db, gateway, creds));
    const { agents } = await (await call<StatusBody>(app, "GET", "/api/gateway/status")).json();
    expect(agents).toHaveLength(1);
    expect(agents[0]?.gateway.phase).toBe("idle");
    expect(agents[0]?.gateway.channels[0]).toMatchObject({ id: CH, state: "not-started", label: "Support" });
    expect(agents[0]?.access).toEqual({ mode: "allowlist", allowed: 1, blocked: 0 });
  });

  it("an agent with no access control reports deny-all", async () => {
    createGatewayAgent(db, "gateway-1", "Bot", JSON.stringify({ provider: "test", channels: [{ id: CH, kind: "telegram" }] }), null, "gateway");
    const app = new Elysia().use(gatewayRouter(db, gateway, creds));
    const { agents } = await (await call<StatusBody>(app, "GET", "/api/gateway/status")).json();
    expect(agents[0]?.access.mode).toBe("deny-all");
  });

  it("does not list ad-hoc agents", async () => {
    createGatewayAgent(db, "agent-1", "Ad hoc", JSON.stringify(config()), null, "ad-hoc");
    const app = new Elysia().use(gatewayRouter(db, gateway, creds));
    expect((await (await call<StatusBody>(app, "GET", "/api/gateway/status")).json()).agents).toEqual([]);
  });

  it("a hosted agent reports live connection state, schedules and the queue settings from the framework", async () => {
    const scripted = scriptedAdapter(CH);
    const host = new GatewayChannelHost(db, ingestLayer(db), gatewayConfigToBuildParams, () => ({ adapters: [scripted.adapter], webhooks: [], skipped: [] }));
    try {
      await host.sync("gateway-1", "Bot", config());
      expect(host.isHosted("gateway-1")).toBe(true);

      let s = await host.status("gateway-1", config());
      expect(s.phase).toBe("running");
      expect(s.channels[0]).toMatchObject({ id: CH, state: "connected", error: null });
      // Capacity and overflow come from the running gateway's inbound queue, so they also prove
      // `.withGateway({ queue })` reaches the runner (it silently did not before the framework fix).
      expect(s.queue).toEqual({ ready: 0, deferred: 0, dropped: 0, capacity: 7, overflow: "drop-newest" });
      expect(s.schedules).toHaveLength(1);
      expect(s.schedules[0]).toMatchObject({ cron: "0 9 * * 1", instruction: "Weekly digest", enabled: true });
      expect(typeof s.schedules[0]?.nextFireAt).toBe("number");

      creds.set(CH, "telegram", "token", TOKEN);
      scripted.set({ status: "failed", error: channelError(CH, "auth", { message: `Unauthorized for bot${TOKEN}` }) });
      s = await until(() => host.status("gateway-1", config()), (v) => v.channels[0]?.state === "failed");
      expect(s.channels[0]?.state).toBe("failed");
      expect(s.channels[0]?.error?.kind).toBe("auth");
      expect(JSON.stringify(s)).not.toContain(TOKEN);

      await host.stop("gateway-1");
      expect(host.isHosted("gateway-1")).toBe(false);
      expect((await host.status("gateway-1", config())).channels[0]?.state).toBe("not-started");
    } finally {
      await host.destroy();
    }
  }, 30_000);

  it("message counts and last-inbound time are the framework's channelStatus, not folded events; a refused sender still counts as received", async () => {
    const scripted = scriptedAdapter(CH);
    const host = new GatewayChannelHost(db, ingestLayer(db), gatewayConfigToBuildParams, () => ({ adapters: [scripted.adapter], webhooks: [], skipped: [] }));
    try {
      await host.sync("gateway-1", "Bot", config());
      const before = await host.status("gateway-1", config());
      expect(before.channels[0]).toMatchObject({ received: 0, sent: 0, failed: 0, lastInboundAt: null, lastSentAt: null, lastFailure: null });

      // The adapter's stream is subscribed on the gateway loop's own fiber, so resend until the first lands.
      const s = await until(async () => {
        scripted.receive("99", "my password is hunter2"); // not on the allowlist
        await new Promise((r) => setTimeout(r, 100));
        return host.status("gateway-1", config());
      }, (v) => (v.channels[0]?.received ?? 0) >= 1);
      expect(s.channels[0]?.received).toBeGreaterThanOrEqual(1);
      expect(typeof s.channels[0]?.lastInboundAt).toBe("number");
      expect(JSON.stringify(s)).not.toContain("hunter2");
    } finally {
      await host.destroy();
    }
  }, 30_000);

  it("a webhook channel is mounted through the adapter's own ingress handler: bad signatures are refused, signed posts are counted", async () => {
    const WH = "ch-bbbb2222";
    const SECRET = "whsec_test_secret_value";
    const port = 41_000 + Math.floor(Math.random() * 1_000);
    const webhook = new WebhookChannelAdapter({ id: WH, secret: Redacted.make(SECRET) });
    const entry = { id: WH, kind: "webhook" as const, enabled: true, settings: { ingressPort: port } };
    const cfg = { provider: "test", model: "test-model", channels: [{ id: WH, kind: "webhook", settings: { ingressPort: port } }], gateway: { accessControl: { accessPolicy: "allowlist", allowedSenders: ["webhook:42"] } } };
    const host = new GatewayChannelHost(db, ingestLayer(db), gatewayConfigToBuildParams, () => ({ adapters: [webhook], webhooks: [{ entry, adapter: webhook, route: "/hook", port }], skipped: [] }));
    const url = `http://127.0.0.1:${port}/hook`;
    try {
      await host.sync("gateway-1", "Bot", cfg);
      expect((await host.status("gateway-1", cfg)).phase).toBe("running");

      const body = JSON.stringify({ id: "w1", senderId: "99", content: "hello" });
      const bad = await fetch(url, { method: "POST", body, headers: { "content-type": "application/json", "x-channels-signature": "nope", "x-channels-timestamp": String(Date.now()) } });
      expect(bad.status).toBeGreaterThanOrEqual(400);
      expect((await host.status("gateway-1", cfg)).channels[0]?.received).toBe(0);

      const ts = String(Date.now());
      const sig = createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
      const ok = await fetch(url, { method: "POST", body, headers: { "content-type": "application/json", "x-channels-signature": sig, "x-channels-timestamp": ts } });
      expect(ok.status).toBeLessThan(300);
      const s = await until(() => host.status("gateway-1", cfg), (v) => (v.channels[0]?.received ?? 0) >= 1);
      expect(s.channels[0]).toMatchObject({ received: 1 });
    } finally {
      await host.destroy();
    }
  }, 30_000);

  it("a channel that cannot be built is reported as skipped with its reason, and nothing is hosted", async () => {
    const host = new GatewayChannelHost(db, ingestLayer(db), gatewayConfigToBuildParams, () => ({ adapters: [], webhooks: [], skipped: [{ id: CH, reason: "No bot token saved." }] }));
    await host.sync("gateway-1", "Bot", config());
    const s = await host.status("gateway-1", config());
    expect(s.phase).toBe("failed");
    expect(s.channels[0]).toMatchObject({ state: "skipped", reason: "No bot token saved." });
    await host.destroy();
  });
});

describe("the gateway block reaches the built agent", () => {
  it("gatewayConfigToBuildParams carries gateway from the saved config", () => {
    const p = gatewayConfigToBuildParams({
      agentId: "gateway-1", name: "Bot", mcpConfigs: [],
      config: { provider: "test", gateway: { accessControl: { accessPolicy: "open" }, queue: { capacity: 3 } } },
    });
    expect(p.gateway).toEqual({ accessControl: { accessPolicy: "open" }, queue: { capacity: 3 } });
  });

  it("buildCortexAgent applies .withGateway from it and .withChannels from the adapters", async () => {
    const { adapter } = scriptedAdapter(CH);
    const params = { provider: "test", gateway: { accessControl: { accessPolicy: "allowlist" as const, allowedSenders: ["telegram:42"] } }, channelAdapters: [adapter] };
    const cfg = (await cortexAgentBuilder(params)).toConfig();
    expect(cfg.gateway?.accessControl).toEqual({ accessPolicy: "allowlist", allowedSenders: ["telegram:42"] });
    const agent = await buildCortexAgent(params);
    expect(agent._channelsConfig?.adapters).toHaveLength(1);
    await agent.dispose();
  });

  it("adapters without an explicit gateway still enable the gateway (withChannels needs it)", async () => {
    const { adapter } = scriptedAdapter(CH);
    const cfg = (await cortexAgentBuilder({ provider: "test", channelAdapters: [adapter] })).toConfig();
    // `ingress` is a builder option the AgentConfig schema type does not name yet; read it untyped.
    const gw: Record<string, unknown> = { ...cfg.gateway };
    expect(gw).toEqual({ ingress: { channels: false } });
  });

  it("Cortex mounts its own webhook adapters, so the framework channel ingress is off and the rest of the gateway block survives", async () => {
    const { adapter } = scriptedAdapter(CH);
    const params = { provider: "test", gateway: { queue: { capacity: 7 }, accessControl: { accessPolicy: "open" as const } }, channelAdapters: [adapter] };
    const cfg = (await cortexAgentBuilder(params)).toConfig();
    const gw: Record<string, unknown> = { ...cfg.gateway };
    expect(gw.ingress).toEqual({ channels: false });
    expect(cfg.gateway?.queue).toEqual({ capacity: 7 });
    expect(cfg.gateway?.accessControl).toEqual({ accessPolicy: "open" });
  });

  it("a desk run or chat turn (no gateway) builds with neither", async () => {
    const cfg = (await cortexAgentBuilder({ provider: "test" })).toConfig();
    expect(cfg.gateway).toBeUndefined();
  });
});
