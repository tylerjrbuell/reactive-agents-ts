import type { Effect } from "effect";
import type { GatewayEvent } from "../types.js";
import type { WebhookValidationError, WebhookTransformError } from "../errors.js";

// ─── Webhook Request ─────────────────────────────────────────────────────────

export interface WebhookRequest {
  readonly body: string;
  readonly headers: Record<string, string>;
}

// ─── Webhook Adapter Interface ───────────────────────────────────────────────

export interface WebhookAdapter {
  readonly source: string;
  readonly validateSignature: (
    req: WebhookRequest,
    secret: string,
  ) => Effect.Effect<boolean, WebhookValidationError>;
  readonly transform: (
    req: WebhookRequest,
  ) => Effect.Effect<GatewayEvent, WebhookTransformError>;
  readonly classify: (event: GatewayEvent) => string;
}
