// Run: bun run repo test packages/gateway/tests/adapters/generic-adapter-replay.test.ts
//
// Replay protection for inbound webhooks (security audit 2026-11-12): a signed timestamp window,
// dedupe of an already-seen signature, and the GitHub delivery-id dedupe. Fake clock via TestClock.
import { describe, test, expect } from "bun:test";
import { Effect, Exit, Cause, Option, TestClock, TestContext } from "effect";
import crypto from "node:crypto";
import { createGenericAdapter } from "../../src/adapters/generic-adapter.js";
import { makeReplayGuard, parseTimestampMs } from "../../src/adapters/replay-guard.js";
import { WebhookService, WebhookServiceLive } from "../../src/services/webhook-service.js";
import type { WebhookRequest } from "../../src/adapters/webhook-adapter.js";

const SECRET = "whsec";
const T0 = 1_700_000_000_000;

const signed = (body: string, tsMs: number, secret = SECRET): WebhookRequest => {
  const ts = String(Math.floor(tsMs / 1000));
  const sig = crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return { body, headers: { "x-webhook-signature": sig, "x-webhook-timestamp": ts } };
};

/** Run at fake time T0 + `offsetMs`; returns the failure reason, or "ok"/"invalid" for non-failures. */
const verdict = (
  adapter: ReturnType<typeof createGenericAdapter>,
  req: WebhookRequest,
  atMs = T0,
): Promise<string> =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(atMs);
      const exit = yield* Effect.exit(adapter.validateSignature(req, SECRET));
      if (Exit.isSuccess(exit)) return exit.value ? "ok" : "invalid";
      const err = Cause.failureOption(exit.cause);
      return Option.isSome(err) ? (err.value.reason ?? "typed-error-without-reason") : "defect";
    }).pipe(Effect.provide(TestContext.TestContext)),
  );

describe("generic webhook replay protection", () => {
  test("fresh signed request is accepted", async () => {
    const a = createGenericAdapter();
    expect(await verdict(a, signed("{}", T0))).toBe("ok");
  });

  test("stale timestamp is rejected with a typed error", async () => {
    const a = createGenericAdapter();
    expect(await verdict(a, signed("{}", T0 - 301_000))).toBe("stale_timestamp");
  });

  test("future timestamp beyond the window is rejected", async () => {
    const a = createGenericAdapter();
    expect(await verdict(a, signed("{}", T0 + 301_000))).toBe("stale_timestamp");
  });

  test("window is configurable", async () => {
    const a = createGenericAdapter({ replayWindowMs: 10_000 });
    expect(await verdict(a, signed("{}", T0 - 11_000))).toBe("stale_timestamp");
    expect(await verdict(createGenericAdapter({ replayWindowMs: 10_000 }), signed("{}", T0 - 9_000))).toBe("ok");
  });

  test("missing timestamp header is rejected (no body-only fallback)", async () => {
    const a = createGenericAdapter();
    const body = "{}";
    const bodyOnly = crypto.createHmac("sha256", SECRET).update(body).digest("hex");
    expect(await verdict(a, { body, headers: { "x-webhook-signature": bodyOnly } })).toBe("missing_timestamp");
  });

  test("timestamp is bound into the signature: swapping it invalidates", async () => {
    const a = createGenericAdapter();
    const req = signed("{}", T0 - 200_000);
    const forged = { ...req, headers: { ...req.headers, "x-webhook-timestamp": String(Math.floor(T0 / 1000)) } };
    expect(await verdict(a, forged)).toBe("invalid");
  });

  test("identical signed request replayed inside the window is rejected", async () => {
    const a = createGenericAdapter();
    const req = signed("{}", T0);
    expect(await verdict(a, req)).toBe("ok");
    expect(await verdict(a, req, T0 + 5_000)).toBe("replayed_delivery");
  });

  test("an unsigned-garbage request does not poison the dedupe cache", async () => {
    const a = createGenericAdapter();
    const req = signed("{}", T0);
    const bad = { ...req, headers: { ...req.headers, "x-webhook-signature": "00".repeat(32) } };
    expect(await verdict(a, bad)).toBe("invalid");
    expect(await verdict(a, req)).toBe("ok");
  });

  test("opt-out replayProtection:false accepts body-only signatures and replays", async () => {
    const a = createGenericAdapter({ replayProtection: false });
    const body = "{}";
    const req = { body, headers: { "x-webhook-signature": crypto.createHmac("sha256", SECRET).update(body).digest("hex") } };
    expect(await verdict(a, req)).toBe("ok");
    expect(await verdict(a, req)).toBe("ok");
  });

  test("through WebhookService: replay is a typed 401 with reason", async () => {
    const req = signed('{"a":1}', T0);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(T0);
        const svc = yield* WebhookService;
        const first = yield* svc.handleRequest("/h", req);
        const second = yield* Effect.flip(svc.handleRequest("/h", req));
        return { first, second };
      }).pipe(
        Effect.provide(WebhookServiceLive([{ path: "/h", adapter: "generic", secret: SECRET }])),
        Effect.provide(TestContext.TestContext),
      ),
    );
    expect(result.first.source).toBe("webhook");
    expect(result.second._tag).toBe("WebhookValidationError");
    expect(result.second.statusCode).toBe(401);
    expect(result.second.reason).toBe("replayed_delivery");
  });
});

describe("replay guard", () => {
  test("entries expire after the ttl and the cache is bounded", () => {
    const g = makeReplayGuard(1000, 2);
    expect(g("a", 0)).toBe(true);
    expect(g("a", 500)).toBe(false);
    expect(g("a", 1001)).toBe(true);
    expect(g("b", 1002)).toBe(true);
    expect(g("c", 1003)).toBe(true); // evicts oldest
    expect(g("a", 1004)).toBe(true);
  });

  test("parseTimestampMs accepts seconds and ms, rejects junk", () => {
    expect(parseTimestampMs("1700000000")).toBe(1_700_000_000_000);
    expect(parseTimestampMs("1700000000000")).toBe(1_700_000_000_000);
    expect(parseTimestampMs("abc")).toBeUndefined();
    expect(parseTimestampMs("-5")).toBeUndefined();
  });
});

describe("github delivery-id dedupe", () => {
  test("a replayed x-github-delivery with a valid signature is rejected", async () => {
    const body = JSON.stringify({ action: "opened" });
    const sig = `sha256=${crypto.createHmac("sha256", SECRET).update(body).digest("hex")}`;
    const req: WebhookRequest = {
      body,
      headers: { "x-hub-signature-256": sig, "x-github-event": "issues", "x-github-delivery": "d-1" },
    };
    const out = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* WebhookService;
        const first = yield* svc.handleRequest("/gh", req);
        const second = yield* Effect.flip(svc.handleRequest("/gh", req));
        return { first, second };
      }).pipe(Effect.provide(WebhookServiceLive([{ path: "/gh", adapter: "github", secret: SECRET }]))),
    );
    expect(out.first.metadata["deliveryId"]).toBe("d-1");
    expect(out.second.statusCode).toBe(400);
    expect(out.second.message).toContain("replayed delivery");
  });
});
