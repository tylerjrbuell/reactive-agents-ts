// Run: bun test packages/tools/tests/skills/web-search-explicit-keys.test.ts --timeout 15000
import { describe, it, expect, afterEach } from "bun:test";
import { Effect, Redacted } from "effect";
import {
  makeWebSearchHandler,
  webSearchHandler,
  WEB_SEARCH_PROVIDERS,
} from "../../src/skills/web-search.js";

const originalFetch = globalThis.fetch;
const ENV_KEYS = [
  "TAVILY_API_KEY",
  "BRAVE_SEARCH_API_KEY",
  "BRAVE_API_KEY",
  "SERPER_API_KEY",
  "KEENABLE_API_KEY",
] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const tavilyRows = { results: [{ title: "T", url: "https://t.example", content: "c" }] };
const serperRows = { organic: [{ title: "S", link: "https://s.example", snippet: "c" }] };
const hrefOf = (i: RequestInfo | URL) =>
  typeof i === "string" ? i : i instanceof URL ? i.href : i.url;

describe("makeWebSearchHandler — explicit keys", () => {
  it("exports the provider list in default order", () => {
    expect(WEB_SEARCH_PROVIDERS.map((p) => p.id)).toEqual([
      "tavily", "brave", "serper", "keenable", "duckduckgo",
    ]);
  });

  it("explicit key beats env", async () => {
    clearEnv();
    process.env.TAVILY_API_KEY = "env-key";
    let sent = "";
    globalThis.fetch = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      sent = String(init?.body);
      return ok(tavilyRows);
    }) as typeof fetch;
    const r = await Effect.runPromise(
      makeWebSearchHandler({ apiKeys: { tavily: "explicit-key" } })({ query: "q" }),
    );
    expect(r.provider).toBe("tavily");
    expect(sent).toContain("explicit-key");
    expect(sent).not.toContain("env-key");
  });

  it("accepts Redacted keys", async () => {
    clearEnv();
    let sent = "";
    globalThis.fetch = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      sent = String(init?.body);
      return ok(tavilyRows);
    }) as typeof fetch;
    await Effect.runPromise(
      makeWebSearchHandler({ apiKeys: { tavily: Redacted.make("red-key") } })({ query: "q" }),
    );
    expect(sent).toContain("red-key");
  });

  it("falls back to env for providers without an explicit key", async () => {
    clearEnv();
    process.env.SERPER_API_KEY = "env-serper";
    globalThis.fetch = (async (i: RequestInfo | URL) => {
      if (hrefOf(i).includes("serper.dev")) return ok(serperRows);
      throw new Error("unexpected");
    }) as typeof fetch;
    const r = await Effect.runPromise(
      makeWebSearchHandler({ apiKeys: { tavily: "unused" } })({ query: "q" }),
    ).catch((e) => e);
    // tavily explicit key is tried first and throws on fetch -> serper env used
    expect((r as { provider: string }).provider).toBe("serper");
  });

  it("providers orders and limits the chain", async () => {
    clearEnv();
    const calls: string[] = [];
    globalThis.fetch = (async (i: RequestInfo | URL) => {
      const h = hrefOf(i);
      calls.push(h);
      if (h.includes("serper.dev")) return ok(serperRows);
      return ok(tavilyRows);
    }) as typeof fetch;
    const r = await Effect.runPromise(
      makeWebSearchHandler({
        apiKeys: { tavily: "a", serper: "b" },
        providers: ["serper", "tavily"],
      })({ query: "q" }),
    );
    expect(r.provider).toBe("serper");
    expect(calls.some((c) => c.includes("tavily"))).toBe(false);
  });

  it("omitting duckduckgo disables the keyless fallback", async () => {
    clearEnv();
    const calls: string[] = [];
    globalThis.fetch = (async (i: RequestInfo | URL) => {
      calls.push(hrefOf(i));
      return ok({});
    }) as typeof fetch;
    const exit = await Effect.runPromiseExit(
      makeWebSearchHandler({ providers: ["tavily"] })({ query: "q" }),
    );
    expect(exit._tag).toBe("Failure");
    expect(calls.length).toBe(0);
  });

  it("never leaks the key into error text", async () => {
    clearEnv();
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "bad key sk-secret-123" }), { status: 401 })) as typeof fetch;
    const exit = await Effect.runPromiseExit(
      makeWebSearchHandler({ apiKeys: { tavily: "sk-secret-123" }, providers: ["tavily"] })({
        query: "q",
      }),
    );
    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).not.toContain("sk-secret-123");
  });

  it("default handler still reads env", async () => {
    clearEnv();
    process.env.TAVILY_API_KEY = "env-key";
    globalThis.fetch = (async () => ok(tavilyRows)) as typeof fetch;
    const r = await Effect.runPromise(webSearchHandler({ query: "q" }));
    expect(r.provider).toBe("tavily");
  });
});
