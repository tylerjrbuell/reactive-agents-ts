import { Clock, Data, Effect } from "effect";
import type { AgentEvent } from "@reactive-agents/core";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { DeliveryReceipt, OutboundMessage } from "../adapter.js";
import type { ChannelError } from "../errors.js";

/**
 * The outbox: every message the router sends passes through it. A row records the send (`pending`,
 * then `sent` or `failed`), a dispatcher retries transient failures with capped backoff and keeps
 * order per conversation, and a permanent failure is a typed event, never silence. Spec:
 * `wiki/Architecture/Design-Specs/2026-11-16-always-on-gateway-primitives.md` (G4).
 *
 * Delivery is at-least-once: a crash after the platform accepted a message but before the row was
 * marked `sent` can send it again on restart.
 */
export type OutboxStatus = "pending" | "sent" | "failed";

/** Row count per status. */
export type OutboxCounts = Readonly<Record<OutboxStatus, number>>;

/** A stored operation failed. The message names the operation, never message text. */
export class OutboxError extends Data.TaggedError("OutboxError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** What the dispatcher records for one outgoing message. */
export interface OutboxRowInput {
  readonly adapterId: string;
  readonly conversationKey: string;
  readonly message: OutboundMessage;
  /**
   * True for a message worth sending after a restart (an agent reply). False for acks and notices,
   * which are stale by then: recovery fails them as `abandoned`.
   */
  readonly resume: boolean;
  /** Inbox key of the envelope this reply answers; recovery skips a reply whose turn will run again. */
  readonly sourceKey?: string;
}

/** A `pending` row handed back by {@link RouterOutbox.recover}. */
export interface OutboxEntry {
  readonly id: number;
  readonly adapterId: string;
  readonly message: OutboundMessage;
  readonly attempts: number;
  readonly resume: boolean;
  readonly sourceKey?: string;
}

/** The outbox port. Store failures are typed; the dispatcher reports them and keeps sending. */
export interface RouterOutbox {
  /** Record a new `pending` message; returns its row id. */
  readonly enqueue: (input: OutboxRowInput) => Effect.Effect<number, OutboxError>;
  /** One failed attempt (counts it, keeps the row `pending`). */
  readonly attempted: (id: number, reason: string) => Effect.Effect<void, OutboxError>;
  /** Terminal: the platform accepted it. The stored text is cleared. */
  readonly sent: (id: number) => Effect.Effect<void, OutboxError>;
  /** Terminal: gave up. The stored text is cleared; `reason` is a classification. */
  readonly failed: (id: number, reason: string) => Effect.Effect<void, OutboxError>;
  /** Startup: every `pending` row, oldest first. A restart means none of them is in flight. */
  readonly recover: () => Effect.Effect<ReadonlyArray<OutboxEntry>, OutboxError>;
  readonly counts: () => Effect.Effect<OutboxCounts, OutboxError>;
  /** Drop old terminal rows (age + count). Returns rows removed. */
  readonly prune: () => Effect.Effect<number, OutboxError>;
}

/** Terminal rows the in-memory outbox keeps. */
const MEMORY_TERMINAL_CAP = 1000;

/** In-memory {@link RouterOutbox}: bookkeeping and counts for one process; nothing survives a restart. */
export const makeMemoryOutbox = (): RouterOutbox => {
  const rows = new Map<number, OutboxStatus>();
  let next = 0;
  const settle = (id: number, status: OutboxStatus): Effect.Effect<void> =>
    Effect.sync(() => {
      if (rows.get(id) !== "pending") return;
      rows.set(id, status);
      let terminal = 0;
      for (const s of rows.values()) if (s !== "pending") terminal += 1;
      for (const [rid, s] of rows) {
        if (terminal <= MEMORY_TERMINAL_CAP) break;
        if (s !== "pending") {
          rows.delete(rid);
          terminal -= 1;
        }
      }
    });
  return {
    enqueue: () =>
      Effect.sync(() => {
        next += 1;
        rows.set(next, "pending");
        return next;
      }),
    attempted: () => Effect.void,
    sent: (id) => settle(id, "sent"),
    failed: (id) => settle(id, "failed"),
    recover: () => Effect.succeed([]),
    counts: () =>
      Effect.sync(() => {
        const c: Record<OutboxStatus, number> = { pending: 0, sent: 0, failed: 0 };
        for (const s of rows.values()) c[s] += 1;
        return c;
      }),
    prune: () => Effect.succeed(0),
  };
};

/** Dispatcher tuning. Defaults keep today's behavior: one attempt, no pacing. */
export interface OutboxOptions {
  /** Attempts per message before it is `failed` (retryable errors only). Default 1 (no retry). */
  readonly maxAttempts?: number;
  /** First retry delay; doubles each attempt. Default 500. */
  readonly baseBackoffMs?: number;
  /** Cap on any retry delay, including a platform `retryAfterMs`. Default 30 000. */
  readonly maxBackoffMs?: number;
  /** Minimum gap between sends in one conversation. Default 0 (off). A route's `minGapMs` overrides it. */
  readonly minGapMs?: number;
}

/** Per-send options. */
export interface SendOptions {
  readonly taskId: string;
  readonly resume?: boolean;
  readonly sourceKey?: string;
  /** Route pacing; overrides {@link OutboxOptions.minGapMs}. */
  readonly minGapMs?: number;
  /** Recovery: send this existing row instead of enqueuing a new one. */
  readonly existing?: { readonly id: number; readonly attempts: number };
}

/** The key one conversation is ordered under. */
export const outboundConversationKey = (adapterId: string, message: OutboundMessage): string =>
  `${adapterId}:${message.conversation.channelId}${message.conversation.threadId !== undefined ? `:${message.conversation.threadId}` : ""}`;

interface Gate {
  readonly sem: Effect.Semaphore;
  refs: number;
}

/**
 * Sends through the hub with retry, order and pacing. One message at a time per conversation, in
 * call order; a retrying message holds its conversation, bounded by `maxAttempts * maxBackoffMs`.
 */
export class OutboxDispatcher {
  private readonly gates = new Map<string, Gate>();
  private readonly lastSentAt = new Map<string, number>();
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly minGapMs: number;

  constructor(
    private readonly deps: {
      readonly store: RouterOutbox;
      readonly deliver: (adapterId: string, message: OutboundMessage, taskId: string) => Effect.Effect<DeliveryReceipt, ChannelError>;
      readonly emit: (event: AgentEvent) => Effect.Effect<void>;
    },
    options: OutboxOptions = {},
  ) {
    this.maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 1));
    this.baseBackoffMs = Math.max(0, options.baseBackoffMs ?? 500);
    this.maxBackoffMs = Math.max(this.baseBackoffMs, options.maxBackoffMs ?? 30_000);
    this.minGapMs = Math.max(0, options.minGapMs ?? 0);
  }

  private guard<A>(site: string, fallback: A, run: (store: RouterOutbox) => Effect.Effect<A, unknown>): Effect.Effect<A> {
    return run(this.deps.store).pipe(
      Effect.catchAll((error) =>
        Effect.as(emitErrorSwallowed({ site: `channels/src/routing/outbox.ts:${site}`, tag: errorTag(error) }), fallback),
      ),
    );
  }

  /** Row counts per status. */
  counts(): Effect.Effect<OutboxCounts | undefined> {
    return this.guard<OutboxCounts | undefined>("counts", undefined, (s) => s.counts());
  }

  /**
   * Startup: send the `pending` rows a dead process left, oldest first. A row is failed instead when
   * it is not worth resuming (ack or notice), its adapter is not registered, or the inbox turn it
   * answers (`skip` holds the inbox keys that will run again) is about to produce a fresh reply.
   */
  recover(
    skip: ReadonlySet<string>,
    canSend: (adapterId: string) => boolean,
    taskId: () => string,
  ): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      const rows = yield* self.guard<ReadonlyArray<OutboxEntry>>("recover", [], (s) => s.recover());
      for (const row of rows) {
        const superseded = row.sourceKey?.split("\n").some((k) => skip.has(k)) ?? false;
        const reason = !row.resume ? "abandoned" : superseded ? "superseded" : !canSend(row.adapterId) ? "adapter-missing" : undefined;
        if (reason !== undefined) {
          yield* self.guard("recover-fail", undefined, (s) => s.failed(row.id, reason));
          continue;
        }
        yield* Effect.ignore(
          self.send(row.adapterId, row.message, {
            taskId: taskId(),
            resume: true,
            existing: { id: row.id, attempts: row.attempts },
          }),
        );
      }
    });
  }

  /**
   * Send one message and return the real receipt, or fail with the typed error of the last attempt.
   * Same contract as the hub's `deliver`, plus the row, the retries and the failure event.
   */
  send(adapterId: string, message: OutboundMessage, opts: SendOptions): Effect.Effect<DeliveryReceipt, ChannelError> {
    const self = this;
    const key = outboundConversationKey(adapterId, message);
    return Effect.suspend(() => {
      const gate = self.gates.get(key) ?? { sem: Effect.unsafeMakeSemaphore(1), refs: 0 };
      gate.refs += 1;
      self.gates.set(key, gate);
      return gate.sem.withPermits(1)(self.run(adapterId, message, opts, key)).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            gate.refs -= 1;
            if (gate.refs <= 0 && self.gates.get(key) === gate) self.gates.delete(key);
          }),
        ),
      );
    });
  }

  private run(adapterId: string, message: OutboundMessage, opts: SendOptions, key: string): Effect.Effect<DeliveryReceipt, ChannelError> {
    const self = this;
    const gap = opts.minGapMs ?? this.minGapMs;
    let rowId: number | undefined = opts.existing?.id;
    return Effect.gen(function* () {
      const id =
        rowId ??
        (yield* self.guard<number | undefined>("enqueue", undefined, (s) =>
          s.enqueue({
            adapterId,
            conversationKey: key,
            message,
            resume: (opts.resume ?? false) && (message.attachments?.length ?? 0) === 0,
            ...(opts.sourceKey !== undefined ? { sourceKey: opts.sourceKey } : {}),
          }),
        ));
      rowId = id;
      const mark = (f: (s: RouterOutbox, rowId: number) => Effect.Effect<void, unknown>, site: string): Effect.Effect<void> =>
        id === undefined ? Effect.void : self.guard(site, undefined, (s) => f(s, id));
      let attempt = opts.existing?.attempts ?? 0;
      for (;;) {
        if (gap > 0) {
          const last = self.lastSentAt.get(key);
          const now = yield* Clock.currentTimeMillis;
          if (last !== undefined && now - last < gap) yield* Effect.sleep(`${last + gap - now} millis`);
        }
        attempt += 1;
        const result = yield* Effect.either(self.deps.deliver(adapterId, message, opts.taskId));
        if (gap > 0) self.lastSentAt.set(key, yield* Clock.currentTimeMillis);
        if (result._tag === "Right") {
          yield* mark((s, rowId) => s.sent(rowId), "sent");
          return result.right;
        }
        const error = result.left;
        if (error.retryable && attempt < self.maxAttempts) {
          yield* mark((s, rowId) => s.attempted(rowId, error.kind), "attempted");
          const backoff = Math.min(self.maxBackoffMs, error.retryAfterMs ?? self.baseBackoffMs * 2 ** (attempt - 1));
          yield* Effect.sleep(`${backoff} millis`);
          continue;
        }
        yield* mark((s, rowId) => s.failed(rowId, error.kind), "failed");
        yield* self.deps.emit({
          _tag: "Custom",
          // Becomes a core `ChannelSendFailed` member (same name) once core adds it. No message text.
          type: "ChannelSendFailed",
          payload: {
            adapterId,
            conversationId: message.conversation.channelId,
            attempts: attempt,
            kind: error.kind,
            retryable: error.retryable,
            exhausted: error.retryable,
          },
        });
        return yield* Effect.fail(error);
      }
    }).pipe(
      // An interrupted send (turn ended, shutdown) must not stay `pending`: recovery would replay a stale message.
      Effect.onInterrupt(() =>
        Effect.suspend(() => {
          const rid = rowId;
          return rid === undefined ? Effect.void : self.guard("interrupted", undefined, (s) => s.failed(rid, "interrupted"));
        }),
      ),
    );
  }
}
