import { describe, expect, test } from "bun:test";
import {
  createCustomTool,
  fetchCatalog,
  fetchServers,
  fetchServerTools,
  importServersJson,
  invokeTool,
  patchCustomTool,
  refreshServerTools,
  saveServer,
  saveServerSecrets,
  setServerEnabled,
  testServer,
  type ApiCtx,
} from "./tools-page-data.js";

type Seen = { url: string; method: string; body: unknown };

/** A fetch that answers one canned reply and records what was asked. */
function fake(status: number, reply: unknown, seen: Seen[] = []): ApiCtx {
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    return new Response(typeof reply === "string" ? reply : JSON.stringify(reply), { status });
  }) as typeof fetch;
  return { base: "http://c", fetchFn };
}

describe("reads", () => {
  test("servers and catalog are plain lists; a non-list answer is empty", async () => {
    const rows = [{ serverId: "a", name: "x", config: {}, tools: [] }];
    expect(await fetchServers(fake(200, rows))).toEqual({ ok: true, value: rows });
    expect(await fetchCatalog(fake(200, { nope: 1 }))).toEqual({ ok: true, value: [] });
  });

  test("server tools come from the tools key, schema included", async () => {
    const seen: Seen[] = [];
    const r = await fetchServerTools(fake(200, { tools: [{ toolName: "a", inputSchema: { type: "object" } }] }, seen), "s 1");
    expect(r).toEqual({ ok: true, value: [{ toolName: "a", inputSchema: { type: "object" } }] });
    expect(seen[0]?.url).toBe("http://c/api/mcp-servers/s%201/tools");
  });

  test("an error answer carries the server's sentence; a non-JSON one says what to do", async () => {
    expect(await fetchServerTools(fake(404, { error: "MCP server not found" }), "x")).toEqual({ ok: false, error: "MCP server not found" });
    const html = await fetchServers(fake(404, "NOT_FOUND"));
    expect(html.ok).toBe(false);
    if (!html.ok) expect(html.error).toContain("Restart Cortex");
  });

  test("a network failure is an error result, never a throw", async () => {
    const failing = Object.assign(
      async (): Promise<Response> => {
        throw new TypeError("fetch failed");
      },
      { preconnect: () => {} },
    );
    const ctx: ApiCtx = { base: "http://c", fetchFn: failing };
    expect(await fetchServers(ctx)).toEqual({ ok: false, error: "fetch failed" });
  });
});

describe("server actions", () => {
  test("test: a failed probe is an answer (HTTP 200, ok false), a passing one has the count", async () => {
    expect(await testServer(fake(200, { ok: false, error: "spawn ENOENT", checkedAt: 1 }), "s")).toEqual({ ok: true, value: { ok: false, error: "spawn ENOENT" } });
    expect(await testServer(fake(200, { ok: true, toolCount: 4, checkedAt: 9 }), "s")).toEqual({ ok: true, value: { ok: true, toolCount: 4, checkedAt: 9 } });
  });

  test("test posts to /:id/test with no body; refresh counts the tools", async () => {
    const seen: Seen[] = [];
    await testServer(fake(200, { ok: true, toolCount: 0 }, seen), "s");
    expect(seen[0]).toMatchObject({ url: "http://c/api/mcp-servers/s/test", method: "POST" });
    expect(await refreshServerTools(fake(200, { tools: [{}, {}] }), "s")).toEqual({ ok: true, value: 2 });
  });

  test("a background check asks for the short cap in the query; the manual Test sends none", async () => {
    const seen: Seen[] = [];
    await testServer(fake(200, { ok: true, toolCount: 0 }, seen), "s", { timeoutMs: 15_000 });
    await testServer(fake(200, { ok: true, toolCount: 0 }, seen), "s");
    expect(seen.map((s) => s.url)).toEqual(["http://c/api/mcp-servers/s/test?timeoutMs=15000", "http://c/api/mcp-servers/s/test"]);
  });

  test("enable and secrets send the documented bodies", async () => {
    const seen: Seen[] = [];
    expect(await setServerEnabled(fake(200, { ok: true, enabled: false }, seen), "s", false)).toEqual({ ok: true, value: false });
    expect(seen[0]).toMatchObject({ method: "PATCH", url: "http://c/api/mcp-servers/s/enabled", body: { enabled: false } });
    const s2: Seen[] = [];
    const r = await saveServerSecrets(fake(200, { ok: true, env: ["TOKEN"], headers: [] }, s2), "s", { env: { set: { TOKEN: "x" } } });
    expect(r).toEqual({ ok: true, value: { env: ["TOKEN"], headers: [] } });
    expect(s2[0]).toMatchObject({ method: "PUT", url: "http://c/api/mcp-servers/s/secrets", body: { env: { set: { TOKEN: "x" } } } });
  });

  test("save: POST for a new server (returns its id), PATCH for an existing one", async () => {
    const a: Seen[] = [];
    expect(await saveServer(fake(200, { serverId: "new", name: "n" }, a), { name: "n" })).toEqual({ ok: true, value: "new" });
    expect(a[0]).toMatchObject({ method: "POST", url: "http://c/api/mcp-servers" });
    const b: Seen[] = [];
    expect(await saveServer(fake(200, { ok: true }, b), { name: "n" }, "s1")).toEqual({ ok: true, value: "s1" });
    expect(b[0]).toMatchObject({ method: "PATCH", url: "http://c/api/mcp-servers/s1" });
  });

  test("import goes to the one /api/mcp-servers/import-json route and never the old tools alias", async () => {
    const seen: Seen[] = [];
    const r = await importServersJson(fake(200, { ok: true, count: 1, created: [{ serverId: "a", name: "ctx" }] }, seen), "{}");
    expect(r).toEqual({ ok: true, value: [{ serverId: "a", name: "ctx" }] });
    expect(seen.map((s) => s.url)).toEqual(["http://c/api/mcp-servers/import-json"]);
  });
});

describe("custom tools and invoke", () => {
  test("create and patch", async () => {
    expect(await createCustomTool(fake(200, { toolId: "t1" }), { name: "n", description: "d", parameters: [] })).toEqual({ ok: true, value: "t1" });
    const seen: Seen[] = [];
    await patchCustomTool(fake(200, { ok: true }, seen), "t1", { description: "new" });
    expect(seen[0]).toMatchObject({ method: "PATCH", url: "http://c/api/tools/lab-custom/t1", body: { description: "new" } });
    expect(await patchCustomTool(fake(400, { error: "name must be kebab-case (letters, numbers, hyphens)" }), "t1", { name: "Bad" })).toEqual({
      ok: false,
      error: "name must be kebab-case (letters, numbers, hyphens)",
    });
  });

  test("invoke: a 409 approval ask is a reply; approved adds the flag", async () => {
    const seen: Seen[] = [];
    const r = await invokeTool(fake(409, { error: "Run shell?", approvalRequired: true }, seen), "t", { a: 1 }, false);
    expect(r).toEqual({ ok: true, value: { status: 409, error: "Run shell?", approvalRequired: true } });
    expect(seen[0]?.body).toEqual({ toolId: "t", arguments: { a: 1 } });
    const s2: Seen[] = [];
    await invokeTool(fake(200, { ok: true, success: true, result: { x: 1 }, executionTimeMs: 5 }, s2), "t", {}, true);
    expect(s2[0]?.body).toEqual({ toolId: "t", arguments: {}, approved: true });
  });
});
