import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import type { PinnedRequest, PinnedTransport } from "@reactive-agents/runtime-shim";
import { httpGetHandler } from "../src/skills/http-client.js";

const PUBLIC_IP = "93.184.216.34";

/** Hermetic network: every host resolves to a public IP, requests go to `respond`. */
const net = (respond: (req: PinnedRequest) => Response | Promise<Response>) => ({
  resolve: async () => [PUBLIC_IP],
  transport: (async (req) => respond(req)) as PinnedTransport,
});

const get = async (
  respond: (req: PinnedRequest) => Response | Promise<Response>,
  url = "https://example.com/",
): Promise<{ body: unknown }> =>
  (await Effect.runPromise(httpGetHandler({ network: net(respond) })({ url }))) as { body: unknown };

describe("httpGetHandler body handling", () => {
  it("returns plain text body untouched under the size cap", async () => {
    const result = await get(() => new Response("hello world", { status: 200, headers: { "content-type": "text/plain" } }));
    expect(result.body).toBe("hello world");
  });

  it("parses a JSON content-type response into an object", async () => {
    const result = await get(
      () =>
        new Response(JSON.stringify({ ok: true, n: 1 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    expect(result.body).toEqual({ ok: true, n: 1 });
  });

  // 2026-09-03: nothing bounded response.text()/response.json() before this
  // fix — a pathological multi-MB body would be read and parsed in full
  // before compressToolResult (which only runs downstream, in the kernel)
  // ever got a chance to act.
  it("caps an oversized body before it is ever JSON-parsed, with a clear truncation message", async () => {
    const big = "Z".repeat(2_500_000);
    const result = await get(() => new Response(big, { status: 200, headers: { "content-type": "text/plain" } }));
    expect(typeof result.body).toBe("string");
    const body = result.body as string;
    expect(body.length).toBeLessThan(2_000_300); // 2M cap + truncation-message prefix, well short of the 2.5M raw body
    expect(body).toContain("Response body truncated");
    // The body is cut while streaming, so the raw length is no longer known; the cap is named.
    expect(body).toContain("2000000-char");
  });

  it("falls back to raw text when content-type claims JSON but the body doesn't parse", async () => {
    const result = await get(
      () => new Response("not actually json", { status: 200, headers: { "content-type": "application/json" } }),
    );
    expect(result.body).toBe("not actually json");
  });
});

describe("httpGetHandler DNS pinning (rebinding)", () => {
  it("connects to the validated address and never re-resolves", async () => {
    let lookups = 0;
    const connected: string[] = [];
    // First answer public, any later answer private: a plain fetch() would
    // re-resolve and could land on the rebound address.
    const resolve = async (): Promise<string[]> => (++lookups === 1 ? [PUBLIC_IP] : ["169.254.169.254"]);
    const transport: PinnedTransport = async (req) => {
      connected.push(req.address);
      return new Response("ok", { status: 200 });
    };
    await Effect.runPromise(
      httpGetHandler({ network: { resolve, transport } })({ url: "https://rebind.example/" }),
    );
    expect(connected).toEqual([PUBLIC_IP]);
    expect(lookups).toBe(1);
  });

  it("re-pins each redirect hop and refuses a hop that resolves private", async () => {
    const connected: string[] = [];
    const resolve = async (host: string): Promise<string[]> =>
      host === "internal.example" ? ["10.0.0.5"] : [PUBLIC_IP];
    const transport: PinnedTransport = async (req) => {
      connected.push(req.address);
      return new Response(null, { status: 302, headers: { location: "https://internal.example/secret" } });
    };
    await expect(
      Effect.runPromise(httpGetHandler({ network: { resolve, transport } })({ url: "https://start.example/" })),
    ).rejects.toThrow(/private address/);
    expect(connected).toEqual([PUBLIC_IP]);
  });

  it("refuses a host that resolves private without opening a connection", async () => {
    let connected = false;
    const transport: PinnedTransport = async () => {
      connected = true;
      return new Response("x");
    };
    await expect(
      Effect.runPromise(
        httpGetHandler({ network: { resolve: async () => ["127.0.0.1"], transport } })({ url: "https://evil.example/" }),
      ),
    ).rejects.toThrow(/private address/);
    expect(connected).toBe(false);
  });
});
