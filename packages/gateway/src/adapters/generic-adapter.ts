import { Effect } from "effect";
import crypto from "crypto";
import { WebhookValidationError, WebhookTransformError } from "../errors.js";
import type { GatewayEvent } from "../types.js";
import type { WebhookAdapter, WebhookRequest } from "./webhook-adapter.js";

// ─── Generic Webhook Adapter Options ─────────────────────────────────────────

export interface GenericAdapterOptions {
  /** Header name that carries the signature (default: "x-webhook-signature") */
  readonly signatureHeader?: string;
  /** HMAC algorithm (default: "sha256") */
  readonly algorithm?: string;
  /** Source name for metadata (default: "generic") */
  readonly sourceName?: string;
}

// ─── Generic Webhook Adapter ─────────────────────────────────────────────────

export const createGenericAdapter = (
  options?: GenericAdapterOptions,
): WebhookAdapter => {
  const signatureHeader = options?.signatureHeader ?? "x-webhook-signature";
  const algorithm = options?.algorithm ?? "sha256";
  const sourceName = options?.sourceName ?? "generic";

  return {
    source: sourceName,

    validateSignature: (req: WebhookRequest, secret: string) =>
      Effect.try({
        try: () => {
          const signature = req.headers[signatureHeader];
          if (!signature) {
            return false;
          }

          const hmac = crypto.createHmac(algorithm, secret);
          hmac.update(req.body);
          const expected = hmac.digest("hex");

          // Timing-safe comparison
          const sigBuf = Buffer.from(signature, "utf8");
          const expectedBuf = Buffer.from(expected, "utf8");

          if (sigBuf.length !== expectedBuf.length) {
            return false;
          }

          return crypto.timingSafeEqual(sigBuf, expectedBuf);
        },
        catch: (err) =>
          new WebhookValidationError({
            message: `Generic signature validation failed: ${err}`,
            source: sourceName,
            statusCode: 401,
          }),
      }),

    transform: (req: WebhookRequest) =>
      Effect.try({
        try: () => {
          // Gracefully handle non-JSON bodies
          let payload: unknown;
          try {
            payload = JSON.parse(req.body);
          } catch {
            payload = req.body;
          }

          const event: GatewayEvent = {
            id: `wh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            source: "webhook",
            timestamp: new Date(),
            payload,
            priority: "normal",
            metadata: {
              adapter: sourceName,
              category: "webhook.received",
              contentType: req.headers["content-type"] ?? "unknown",
            },
          };

          return event;
        },
        catch: (err) =>
          new WebhookTransformError({
            message: `Generic transform failed: ${err}`,
            source: sourceName,
            payload: req.body,
          }),
      }),

    classify: (event: GatewayEvent) => {
      const category = event.metadata["category"] as string | undefined;
      return category ?? "webhook.received";
    },
  };
};
