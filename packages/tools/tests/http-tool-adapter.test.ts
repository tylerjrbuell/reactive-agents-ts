import { describe, it, expect, afterEach, mock } from "bun:test";
import { createServer } from "node:http";
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
    // 503-then-200 script. The exact call-count pin (calls===2) is deliberately
    // NOT asserted on the shared mock: a CI-only phantom double-invocation of
    // this handler was observed twice (CI runs 39341793990 / 39347275662:
    // calls=4 after a single awaited handler call — two full invocations of
    // the adapter closure, never reproduced locally). The adapter contract is
    // asserted outcome-wise (success after a transient failure, at least one
    // retry); the EXACT one-retry contract is pinned deterministically by the
    // live-server test below, which uses no global mocks and is immune to
    // the phantom.
    const hits: number[] = [];
    global.fetch = mock(async () => {
      const call = hits.length + 1;
      hits.push(call);
      if (call === 1) return new Response("unavailable", { status: 503 });
      return new Response(JSON.stringify({ ok: true, calls: call }), { status: 200 });
    }) as unknown as typeof fetch;
    const handler = fetchJsonTool({ buildUrl: () => "https://example.test/flaky", maxRetries: 3 });
    const result = (await handler({})) as { ok: boolean; calls: number };
    expect(result.ok).toBe(true);
    // The returned success body must have come from a retry (post-503 hit).
    // Structurally guaranteed under any invocation pattern: the only 503 slot
    // is hit 1, so any successfully returned success body carries calls >= 2.
    // Do NOT re-introduce parity/hit-count pins here — the CI-only phantom
    // double-invocation of this handler has now consumed both an even hit
    // span (calls=4, runs 39341793990/39347275662) and an odd one (hits=3,
    // floater never completed, run 39359903979); the exact one-retry contract
    // is pinned by the live-server test below, which shares no global state.
    expect(result.calls).toBeGreaterThanOrEqual(2);
  });

  it("retries a transient 503 exactly once against a live server", async () => {
    // Deterministic one-retry pin: a real HTTP server (no global mocks, no
    // shared fetch state) serves 503 once then 200. The adapter must issue
    // exactly ONE retry and surface the success body. node:http keeps this
    // portable across Bun/Node per the runtime policy.
    const requests: number[] = [];
    const server = createServer((_req, res) => {
      const hit = requests.push(1);
      if (hit === 1) {
        res.statusCode = 503;
        res.end("unavailable");
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, requests: hit }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      global.fetch = originalFetch as typeof fetch; // real fetch for this test
      const handler = fetchJsonTool({
        buildUrl: () => `http://127.0.0.1:${port}/flaky`,
        maxRetries: 3,
      });
      const result = await handler({});
      expect(requests).toEqual([1, 1]);
      expect(result).toEqual({ ok: true, requests: 2 });
    } finally {
      server.close();
    }
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
