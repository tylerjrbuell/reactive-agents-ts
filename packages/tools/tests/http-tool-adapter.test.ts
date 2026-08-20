import { describe, it, expect, afterEach, mock } from "bun:test";
import { fetchJsonTool, HttpToolError } from "../src/adapters/http-tool-adapter.js";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

describe("fetchJsonTool", () => {
  it("returns parsed JSON on 200", async () => {
    global.fetch = mock(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;
    const handler = fetchJsonTool({ buildUrl: (a) => `https://example.test/${a.id}` });
    const result = await handler({ id: "42" });
    expect(result).toEqual({ ok: true });
  });

  it("throws HttpToolError with status on a 404", async () => {
    global.fetch = mock(async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;
    const handler = fetchJsonTool({ buildUrl: () => "https://example.test/missing" });
    await expect(handler({})).rejects.toBeInstanceOf(HttpToolError);
  });

  it("retries on 503 then succeeds", async () => {
    let calls = 0;
    global.fetch = mock(async () => {
      calls++;
      if (calls < 2) return new Response("unavailable", { status: 503 });
      return new Response(JSON.stringify({ ok: true, calls }), { status: 200 });
    }) as unknown as typeof fetch;
    const handler = fetchJsonTool({ buildUrl: () => "https://example.test/flaky", maxRetries: 3 });
    const result = await handler({});
    expect(result).toEqual({ ok: true, calls: 2 });
  });

  it("returns emptyResultValue on 204 instead of throwing", async () => {
    global.fetch = mock(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const handler = fetchJsonTool({ buildUrl: () => "https://example.test/empty", emptyResultValue: { items: [] } });
    const result = await handler({});
    expect(result).toEqual({ items: [] });
  });

  it("Finding 5: throws HttpToolError (not a raw SyntaxError) on a 200 with a non-JSON body", async () => {
    global.fetch = mock(
      async () => new Response("<html>Error</html>", { status: 200 }),
    ) as unknown as typeof fetch;
    const handler = fetchJsonTool({ buildUrl: () => "https://example.test/bad-content-type" });
    await expect(handler({})).rejects.toBeInstanceOf(HttpToolError);
    await expect(handler({})).rejects.not.toBeInstanceOf(SyntaxError);
  });

  it("Finding 6: does not follow redirects when headers are supplied — blocked redirect throws HttpToolError", async () => {
    global.fetch = mock(async () => {
      // Simulate the browser/undici "opaque redirect" response produced by
      // `redirect: "manual"` when the server answers with a 3xx.
      return {
        type: "opaqueredirect",
        status: 0,
        ok: false,
        text: async () => "",
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const handler = fetchJsonTool({
      buildUrl: () => "https://example.test/secret",
      headers: { Authorization: "Bearer secret-token" },
    });
    await expect(handler({})).rejects.toBeInstanceOf(HttpToolError);
  });

  it("Finding 6: passes redirect: 'manual' to fetch only when headers are supplied", async () => {
    let capturedInit: RequestInit | undefined;
    global.fetch = mock(async (_url: unknown, init?: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;

    const withHeaders = fetchJsonTool({
      buildUrl: () => "https://example.test/x",
      headers: { Authorization: "Bearer t" },
    });
    await withHeaders({});
    expect(capturedInit?.redirect).toBe("manual");

    const withoutHeaders = fetchJsonTool({ buildUrl: () => "https://example.test/y" });
    await withoutHeaders({});
    expect(capturedInit).toBeUndefined();
  });
});
