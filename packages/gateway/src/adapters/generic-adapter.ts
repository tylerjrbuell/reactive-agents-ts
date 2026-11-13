import { Clock, Effect } from "effect";
import crypto from "crypto";
import { WebhookValidationError, WebhookTransformError } from "../errors.js";
import type { GatewayEvent } from "../types.js";
import type { WebhookAdapter, WebhookRequest } from "./webhook-adapter.js";
import { DEFAULT_REPLAY_WINDOW_MS, makeReplayGuard, parseTimestampMs } from "./replay-guard.js";

// ─── Generic Webhook Adapter Options ─────────────────────────────────────────

export interface GenericAdapterOptions {
  /** Header name that carries the signature (default: "x-webhook-signature") */
  readonly signatureHeader?: string;
  /** HMAC algorithm (default: "sha256") */
  readonly algorithm?: string;
  /** Source name for metadata (default: "generic") */
  readonly sourceName?: string;
  /** Header carrying the signed epoch timestamp, seconds or ms (default: "x-webhook-timestamp"). */
  readonly timestampHeader?: string;
  /** Reject timestamps further than this from now, either direction (default: 5 minutes). */
  readonly replayWindowMs?: number;
  /**
   * Replay protection (default true): the signature must be `hex(HMAC(secret, "<timestamp>.<body>"))`,
   * the timestamp must be inside the window, and a signature already seen inside the window is
   * rejected. Set false only for a legacy sender that signs the body alone; a captured request is
   * then replayable forever, and every request logs a warning.
   */
  readonly replayProtection?: boolean;
}

// ─── Generic Webhook Adapter ─────────────────────────────────────────────────

export const createGenericAdapter = (
  options?: GenericAdapterOptions,
): WebhookAdapter => {
  const signatureHeader = options?.signatureHeader ?? "x-webhook-signature";
  const algorithm = options?.algorithm ?? "sha256";
  const sourceName = options?.sourceName ?? "generic";
  const timestampHeader = options?.timestampHeader ?? "x-webhook-timestamp";
  const replayWindowMs = options?.replayWindowMs ?? DEFAULT_REPLAY_WINDOW_MS;
  const replayProtection = options?.replayProtection !== false;
  // A timestamp can be up to one window in the future, so a signature stays acceptable for two.
  const firstSeen = makeReplayGuard(replayWindowMs * 2);
  const rejected = (message: string, reason: string) =>
    new WebhookValidationError({ message, source: sourceName, statusCode: 401, reason });

  return {
    source: sourceName,

    validateSignature: (req: WebhookRequest, secret: string) =>
      Effect.gen(function* () {
        const signature = req.headers[signatureHeader];
        if (!signature) return false;

        let signedPayload = req.body;
        let nowMs = 0;
        if (replayProtection) {
          const rawTs = req.headers[timestampHeader];
          if (!rawTs) {
            return yield* Effect.fail(rejected("Missing webhook timestamp", "missing_timestamp"));
          }
          const tsMs = parseTimestampMs(rawTs);
          nowMs = yield* Clock.currentTimeMillis;
          if (tsMs === undefined || Math.abs(nowMs - tsMs) > replayWindowMs) {
            return yield* Effect.fail(rejected("Webhook timestamp outside the replay window", "stale_timestamp"));
          }
          signedPayload = `${rawTs}.${req.body}`;
        } else {
          yield* Effect.logWarning(
            `webhook ${sourceName}: replayProtection is off - a captured signed request can be replayed`,
          );
        }

        const valid = yield* Effect.try({
          try: () => {
            const expected = crypto.createHmac(algorithm, secret).update(signedPayload).digest("hex");
            // Timing-safe comparison
            const sigBuf = Buffer.from(signature, "utf8");
            const expectedBuf = Buffer.from(expected, "utf8");
            if (sigBuf.length !== expectedBuf.length) return false;
            return crypto.timingSafeEqual(sigBuf, expectedBuf);
          },
          catch: (err) =>
            new WebhookValidationError({
              message: `Generic signature validation failed: ${err}`,
              source: sourceName,
              statusCode: 401,
            }),
        });
        if (!valid) return false;

        // Dedupe only after the signature verified. The key is the signature itself: it binds the
        // timestamp and body, so an unsigned delivery-id header can never be used to dodge it.
        if (replayProtection && !firstSeen(signature, nowMs)) {
          return yield* Effect.fail(rejected("Replayed webhook delivery", "replayed_delivery"));
        }
        return true;
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
