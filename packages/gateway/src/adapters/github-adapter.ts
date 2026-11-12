import { Effect } from "effect";
import crypto from "crypto";
import { WebhookValidationError, WebhookTransformError } from "../errors.js";
import type { GatewayEvent } from "../types.js";
import type { WebhookAdapter, WebhookRequest } from "./webhook-adapter.js";

// ─── GitHub Webhook Adapter ──────────────────────────────────────────────────

/** Delivery ids remembered per adapter instance; oldest evicted first. */
export const GITHUB_DELIVERY_CACHE_SIZE = 1024;

/**
 * GitHub adapter. Replayed `x-github-delivery` ids are rejected in `transform` (a signed request
 * captured on the wire cannot be re-run). The seen-id cache is closure-held and bounded.
 */
export const createGitHubAdapter = (): WebhookAdapter => {
  const seen = new Set<string>();
  const isReplay = (deliveryId: string | undefined): boolean => {
    if (!deliveryId) return false;
    if (seen.has(deliveryId)) {
      // refresh recency
      seen.delete(deliveryId);
      seen.add(deliveryId);
      return true;
    }
    seen.add(deliveryId);
    if (seen.size > GITHUB_DELIVERY_CACHE_SIZE) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
    return false;
  };
  return {
  source: "github",

  validateSignature: (req: WebhookRequest, secret: string) =>
    Effect.try({
      try: () => {
        const signatureHeader = req.headers["x-hub-signature-256"];
        if (!signatureHeader) {
          return false;
        }

        const hmac = crypto.createHmac("sha256", secret);
        hmac.update(req.body);
        const expected = `sha256=${hmac.digest("hex")}`;

        // Timing-safe comparison — both must be same length for timingSafeEqual
        const sigBuf = Buffer.from(signatureHeader, "utf8");
        const expectedBuf = Buffer.from(expected, "utf8");

        if (sigBuf.length !== expectedBuf.length) {
          return false;
        }

        return crypto.timingSafeEqual(sigBuf, expectedBuf);
      },
      catch: (err) =>
        new WebhookValidationError({
          message: `GitHub signature validation failed: ${err}`,
          source: "github",
          statusCode: 401,
        }),
    }),

  transform: (req: WebhookRequest) =>
    Effect.try({
      try: () => {
        const deliveryId = req.headers["x-github-delivery"];
        if (isReplay(deliveryId)) {
          throw new Error(`replayed delivery ${deliveryId}`);
        }
        const payload = JSON.parse(req.body);
        const githubEvent = req.headers["x-github-event"] ?? "unknown";
        const action =
          typeof payload === "object" && payload !== null && "action" in payload
            ? String(payload.action)
            : undefined;

        const category = action ? `${githubEvent}.${action}` : githubEvent;

        const event: GatewayEvent = {
          id: `gh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          source: "webhook",
          timestamp: new Date(),
          payload,
          priority: "normal",
          metadata: {
            adapter: "github",
            githubEvent,
            category,
            ...(action ? { action } : {}),
            deliveryId: req.headers["x-github-delivery"] ?? undefined,
          },
        };

        return event;
      },
      catch: (err) =>
        new WebhookTransformError({
          message: `GitHub transform failed: ${err}`,
          source: "github",
          payload: req.body,
        }),
    }),

  classify: (event: GatewayEvent) => {
    const githubEvent = event.metadata["githubEvent"] as string | undefined;
    const action = event.metadata["action"] as string | undefined;
    if (githubEvent && action) {
      return `${githubEvent}.${action}`;
    }
    return githubEvent ?? "unknown";
  },
  };
};
