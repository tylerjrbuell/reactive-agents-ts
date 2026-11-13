import { describe, expect, it } from "bun:test";
import { fetchHub, probeHub, routePatch, saveHubRoute } from "./channel-hub-api.js";
import type { HubRouteWire } from "./channel-hub.js";

const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });
const route: HubRouteWire = { id: "r1", match: { channelId: "c" }, target: { agentId: "a" }, owners: ["telegram:1"], maxCostPerDayUsd: 2 };

describe("routePatch", () => {
  it("nulls what the next route no longer has so the server clears it", () => {
    const { maxCostPerDayUsd: _c, ...next } = route;
    const patch = routePatch(route, next);
    expect(patch.maxCostPerDayUsd).toBeNull();
    expect(patch.owners).toEqual(["telegram:1"]);
    expect("id" in patch).toBe(false);
  });
});

describe("saveHubRoute", () => {
  it("a 409 confirmation_required comes back as the tokens to confirm, not as an error to show", async () => {
    const r = await saveHubRoute("", reply(409, { error: "confirmation_required", required: ["open:r1"] }), route, undefined, []);
    expect(r).toMatchObject({ ok: false, needsConfirm: ["open:r1"] });
  });
  it("sends confirm only when there is something to confirm, POST to create and PATCH to change", async () => {
    const seen: { url: string; method?: string; body: Record<string, unknown> }[] = [];
    const f = async (url: string, init?: RequestInit) => {
      seen.push({ url, method: init?.method, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(JSON.stringify(route), { status: 200 });
    };
    await saveHubRoute("", f, route, undefined, []);
    await saveHubRoute("", f, route, route, ["owners:r1"]);
    expect(seen[0]).toMatchObject({ url: "/api/channels/routes", method: "POST" });
    expect("confirm" in seen[0]!.body).toBe(false);
    expect(seen[1]).toMatchObject({ url: "/api/channels/routes/r1", method: "PATCH" });
    expect(seen[1]!.body.confirm).toEqual(["owners:r1"]);
  });
  it("other refusals carry the server's reason", async () => {
    const r = await saveHubRoute("", reply(400, { error: "open routes need caps" }), route, undefined, []);
    expect(r).toEqual({ ok: false, error: "open routes need caps" });
  });
});

describe("fetchHub", () => {
  it("reads masks and nothing else about a credential", async () => {
    const r = await fetchHub("", reply(200, { hubEnabled: true, channels: [{ id: "ch-1", platform: "telegram", label: null, enabled: true, settings: {}, credentials: [{ field: "token", masked: "••••abcd", updatedAt: 1 }] }], routes: [route], rejected: [{ routeId: "bad", reason: "x" }] }));
    expect(r.ok && r.value.channels[0]?.credentials).toEqual([{ field: "token", masked: "••••abcd" }]);
    expect(r.ok && r.value.rejected).toEqual([{ id: "bad", reason: "x" }]);
  });
  it("drops a channel of an unknown kind", async () => {
    const r = await fetchHub("", reply(200, { channels: [{ id: "x", platform: "irc" }], routes: [] }));
    expect(r.ok && r.value.channels).toEqual([]);
  });
});

describe("probeHub", () => {
  it("explain only when asked not to run; both when run", async () => {
    const urls: string[] = [];
    const f = async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ decision: "allowed" }), { status: 200 });
    };
    await probeHub("", f, { channelId: "c", userId: "telegram:1", text: "hi" }, false);
    expect(urls).toEqual(["/api/channels/explain"]);
    await probeHub("", f, { channelId: "c", userId: "telegram:1", text: "hi" }, true);
    expect(urls.slice(1)).toEqual(["/api/channels/explain", "/api/channels/simulate"]);
  });
  it("a 503 (channel not running) surfaces the server's sentence", async () => {
    const r = await probeHub("", reply(503, { error: "The channel hub is not running that channel." }), { channelId: "c", userId: "u", text: "t" }, true);
    expect(r).toEqual({ ok: false, error: "The channel hub is not running that channel." });
  });
});
