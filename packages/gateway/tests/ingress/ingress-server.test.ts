import { describe, test, expect } from "bun:test";
import { Effect, Ref, type Scope } from "effect";
import crypto from "node:crypto";
import { startIngress, startGatewayIngress, type IngressChannelRoute } from "../../src/ingress/ingress-server.js";
import { WebhookService, WebhookServiceLive } from "../../src/services/webhook-service.js";
import type { GatewayEvent } from "../../src/types.js";

const SECRET = "whsec-test";
const sign = (body: string, secret = SECRET) => crypto.createHmac("sha256", secret).update(body).digest("hex");

/** Boot ingress on an ephemeral 127.0.0.1 port with a generic webhook at /hooks/generic. */
const withIngress = async (
  f: (ctx: { url: string; events: GatewayEvent[]; channelBodies: string[] }) => Promise<void>,
  opts: { channelRoutes?: readonly IngressChannelRoute[]; maxBodyBytes?: number; secret?: string | undefined } = {},
): Promise<void> => {
  const events: GatewayEvent[] = [];
  const channelBodies: string[] = [];
  const program = Effect.gen(function* () {
    const ref = yield* Ref.make(events);
    const ingress = yield* startIngress({
      maxBodyBytes: opts.maxBodyBytes ?? 1024,
      channelRoutes: opts.channelRoutes ?? [],
      onEvent: (e) => Ref.update(ref, (xs) => (xs.push(e), xs)),
    });
    yield* Effect.promise(() => f({ url: ingress.url, events, channelBodies }));
  }).pipe(
    Effect.provide(WebhookServiceLive([{ path: "/hooks/generic", adapter: "generic", secret: "secret" in opts ? opts.secret : SECRET }])),
    Effect.scoped,
  );
  await Effect.runPromise(program);
};

const post = (url: string, body: string, headers: Record<string, string> = {}) =>
  fetch(url, { method: "POST", body, headers });

describe("ingress: webhooks", () => {
  test("binds loopback on an ephemeral port by default", async () => {
    await withIngress(async ({ url }) => {
      expect(url.startsWith("http://127.0.0.1:")).toBe(true);
    });
  });

  test("a correctly signed webhook is accepted and handed to onEvent", async () => {
    await withIngress(async ({ url, events }) => {
      const body = JSON.stringify({ hello: "world" });
      const res = await post(`${url}/hooks/generic`, body, { "x-webhook-signature": sign(body) });
      expect(res.status).toBe(202);
      expect(events.length).toBe(1);
      expect(events[0]?.source).toBe("webhook");
      expect(events[0]?.payload).toEqual({ hello: "world" });
    });
  });

  test("fail-closed: bad signature, missing signature and wrong secret are 401 and never reach onEvent", async () => {
    await withIngress(async ({ url, events }) => {
      const body = JSON.stringify({ x: 1 });
      expect((await post(`${url}/hooks/generic`, body, { "x-webhook-signature": "00" })).status).toBe(401);
      expect((await post(`${url}/hooks/generic`, body)).status).toBe(401);
      expect((await post(`${url}/hooks/generic`, body, { "x-webhook-signature": sign(body, "other") })).status).toBe(401);
      expect(events.length).toBe(0);
    });
  });

  test("fail-closed: a route configured without a secret refuses every request", async () => {
    await withIngress(
      async ({ url, events }) => {
        const body = "{}";
        expect((await post(`${url}/hooks/generic`, body)).status).toBe(401);
        expect((await post(`${url}/hooks/generic`, body, { "x-webhook-signature": sign(body, "") })).status).toBe(401);
        expect(events.length).toBe(0);
      },
      { secret: undefined },
    );
  });

  test("oversized body is rejected 413 before any webhook processing", async () => {
    await withIngress(
      async ({ url, events }) => {
        const body = JSON.stringify({ pad: "x".repeat(4096) });
        // Correct signature: only the size cap can reject this.
        const res = await post(`${url}/hooks/generic`, body, { "x-webhook-signature": sign(body) });
        expect(res.status).toBe(413);
        expect(events.length).toBe(0);
      },
      { maxBodyBytes: 1024 },
    );
  });

  test("oversized chunked body (no content-length) is also rejected 413", async () => {
    await withIngress(async ({ url, events }) => {
      const big = new Uint8Array(4096).fill(120);
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(big.slice(0, 2048));
          c.enqueue(big.slice(2048));
          c.close();
        },
      });
      const res = await fetch(`${url}/hooks/generic`, {
        method: "POST",
        body: stream,
        headers: { "x-webhook-signature": "00" },
        // @ts-expect-error duplex is required for streaming request bodies
        duplex: "half",
      });
      expect(res.status).toBe(413);
      expect(events.length).toBe(0);
    });
  });

  test("non-POST is 405, unknown path is 404", async () => {
    await withIngress(async ({ url }) => {
      expect((await fetch(`${url}/hooks/generic`)).status).toBe(405);
      expect((await post(`${url}/nope`, "{}")).status).toBe(404);
    });
  });

  test("error bodies are generic: no adapter message or secret leaks", async () => {
    await withIngress(async ({ url }) => {
      const res = await post(`${url}/hooks/generic`, "{}", { "x-webhook-signature": "00" });
      const text = await res.text();
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain("signature for path");
      expect(JSON.parse(text)).toEqual({ ok: false, error: "unauthorized" });
    });
  });
});

describe("ingress: channel routes", () => {
  const routeFor = (
    seen: string[],
    verify: (headers: Record<string, string>) => { kind: string } | undefined,
  ): IngressChannelRoute => ({
    path: "/channels/telegram",
    id: "telegram",
    handle: (req) =>
      Effect.suspend(() => {
        const bad = verify(req.headers);
        if (bad) return Effect.fail({ kind: bad.kind, message: "channel telegram: SECRET-DETAIL" });
        seen.push(req.body);
        return Effect.void;
      }),
  });

  test("routes a channel webhook to the adapter with body and lower-cased headers", async () => {
    const seen: string[] = [];
    const headersSeen: Record<string, string>[] = [];
    const route = routeFor(seen, (h) => (headersSeen.push(h), undefined));
    await withIngress(
      async ({ url, events }) => {
        const res = await post(`${url}/channels/telegram`, '{"update_id":1}', { "X-Telegram-Bot-Api-Secret-Token": "s" });
        expect(res.status).toBe(200);
        expect(seen).toEqual(['{"update_id":1}']);
        expect(headersSeen[0]?.["x-telegram-bot-api-secret-token"]).toBe("s");
        expect(events.length).toBe(0); // channel traffic goes through the adapter's inbound stream, not onEvent
      },
      { channelRoutes: [route] },
    );
  });

  test("adapter rejection maps to a status and never leaks the adapter message", async () => {
    const route = routeFor([], () => ({ kind: "forbidden" }));
    await withIngress(
      async ({ url }) => {
        const res = await post(`${url}/channels/telegram`, "{}");
        expect(res.status).toBe(401);
        expect(await res.text()).not.toContain("SECRET-DETAIL");
      },
      { channelRoutes: [route] },
    );
  });

  test("oversized body never reaches the channel adapter", async () => {
    const seen: string[] = [];
    await withIngress(
      async ({ url }) => {
        const res = await post(`${url}/channels/telegram`, "x".repeat(5000));
        expect(res.status).toBe(413);
        expect(seen).toEqual([]);
      },
      { channelRoutes: [routeFor(seen, () => undefined)] },
    );
  });
});

describe("startGatewayIngress", () => {
  const run = <A, E>(eff: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Effect.scoped(eff));

  test("opens no socket when nothing is configured", async () => {
    const server = await run(startGatewayIngress({ port: 0 }, { onEvent: () => Effect.void }));
    expect(server).toBeUndefined();
  });

  test("consumes GatewayConfig.webhooks and GatewayConfig.port", async () => {
    await run(
      Effect.gen(function* () {
        const probe = yield* Effect.promise(async () => {
          const s = Bun.serve({ port: 0, fetch: () => new Response("") });
          const port = s.port;
          s.stop(true);
          return port;
        });
        const server = yield* startGatewayIngress(
          { port: probe, webhooks: [{ path: "/hooks/g", adapter: "generic", secret: SECRET }] },
          { onEvent: () => Effect.void },
        );
        expect(server?.port).toBe(probe);
        const body = "{}";
        const res = yield* Effect.promise(() =>
          post(`${server?.url}/hooks/g`, body, { "x-webhook-signature": sign(body) }),
        );
        expect(res.status).toBe(202);
      }),
    );
  });

  test("WebhookService from the caller's context is honoured (startIngress)", async () => {
    // Runtime code registers adapters on its own WebhookService; ingress must use that instance.
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* WebhookService;
        yield* svc.registerAdapter("/custom", {
          source: "custom",
          validateSignature: () => Effect.succeed(true),
          transform: (req) =>
            Effect.succeed({ id: "c1", source: "webhook", timestamp: new Date(), payload: req.body, priority: "normal", metadata: {} }),
          classify: () => "custom",
        }, "s");
        const got: GatewayEvent[] = [];
        const server = yield* startIngress({ onEvent: (e) => Effect.sync(() => void got.push(e)) });
        const res = yield* Effect.promise(() => post(`${server.url}/custom`, "hi"));
        expect(res.status).toBe(202);
        expect(got[0]?.id).toBe("c1");
      }).pipe(Effect.provide(WebhookServiceLive()), Effect.scoped),
    );
  });
});
