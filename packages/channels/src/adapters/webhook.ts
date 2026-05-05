import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Effect } from "effect";
import { ChannelConnectionError, ChannelSendError } from "../errors.js";
import type {
  ChannelSubscription,
  ChannelTarget,
  InboundMessage,
  MessageChannel,
  MessageContent,
  SendResult,
} from "../types.js";

export interface WebhookChannelAdapterConfig {
  readonly id?: string;
  /** When set, `handleRequest` requires valid HMAC-SHA256 hex digest in `x-channels-signature` header. */
  readonly secret?: string;
  /** Stored on normalized {@link InboundMessage.platform} (e.g. `telegram-bot`). */
  readonly platform?: string;
  readonly onResponse?: (target: ChannelTarget, content: MessageContent) => Promise<void>;
}

/**
 * Generic HTTP webhook ingress implementing {@link MessageChannel}. Bot transports normalize
 * provider POST bodies into {@link InboundMessage} before calling {@link WebhookChannelAdapter#handleRequest}.
 */
export class WebhookChannelAdapter implements MessageChannel {
  readonly id: string;
  private readonly secret?: string;
  private readonly platform: string;
  private readonly onResponse?: WebhookChannelAdapterConfig["onResponse"];
  private handler?: (msg: InboundMessage) => Effect.Effect<void>;
  private unsub = false;

  constructor(private readonly config: WebhookChannelAdapterConfig) {
    this.id = config.id ?? "webhook";
    this.secret = config.secret;
    this.platform = config.platform ?? "webhook";
    this.onResponse = config.onResponse;
  }

  connect(): Effect.Effect<void, ChannelConnectionError> {
    return Effect.void;
  }

  disconnect(): Effect.Effect<void, ChannelConnectionError> {
    this.handler = undefined;
    return Effect.void;
  }

  onMessage(handler: (msg: InboundMessage) => Effect.Effect<void>): Effect.Effect<ChannelSubscription> {
    this.handler = handler;
    this.unsub = false;
    return Effect.succeed({
      unsubscribe: () => {
        this.unsub = true;
        this.handler = undefined;
        return Effect.void;
      },
    });
  }

  /**
   * Validates optional HMAC, parses JSON body into {@link InboundMessage}, invokes the registered handler.
   */
  handleRequest(req: { body: string; headers: Record<string, string> }): Effect.Effect<void, ChannelConnectionError> {
    const self = this;
    return Effect.gen(function* () {
      if (self.secret) {
        const sig = req.headers["x-channels-signature"] ?? req.headers["X-Channels-Signature"];
        if (!sig) {
          return yield* Effect.fail(
            new ChannelConnectionError({ adapter: self.id, reason: "missing_signature" }),
          );
        }
        const expected = createHmac("sha256", self.secret).update(req.body).digest("hex");
        const a = Buffer.from(sig, "utf8");
        const b = Buffer.from(expected, "utf8");
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return yield* Effect.fail(
            new ChannelConnectionError({ adapter: self.id, reason: "invalid_signature" }),
          );
        }
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(req.body) as unknown;
      } catch (e) {
        return yield* Effect.fail(
          new ChannelConnectionError({ adapter: self.id, reason: "invalid_json", cause: e }),
        );
      }

      const msg = normalizeWebhookPayload(self.platform, parsed);
      const h = self.handler;
      if (!h || self.unsub) return;

      yield* h(msg);
    });
  }

  sendMessage(target: ChannelTarget, content: MessageContent): Effect.Effect<SendResult, ChannelSendError> {
    if (!this.onResponse) {
      return Effect.fail(
        new ChannelSendError({
          adapter: this.id,
          target,
          reason: "unknown",
        }),
      );
    }
    const id = this.id;
    const fn = this.onResponse;
    return Effect.tryPromise({
      try: async () => {
        await fn(target, content);
        return { messageId: `wh-${randomUUID()}`, timestamp: new Date() };
      },
      catch: (cause) =>
        new ChannelSendError({
          adapter: id,
          target,
          reason: "unknown",
          cause,
        }),
    });
  }
}

function normalizeWebhookPayload(platform: string, body: unknown): InboundMessage {
  if (typeof body !== "object" || body === null) {
    return {
      id: randomUUID(),
      platform,
      channelId: "unknown",
      senderId: "unknown",
      content: "",
      metadata: { raw: body },
      timestamp: new Date(),
    };
  }
  const o = body as Record<string, unknown>;
  return {
    id: String(o.id ?? o.message_id ?? randomUUID()),
    platform: String(o.platform ?? platform),
    channelId: String(o.channelId ?? o.chat_id ?? "default"),
    senderId: String(o.senderId ?? o.from_id ?? "unknown"),
    senderName: o.senderName !== undefined ? String(o.senderName) : undefined,
    content: String(o.content ?? o.text ?? ""),
    metadata: (typeof o.metadata === "object" && o.metadata !== null
      ? (o.metadata as Record<string, unknown>)
      : {}) as Record<string, unknown>,
    timestamp: o.timestamp !== undefined ? new Date(String(o.timestamp)) : new Date(),
  };
}
