// Run: bun run repo test apps/cortex/server/tests/webhook-channel-api.test.ts
//
// /api/channels/:id/webhook-*: the framework's connection info, a generated secret returned once and
// stored sealed, and a signed test request posted from the server. No later response carries the secret.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { Elysia } from "elysia";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signWebhookPayload, WEBHOOK_SIGNATURE_HEADER, WEBHOOK_TIMESTAMP_HEADER } from "@reactive-agents/channels";
import { applySchema } from "../db/schema.js";
import { insertChannel } from "../db/channel-hub-queries.js";
import { webhookChannelRouter } from "../api/webhook-channel.js";
import { ChannelCredentials } from "../services/channel-credentials.js";
import { installProviderKeyStore, ProviderKeyStore } from "../services/provider-key-store.js";
import type { WebhookFetch } from "../services/webhook-channel-tools.js";

let dir: string;
let db: Database;
let creds: ChannelCredentials;
const ID = "ch-hook0001";

/** What the fake listener saw, and how it answers. */
let seen: { url: string; headers: Record<string, string>; body: string }[] = [];
let answer: { status: number; text: string } | "down" = { status: 200, text: "{}" };
/** The secret the fake listener verifies with (the framework's own signing function). */
let listenerSecret = "";
const fakeFetch: WebhookFetch = async (url, init) => {
  seen.push({ url, headers: init.headers, body: init.body });
  if (answer === "down") throw new Error("connect ECONNREFUSED 127.0.0.1:7700");
  const reply = answer;
  const expected = signWebhookPayload(listenerSecret, init.headers[WEBHOOK_TIMESTAMP_HEADER] ?? "", init.body);
  if (reply.status === 200 && init.headers[WEBHOOK_SIGNATURE_HEADER] !== expected) return { status: 401, text: async () => '{"error":"channel: bad signature"}' };
  return { status: reply.status, text: async () => reply.text };
};

const call = async (method: string, path: string, body?: unknown) => {
  const app = new Elysia().use(webhookChannelRouter(db, creds, { fetch: fakeFetch }));
  const res = await app.handle(new Request(`http://localhost${path}`, { method, headers: { "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }));
  const text = await res.text();
  return { status: res.status, text, json: (text ? JSON.parse(text) : {}) as Record<string, unknown> };
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cortex-webhookapi-"));
  const store = new ProviderKeyStore({ dir, env: {} });
  installProviderKeyStore(store);
  creds = new ChannelCredentials(store);
  db = new Database(":memory:");
  applySchema(db);
  insertChannel(db, { id: ID, platform: "webhook", label: "Deploy", settings: { ingressPort: 7700 }, enabled: true });
  seen = [];
  answer = { status: 200, text: "{}" };
  listenerSecret = "";
});
afterEach(() => {
  installProviderKeyStore(null);
  rmSync(dir, { recursive: true, force: true });
});

describe("webhook-info", () => {
  it("renders the framework's info against the loopback ingress, with the placeholder secret", async () => {
    const r = await call("GET", `/api/channels/${ID}/webhook-info`);
    expect(r.status).toBe(200);
    const info = (r.json.info ?? {}) as { method: string; path: string; url: string; contentType: string; signature: Record<string, unknown>; examples: { curl: string; node: string; openssl: string } };
    expect(info.method).toBe("POST");
    expect(info.url).toBe(`http://127.0.0.1:7700/channels/${ID}`);
    expect(info.signature.header).toBe("x-channels-signature");
    expect(info.signature.timestampHeader).toBe("x-channels-timestamp");
    expect(info.signature.algorithm).toBe("HMAC-SHA256");
    expect(info.examples.curl).toContain("$WEBHOOK_SECRET");
    expect(r.json.loopbackOnly).toBe(true);
    expect(r.json.customRoute).toBe(false);
  });

  it("a custom path replaces the default in the path, URL and every example", async () => {
    db.run("UPDATE cortex_channels SET settings_json = ? WHERE id = ?", [JSON.stringify({ ingressPort: 7700, route: "/hooks/deploy" }), ID]);
    const r = await call("GET", `/api/channels/${ID}/webhook-info`);
    const info = r.json.info as { path: string; url: string; examples: { curl: string; node: string; openssl: string } };
    expect(info.path).toBe("/hooks/deploy");
    expect(info.url).toBe("http://127.0.0.1:7700/hooks/deploy");
    expect(info.examples.curl).toContain("http://127.0.0.1:7700/hooks/deploy");
    expect(info.examples.curl).not.toContain(`/channels/${ID}`);
    expect(r.json.customRoute).toBe(true);
  });

  it("a channel not in the hub takes the typed port; no port gives the path only; a non-webhook channel is refused", async () => {
    const typed = await call("GET", "/api/channels/ch-legacy01/webhook-info?ingressPort=7801");
    expect((typed.json.info as { url: string }).url).toBe("http://127.0.0.1:7801/channels/ch-legacy01");
    const bare = await call("GET", "/api/channels/ch-legacy01/webhook-info");
    expect((bare.json.info as { url?: string }).url).toBeUndefined();
    insertChannel(db, { id: "ch-tg000001", platform: "telegram", label: null, settings: {}, enabled: true });
    expect((await call("GET", "/api/channels/ch-tg000001/webhook-info")).status).toBe(400);
    expect((await call("GET", "/api/channels/ch-legacy01/webhook-info?route=/../x%3Fy")).status).toBe(400);
  });
});

describe("webhook-secret", () => {
  it("generates once, stores it sealed, and no later response echoes it", async () => {
    const gen = await call("POST", `/api/channels/${ID}/webhook-secret`);
    expect(gen.status).toBe(200);
    const secret = String(gen.json.secret);
    expect(secret).toMatch(/^whsec_[0-9a-f]{64}$/);
    expect(creds.value(ID, "secret")).toBe(secret);
    const second = String((await call("POST", `/api/channels/${ID}/webhook-secret`)).json.secret);
    expect(second).not.toBe(secret);
    expect(creds.value(ID, "secret")).toBe(second);

    const info = await call("GET", `/api/channels/${ID}/webhook-info`);
    listenerSecret = second;
    const test = await call("POST", `/api/channels/${ID}/webhook-test`, {});
    for (const r of [info, test]) {
      expect(r.text).not.toContain(second);
      expect(r.text).not.toContain(secret);
    }
  });

  it("refuses a non-webhook channel and a malformed id", async () => {
    insertChannel(db, { id: "ch-tg000001", platform: "telegram", label: null, settings: {}, enabled: true });
    expect((await call("POST", "/api/channels/ch-tg000001/webhook-secret")).status).toBe(400);
    expect((await call("POST", "/api/channels/X/webhook-secret")).status).toBe(400);
  });
});

describe("webhook-test", () => {
  it("posts a body signed with the saved secret to the local ingress and reports accepted", async () => {
    creds.set(ID, "webhook", "secret", "whsec_known-secret-value");
    listenerSecret = "whsec_known-secret-value";
    const r = await call("POST", `/api/channels/${ID}/webhook-test`, {});
    expect(r.json).toEqual({ ok: true, status: 200, detail: "Accepted (200)." });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(`http://127.0.0.1:7700/channels/${ID}`);
    expect(seen[0]?.headers["content-type"]).toBe("application/json");
    expect(r.text).not.toContain("whsec_known-secret-value");
  });

  it("a refused signature shows the reason, scrubbed of the secret", async () => {
    creds.set(ID, "webhook", "secret", "whsec_known-secret-value");
    listenerSecret = "whsec_a-different-secret";
    const r = await call("POST", `/api/channels/${ID}/webhook-test`, {});
    expect(r.json.ok).toBe(false);
    expect(r.json.status).toBe(401);
    expect(String(r.json.detail)).toContain("signature did not verify");
    answer = { status: 500, text: "boom whsec_known-secret-value" };
    listenerSecret = "whsec_known-secret-value";
    const echoed = await call("POST", `/api/channels/${ID}/webhook-test`, {});
    expect(echoed.text).not.toContain("whsec_known-secret-value");
  });

  it("says plainly when nothing listens, or no secret or port is set", async () => {
    expect((await call("POST", `/api/channels/${ID}/webhook-test`, {})).json.detail).toBe("No signing secret saved.");
    creds.set(ID, "webhook", "secret", "whsec_known-secret-value");
    answer = "down";
    const down = await call("POST", `/api/channels/${ID}/webhook-test`, {});
    expect(down.json.ok).toBe(false);
    expect(String(down.json.detail)).toContain("Nothing answered at 127.0.0.1:7700");
    insertChannel(db, { id: "ch-noport01", platform: "webhook", label: null, settings: {}, enabled: true });
    creds.set("ch-noport01", "webhook", "secret", "whsec_known-secret-value");
    expect((await call("POST", "/api/channels/ch-noport01/webhook-test", {})).json.detail).toBe("No listen port set.");
  });
});
