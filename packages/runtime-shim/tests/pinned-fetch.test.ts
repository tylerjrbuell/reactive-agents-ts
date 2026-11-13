// Run: bun test packages/runtime-shim/tests/pinned-fetch.test.ts --timeout 15000
//
// DNS-rebinding (TOCTOU) closure for the F6 egress guard. assertPublicUrl
// validated a hostname's DNS answer, then the caller's fetch() resolved it again,
// so a rebinding server could answer public first and private second. fetchPinned
// resolves ONCE, validates every answer, and connects to that address.
import { describe, test, expect, afterEach } from "bun:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { fetchPinned, nodePinnedTransport, type PinnedRequest } from "../src/pinned-fetch.js";
import { PublicUrlError, resolvePublicUrl } from "../src/assert-public-url.js";

/** Resolver that records calls and answers from a script: first call -> answers[0], later -> answers[1]. */
const scripted = (answers: string[][]) => {
  const calls: string[] = [];
  const resolve = async (host: string): Promise<string[]> => {
    calls.push(host);
    return answers[Math.min(calls.length - 1, answers.length - 1)]!;
  };
  return { resolve, calls };
};

/** Fake transport: records the pinned request, replies from a per-call script. */
const fakeTransport = (replies: Array<() => Response>) => {
  const seen: PinnedRequest[] = [];
  const transport = async (req: PinnedRequest): Promise<Response> => {
    seen.push(req);
    return replies[Math.min(seen.length - 1, replies.length - 1)]!();
  };
  return { transport, seen };
};

const ok = () => new Response("ok", { status: 200 });
const redirectTo = (loc: string) => () => new Response(null, { status: 302, headers: { location: loc } });

describe("resolvePublicUrl", () => {
  test("returns the first validated address and family", async () => {
    const r = await resolvePublicUrl("https://a.example/x", { resolve: async () => ["93.184.216.34", "93.184.216.35"] });
    expect(r.address).toBe("93.184.216.34");
    expect(r.family).toBe(4);
    expect(r.url.hostname).toBe("a.example");
  });

  test("IPv6 answer reports family 6", async () => {
    const r = await resolvePublicUrl("https://a.example/", { resolve: async () => ["2606:2800:220:1::1"] });
    expect(r.family).toBe(6);
  });

  test("IP literal pins to itself without resolving", async () => {
    const { resolve, calls } = scripted([["10.0.0.1"]]);
    const r = await resolvePublicUrl("http://93.184.216.34/", { resolve });
    expect(r.address).toBe("93.184.216.34");
    expect(calls).toHaveLength(0);
  });

  test.each([
    ["mapped private", ["93.184.216.34", "::ffff:a00:1"]],
    ["NAT64 metadata", ["64:ff9b::a9fe:a9fe"]],
    ["6to4 loopback", ["2002:7f00:1::1"]],
    ["plain private", ["10.0.0.5"]],
  ])("refuses when ANY answer is blocked: %s", async (_n, answers) => {
    await expect(resolvePublicUrl("http://evil.example/", { resolve: async () => answers as string[] })).rejects.toBeInstanceOf(
      PublicUrlError,
    );
  });

  test("PublicUrlError carries _tag", async () => {
    const err = await resolvePublicUrl("file:///etc/passwd").catch((e: unknown) => e);
    expect((err as PublicUrlError)._tag).toBe("PublicUrlError");
  });
});

describe("fetchPinned — rebinding", () => {
  test("connects to the first (public) answer; a second private answer is never used", async () => {
    const { resolve, calls } = scripted([["93.184.216.34"], ["10.0.0.5"]]);
    const { transport, seen } = fakeTransport([ok]);
    const res = await fetchPinned("https://rebind.example/path?q=1", {}, { resolve, transport });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["rebind.example"]); // resolved exactly once
    expect(seen).toHaveLength(1);
    expect(seen[0]!.address).toBe("93.184.216.34");
    expect(seen[0]!.url.hostname).toBe("rebind.example"); // logical host kept for Host/SNI
  });

  test("each redirect hop is resolved once and pinned to its own validated address", async () => {
    const { resolve, calls } = scripted([["93.184.216.34"], ["93.184.216.99"], ["10.0.0.5"]]);
    const { transport, seen } = fakeTransport([redirectTo("https://hop2.example/"), ok]);
    await fetchPinned("https://hop1.example/", {}, { resolve, transport });
    expect(calls).toEqual(["hop1.example", "hop2.example"]);
    expect(seen.map((s) => s.address)).toEqual(["93.184.216.34", "93.184.216.99"]);
  });

  test("normal public URL is unchanged: body and status pass through", async () => {
    const { transport } = fakeTransport([() => new Response("hello", { status: 201 })]);
    const res = await fetchPinned("http://ok.example/", {}, { resolve: async () => ["93.184.216.34"], transport });
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("hello");
  });
});

describe("fetchPinned — redirects", () => {
  const pub = { resolve: async () => ["93.184.216.34"] };

  test.each([
    ["http://127.0.0.1/admin"],
    ["http://169.254.169.254/latest/meta-data/"],
    ["http://[::ffff:a9fe:a9fe]/"],
    ["http://metadata.google.internal/"],
    ["file:///etc/passwd"],
  ])("redirect to %s is refused", async (loc) => {
    const { transport, seen } = fakeTransport([redirectTo(loc), ok]);
    await expect(fetchPinned("http://start.example/", {}, { ...pub, transport })).rejects.toBeInstanceOf(PublicUrlError);
    expect(seen).toHaveLength(1); // the private hop was never requested
  });

  test("redirect to a hostname that resolves private is refused", async () => {
    const { resolve } = scripted([["93.184.216.34"], ["192.168.1.1"]]);
    const { transport, seen } = fakeTransport([redirectTo("http://sneaky.example/"), ok]);
    await expect(fetchPinned("http://start.example/", {}, { resolve, transport })).rejects.toBeInstanceOf(PublicUrlError);
    expect(seen).toHaveLength(1);
  });

  test("hop cap throws", async () => {
    const { transport } = fakeTransport([redirectTo("http://loop.example/")]);
    await expect(fetchPinned("http://loop.example/", {}, { ...pub, transport, maxRedirects: 3 })).rejects.toThrow(/redirects/);
  });

  test('redirect: "manual" returns the 3xx untouched', async () => {
    const { transport, seen } = fakeTransport([redirectTo("http://127.0.0.1/")]);
    const res = await fetchPinned("http://start.example/", {}, { ...pub, transport, redirect: "manual" });
    expect(res.status).toBe(302);
    expect(seen).toHaveLength(1);
  });

  test("credentials are dropped on a cross-origin hop, kept on same-origin", async () => {
    const { transport, seen } = fakeTransport([redirectTo("http://other.example/"), ok]);
    await fetchPinned("http://start.example/", { headers: { Authorization: "Bearer x", "x-keep": "1" } }, { ...pub, transport });
    expect(seen[0]!.headers["Authorization"]).toBe("Bearer x");
    expect(seen[1]!.headers["Authorization"]).toBeUndefined();
    expect(seen[1]!.headers["x-keep"]).toBe("1");

    const same = fakeTransport([redirectTo("/next"), ok]);
    await fetchPinned("http://start.example/", { headers: { Authorization: "Bearer x" } }, { ...pub, transport: same.transport });
    expect(same.seen[1]!.headers["Authorization"]).toBe("Bearer x");
  });

  test("303 turns a POST into a body-less GET", async () => {
    const r = new Response(null, { status: 303, headers: { location: "/done" } });
    const { transport, seen } = fakeTransport([() => r, ok]);
    await fetchPinned("http://start.example/", { method: "POST", body: "payload" }, { ...pub, transport });
    expect(seen[1]!.method).toBe("GET");
    expect(seen[1]!.body).toBeUndefined();
  });
});

describe("nodePinnedTransport — real sockets (loopback server)", () => {
  let server: http.Server | undefined;
  afterEach(() => {
    server?.closeAllConnections();
    server?.close();
    server = undefined;
  });

  const start = async (handler: http.RequestListener): Promise<number> => {
    server = http.createServer(handler);
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    return (server.address() as AddressInfo).port;
  };

  test("connects to the pinned IP even though the hostname does not resolve; Host keeps the real name", async () => {
    let hostHeader = "";
    const port = await start((req, res) => {
      hostHeader = req.headers.host ?? "";
      res.setHeader("x-seen", "1");
      res.end("pinned-body");
    });
    // "pinned.invalid" can never resolve via DNS: success proves the socket went to the pinned address.
    const { resolve, calls } = scripted([["127.0.0.1"], ["10.0.0.5"]]);
    const res = await fetchPinned(`http://pinned.invalid:${port}/p?x=1`, {}, { resolve, allowPrivate: true });
    expect(await res.text()).toBe("pinned-body");
    expect(res.headers.get("x-seen")).toBe("1");
    expect(hostHeader).toBe(`pinned.invalid:${port}`);
    expect(calls).toHaveLength(1);
  });

  test("POST body is delivered", async () => {
    let got = "";
    const port = await start((req, res) => {
      req.on("data", (c: Buffer) => (got += c.toString()));
      req.on("end", () => res.end("done"));
    });
    const res = await fetchPinned(
      `http://pinned.invalid:${port}/`,
      { method: "POST", body: "hello" },
      { resolve: async () => ["127.0.0.1"], allowPrivate: true },
    );
    expect(await res.text()).toBe("done");
    expect(got).toBe("hello");
  });

  test("real redirect to a private target is refused before connecting", async () => {
    const port = await start((_req, res) => {
      res.statusCode = 302;
      res.setHeader("location", "http://169.254.169.254/latest/meta-data/");
      res.end();
    });
    // allowPrivate lets the loopback start through; metadata stays blocked regardless.
    await expect(
      fetchPinned(`http://pinned.invalid:${port}/`, {}, { resolve: async () => ["127.0.0.1"], allowPrivate: true }),
    ).rejects.toBeInstanceOf(PublicUrlError);
  });

  test("nodePinnedTransport is the default transport (exported)", () => {
    expect(typeof nodePinnedTransport).toBe("function");
  });
});
