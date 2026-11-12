import { describe, expect, it } from "bun:test";
import { deleteCredential, fetchCredentials, saveCredential, testChannel, type Fetcher } from "./gateway-api.js";
import { fetchGatewayStatus } from "./gateway-overview.js";

const reply = (status: number, body: unknown): Fetcher => async () => new Response(JSON.stringify(body), { status });

describe("gateway api", () => {
  it("saveCredential sends the value once in the body and returns only the mask", async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const f: Fetcher = async (url, init) => {
      seen = { url, ...(init ? { init } : {}) };
      return new Response(JSON.stringify({ field: "token", masked: "••••gh", updatedAt: 5 }), { status: 200 });
    };
    const r = await saveCredential("", f, "ch-aaaa1111", "telegram", "token", "123:SECRET-token-value");
    expect(seen?.url).toBe("/api/gateway/channels/ch-aaaa1111/credentials/token");
    expect(seen?.init?.method).toBe("PUT");
    expect(JSON.parse(String(seen?.init?.body))).toEqual({ kind: "telegram", value: "123:SECRET-token-value" });
    expect(r).toEqual({ ok: true, value: { field: "token", masked: "••••gh", updatedAt: 5 } });
    expect(JSON.stringify(r)).not.toContain("SECRET");
  });

  it("fetchCredentials and deleteCredential parse the field list", async () => {
    const body = { fields: [{ field: "token", masked: null, updatedAt: null }] };
    expect(await fetchCredentials("", reply(200, body), "ch-aaaa1111", "telegram")).toEqual({ ok: true, value: [{ field: "token", masked: null, updatedAt: null }] });
    expect((await deleteCredential("", reply(200, body), "ch-aaaa1111", "telegram", "token")).ok).toBe(true);
  });

  it("surfaces the server's error message, and a network failure as text", async () => {
    expect(await saveCredential("", reply(400, { error: "invalid channel id" }), "x", "telegram", "token", "v")).toEqual({ ok: false, error: "invalid channel id" });
    const down: Fetcher = async () => {
      throw new Error("connection refused");
    };
    expect(await fetchCredentials("", down, "x", "telegram")).toEqual({ ok: false, error: "connection refused" });
  });

  it("a malformed answer is an error, not a crash", async () => {
    expect((await fetchCredentials("", reply(200, { nope: 1 }), "x", "telegram")).ok).toBe(false);
    expect((await testChannel("", reply(200, { ok: "yes" }), { channelId: "x", kind: "telegram", settings: {} })).ok).toBe(false);
  });

  it("testChannel posts the typed credential and returns ok + detail", async () => {
    let body: unknown;
    const f: Fetcher = async (_u, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ ok: true, detail: "Connected as @bot." }), { status: 200 });
    };
    const r = await testChannel("", f, { channelId: "ch-aaaa1111", kind: "telegram", settings: {}, credentials: { token: "typed" } });
    expect(body).toEqual({ channelId: "ch-aaaa1111", kind: "telegram", settings: {}, credentials: { token: "typed" } });
    expect(r).toEqual({ ok: true, value: { ok: true, detail: "Connected as @bot." } });
  });

  it("fetchGatewayStatus returns the agents list", async () => {
    expect(await fetchGatewayStatus("", reply(200, { agents: [] }))).toEqual({ ok: true, value: [] });
    expect((await fetchGatewayStatus("", reply(500, {}))).ok).toBe(false);
    expect((await fetchGatewayStatus("", reply(200, { agents: "x" }))).ok).toBe(false);
  });
});
