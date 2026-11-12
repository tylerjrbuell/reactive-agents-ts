import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Clock, Duration, Effect, Queue, Redacted, Stream, type Scope } from "effect";
import type {
  ChannelAdapter,
  ChannelCapabilities,
  ConnectionState,
  DeliveryReceipt,
  InboundEnvelope,
  OutboundMessage,
} from "../adapter.js";
import { envelopeToInboundMessage } from "../adapter.js";
import {
  makeConnectionState,
  makeInboundDedupe,
  makeOutboundRateLimiter,
  type ConnectionStateRef,
} from "../combinators.js";
import {
  channelError,
  ChannelConnectionError,
  ChannelSendError,
  classifyChannelFailure,
  type ChannelError,
} from "../errors.js";
import type {
  Attachment,
  ChannelSubscription,
  ChannelTarget,
  InboundMessage,
  MessageChannel,
  MessageContent,
  SendResult,
} from "../types.js";

export interface WebhookChannelAdapterConfig {
  readonly id?: string;
  /**
   * HMAC-SHA256 key. Required unless {@link allowUnsigned} is set: with neither, `handleRequest`
   * rejects every request (fail closed). Accepts `Redacted` so the key stays out of logs.
   */
  readonly secret?: string | Redacted.Redacted<string>;
  /** Explicit opt-in to accept unsigned requests when no `secret` is set (local development only). */
  readonly allowUnsigned?: boolean;
  /** Reject signed requests whose `x-channels-timestamp` is older/newer than this. Default 5 minutes. */
  readonly replayWindowMs?: number;
  /** Stored on the normalized sender `platform` (e.g. `telegram-bot`). */
  readonly platform?: string;
  /**
   * Outbound transport. Throw/reject with a {@link ChannelError}, or an error carrying an HTTP
   * `status` (and optional `retryAfterMs`) or Node `code`, and it is classified into a typed error.
   */
  readonly onResponse?: (target: ChannelTarget, content: MessageContent) => Promise<void>;
  /** At most `max` sends per `window`; excess sends wait. */
  readonly rateLimit?: { readonly max: number; readonly window: Duration.DurationInput };
  /** Buffered inbound envelopes before `handleRequest` waits for the consumer. Default 256. */
  readonly inboundCapacity?: number;
}

const WEBHOOK_CAPABILITIES: ChannelCapabilities = {
  threads: true,
  attachments: true,
  markdown: true,
  receipts: false,
  groups: true,
};

/**
 * Generic HTTPS webhook ingress and callback egress implementing the canonical
 * {@link ChannelAdapter} contract.
 *
 * Request signing: `x-channels-timestamp: <epoch seconds|ms>` and
 * `x-channels-signature: hex(HMAC-SHA256(secret, "<timestamp>.<body>"))`. Binding the timestamp
 * into the signature gives a replay window; a replayed request with the same message id is also
 * deduplicated.
 *
 * Also implements the legacy {@link MessageChannel} shape (`connect`, `onMessage`, `sendMessage`)
 * so existing consumers keep working.
 */
export class WebhookChannelAdapter implements ChannelAdapter, MessageChannel {
  readonly id: string;
  readonly platform: string;
  readonly capabilities = WEBHOOK_CAPABILITIES;
  readonly inbound: Stream.Stream<InboundEnvelope, ChannelError>;
  readonly state: Stream.Stream<ConnectionState>;
  readonly currentState: Effect.Effect<ConnectionState>;

  private readonly secret?: Redacted.Redacted<string>;
  private readonly allowUnsigned: boolean;
  private readonly replayWindowMs: number;
  private readonly onResponse?: WebhookChannelAdapterConfig["onResponse"];
  private readonly queue: Queue.Queue<InboundEnvelope>;
  private readonly conn: ConnectionStateRef;
  private readonly firstSeen = makeInboundDedupe();
  private readonly sendLimited: (m: OutboundMessage) => Effect.Effect<DeliveryReceipt, ChannelError>;
  private handler?: (msg: InboundMessage) => Effect.Effect<void>;
  private unsub = false;
  private started = false;

  constructor(config: WebhookChannelAdapterConfig) {
    this.id = config.id ?? "webhook";
    this.platform = config.platform ?? "webhook";
    // An empty/whitespace secret (e.g. `process.env.X ?? ""`) is "no secret": HMAC with an empty
    // key is forgeable by anyone, so it must fail closed (missing_secret) like an unset one.
    const rawSecret = typeof config.secret === "string" ? config.secret : config.secret && Redacted.value(config.secret);
    this.secret =
      config.secret === undefined || !rawSecret || rawSecret.trim() === ""
        ? undefined
        : typeof config.secret === "string"
          ? Redacted.make(config.secret)
          : config.secret;
    this.allowUnsigned = config.allowUnsigned === true;
    this.replayWindowMs = config.replayWindowMs ?? 300_000;
    this.onResponse = config.onResponse;
    this.queue = Effect.runSync(Queue.bounded<InboundEnvelope>(config.inboundCapacity ?? 256));
    this.conn = Effect.runSync(makeConnectionState());
    this.inbound = Stream.fromQueue(this.queue);
    this.state = this.conn.state;
    this.currentState = this.conn.current;
    const limiter = config.rateLimit
      ? Effect.runSync(makeOutboundRateLimiter(config.rateLimit.max, config.rateLimit.window))
      : undefined;
    this.sendLimited = (m) => {
      const raw = this.sendRaw(m);
      return limiter ? limiter(raw) : raw;
    };
  }

  /**
   * True once something consumes inbound: `start()` ran (new contract) or `onMessage` registered a
   * handler (legacy). Before that, `handleRequest` fails with `not_started` instead of dropping.
   *
   * `agent.start()` registers adapters asynchronously; poll this rather than sleeping.
   */
  get isSubscribed(): boolean {
    return this.started || (this.handler !== undefined && !this.unsub);
  }

  // ── ChannelAdapter ──────────────────────────────────────────────────────

  start(): Effect.Effect<void, ChannelError, Scope.Scope> {
    const self = this;
    return Effect.acquireRelease(
      Effect.suspend(() => {
        self.started = true;
        return self.conn.set({ status: "connected" });
      }),
      () =>
        Effect.suspend(() => {
          self.started = false;
          return self.conn.set({ status: "disconnected" });
        }),
    ).pipe(Effect.asVoid);
  }

  send(message: OutboundMessage): Effect.Effect<DeliveryReceipt, ChannelError> {
    return this.sendLimited(message);
  }

  private sendRaw(message: OutboundMessage): Effect.Effect<DeliveryReceipt, ChannelError> {
    const fn = this.onResponse;
    if (!fn) {
      return Effect.fail(
        channelError(this.id, "unsupported", { message: `channel ${this.id}: no onResponse configured` }),
      );
    }
    const self = this;
    const target: ChannelTarget = {
      channelId: message.conversation.channelId,
      ...(message.conversation.threadId !== undefined ? { threadId: message.conversation.threadId } : {}),
      ...(message.replyTo !== undefined ? { replyToMessageId: message.replyTo } : {}),
    };
    const content: MessageContent = {
      text: message.text,
      ...(message.format !== undefined ? { format: message.format } : {}),
      ...(message.attachments !== undefined ? { attachments: [...message.attachments] } : {}),
    };
    return Effect.tryPromise({
      try: () => fn(target, content),
      catch: (cause) => classifyChannelFailure(self.id, cause),
    }).pipe(
      Effect.zipRight(Clock.currentTimeMillis),
      Effect.map((sentAt): DeliveryReceipt => ({
        messageId: `wh-${randomUUID()}`,
        adapterId: self.id,
        platform: self.platform,
        status: "sent",
        sentAt,
      })),
    );
  }

  /**
   * Verifies signature and replay window, normalizes the JSON body into an {@link InboundEnvelope},
   * drops repeats of the same message id, then delivers: to the legacy `onMessage` handler when one
   * is registered, otherwise onto the backpressured `inbound` stream (this call waits while the
   * stream is full).
   */
  handleRequest(req: {
    body: string;
    headers: Record<string, string>;
  }): Effect.Effect<void, ChannelConnectionError> {
    const self = this;
    const reject = (reason: string, cause?: unknown) =>
      Effect.fail(new ChannelConnectionError({ adapter: self.id, reason, cause }));
    return Effect.gen(function* () {
      const headers = lowerCaseKeys(req.headers);
      const now = yield* Clock.currentTimeMillis;

      if (self.secret) {
        const sig = headers["x-channels-signature"];
        if (!sig) return yield* reject("missing_signature");
        const rawTs = headers["x-channels-timestamp"];
        if (!rawTs) return yield* reject("missing_timestamp");
        const tsMs = parseTimestampMs(rawTs);
        if (tsMs === undefined || Math.abs(now - tsMs) > self.replayWindowMs) {
          return yield* reject("stale_timestamp");
        }
        const expected = createHmac("sha256", Redacted.value(self.secret))
          .update(`${rawTs}.${req.body}`)
          .digest("hex");
        const a = Buffer.from(sig, "utf8");
        const b = Buffer.from(expected, "utf8");
        if (a.length !== b.length || !timingSafeEqual(a, b)) return yield* reject("invalid_signature");
      } else if (!self.allowUnsigned) {
        return yield* reject("missing_secret");
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(req.body) as unknown;
      } catch (e) {
        return yield* reject("invalid_json", e);
      }

      const env = normalizeWebhookPayload(self.platform, parsed, now);
      if (!self.firstSeen(`${env.sender.platform}:${env.id}`)) return;

      const h = self.handler;
      if (h && !self.unsub) {
        yield* h(envelopeToInboundMessage(env));
        return;
      }
      if (!self.started) return yield* reject("not_started");
      yield* Queue.offer(self.queue, env);
    });
  }

  // ── Legacy MessageChannel ───────────────────────────────────────────────

  connect(): Effect.Effect<void, ChannelConnectionError> {
    this.started = true;
    return this.conn.set({ status: "connected" });
  }

  disconnect(): Effect.Effect<void, ChannelConnectionError> {
    this.handler = undefined;
    this.started = false;
    return this.conn.set({ status: "disconnected" });
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

  sendMessage(target: ChannelTarget, content: MessageContent): Effect.Effect<SendResult, ChannelSendError> {
    const message: OutboundMessage = {
      conversation: {
        channelId: target.channelId,
        ...(target.threadId !== undefined ? { threadId: target.threadId } : {}),
      },
      text: content.text,
      ...(content.format !== undefined ? { format: content.format } : {}),
      ...(content.attachments !== undefined ? { attachments: content.attachments } : {}),
      ...(target.replyToMessageId !== undefined ? { replyTo: target.replyToMessageId } : {}),
    };
    const id = this.id;
    return this.send(message).pipe(
      Effect.map((r): SendResult => ({ messageId: r.messageId, timestamp: new Date(r.sentAt) })),
      Effect.mapError(
        (e) => new ChannelSendError({ adapter: id, target, reason: LEGACY_REASON[e.kind] ?? "unknown", cause: e }),
      ),
    );
  }
}

const LEGACY_REASON: Readonly<Record<string, ChannelSendError["reason"]>> = {
  rate_limited: "rate_limited",
  too_large: "message_too_large",
  not_found: "channel_not_found",
  auth: "unauthorized",
  forbidden: "unauthorized",
};

function lowerCaseKeys(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v;
  return out;
}

/** Epoch seconds (< 1e12) or milliseconds; undefined when not a finite number. */
function parseTimestampMs(raw: string): number | undefined {
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return n < 1e12 ? n * 1000 : n;
}

const str = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : String(v));

function normalizeAttachments(raw: unknown): Attachment[] {
  if (!Array.isArray(raw)) return [];
  const out: Attachment[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const a = item as Record<string, unknown>;
    const filename = str(a.filename) ?? "attachment";
    const contentType = str(a.contentType) ?? "application/octet-stream";
    if (typeof a.url === "string") {
      out.push({ type: "url", filename, contentType, url: a.url });
    } else if (typeof a.data === "string") {
      out.push({ type: "binary", filename, contentType, data: new Uint8Array(Buffer.from(a.data, "base64")) });
    }
  }
  return out;
}

function normalizeWebhookPayload(platform: string, body: unknown, now: number): InboundEnvelope {
  const o: Record<string, unknown> =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const ts = o.timestamp !== undefined ? new Date(String(o.timestamp)).getTime() : Number.NaN;
  const threadId = str(o.threadId ?? o.thread_id);
  const replyTo = str(o.replyTo ?? o.reply_to);
  const displayName = str(o.senderName);
  const metadata =
    typeof o.metadata === "object" && o.metadata !== null ? (o.metadata as Record<string, unknown>) : undefined;
  return {
    id: str(o.id ?? o.message_id) ?? randomUUID(),
    conversation: {
      channelId: str(o.channelId ?? o.chat_id) ?? "default",
      ...(threadId !== undefined ? { threadId } : {}),
      isGroup: o.isGroup === true || o.is_group === true,
    },
    sender: {
      platform: str(o.platform) ?? platform,
      userId: str(o.senderId ?? o.from_id) ?? "unknown",
      ...(displayName !== undefined ? { displayName } : {}),
    },
    text: str(o.content ?? o.text) ?? "",
    attachments: normalizeAttachments(o.attachments),
    ...(replyTo !== undefined ? { replyTo } : {}),
    mentionsSelf: o.mentionsSelf === true,
    isEcho: o.isEcho === true || o.is_echo === true,
    receivedAt: Number.isFinite(ts) ? ts : now,
    ...(metadata ? { metadata } : {}),
  };
}
