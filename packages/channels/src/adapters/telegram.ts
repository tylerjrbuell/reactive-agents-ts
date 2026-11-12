import { timingSafeEqual } from "node:crypto";
import { Clock, Deferred, Duration, Effect, Queue, Redacted, Schedule, Stream, type Scope } from "effect";
import type {
  ChannelAdapter,
  ChannelCapabilities,
  ConnectionState,
  DeliveryReceipt,
  InboundEnvelope,
  OutboundMessage,
} from "../adapter.js";
import {
  makeConnectionState,
  makeInboundDedupe,
  makeOutboundRateLimiter,
  withReconnect,
  type ConnectionStateRef,
} from "../combinators.js";
import { channelError, isChannelError, type ChannelError } from "../errors.js";
import type { Attachment } from "../types.js";
import { makeTelegramApi, type FetchLike, type TelegramApi } from "./telegram-api.js";
import {
  isEntityParseFailure,
  parseTelegramUpdate,
  splitTelegramText,
  TELEGRAM_MAX_TEXT,
  toMarkdownV2,
  type TelegramEvent,
  type TelegramSelf,
} from "./telegram-protocol.js";

type Limit = { readonly max: number; readonly window: Duration.DurationInput };
type Limiter = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;

export interface TelegramChannelAdapterConfig {
  readonly id?: string;
  /** The BotFather token. `Redacted` keeps it out of logs; it never appears in errors, receipts or URLs we report. */
  readonly token: string | Redacted.Redacted<string>;
  /** HTTP client. Default: global `fetch`. Tests inject a fake Bot API server. */
  readonly fetch?: FetchLike;
  /** Default `https://api.telegram.org`. */
  readonly apiBaseUrl?: string;
  /**
   * Receive updates by webhook instead of long polling. Pass the secret Telegram echoes in
   * `X-Telegram-Bot-Api-Secret-Token`; with `url`, `start()` registers it via `setWebhook`.
   * Feed requests to {@link TelegramChannelAdapter.handleWebhook}.
   */
  readonly webhook?: { readonly secretToken: string | Redacted.Redacted<string>; readonly url?: string };
  /** First `getUpdates` offset (the persisted value from `onOffset`). Default: Telegram's oldest unconfirmed update. */
  readonly initialOffset?: number;
  /**
   * Called with the new offset after an update was handed to the inbound queue. Persist it so a
   * restart resumes without replays. Failures are ignored (a replay is deduplicated).
   */
  readonly onOffset?: (offset: number) => Effect.Effect<void>;
  /** Long-poll seconds Telegram holds an empty `getUpdates`. Default 30. */
  readonly pollTimeoutSeconds?: number;
  /** Update kinds to request. Default `["message", "channel_post"]`. */
  readonly allowedUpdates?: readonly string[];
  /** Global send limit. Default 30 per second (Telegram's broadcast limit); `false` disables. */
  readonly rateLimit?: Limit | false;
  /** Per-chat send limits. Default 1 per second in a DM and 20 per minute in a group; `false` disables. */
  readonly chatRateLimit?: { readonly dm?: Limit; readonly group?: Limit } | false;
  /** Buffered inbound envelopes before polling is slowed. Default 256. */
  readonly inboundCapacity?: number;
  /** Reconnect backoff. Default: exponential from 500 ms, capped at 30 s. */
  readonly reconnectSchedule?: Schedule.Schedule<unknown, unknown>;
  /** Inbound files larger than this are not downloaded. Default 20 MiB (the Bot API `getFile` limit). */
  readonly maxInboundAttachmentBytes?: number;
}

const TELEGRAM_CAPABILITIES: ChannelCapabilities = {
  threads: true,
  attachments: true,
  markdown: true,
  receipts: false,
  groups: true,
  maxTextLength: TELEGRAM_MAX_TEXT,
  maxAttachmentBytes: 50 * 1024 * 1024,
};

const DEFAULT_GLOBAL: Limit = { max: 30, window: "1 second" };
const DEFAULT_DM: Limit = { max: 1, window: "1 second" };
const DEFAULT_GROUP: Limit = { max: 20, window: "1 minute" };
const MEMORY = 1024;
const MAX_CHAT_LIMITERS = 1024;

const isNumeric = (s: string): boolean => /^-?\d+$/.test(s);
const chatParam = (channelId: string): number | string => (isNumeric(channelId) ? Number(channelId) : channelId);
const isGroupChat = (channelId: string): boolean => channelId.startsWith("-") || channelId.startsWith("@");

const asRecord = (u: unknown): Record<string, unknown> | undefined =>
  typeof u === "object" && u !== null && !Array.isArray(u) ? (u as Record<string, unknown>) : undefined;

/**
 * Native Telegram **bot** adapter (Bot API, bot token) implementing the canonical {@link ChannelAdapter}.
 * It replaces the Telethon personal-account userbot for new setups.
 *
 * - Inbound by long polling `getUpdates` (default) or by webhook. The offset advances only after an
 *   update was handed to the inbound queue (at-least-once); replays are deduplicated.
 * - Identity is `telegram:<numeric user id>` with the username as `displayName`. A group is the
 *   conversation and the individual sender is kept. Ids are `<chatId>:<messageId>`.
 * - `send` splits text at 4096 units, converts `format: "markdown"` to MarkdownV2 (falling back to
 *   plain text if Telegram rejects the entities), and returns the real `message_id` as the receipt.
 * - Telegram sends no delivery or typing signals to bots: `capabilities.receipts` is `false`.
 * - `409 Conflict` (another poller or a webhook owns the bot) stops the adapter with a clear error.
 */
export class TelegramChannelAdapter implements ChannelAdapter {
  readonly id: string;
  readonly platform = "telegram";
  readonly capabilities = TELEGRAM_CAPABILITIES;
  readonly inbound: Stream.Stream<InboundEnvelope, ChannelError>;
  readonly state: Stream.Stream<ConnectionState>;
  readonly currentState: Effect.Effect<ConnectionState>;

  private readonly api: TelegramApi;
  private readonly inboundQueue: Queue.Queue<InboundEnvelope | ChannelError>;
  private readonly conn: ConnectionStateRef;
  private readonly seenUpdates = makeInboundDedupe();
  private readonly seenMessages = makeInboundDedupe();
  private readonly sentIds = new Set<string>();
  private readonly config: TelegramChannelAdapterConfig;
  private readonly webhookSecret?: Redacted.Redacted<string>;
  private readonly globalLimiter?: Limiter;
  private readonly chatLimits: { readonly dm?: Limit; readonly group?: Limit };
  private readonly chatLimiters = new Map<string, Limiter>();
  private me?: TelegramSelf;
  private offset: number;
  private accepting = false;
  private lastSentAt = 0;

  constructor(config: TelegramChannelAdapterConfig) {
    this.config = config;
    this.id = config.id ?? "telegram";
    const token = typeof config.token === "string" ? Redacted.make(config.token) : config.token;
    this.api = makeTelegramApi({
      adapterId: this.id,
      token,
      ...(config.fetch ? { fetch: config.fetch } : {}),
      ...(config.apiBaseUrl ? { apiBaseUrl: config.apiBaseUrl } : {}),
    });
    this.webhookSecret = config.webhook
      ? typeof config.webhook.secretToken === "string"
        ? Redacted.make(config.webhook.secretToken)
        : config.webhook.secretToken
      : undefined;
    this.offset = config.initialOffset ?? 0;
    this.inboundQueue = Effect.runSync(Queue.bounded<InboundEnvelope | ChannelError>(config.inboundCapacity ?? 256));
    this.conn = Effect.runSync(makeConnectionState());
    this.inbound = Stream.fromQueue(this.inboundQueue).pipe(
      Stream.mapEffect((item) => (isChannelError(item) ? Effect.fail(item) : Effect.succeed(item))),
    );
    this.state = this.conn.state;
    this.currentState = this.conn.current;
    const global = config.rateLimit === false ? undefined : (config.rateLimit ?? DEFAULT_GLOBAL);
    this.globalLimiter = global ? Effect.runSync(makeOutboundRateLimiter(global.max, global.window)) : undefined;
    this.chatLimits =
      config.chatRateLimit === false ? {} : { dm: DEFAULT_DM, group: DEFAULT_GROUP, ...(config.chatRateLimit ?? {}) };
  }

  // ── ChannelAdapter ──────────────────────────────────────────────────────

  start(): Effect.Effect<void, ChannelError, Scope.Scope> {
    const self = this;
    return Effect.gen(function* () {
      yield* self.conn.set({ status: "connecting" });
      yield* Effect.addFinalizer(() =>
        Effect.zipRight(
          Effect.sync(() => void (self.accepting = false)),
          self.conn.set({ status: "disconnected" }),
        ),
      );
      if (self.config.webhook) {
        yield* self.startWebhook();
        return;
      }
      const ready = yield* Deferred.make<void, ChannelError>();
      // `start` returns once the first connection attempt resolved: connected, retrying, or failed for good.
      const observed: Pick<ConnectionStateRef, "set"> = {
        set: (next) =>
          Effect.zipRight(
            self.conn.set(next),
            next.status === "connected" || next.status === "reconnecting"
              ? Deferred.succeed(ready, undefined)
              : next.status === "failed"
                ? Deferred.fail(ready, next.error)
                : Effect.void,
          ).pipe(Effect.asVoid),
      };
      const pump = withReconnect(self.id, self.openPolling(), observed, self.config.reconnectSchedule).pipe(
        Stream.runForEach((update) => self.ingestAndAcknowledge(update)),
        Effect.catchAll((error) => Queue.offer(self.inboundQueue, error)),
      );
      self.accepting = true;
      yield* Effect.forkScoped(pump);
      yield* Deferred.await(ready);
    });
  }

  send(message: OutboundMessage): Effect.Effect<DeliveryReceipt, ChannelError> {
    return this.sendRaw(message);
  }

  /**
   * Webhook ingest: verify `X-Telegram-Bot-Api-Secret-Token` (constant time; fail closed when no
   * secret is configured), parse the update and hand it to the inbound queue. Waits while the
   * queue is full, so Telegram's retry applies the backpressure.
   */
  handleWebhook(req: {
    readonly body: string;
    readonly headers: Readonly<Record<string, string>>;
  }): Effect.Effect<void, ChannelError> {
    const self = this;
    return Effect.gen(function* () {
      const secret = self.webhookSecret;
      if (!secret) {
        return yield* Effect.fail(channelError(self.id, "forbidden", { message: `channel ${self.id}: webhook ingest is not configured` }));
      }
      const given = Object.entries(req.headers).find(([k]) => k.toLowerCase() === "x-telegram-bot-api-secret-token")?.[1] ?? "";
      const a = Buffer.from(given, "utf8");
      const b = Buffer.from(Redacted.value(secret), "utf8");
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return yield* Effect.fail(channelError(self.id, "forbidden", { message: `channel ${self.id}: invalid webhook secret` }));
      }
      if (!self.accepting) {
        return yield* Effect.fail(channelError(self.id, "unsupported", { message: `channel ${self.id}: not started` }));
      }
      let update: unknown;
      try {
        update = JSON.parse(req.body) as unknown;
      } catch {
        return yield* Effect.fail(channelError(self.id, "unsupported", { message: `channel ${self.id}: webhook body is not JSON` }));
      }
      yield* self.ingest(update);
    });
  }

  // ── Connection ──────────────────────────────────────────────────────────

  private ensureMe(): Effect.Effect<TelegramSelf, ChannelError> {
    const self = this;
    return Effect.suspend(() => {
      if (self.me) return Effect.succeed(self.me);
      return self.api.call("getMe").pipe(
        Effect.flatMap((result) => {
          const r = asRecord(result);
          if (!r || typeof r.id !== "number") {
            return Effect.fail(channelError(self.id, "unknown", { message: `channel ${self.id}: getMe returned no bot id` }));
          }
          const me: TelegramSelf = { id: r.id, ...(typeof r.username === "string" ? { username: r.username } : {}) };
          self.me = me;
          return Effect.succeed(me);
        }),
      );
    });
  }

  private startWebhook(): Effect.Effect<void, ChannelError> {
    const self = this;
    const webhook = self.config.webhook;
    return Effect.gen(function* () {
      yield* self.ensureMe();
      if (webhook?.url !== undefined && self.webhookSecret) {
        yield* self.api.call("setWebhook", {
          url: webhook.url,
          secret_token: Redacted.value(self.webhookSecret),
          allowed_updates: self.config.allowedUpdates ?? ["message", "channel_post"],
        });
      }
      self.accepting = true;
      yield* self.conn.set({ status: "connected" });
    }).pipe(Effect.tapError((error) => self.conn.set({ status: "failed", error })));
  }

  private openPolling(): Effect.Effect<Stream.Stream<unknown, ChannelError>, ChannelError> {
    const self = this;
    const seconds = self.config.pollTimeoutSeconds ?? 30;
    const poll: Effect.Effect<readonly unknown[], ChannelError> = Effect.suspend(() =>
      self.api
        .call(
          "getUpdates",
          {
            timeout: seconds,
            allowed_updates: self.config.allowedUpdates ?? ["message", "channel_post"],
            ...(self.offset > 0 ? { offset: self.offset } : {}),
          },
          { timeoutMs: (seconds + 15) * 1000 },
        )
        .pipe(Effect.map((result) => (Array.isArray(result) ? result : []))),
    );
    return Effect.map(self.ensureMe(), () => Stream.repeatEffect(poll).pipe(Stream.flattenIterables));
  }

  // ── Inbound ─────────────────────────────────────────────────────────────

  /** Hand the update to the inbound queue, then (only then) advance and publish the offset. */
  private ingestAndAcknowledge(update: unknown): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      yield* self.ingest(update);
      const updateId = asRecord(update)?.update_id;
      if (typeof updateId !== "number") return;
      self.offset = Math.max(self.offset, updateId + 1);
      if (self.config.onOffset) yield* self.config.onOffset(self.offset).pipe(Effect.ignore);
    });
  }

  private ingest(update: unknown): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      const me = self.me;
      if (!me) return;
      const event: TelegramEvent = parseTelegramUpdate(update, me, (id) => self.sentIds.has(id));
      if (event.kind !== "message") return;

      const fetched = event.isEcho ? { attachments: [] as Attachment[], unavailable: 0 } : yield* self.fetchFiles(event);
      const envelope: InboundEnvelope = {
        id: event.id,
        conversation: {
          channelId: event.chatId,
          ...(event.threadId !== undefined ? { threadId: event.threadId } : {}),
          isGroup: event.isGroup,
        },
        sender: {
          platform: self.platform,
          userId: event.userId,
          ...(event.displayName !== undefined ? { displayName: event.displayName } : {}),
        },
        text: event.text,
        attachments: fetched.attachments,
        ...(event.replyTo !== undefined ? { replyTo: event.replyTo } : {}),
        mentionsSelf: event.mentionsSelf,
        isEcho: event.isEcho,
        receivedAt: event.timestamp,
        metadata: {
          updateId: event.updateId,
          chatType: event.chatType,
          ...(fetched.unavailable > 0 ? { attachmentsUnavailable: fetched.unavailable } : {}),
        },
      };
      // Marked seen only now, right before the hand-off: an interrupted attempt must stay retryable.
      if (!self.seenUpdates(String(event.updateId)) || !self.seenMessages(event.id)) return;
      yield* Queue.offer(self.inboundQueue, envelope);
    });
  }

  /** Download inbound files. A failed or oversized download is counted, never silently dropped. */
  private fetchFiles(
    event: Extract<TelegramEvent, { kind: "message" }>,
  ): Effect.Effect<{ attachments: Attachment[]; unavailable: number }> {
    const self = this;
    const limit = self.config.maxInboundAttachmentBytes ?? 20 * 1024 * 1024;
    return Effect.gen(function* () {
      const attachments: Attachment[] = [];
      let unavailable = 0;
      for (const file of event.files) {
        const bytes =
          file.size !== undefined && file.size > limit
            ? undefined
            : yield* self.api.call("getFile", { file_id: file.fileId }).pipe(
                Effect.flatMap((info) => {
                  const path = asRecord(info)?.file_path;
                  return typeof path === "string" ? self.api.download(path) : Effect.succeed(undefined);
                }),
                Effect.catchAll(() => Effect.succeed(undefined)),
              );
        if (bytes && bytes.length <= limit) {
          attachments.push({ type: "binary", filename: file.filename, contentType: file.contentType, data: bytes });
        } else unavailable++;
      }
      return { attachments, unavailable };
    });
  }

  // ── Outbound ────────────────────────────────────────────────────────────

  private chatLimiter(channelId: string): Limiter | undefined {
    const limit = isGroupChat(channelId) ? this.chatLimits.group : this.chatLimits.dm;
    if (!limit) return undefined;
    const existing = this.chatLimiters.get(channelId);
    if (existing) return existing;
    if (this.chatLimiters.size >= MAX_CHAT_LIMITERS) {
      const oldest = this.chatLimiters.keys().next().value;
      if (oldest !== undefined) this.chatLimiters.delete(oldest);
    }
    const made = Effect.runSync(makeOutboundRateLimiter(limit.max, limit.window));
    this.chatLimiters.set(channelId, made);
    return made;
  }

  /** Per-chat limit first, then the global one, then the call. Excess sends wait; none are dropped. */
  private limited<A>(channelId: string, call: Effect.Effect<A, ChannelError>): Effect.Effect<A, ChannelError> {
    const global = this.globalLimiter;
    const chat = this.chatLimiter(channelId);
    const inner = global ? global(call) : call;
    return chat ? chat(inner) : inner;
  }

  private sendRaw(message: OutboundMessage): Effect.Effect<DeliveryReceipt, ChannelError> {
    const self = this;
    return Effect.gen(function* () {
      const channelId = message.conversation.channelId;
      const threadId = message.conversation.threadId;
      if (threadId !== undefined && !/^\d+$/.test(threadId)) {
        return yield* Effect.fail(channelError(self.id, "unsupported", { message: `channel ${self.id}: threadId must be a numeric message_thread_id` }));
      }
      const replyId = message.replyTo !== undefined ? parseReplyRef(message.replyTo, channelId) : undefined;
      if (message.replyTo !== undefined && replyId === undefined) {
        return yield* Effect.fail(channelError(self.id, "unsupported", { message: `channel ${self.id}: replyTo must be a message id in this chat` }));
      }
      const attachments = message.attachments ?? [];
      const chunks = message.text === "" ? [] : splitTelegramText(message.text, TELEGRAM_MAX_TEXT);
      if (chunks.length === 0 && attachments.length === 0) {
        return yield* Effect.fail(channelError(self.id, "unsupported", { message: `channel ${self.id}: empty message` }));
      }
      const target = {
        chat_id: chatParam(channelId),
        ...(threadId !== undefined ? { message_thread_id: Number(threadId) } : {}),
      };
      let reply = replyId;
      let lastId = "";
      for (const chunk of chunks) {
        lastId = yield* self.sendText(channelId, target, chunk, message.format === "markdown", reply);
        reply = undefined;
      }
      for (const attachment of attachments) {
        lastId = yield* self.sendAttachment(channelId, target, attachment, reply);
        reply = undefined;
      }
      const now = yield* Clock.currentTimeMillis;
      self.lastSentAt = Math.max(self.lastSentAt, now);
      return {
        messageId: lastId,
        adapterId: self.id,
        platform: self.platform,
        status: "sent",
        sentAt: self.lastSentAt,
      } satisfies DeliveryReceipt;
    });
  }

  private sendText(
    channelId: string,
    target: Record<string, unknown>,
    text: string,
    markdown: boolean,
    replyId: number | undefined,
  ): Effect.Effect<string, ChannelError> {
    const reply = replyParams(replyId);
    const plain = this.deliver(channelId, "sendMessage", { ...target, text, ...reply });
    if (!markdown) return plain;
    return this.deliver(channelId, "sendMessage", { ...target, text: toMarkdownV2(text), parse_mode: "MarkdownV2", ...reply }).pipe(
      Effect.catchIf(isEntityParseFailure, () => plain),
    );
  }

  private sendAttachment(
    channelId: string,
    target: Record<string, unknown>,
    attachment: Attachment,
    replyId: number | undefined,
  ): Effect.Effect<string, ChannelError> {
    const asPhoto = /^image\/(jpeg|png)$/.test(attachment.contentType);
    const method = asPhoto ? "sendPhoto" : "sendDocument";
    const field = asPhoto ? "photo" : "document";
    const params = { ...target, ...replyParams(replyId) };
    return attachment.type === "url"
      ? this.deliver(channelId, method, { ...params, [field]: attachment.url })
      : this.deliver(channelId, method, params, {
          [field]: { filename: attachment.filename, contentType: attachment.contentType, data: attachment.data },
        });
  }

  /** One rate-limited Bot API send. Resolves to the real `<chatId>:<messageId>` and remembers it for echo detection. */
  private deliver(
    channelId: string,
    method: string,
    params: Record<string, unknown>,
    files?: Record<string, { filename: string; contentType: string; data: Uint8Array }>,
  ): Effect.Effect<string, ChannelError> {
    const self = this;
    return self.limited(channelId, self.api.call(method, params, files ? { files } : {})).pipe(
      Effect.flatMap((result) => {
        const r = asRecord(result);
        const chat = asRecord(r?.chat)?.id;
        if (!r || typeof r.message_id !== "number" || (typeof chat !== "number" && typeof chat !== "string")) {
          return Effect.fail(channelError(self.id, "unknown", { message: `channel ${self.id}: ${method} response had no message_id` }));
        }
        const id = `${chat}:${r.message_id}`;
        self.rememberSent(id);
        return Effect.succeed(id);
      }),
    );
  }

  private rememberSent(id: string): void {
    this.sentIds.add(id);
    if (this.sentIds.size > MEMORY) {
      const oldest = this.sentIds.values().next().value;
      if (oldest !== undefined) this.sentIds.delete(oldest);
    }
  }
}

/** `41` or `<chatId>:41` (an envelope id) in the target chat. Anything else is invalid. */
const parseReplyRef = (ref: string, channelId: string): number | undefined => {
  const m = /^(?:(-?\d+):)?(\d+)$/.exec(ref);
  if (!m || (m[1] !== undefined && m[1] !== channelId)) return undefined;
  return Number(m[2]);
};

const replyParams = (messageId: number | undefined): Record<string, unknown> =>
  messageId === undefined ? {} : { reply_parameters: { message_id: messageId, allow_sending_without_reply: true } };
