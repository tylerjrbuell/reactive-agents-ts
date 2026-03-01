import { Effect } from "effect";
import crypto from "crypto";
import { WebhookValidationError, WebhookTransformError } from "../errors.js";
import type { GatewayEvent } from "../types.js";
import type { WebhookAdapter, WebhookRequest } from "./webhook-adapter.js";

// ─── GitHub Webhook Adapter ──────────────────────────────────────────────────

export const createGitHubAdapter = (): WebhookAdapter => ({
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
});
