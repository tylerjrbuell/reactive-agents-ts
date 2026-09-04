import { describe, it, expect, afterEach, mock } from "bun:test";
import { Effect } from "effect";
import { httpGetHandler } from "../src/skills/http-client.js";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

describe("httpGetHandler body handling", () => {
  it("returns plain text body untouched under the size cap", async () => {
    global.fetch = mock(
      async () => new Response("hello world", { status: 200, headers: { "content-type": "text/plain" } }),
    ) as unknown as typeof fetch;
    const result = (await Effect.runPromise(httpGetHandler()({ url: "https://example.com/" }))) as {
      body: unknown;
    };
    expect(result.body).toBe("hello world");
  });

  it("parses a JSON content-type response into an object", async () => {
    global.fetch = mock(
      async () =>
        new Response(JSON.stringify({ ok: true, n: 1 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const result = (await Effect.runPromise(httpGetHandler()({ url: "https://example.com/" }))) as {
      body: unknown;
    };
    expect(result.body).toEqual({ ok: true, n: 1 });
  });

  // 2026-09-03: nothing bounded response.text()/response.json() before this
  // fix — a pathological multi-MB body would be read and parsed in full
  // before compressToolResult (which only runs downstream, in the kernel)
  // ever got a chance to act.
  it("caps an oversized body before it is ever JSON-parsed, with a clear truncation message", async () => {
    const big = "Z".repeat(2_500_000);
    global.fetch = mock(
      async () => new Response(big, { status: 200, headers: { "content-type": "text/plain" } }),
    ) as unknown as typeof fetch;
    const result = (await Effect.runPromise(httpGetHandler()({ url: "https://example.com/" }))) as {
      body: unknown;
    };
    expect(typeof result.body).toBe("string");
    const body = result.body as string;
    expect(body.length).toBeLessThan(2_000_300); // 2M cap + truncation-message prefix, well short of the 2.5M raw body
    expect(body).toContain("Response body truncated");
    expect(body).toContain("2500000 chars");
  });

  it("falls back to raw text when content-type claims JSON but the body doesn't parse", async () => {
    global.fetch = mock(
      async () => new Response("not actually json", { status: 200, headers: { "content-type": "application/json" } }),
    ) as unknown as typeof fetch;
    const result = (await Effect.runPromise(httpGetHandler()({ url: "https://example.com/" }))) as {
      body: unknown;
    };
    expect(result.body).toBe("not actually json");
  });
});
