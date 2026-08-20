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
});
