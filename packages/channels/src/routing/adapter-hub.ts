import { Cause, Effect, Exit, Scope, Stream } from "effect";
import { emitErrorSwallowed, errorTag, type AgentEvent } from "@reactive-agents/core";
import {
  isChannelAdapter,
  type ChannelAdapter,
  type ConnectionState,
  type DeliveryReceipt,
  type InboundEnvelope,
  type OutboundMessage,
  type SenderGate,
} from "../adapter.js";
import {
  channelError,
  classifyChannelFailure,
  type ChannelConnectionError,
  type ChannelError,
} from "../errors.js";
import type { AdapterInfo, InboundMessage, MessageChannel } from "../types.js";

/** How the hub talks to one registered adapter, canonical or legacy. */
interface RegisteredAdapter {
  readonly id: string;
  readonly platform: string;
  readonly send: (m: OutboundMessage) => Effect.Effect<DeliveryReceipt, ChannelError>;
  readonly state: ConnectionState;
  /** Re-read state from the adapter (canonical adapters only). */
  readonly readState?: Effect.Effect<ConnectionState>;
  /** The platform reported another consumer owns the account; the channel was stopped. */
  readonly conflict: boolean;
  readonly deliveryFailures: number;
  readonly lastError?: ChannelError;
  readonly messagesReceived: number;
  readonly messagesSent: number;
  readonly lastInboundAt?: number;
  readonly lastSentAt?: number;
}

export interface AdapterHubDeps {
  readonly taskId: () => string;
  readonly eventBus?: { publish: (e: AgentEvent) => Effect.Effect<void, never> };
  /** Inbound envelopes processed in parallel per adapter. Default 4. */
  readonly inboundConcurrency?: number;
  /** Process one canonical inbound envelope. */
  readonly onEnvelope: (adapterId: string, env: InboundEnvelope) => Effect.Effect<void, never>;
  /** Process one legacy inbound message. */
  readonly onMessage: (adapterId: string, msg: InboundMessage) => Effect.Effect<void, never>;
  /** Sender check consulted by adapters before downloading a stranger's attachments. */
  readonly senderGate: (
    adapterId: string,
    sender: { readonly platform: string; readonly userId: string },
  ) => Effect.Effect<boolean>;
  /** Called when a channel's inbound stream failed for good (it is not retried). */
  readonly onChannelFailed?: (adapterId: string, error: ChannelError) => Effect.Effect<void>;
}

/**
 * Owns the registered adapters: start/stop, the inbound consume loop, `deliver` with typed
 * receipts, and per-adapter status counters. Shared by the {@link import("./router.js").createChannelRouter}
 * engine and by `ChannelService`, so there is one implementation of each.
 */
export class AdapterHub {
  private readonly adapters = new Map<string, RegisteredAdapter>();
  private scope?: Scope.CloseableScope;
  /** Guards lazy creation of {@link scope} so concurrent registrations share one. */
  private readonly scopeLock = Effect.unsafeMakeSemaphore(1);

  constructor(private readonly deps: AdapterHubDeps) {}

  has(adapterId: string): boolean {
    return this.adapters.has(adapterId);
  }

  platformOf(adapterId: string): string | undefined {
    return this.adapters.get(adapterId)?.platform;
  }

  private ensureScope(): Effect.Effect<Scope.CloseableScope> {
    const self = this;
    return self.scopeLock.withPermits(1)(
      Effect.suspend(() => {
        const existing = self.scope;
        if (existing) return Effect.succeed(existing);
        return Effect.map(Scope.make(), (made) => (self.scope = made));
      }),
    );
  }

  private update(id: string, patch: Partial<RegisteredAdapter>): void {
    const cur = this.adapters.get(id);
    if (cur) this.adapters.set(id, { ...cur, ...patch });
  }

  /** Count one inbound message for the adapter's status. */
  noteReceived(adapterId: string): void {
    const reg = this.adapters.get(adapterId);
    if (reg) this.update(adapterId, { messagesReceived: reg.messagesReceived + 1, lastInboundAt: Date.now() });
  }

  /** Register and start an adapter. */
  register(adapter: MessageChannel | ChannelAdapter): Effect.Effect<void, ChannelConnectionError | ChannelError> {
    return isChannelAdapter(adapter) ? this.registerCanonical(adapter) : this.registerLegacy(adapter);
  }

  private registerLegacy(adapter: MessageChannel): Effect.Effect<void, ChannelConnectionError> {
    const self = this;
    return Effect.gen(function* () {
      yield* adapter.connect();
      yield* adapter.onMessage((msg) => self.deps.onMessage(adapter.id, msg));
      self.adapters.set(adapter.id, {
        id: adapter.id,
        platform: adapter.id,
        state: { status: "connected" },
        conflict: false,
        deliveryFailures: 0,
        messagesReceived: 0,
        messagesSent: 0,
        send: (m) =>
          adapter
            .sendMessage(
              {
                channelId: m.conversation.channelId,
                ...(m.conversation.threadId !== undefined ? { threadId: m.conversation.threadId } : {}),
                ...(m.replyTo !== undefined ? { replyToMessageId: m.replyTo } : {}),
              },
              { text: m.text, ...(m.format !== undefined ? { format: m.format } : {}) },
            )
            .pipe(
              Effect.map((r): DeliveryReceipt => ({
                messageId: r.messageId,
                adapterId: adapter.id,
                platform: adapter.id,
                status: "sent",
                sentAt: r.timestamp.getTime(),
              })),
              Effect.mapError((e) => classifyChannelFailure(adapter.id, e)),
            ),
      });
    });
  }

  private registerCanonical(adapter: ChannelAdapter): Effect.Effect<void, ChannelError> {
    const self = this;
    return Effect.gen(function* () {
      const scope = yield* self.ensureScope();
      const gate: SenderGate = (sender) => self.deps.senderGate(adapter.id, sender);
      adapter.setSenderGate?.(gate);
      self.adapters.set(adapter.id, {
        id: adapter.id,
        platform: adapter.platform,
        send: adapter.send.bind(adapter),
        state: yield* adapter.currentState,
        readState: adapter.currentState,
        conflict: false,
        deliveryFailures: 0,
        messagesReceived: 0,
        messagesSent: 0,
      });
      // A failed start must not leave a registration that `has()` reports and `deliver` would use.
      yield* Scope.extend(adapter.start(), scope).pipe(
        Effect.onError(() => Effect.sync(() => void self.adapters.delete(adapter.id))),
      );
      self.update(adapter.id, { state: yield* adapter.currentState });
      yield* Effect.forkIn(
        Stream.runForEach(adapter.state, (s) => Effect.sync(() => self.update(adapter.id, { state: s }))),
        scope,
      );
      const concurrency = self.deps.inboundConcurrency ?? 4;
      yield* Effect.forkIn(
        adapter.inbound.pipe(
          Stream.mapEffect((env) => self.deps.onEnvelope(adapter.id, env), { concurrency }),
          Stream.runDrain,
          // catchAllCause: a handler defect must end as a failed channel, not a silent dead fiber.
          Effect.catchAllCause((cause) => {
            if (Cause.isInterruptedOnly(cause)) return Effect.void;
            const failure = Cause.failureOption(cause);
            const error: ChannelError =
              failure._tag === "Some"
                ? failure.value
                : channelError(adapter.id, "unknown", {
                    message: `channel ${adapter.id}: inbound handler defect`,
                    cause: Cause.squash(cause),
                  });
            const report =
              failure._tag === "Some"
                ? Effect.void
                : emitErrorSwallowed({
                    site: "channels/src/routing/adapter-hub.ts:inbound",
                    tag: errorTag(Cause.squash(cause)),
                  });
            return Effect.suspend(() => {
              self.update(adapter.id, {
                state: { status: "failed", error },
                ...(error.kind === "conflict" ? { conflict: true } : {}),
              });
              return Effect.zipRight(report, self.deps.onChannelFailed?.(adapter.id, error) ?? Effect.void);
            });
          }),
        ),
        scope,
      );
    });
  }

  /** Stop consuming inbound and disconnect every canonical adapter. Idempotent. */
  shutdown(): Effect.Effect<void> {
    const scope = this.scope;
    this.scope = undefined;
    if (!scope) return Effect.void;
    const self = this;
    return Effect.gen(function* () {
      yield* Scope.close(scope, Exit.void);
      // The state-tracking fiber is interrupted with the scope; re-read the final states.
      for (const reg of [...self.adapters.values()]) {
        if (reg.readState) self.update(reg.id, { state: yield* reg.readState });
      }
    });
  }

  /**
   * Send through a registered adapter and return its real {@link DeliveryReceipt}. Publishes
   * `ChannelMessageSent` only on success. On failure it records the failure in status, publishes
   * `ChannelDeliveryFailed` (classification only) and fails with the typed {@link ChannelError}.
   */
  deliver(
    adapterId: string,
    message: OutboundMessage,
    taskId: string = this.deps.taskId(),
  ): Effect.Effect<DeliveryReceipt, ChannelError> {
    const self = this;
    return Effect.gen(function* () {
      const reg = self.adapters.get(adapterId);
      if (!reg) {
        return yield* Effect.fail(
          channelError(adapterId, "not_found", { message: `channel ${adapterId}: adapter not registered` }),
        );
      }
      const bus = self.deps.eventBus;
      return yield* reg.send(message).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            const cur = self.adapters.get(adapterId);
            if (cur) self.update(adapterId, { messagesSent: cur.messagesSent + 1, lastSentAt: Date.now() });
          }),
        ),
        Effect.tap((receipt) =>
          bus
            ? bus.publish({
                _tag: "ChannelMessageSent",
                taskId,
                platform: receipt.platform,
                messageId: receipt.messageId,
                channelId: message.conversation.channelId,
                timestamp: Date.now(),
              })
            : Effect.void,
        ),
        Effect.tapError((error) =>
          Effect.suspend(() => {
            const failures = (self.adapters.get(adapterId)?.deliveryFailures ?? 0) + 1;
            self.update(adapterId, { deliveryFailures: failures, lastError: error });
            // Classification and ids only; never the cause, which may carry secrets.
            return bus
              ? bus.publish({
                  _tag: "ChannelDeliveryFailed",
                  taskId,
                  adapterId,
                  kind: error.kind,
                  retryable: error.retryable,
                  ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
                  conversationId: message.conversation.channelId,
                })
              : Effect.void;
          }),
        ),
      );
    });
  }

  /** Per-adapter status rows. */
  info(): AdapterInfo[] {
    return [...this.adapters.values()].map((a) => ({
      id: a.id,
      platform: a.platform,
      connected: a.state.status === "connected",
      sessionsActive: 0,
      state: a.state,
      deliveryFailures: a.deliveryFailures,
      messagesReceived: a.messagesReceived,
      messagesSent: a.messagesSent,
      ...(a.lastInboundAt !== undefined ? { lastInboundAt: a.lastInboundAt } : {}),
      ...(a.lastSentAt !== undefined ? { lastSentAt: a.lastSentAt } : {}),
      ...(a.lastError ? { lastError: a.lastError } : {}),
    }));
  }

  /** True when the adapter was stopped because another consumer owns the account. */
  conflicted(adapterId: string): boolean {
    return this.adapters.get(adapterId)?.conflict === true;
  }
}
