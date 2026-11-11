import { describe, expect, test } from "bun:test";
import { get } from "svelte/store";
import { bulkDeleteConfirmMessage, createGatewayAgentsStore, pruneSelection, type GatewayRow } from "./gateway-agents-store.js";
import { defaultConfig } from "../types/agent-config.js";

type Call = { url: string; method: string; body?: unknown };

function fakeFetch(routes: Record<string, (c: Call) => { status?: number; body?: unknown } | "throw">) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = { url: String(input), method: init?.method ?? "GET", ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) };
    calls.push(call);
    const key = `${call.method} ${call.url.replace("http://x", "")}`;
    const route = Object.entries(routes).find(([k]) => key.startsWith(k))?.[1];
    const r = route ? route(call) : { status: 404 };
    if (r === "throw") throw new Error("network");
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { fn, calls };
}

const row = (agentId: string, name = agentId): GatewayRow => ({ agentId, name, config: defaultConfig(), status: "active", runCount: 0, agentType: "gateway" });

describe("gateway agents store", () => {
  test("load maps agent type and merges config over defaults", async () => {
    const { fn } = fakeFetch({
      "GET /api/agents": () => ({ body: [
        { agentId: "gateway-1", name: "g", config: { model: "m1" }, status: "active", runCount: 1 },
        { agentId: "agent-2", name: "a", config: {}, status: "active", runCount: 0 },
        { agentId: "x-3", name: "b", type: "ad-hoc", status: "active", runCount: 0 },
      ] }),
    });
    const store = createGatewayAgentsStore("http://x", fn);
    const list = await store.load({ ...defaultConfig(), provider: "ollama" });
    expect(list?.map((a) => a.agentType)).toEqual(["gateway", "ad-hoc", "ad-hoc"]);
    expect(list?.[0]?.config).toMatchObject({ provider: "ollama", model: "m1" });
    expect(get(store)).toMatchObject({ loading: false });
    expect(get(store).agents).toHaveLength(3);
  });

  test("a failed load empties the list and reports null", async () => {
    const store = createGatewayAgentsStore("http://x", fakeFetch({ "GET /api/agents": () => "throw" }).fn);
    expect(await store.load(defaultConfig())).toBeNull();
    expect(get(store).agents).toEqual([]);
  });

  test("save POSTs a new agent and PATCHes an existing one; non-2xx throws", async () => {
    const { fn, calls } = fakeFetch({ "POST /api/agents": () => ({ body: { runId: "r1" } }), "PATCH /api/agents/a1": () => ({ status: 500 }) });
    const store = createGatewayAgentsStore("http://x", fn);
    const body = { name: "n", type: "ad-hoc" as const, config: defaultConfig(), schedule: null, runNow: true };
    expect(await store.save(null, body)).toEqual({ runId: "r1" });
    expect(calls[0]).toMatchObject({ method: "POST", body: { name: "n", runNow: true } });
    await expect(store.save("a1", body)).rejects.toThrow("Server error 500");
  });

  test("trigger sends variable values only when given", async () => {
    const { fn, calls } = fakeFetch({ "POST /api/agents/a1/trigger": () => ({ body: { runId: "r" } }) });
    const store = createGatewayAgentsStore("http://x", fn);
    expect(await store.trigger("a1")).toEqual({ ok: true, status: 200, data: { runId: "r" } });
    await store.trigger("a1", { topic: "x" });
    expect(calls.map((c) => c.body)).toEqual([{}, { variableValues: { topic: "x" } }]);
  });

  test("toggleStatus pauses an active agent and activates others", async () => {
    const { fn, calls } = fakeFetch({ "PATCH /api/agents/": () => ({}) });
    const store = createGatewayAgentsStore("http://x", fn);
    await store.toggleStatus(row("a1"));
    await store.toggleStatus({ ...row("a2"), status: "paused" });
    expect(calls.map((c) => c.body)).toEqual([{ status: "paused" }, { status: "active" }]);
  });

  test("removeMany counts failures, network errors included", async () => {
    const { fn } = fakeFetch({ "DELETE /api/agents/ok": () => ({}), "DELETE /api/agents/bad": () => ({ status: 500 }), "DELETE /api/agents/net": () => "throw" });
    const store = createGatewayAgentsStore("http://x", fn);
    expect(await store.removeMany([row("ok"), row("bad"), row("net")])).toBe(2);
  });

  test("loadStats stores object replies", async () => {
    const { fn } = fakeFetch({ "GET /api/agents/a1/stats": () => ({ body: { runCount: 2, successRate: 1, avgTokens: 10, totalCostUsd: 0 } }) });
    const store = createGatewayAgentsStore("http://x", fn);
    await store.loadStats("a1");
    expect(get(store).stats.a1?.runCount).toBe(2);
  });
});

describe("helpers", () => {
  test("pruneSelection keeps ids still listed", () => {
    expect([...pruneSelection(new Set(["a", "gone"]), [row("a"), row("b")])]).toEqual(["a"]);
  });
  test("bulk delete message names six and counts the rest", () => {
    const msg = bulkDeleteConfirmMessage(Array.from({ length: 8 }, (_, i) => row(`a${i}`)));
    expect(msg).toStartWith("This permanently deletes 8 saved agents");
    expect(msg).toContain("· a5");
    expect(msg).not.toContain("· a6");
    expect(msg).toEndWith("… and 2 more");
    expect(bulkDeleteConfirmMessage([row("x")])).toContain("1 saved agent and");
  });
});
