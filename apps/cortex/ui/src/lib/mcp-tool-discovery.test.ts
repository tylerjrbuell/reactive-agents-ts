import { describe, expect, test } from "bun:test";
import { discoverMcpServerTools, runMcpDiscovery, serversToDiscover, type McpDiscoveryState } from "./mcp-tool-discovery.js";

const reply = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status });

describe("discoverMcpServerTools", () => {
  test("returns tool names on success", async () => {
    const f = (async () => reply(200, { ok: true, tools: [{ toolName: "docs/search" }, { toolName: "docs/read" }] })) as unknown as typeof fetch;
    expect(await discoverMcpServerTools("s1", f)).toEqual({ ok: true, tools: ["docs/search", "docs/read"] });
  });
  test("returns the server's reason on failure", async () => {
    const f = (async () => reply(502, { error: "connect refused" })) as unknown as typeof fetch;
    expect(await discoverMcpServerTools("s1", f)).toEqual({ ok: false, error: "connect refused" });
  });
  test("a network error is a failure, not a throw", async () => {
    const f = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await discoverMcpServerTools("s1", f)).toEqual({ ok: false, error: "offline" });
  });
});

describe("runMcpDiscovery", () => {
  const harness = () => {
    let state: Record<string, McpDiscoveryState> = {};
    const seen: string[] = [];
    return {
      seen,
      get: () => state,
      deps: (discover: Parameters<typeof runMcpDiscovery>[1]["discover"]) => ({
        state: () => state,
        setState: (n: Record<string, McpDiscoveryState>) => { state = n; seen.push(Object.values(n).map((v) => v.status).join(",")); },
        reload: async () => void seen.push("reload"),
        discover,
      }),
    };
  };
  test("loading, then reload and cleared on success", async () => {
    const h = harness();
    await runMcpDiscovery("s1", h.deps(async () => ({ ok: true, tools: ["a/b"] })));
    expect(h.seen).toEqual(["loading", "reload", ""]);
    expect(h.get()).toEqual({});
  });
  test("failure keeps the reason", async () => {
    const h = harness();
    await runMcpDiscovery("s1", h.deps(async () => ({ ok: false, error: "boom" })));
    expect(h.get()).toEqual({ s1: { status: "failed", error: "boom" } });
  });
  test("a running listing is not started twice", async () => {
    const h = harness();
    let calls = 0;
    const d = h.deps(async () => { calls++; return { ok: true as const, tools: [] }; });
    const first = runMcpDiscovery("s1", d);
    await runMcpDiscovery("s1", d);
    await first;
    expect(calls).toBe(1);
  });
});

describe("serversToDiscover", () => {
  const servers = [{ serverId: "a", tools: [] }, { serverId: "b", tools: ["b/x"] }, { serverId: "c", tools: [] }];
  test("attached, empty, untried only", () => {
    expect(serversToDiscover(["a", "b", "c"], servers, { c: { status: "failed", error: "x" } })).toEqual(["a"]);
  });
});
