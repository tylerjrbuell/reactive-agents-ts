import { Clock, Deferred, Duration, Effect, Exit, Queue, Redacted, Schedule, Scope, Stream } from "effect";
import type {
  ChannelAdapter,
  ChannelCapabilities,
  ConnectionState,
  DeliveryReceipt,
  DeliveryUpdate,
  InboundEnvelope,
  OutboundMessage,
  SenderGate,
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
import {
  failureFromSendResult,
  isDirectAddress,
  mapSignalFailure,
  parseReplyRef,
  parseSignalNotification,
  type SignalAttachmentRef,
  type SignalEvent,
} from "./signal-protocol.js";
import type { SignalConnection, SignalNotification, SignalTransport } from "./signal-transport.js";

export interface SignalChannelAdapterConfig {
  readonly id?: string;
  /** The bot's own number. `Redacted` keeps it out of logs; it never appears in errors or receipts. */
  readonly account: string | Redacted.Redacted<string>;
  /** The bot's uuid, so group mentions of a number-less account resolve `mentionsSelf`. */
  readonly accountUuid?: string;
  /** How to reach signal-cli: `makeSignalProcessTransport`, `makeSignalSocketTransport`, or a fake. */
  readonly transport: SignalTransport;
  /** At most `max` sends per `window`; excess sends wait. */
  readonly rateLimit?: { readonly max: number; readonly window: Duration.DurationInput };
  /** Buffered inbound envelopes before the transport is slowed. Default 256. */
  readonly inboundCapacity?: number;
  /** Reconnect backoff. Default: exponential from 500 ms, capped at 30 s. */
  readonly reconnectSchedule?: Schedule.Schedule<unknown, unknown>;
  /** Inbound attachments larger than this are not downloaded. Default 25 MiB. */
  readonly maxInboundAttachmentBytes?: number;
}

const SIGNAL_CAPABILITIES: ChannelCapabilities = {
  threads: false,
  attachments: true,
  markdown: false,
  receipts: true,
  groups: true,
};

const SENT_MEMORY = 1024;

/**
 * Native Signal adapter over `signal-cli` JSON-RPC, implementing the canonical {@link ChannelAdapter}.
 *
 * - Identity is `signal:<number-or-uuid>`; a group is the conversation and the individual sender is
 *   kept, so concurrent senders are never cross-wired.
 * - `send` returns the message timestamp (Signal's message id) as a real receipt, or a typed
 *   {@link ChannelError}. Delivery and read receipts arrive on `deliveryUpdates`.
 * - Echoes of this adapter's own sends are recognised by timestamp, never by text.
 * - Connection loss reconnects with backoff; bad credentials stop the retry loop.
 */
export class SignalChannelAdapter implements ChannelAdapter {
  readonly id: string;
  readonly platform = "signal";
  readonly capabilities = SIGNAL_CAPABILITIES;
  readonly inbound: Stream.Stream<InboundEnvelope, ChannelError>;
  readonly deliveryUpdates: Stream.Stream<DeliveryUpdate>;
  readonly state: Stream.Stream<ConnectionState>;
  readonly currentState: Effect.Effect<ConnectionState>;

  private readonly account: Redacted.Redacted<string>;
  private readonly accountUuid?: string;
  private readonly transport: SignalTransport;
  private readonly inboundQueue: Queue.Queue<InboundEnvelope | ChannelError>;
  private readonly receiptQueue: Queue.Queue<DeliveryUpdate>;
  private readonly conn: ConnectionStateRef;
  private readonly firstSeen = makeInboundDedupe();
  private readonly sentTimestamps = new Set<string>();
  private readonly sendLimited: (m: OutboundMessage) => Effect.Effect<DeliveryReceipt, ChannelError>;
  private readonly reconnectSchedule?: Schedule.Schedule<unknown, unknown>;
  private readonly maxInboundAttachmentBytes: number;
  private connection?: SignalConnection;
  private lastSentAt = 0;
  private senderGate?: SenderGate;

  /** Installed by `ChannelService`: only gated-in senders may cause attachment downloads. */
  setSenderGate(gate: SenderGate): void {
    this.senderGate = gate;
  }

  constructor(config: SignalChannelAdapterConfig) {
    this.id = config.id ?? "signal";
    this.account = typeof config.account === "string" ? Redacted.make(config.account) : config.account;
    this.accountUuid = config.accountUuid;
    this.transport = config.transport;
    this.reconnectSchedule = config.reconnectSchedule;
    this.maxInboundAttachmentBytes = config.maxInboundAttachmentBytes ?? 25 * 1024 * 1024;
    this.inboundQueue = Effect.runSync(Queue.bounded<InboundEnvelope | ChannelError>(config.inboundCapacity ?? 256));
    this.receiptQueue = Effect.runSync(Queue.sliding<DeliveryUpdate>(256));
    this.conn = Effect.runSync(makeConnectionState());
    this.inbound = Stream.fromQueue(this.inboundQueue).pipe(
      Stream.mapEffect((item) => (isChannelError(item) ? Effect.fail(item) : Effect.succeed(item))),
    );
    this.deliveryUpdates = Stream.fromQueue(this.receiptQueue);
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

  // ── ChannelAdapter ──────────────────────────────────────────────────────

  start(): Effect.Effect<void, ChannelError, Scope.Scope> {
    const self = this;
    return Effect.gen(function* () {
      yield* self.conn.set({ status: "connecting" });
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
      yield* Effect.addFinalizer(() => self.conn.set({ status: "disconnected" }));
      const pump = withReconnect(self.id, self.openConnection(), observed, self.reconnectSchedule).pipe(
        Stream.runForEach((n) => self.handle(n)),
        Effect.catchAll((error) => Queue.offer(self.inboundQueue, error)),
      );
      yield* Effect.forkScoped(pump);
      yield* Deferred.await(ready);
    });
  }

  send(message: OutboundMessage): Effect.Effect<DeliveryReceipt, ChannelError> {
    return this.sendLimited(message);
  }

  // ── Connection ──────────────────────────────────────────────────────────

  private openConnection(): Effect.Effect<Stream.Stream<SignalNotification, ChannelError>, ChannelError> {
    const self = this;
    return Effect.gen(function* () {
      const scope = yield* Scope.make();
      const connection = yield* self.transport.open.pipe(
        Scope.extend(scope),
        Effect.tapError(() => Scope.close(scope, Exit.void)),
      );
      self.connection = connection;
      return connection.notifications.pipe(
        Stream.ensuring(
          Effect.suspend(() => {
            if (self.connection === connection) self.connection = undefined;
            return Scope.close(scope, Exit.void);
          }),
        ),
      );
    });
  }

  // ── Inbound ─────────────────────────────────────────────────────────────

  private handle(notification: SignalNotification): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      const event: SignalEvent = parseSignalNotification(
        notification,
        { account: Redacted.value(self.account), ...(self.accountUuid ? { accountUuid: self.accountUuid } : {}) },
        (ts) => self.sentTimestamps.has(ts),
      );
      if (event.kind === "receipt") {
        for (const ts of event.messageTimestamps) {
          yield* Queue.offer(self.receiptQueue, {
            messageId: String(ts),
            adapterId: self.id,
            platform: self.platform,
            status: event.status,
            at: event.at,
          });
        }
        return;
      }
      if (event.kind !== "message" || !self.firstSeen(event.id)) return;

      const fetched = event.isEcho ? { attachments: [], unavailable: 0 } : yield* self.fetchAttachments(event);
      const envelope: InboundEnvelope = {
        id: event.id,
        conversation: { channelId: event.channelId, isGroup: event.isGroup },
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
        ...(fetched.unavailable > 0 ? { metadata: { attachmentsUnavailable: fetched.unavailable } } : {}),
      };
      yield* Queue.offer(self.inboundQueue, envelope);
    });
  }

  /** Download attachment bytes. A failed or oversized download is counted, never silently dropped. */
  private fetchAttachments(
    event: Extract<SignalEvent, { kind: "message" }>,
  ): Effect.Effect<{ attachments: Attachment[]; unavailable: number }> {
    const self = this;
    return Effect.gen(function* () {
      const attachments: Attachment[] = [];
      let unavailable = 0;
      // Policy before bytes: an unknown sender must not make us fetch anything.
      if (event.attachments.length > 0 && self.senderGate) {
        const allowed = yield* self.senderGate({ platform: self.platform, userId: event.userId });
        if (!allowed) return { attachments, unavailable: event.attachments.length };
      }
      for (const ref of event.attachments) {
        const bytes = yield* self.downloadAttachment(ref, event);
        if (bytes) attachments.push({ type: "binary", filename: ref.filename, contentType: ref.contentType, data: bytes });
        else unavailable++;
      }
      return { attachments, unavailable };
    });
  }

  private downloadAttachment(
    ref: SignalAttachmentRef,
    event: Extract<SignalEvent, { kind: "message" }>,
  ): Effect.Effect<Uint8Array | undefined> {
    const connection = this.connection;
    if (!connection || (ref.size !== undefined && ref.size > this.maxInboundAttachmentBytes)) {
      return Effect.succeed(undefined);
    }
    const params = { id: ref.id, ...(event.isGroup ? { groupId: event.channelId } : { recipient: event.userId }) };
    return connection.request("getAttachment", params).pipe(
      Effect.map((result) => {
        const data = typeof result === "object" && result !== null ? (result as { data?: unknown }).data : undefined;
        return typeof data === "string" ? new Uint8Array(Buffer.from(data, "base64")) : undefined;
      }),
      Effect.catchAll(() => Effect.succeed(undefined)),
    );
  }

  // ── Outbound ────────────────────────────────────────────────────────────

  private sendRaw(message: OutboundMessage): Effect.Effect<DeliveryReceipt, ChannelError> {
    const self = this;
    return Effect.gen(function* () {
      const connection = self.connection;
      if (!connection) {
        return yield* Effect.fail(channelError(self.id, "network", { message: `channel ${self.id}: signal-cli not connected` }));
      }
      const params = yield* self.sendParams(message);
      const result = yield* connection.request("send", params).pipe(Effect.mapError((e) => mapSignalFailure(self.id, e)));
      const failed = failureFromSendResult(self.id, result);
      if (failed) return yield* Effect.fail(failed);
      const timestamp =
        typeof result === "object" && result !== null ? (result as { timestamp?: unknown }).timestamp : undefined;
      if (typeof timestamp !== "number") {
        return yield* Effect.fail(channelError(self.id, "unknown", { message: `channel ${self.id}: send response had no timestamp` }));
      }
      self.rememberSent(String(timestamp));
      const now = yield* Clock.currentTimeMillis;
      self.lastSentAt = Math.max(self.lastSentAt, now);
      return {
        messageId: String(timestamp),
        adapterId: self.id,
        platform: self.platform,
        status: "sent",
        sentAt: self.lastSentAt,
      } satisfies DeliveryReceipt;
    });
  }

  private sendParams(message: OutboundMessage): Effect.Effect<Record<string, unknown>, ChannelError> {
    const self = this;
    return Effect.gen(function* () {
      const attachments: string[] = [];
      for (const a of message.attachments ?? []) {
        if (a.type === "url") {
          return yield* Effect.fail(
            channelError(self.id, "unsupported", { message: `channel ${self.id}: url attachments are not supported; send bytes` }),
          );
        }
        attachments.push(`data:${a.contentType};filename=${a.filename};base64,${Buffer.from(a.data).toString("base64")}`);
      }
      const reply = message.replyTo !== undefined ? parseReplyRef(message.replyTo) : undefined;
      if (message.replyTo !== undefined && !reply) {
        return yield* Effect.fail(
          channelError(self.id, "unsupported", { message: `channel ${self.id}: replyTo must be "<author>:<timestamp>"` }),
        );
      }
      const channelId = message.conversation.channelId;
      return {
        ...(isDirectAddress(channelId) ? { recipient: [channelId] } : { groupId: channelId }),
        message: message.text,
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(reply ? { quoteTimestamp: reply.timestamp, quoteAuthor: reply.author } : {}),
      };
    });
  }

  private rememberSent(timestamp: string): void {
    this.sentTimestamps.add(timestamp);
    if (this.sentTimestamps.size > SENT_MEMORY) {
      const oldest = this.sentTimestamps.values().next().value;
      if (oldest !== undefined) this.sentTimestamps.delete(oldest);
    }
  }
}
