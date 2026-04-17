// Run: bun test packages/tools/tests/skills/web-search.test.ts --timeout 15000
import { describe, it, expect, afterEach } from "bun:test";
import { Effect } from "effect";
import { webSearchHandler } from "../../src/skills/web-search.js";
import { ToolExecutionError } from "../../src/errors.js";

const originalFetch = globalThis.fetch;
const originalEnv: Record<string, string | undefined> = {};

function stashEnv(key: string) {
  if (!(key in originalEnv)) originalEnv[key] = process.env[key];
}

function restoreAllEnv() {
  for (const [k, v] of Object.entries(originalEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of Object.keys(originalEnv)) delete originalEnv[k];
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreAllEnv();
});

describe("webSearchHandler — provider chain", () => {
  it("uses Tavily when configured and Tavily returns results", async () => {
    stashEnv("TAVILY_API_KEY");
    stashEnv("BRAVE_SEARCH_API_KEY");
    stashEnv("BRAVE_API_KEY");
    process.env.TAVILY_API_KEY = "tv-test";
    delete process.env.BRAVE_SEARCH_API_KEY;
    delete process.env.BRAVE_API_KEY;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (href.includes("api.tavily.com")) {
        expect(init?.method).toBe("POST");
        return new Response(
          JSON.stringify({
            results: [
              { title: "A", url: "https://a.example", content: "snippet a", score: 1 },
              { title: "B", url: "https://b.example", content: "snippet b", score: 0.9 },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch: ${href}`);
    }) as typeof fetch;

    const result = await Effect.runPromise(webSearchHandler({ query: "q1", maxResults: 2 }));
    expect(result.provider).toBe("tavily");
    expect(result.results).toHaveLength(2);
    expect(result.results[0]?.url).toBe("https://a.example");
  });

  it("falls back to Brave when Tavily fails but Brave key is set", async () => {
    stashEnv("TAVILY_API_KEY");
    stashEnv("BRAVE_SEARCH_API_KEY");
    process.env.TAVILY_API_KEY = "tv-bad";
    process.env.BRAVE_SEARCH_API_KEY = "brave-test";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (href.includes("api.tavily.com")) {
        return new Response("{}", { status: 500 });
      }
      if (href.includes("api.search.brave.com")) {
        expect(href).toContain("q=q1");
        return new Response(
          JSON.stringify({
            web: {
              results: [{ title: "Brave hit", url: "https://brave.example/x", description: "desc" }],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch: ${href}`);
    }) as typeof fetch;

    const result = await Effect.runPromise(webSearchHandler({ query: "q1" }));
    expect(result.provider).toBe("brave");
    expect(result.results[0]?.title).toBe("Brave hit");
  });

  it("falls back to Brave when Tavily returns 432 plan limit with JSON body", async () => {
    stashEnv("TAVILY_API_KEY");
    stashEnv("BRAVE_SEARCH_API_KEY");
    process.env.TAVILY_API_KEY = "tv-quota";
    process.env.BRAVE_SEARCH_API_KEY = "brave-test";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (href.includes("api.tavily.com")) {
        return new Response(
          JSON.stringify({
            detail: {
              error: "This request exceeds your plan's set usage limit.",
            },
          }),
          { status: 432, headers: { "Content-Type": "application/json" } },
        );
      }
      if (href.includes("api.search.brave.com")) {
        return new Response(
          JSON.stringify({
            web: {
              results: [{ title: "From Brave", url: "https://example.com/b", description: "snippet" }],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch: ${href}`);
    }) as typeof fetch;

    const result = await Effect.runPromise(webSearchHandler({ query: "quota-fallback" }));
    expect(result.provider).toBe("brave");
    expect(result.results[0]?.url).toBe("https://example.com/b");
  });

  it("uses DuckDuckGo when no API keys and DDG returns data", async () => {
    stashEnv("TAVILY_API_KEY");
    stashEnv("BRAVE_SEARCH_API_KEY");
    stashEnv("BRAVE_API_KEY");
    delete process.env.TAVILY_API_KEY;
    delete process.env.BRAVE_SEARCH_API_KEY;
    delete process.env.BRAVE_API_KEY;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (href.includes("api.duckduckgo.com")) {
        return new Response(
          JSON.stringify({
            Heading: "Topic",
            AbstractSource: "Wikipedia",
            AbstractURL: "https://en.wikipedia.org/wiki/Topic",
            AbstractText: "Abstract body.",
            RelatedTopics: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch: ${href}`);
    }) as typeof fetch;

    const result = await Effect.runPromise(webSearchHandler({ query: "topic" }));
    expect(result.provider).toBe("duckduckgo");
    expect(result.results.length).toBeGreaterThanOrEqual(1);
    expect(result.results[0]?.content).toContain("Abstract body");
  });

  it("falls back to Serper when Tavily fails and SERPER_API_KEY is set", async () => {
    stashEnv("TAVILY_API_KEY");
    stashEnv("BRAVE_SEARCH_API_KEY");
    stashEnv("BRAVE_API_KEY");
    stashEnv("SERPER_API_KEY");
    process.env.TAVILY_API_KEY = "tv-bad";
    delete process.env.BRAVE_SEARCH_API_KEY;
    delete process.env.BRAVE_API_KEY;
    process.env.SERPER_API_KEY = "serper-test";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (href.includes("api.tavily.com")) {
        return new Response("{}", { status: 500 });
      }
      if (href.includes("google.serper.dev")) {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(init?.body as string);
        expect(body.q).toBe("serper-query");
        return new Response(
          JSON.stringify({
            organic: [
              { title: "Serper hit", link: "https://serper.example/r", snippet: "good snippet" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch: ${href}`);
    }) as typeof fetch;

    const result = await Effect.runPromise(webSearchHandler({ query: "serper-query" }));
    expect(result.provider).toBe("serper");
    expect(result.results[0]?.url).toBe("https://serper.example/r");
    expect(result.results[0]?.title).toBe("Serper hit");
  });

  it("falls back to Serper when Tavily returns 432 plan limit and no Brave key", async () => {
    stashEnv("TAVILY_API_KEY");
    stashEnv("BRAVE_SEARCH_API_KEY");
    stashEnv("BRAVE_API_KEY");
    stashEnv("SERPER_API_KEY");
    process.env.TAVILY_API_KEY = "tv-quota";
    delete process.env.BRAVE_SEARCH_API_KEY;
    delete process.env.BRAVE_API_KEY;
    process.env.SERPER_API_KEY = "serper-free";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (href.includes("api.tavily.com")) {
        return new Response(
          JSON.stringify({ detail: { error: "This request exceeds your plan's set usage limit." } }),
          { status: 432, headers: { "Content-Type": "application/json" } },
        );
      }
      if (href.includes("google.serper.dev")) {
        return new Response(
          JSON.stringify({
            organic: [{ title: "Result", link: "https://example.com/s", snippet: "snippet" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch: ${href}`);
    }) as typeof fetch;

    const result = await Effect.runPromise(webSearchHandler({ query: "quota test" }));
    expect(result.provider).toBe("serper");
    expect(result.results.length).toBeGreaterThan(0);
  });

  it("returns ToolExecutionError when all providers yield nothing", async () => {
    stashEnv("TAVILY_API_KEY");
    stashEnv("BRAVE_SEARCH_API_KEY");
    stashEnv("BRAVE_API_KEY");
    stashEnv("SERPER_API_KEY");
    delete process.env.TAVILY_API_KEY;
    delete process.env.BRAVE_SEARCH_API_KEY;
    delete process.env.BRAVE_API_KEY;
    delete process.env.SERPER_API_KEY;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (href.includes("api.duckduckgo.com")) {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch: ${href}`);
    }) as typeof fetch;

    const err = await Effect.runPromise(webSearchHandler({ query: "zzz" }).pipe(Effect.flip));
    expect(err).toBeInstanceOf(ToolExecutionError);
    expect((err as ToolExecutionError).message).toContain("BRAVE_SEARCH_API_KEY");
    expect((err as ToolExecutionError).message).toContain("zzz");
  });
});
