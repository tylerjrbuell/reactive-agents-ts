// Run: bun test packages/gateway/tests/adapters/generic-adapter.test.ts --timeout 15000
//
// GH #227 — `createGenericAdapter` (generic webhook HMAC validation + payload
// transform) had zero test coverage. Mirrors the sibling
// github-adapter.test.ts coverage shape.

import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import crypto from "crypto";
import { createGenericAdapter } from "../../src/adapters/generic-adapter.js";
import type { GatewayEvent } from "../../src/types.js";
import type { WebhookRequest } from "../../src/adapters/webhook-adapter.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

const makeSignature = (
  body: string,
  secret: string,
  algorithm = "sha256",
): string => {
  const hmac = crypto.createHmac(algorithm, secret);
  hmac.update(body);
  return hmac.digest("hex");
};

const makeRequest = (
  body: string,
  opts: {
    secret?: string;
    algorithm?: string;
    header?: string;
    /** null omits the content-type header entirely */
    contentType?: string | null;
  } = {},
): WebhookRequest => {
  const headers: Record<string, string> = {};
  if (opts.contentType !== null) {
    headers["content-type"] = opts.contentType ?? "application/json";
  }
  if (opts.secret) {
    headers[opts.header ?? "x-webhook-signature"] = makeSignature(
      body,
      opts.secret,
      opts.algorithm,
    );
  }
  return { body, headers };
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Generic Webhook Adapter", () => {
  const adapter = createGenericAdapter();

  test("defaults source to 'generic'", () => {
    expect(adapter.source).toBe("generic");
  });

  describe("validateSignature", () => {
    test("accepts a correct HMAC-SHA256 signature", async () => {
      const secret = "s3cr3t";
      const body = JSON.stringify({ hello: "world" });
      const valid = await Effect.runPromise(
        adapter.validateSignature(makeRequest(body, { secret }), secret),
      );
      expect(valid).toBe(true);
    });

    test("returns false when the signature header is absent (no throw)", async () => {
      const valid = await Effect.runPromise(
        adapter.validateSignature(makeRequest("{}"), "s3cr3t"),
      );
      expect(valid).toBe(false);
    });

    test("returns false for a wrong same-length signature", async () => {
      const body = JSON.stringify({ a: 1 });
      const good = makeSignature(body, "right");
      const flipped = good[0] === "0" ? "1" : "0";
      const bad = flipped + good.slice(1);
      const req: WebhookRequest = {
        body,
        headers: { "x-webhook-signature": bad },
      };
      const valid = await Effect.runPromise(
        adapter.validateSignature(req, "right"),
      );
      expect(valid).toBe(false);
    });

    test("returns false for a length-mismatched signature", async () => {
      const req: WebhookRequest = {
        body: "{}",
        headers: { "x-webhook-signature": "deadbeef" },
      };
      const valid = await Effect.runPromise(
        adapter.validateSignature(req, "right"),
      );
      expect(valid).toBe(false);
    });

    test("honors a custom signature header (default header ignored)", async () => {
      const secret = "s";
      const body = "{}";
      const custom = createGenericAdapter({ signatureHeader: "x-custom-sig" });

      const defaultOnly: WebhookRequest = {
        body,
        headers: { "x-webhook-signature": makeSignature(body, secret) },
      };
      expect(
        await Effect.runPromise(custom.validateSignature(defaultOnly, secret)),
      ).toBe(false);

      const customHeader: WebhookRequest = {
        body,
        headers: { "x-custom-sig": makeSignature(body, secret) },
      };
      expect(
        await Effect.runPromise(custom.validateSignature(customHeader, secret)),
      ).toBe(true);
    });

    test("honors a custom HMAC algorithm", async () => {
      const secret = "s";
      const body = "{}";
      const sha512 = createGenericAdapter({ algorithm: "sha512" });

      const okSha512: WebhookRequest = {
        body,
        headers: { "x-webhook-signature": makeSignature(body, secret, "sha512") },
      };
      expect(
        await Effect.runPromise(sha512.validateSignature(okSha512, secret)),
      ).toBe(true);

      const sha256Only: WebhookRequest = {
        body,
        headers: { "x-webhook-signature": makeSignature(body, secret, "sha256") },
      };
      expect(
        await Effect.runPromise(sha512.validateSignature(sha256Only, secret)),
      ).toBe(false);
    });

    test("surfaces WebhookValidationError when the algorithm is invalid", async () => {
      const badAlgorithm = createGenericAdapter({
        algorithm: "not-a-real-algorithm",
      });
      const req: WebhookRequest = {
        body: "{}",
        headers: { "x-webhook-signature": "whatever" },
      };
      const err = await Effect.runPromise(
        Effect.flip(badAlgorithm.validateSignature(req, "s")),
      );
      expect(err._tag).toBe("WebhookValidationError");
      expect(err.source).toBe("generic");
      expect(err.statusCode).toBe(401);
    });
  });

  describe("transform", () => {
    test("parses a JSON body into payload and stamps webhook metadata", async () => {
      const payload = { action: "opened", id: 7 };
      const req = makeRequest(JSON.stringify(payload), {
        contentType: "application/json",
      });
      const event = await Effect.runPromise(adapter.transform(req));

      expect(event.source).toBe("webhook");
      expect(event.payload).toEqual(payload);
      expect(event.priority).toBe("normal");
      expect(event.metadata["adapter"]).toBe("generic");
      expect(event.metadata["category"]).toBe("webhook.received");
      expect(event.metadata["contentType"]).toBe("application/json");
      expect(typeof event.id).toBe("string");
      expect(event.timestamp).toBeInstanceOf(Date);
    });

    test("falls back to the raw body when it is not JSON", async () => {
      const req = makeRequest("not json at all", { contentType: "text/plain" });
      const event = await Effect.runPromise(adapter.transform(req));

      expect(event.payload).toBe("not json at all");
      expect(event.metadata["contentType"]).toBe("text/plain");
    });

    test("defaults contentType to 'unknown' when the header is absent", async () => {
      const event = await Effect.runPromise(
        adapter.transform(makeRequest("{}", { contentType: null })),
      );
      expect(event.metadata["contentType"]).toBe("unknown");
    });

    test("honors a custom sourceName in source + metadata", async () => {
      const custom = createGenericAdapter({ sourceName: "acme" });
      const event = await Effect.runPromise(custom.transform(makeRequest("{}")));
      expect(custom.source).toBe("acme");
      expect(event.metadata["adapter"]).toBe("acme");
    });
  });

  describe("classify", () => {
    test("returns the event category when present", () => {
      const event: GatewayEvent = {
        id: "wh-1",
        source: "webhook",
        timestamp: new Date(),
        payload: {},
        priority: "normal",
        metadata: { category: "custom.category" },
      };
      expect(adapter.classify(event)).toBe("custom.category");
    });

    test("defaults to 'webhook.received' when no category is set", () => {
      const event: GatewayEvent = {
        id: "wh-2",
        source: "webhook",
        timestamp: new Date(),
        payload: {},
        priority: "normal",
        metadata: {},
      };
      expect(adapter.classify(event)).toBe("webhook.received");
    });
  });
});
