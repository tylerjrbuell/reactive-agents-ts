// Run: bun run repo test apps/cortex/server/tests/channel-hub-api.test.ts
//
// /api/channels: channel and route CRUD with the framework's validation, the audited confirm for any change
// that widens access, no credential in any response, and the hub block on /api/gateway/status.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { Effect, Layer } from "effect";
import { Elysia } from "elysia";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySchema } from "../db/schema.js";
import { createGatewayAgent } from "../db/queries.js";
import { channelHubRouter } from "../api/channel-hub.js";
import { gatewayRouter } from "../api/gateway.js";
import { ChannelCredentials } from "../services/channel-credentials.js";
import { ChannelHub } from "../services/channel-hub.js";
import { CortexEventBridge, CortexEventBridgeLive } from "../services/event-bridge.js";
import { CortexIngestServiceLive } from "../services/ingest-service.js";
import { GatewayProcessManager, gatewayConfigToBuildParams } from "../services/gateway-process-manager.js";
import { installProviderKeyStore, ProviderKeyStore } from "../services/provider-key-store.js";

let dir: string;
let db: Database;
let creds: ChannelCredentials;
let hub: ChannelHub;
let app: { handle: (r: Request) => Promise<Response> };
const TOKEN = "123456789:AAFakeTelegramBotToken_abcdefgh";

const call = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T; text: string }> => {
  const res = await app.handle(new Request(`http://localhost${path}`, { method, headers: { "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }));
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as T, text };
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cortex-hubapi-"));
  const store = new ProviderKeyStore({ dir, env: {} });
  installProviderKeyStore(store);
  creds = new ChannelCredentials(store);
  db = new Database(":memory:");
  applySchema(db);
  const bridge = Effect.runSync(CortexEventBridge.pipe(Effect.provide(CortexEventBridgeLive)));
  const ingest = CortexIngestServiceLive(db).pipe(Layer.provide(Layer.succeed(CortexEventBridge, bridge))) as never;
  hub = new ChannelHub({ db, ingestLayer: ingest, toBuildParams: gatewayConfigToBuildParams, enabled: true });
  app = new Elysia().use(channelHubRouter(db, hub, creds)).use(gatewayRouter(db, new GatewayProcessManager(db, ingest), creds, { hub }));
  createGatewayAgent(db, "gw-1", "Bot", JSON.stringify({ provider: "test" }), null, "gateway");
});
afterEach(async () => {
  await hub.stop();
  installProviderKeyStore(null);
  rmSync(dir, { recursive: true, force: true });
});

const makeChannel = async () => (await call<{ id: string }>("POST", "/api/channels", { kind: "telegram", label: "Support" })).body.id;
const route = (channelId: string, extra: Record<string, unknown> = {}) => ({ id: "r1", match: { channelId }, target: { agentId: "gw-1" }, ...extra });

describe("channels", () => {
  it("create, read back with credential masks (never the value), update, delete", async () => {
    const id = await makeChannel();
    expect(id).toMatch(/^ch-[0-9a-f]{8}$/);
    creds.set(id, "telegram", "token", TOKEN);
    const list = await call<{ channels: { id: string; credentials: { masked: string | null }[] }[] }>("GET", "/api/channels");
    expect(list.text).not.toContain(TOKEN);
    expect(list.body.channels[0]?.credentials[0]?.masked).toBe(`••••${TOKEN.slice(-4)}`);
    expect((await call("PATCH", `/api/channels/${id}`, { enabled: false })).status).toBe(200);
    expect((await call("DELETE", `/api/channels/${id}`)).status).toBe(200);
    expect(creds.value(id, "token")).toBeUndefined();
  });

  it("a channel with routes needs force to delete", async () => {
    const id = await makeChannel();
    await call("POST", "/api/channels/routes", { route: route(id) });
    expect((await call("DELETE", `/api/channels/${id}`)).status).toBe(409);
    expect((await call("DELETE", `/api/channels/${id}?force=1`)).status).toBe(200);
  });
});

describe("routes", () => {
  it("creates a route with the framework defaults: fail-closed, ReadOnly, no owner", async () => {
    const id = await makeChannel();
    const r = await call("POST", "/api/channels/routes", { route: route(id) });
    expect(r.status).toBe(201);
    const status = await call<{ routes: { access: { open: boolean; allow: number; owners: number }; senderTools: string }[] }>("GET", "/api/channels/status");
    expect(status.body.routes[0]).toMatchObject({ access: { open: false, allow: 0, owners: 0 }, senderTools: "ReadOnly" });
  });

  it("the framework validation applies: open needs caps, AgentDefault needs an owner, unknown agent and channel are refused", async () => {
    const id = await makeChannel();
    expect((await call("POST", "/api/channels/routes", { route: route(id, { open: true }), confirm: ["open:r1"] })).status).toBe(400);
    expect((await call("POST", "/api/channels/routes", { route: route(id, { senderTools: { _tag: "AgentDefault" } }), confirm: ["agent-default:r1"] })).status).toBe(400);
    expect((await call("POST", "/api/channels/routes", { route: { ...route(id), target: { agentId: "nope" } } })).status).toBe(400);
    expect((await call("POST", "/api/channels/routes", { route: route("ch-zzzzzzzz") })).status).toBe(400);
    expect((await call("POST", "/api/channels/routes", { route: route(id, { owners: ["not-a-key"] }) })).status).toBe(400);
  });

  it("an added owner, open, or AgentDefault is refused without confirm and audited with it", async () => {
    const id = await makeChannel();
    const refused = await call<{ error: string; required: string[] }>("POST", "/api/channels/routes", { route: route(id, { owners: ["telegram:1"] }) });
    expect(refused.status).toBe(409);
    expect(refused.body.required).toEqual(["owners:r1"]);
    const ok = await call("POST", "/api/channels/routes", { route: route(id, { owners: ["telegram:1"] }), confirm: ["owners:r1"] });
    expect(ok.status).toBe(201);

    const patch = await call<{ required: string[] }>("PATCH", "/api/channels/routes/r1", { route: { open: true, maxCostPerDayUsd: 5, maxTurnsPerHour: 10, maxTurnsPerSenderPerHour: 3 } });
    expect(patch.status).toBe(409);
    expect(patch.body.required).toEqual(["open:r1"]);
    expect((await call("PATCH", "/api/channels/routes/r1", { route: { open: true, maxCostPerDayUsd: 5, maxTurnsPerHour: 10, maxTurnsPerSenderPerHour: 3 }, confirm: ["open:r1"] })).status).toBe(200);

    const audit = await call<{ entries: { action: string; subject: string; detail: { confirmed?: string[] } }[] }>("GET", "/api/channels/audit");
    const created = audit.body.entries.find((e) => e.action === "route-created");
    expect(created?.detail.confirmed).toEqual(["owners:r1"]);
    expect(audit.body.entries.some((e) => e.action === "route-updated" && e.detail.confirmed?.includes("open:r1"))).toBe(true);
  });

  it("an edit detaches a migrated route from the agent config", async () => {
    createGatewayAgent(db, "gw-2", "Bot2", JSON.stringify({ provider: "test", channels: [{ id: "ch-cccc3333", kind: "telegram" }], gateway: { accessControl: { accessPolicy: "allowlist", allowedSenders: ["telegram:9"] } } }), null, "gateway");
    await hub.migrateNow();
    const before = await call<{ routes: { id: string; migratedFrom: string | null }[] }>("GET", "/api/channels");
    expect(before.body.routes[0]?.migratedFrom).toBe("gw-2");
    const id = before.body.routes[0]!.id;
    expect((await call("PATCH", `/api/channels/routes/${id}`, { route: { priority: 5 } })).status).toBe(200);
    const after = await call<{ routes: { migratedFrom: string | null }[] }>("GET", "/api/channels");
    expect(after.body.routes[0]?.migratedFrom).toBeNull();
  });

  it("migration dry run lists what would be created without writing", async () => {
    createGatewayAgent(db, "gw-2", "Bot2", JSON.stringify({ provider: "test", channels: [{ id: "ch-cccc3333", kind: "telegram" }] }), null, "gateway");
    const plan = await call<{ channels: unknown[]; routes: unknown[] }>("GET", "/api/channels/migration");
    expect(plan.body.channels).toHaveLength(1);
    expect((await call<{ channels: unknown[] }>("GET", "/api/channels")).body.channels).toHaveLength(0);
  });

  it("explain and simulate answer 503 while the router is not running that channel", async () => {
    const id = await makeChannel();
    expect((await call("POST", "/api/channels/explain", { channelId: id, userId: "1", text: "hi" })).status).toBe(503);
  });
});

describe("gateway overview", () => {
  it("carries the hub block with phase and route roles explained", async () => {
    const id = await makeChannel();
    await call("POST", "/api/channels/routes", { route: route(id) });
    const s = await call<{ hub: { enabled: boolean; phase: string; routes: { roleNote: string }[] } }>("GET", "/api/gateway/status");
    expect(s.body.hub.enabled).toBe(true);
    expect(s.body.hub.routes[0]?.roleNote).toContain("No owner");
  });
});
