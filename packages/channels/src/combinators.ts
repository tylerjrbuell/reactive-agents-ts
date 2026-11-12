import { Clock, Duration, Effect, Ref, Schedule, Stream, SubscriptionRef } from "effect";
import type { ConnectionState } from "./adapter.js";
import { channelError, type ChannelError } from "./errors.js";

/**
 * Shared adapter building blocks, so Signal, Telegram, Discord, Slack and email adapters do not
 * each re-invent reconnect, outbound rate limiting, idempotency and connection state.
 */

// ── Connection state ──────────────────────────────────────────────────────

/** Observable connection state: `state` for subscribers, `current` for snapshots. */
export interface ConnectionStateRef {
  readonly state: Stream.Stream<ConnectionState>;
  readonly current: Effect.Effect<ConnectionState>;
  readonly set: (next: ConnectionState) => Effect.Effect<void>;
}

/** Create a {@link ConnectionStateRef}, `disconnected` until the adapter says otherwise. */
export const makeConnectionState = (
  initial: ConnectionState = { status: "disconnected" },
): Effect.Effect<ConnectionStateRef> =>
  Effect.map(SubscriptionRef.make<ConnectionState>(initial), (ref) => ({
    state: ref.changes,
    current: SubscriptionRef.get(ref),
    set: (next: ConnectionState) => SubscriptionRef.set(ref, next),
  }));

// ── Reconnect ─────────────────────────────────────────────────────────────

/** Exponential backoff from 500 ms, capped at 30 s, forever. */
export const defaultReconnectSchedule = Schedule.exponential("500 millis").pipe(
  Schedule.union(Schedule.spaced("30 seconds")),
);

/**
 * Turn "open a connection, stream from it" into a stream that survives drops.
 *
 * When the inner stream fails with a retryable {@link ChannelError}, or ends (a graceful end of a
 * long-lived platform stream is a drop), the state becomes `reconnecting` and `open` runs again
 * after the backoff. A non-retryable error (`auth`, `forbidden`, ...) ends the stream and sets
 * `failed`: retrying a bad credential only hammers the platform.
 *
 * `open` must resume from the adapter's cursor (last acknowledged update id) so a reconnect neither
 * loses nor repeats messages.
 */
export const withReconnect = <A>(
  adapterId: string,
  open: Effect.Effect<Stream.Stream<A, ChannelError>, ChannelError>,
  conn: Pick<ConnectionStateRef, "set">,
  schedule: Schedule.Schedule<unknown, unknown> = defaultReconnectSchedule,
): Stream.Stream<A, ChannelError> => {
  const attempt: Stream.Stream<A, ChannelError> = Stream.unwrap(
    Effect.tap(open, () => conn.set({ status: "connected" })),
  ).pipe(
    Stream.concat(
      Stream.failSync(() => channelError(adapterId, "network", { message: `channel ${adapterId}: stream ended` })),
    ),
    Stream.tapError((error) =>
      conn.set(error.retryable ? { status: "reconnecting", error } : { status: "failed", error }),
    ),
  );
  return Stream.retry(
    attempt,
    schedule.pipe(Schedule.whileInput((error: ChannelError) => error.retryable)),
  );
};

// ── Outbound rate limit ───────────────────────────────────────────────────

/**
 * A limiter allowing at most `max` guarded operations per sliding `window`. Excess operations wait
 * (they are delayed, never dropped). Uses `Clock`, so tests drive it with `TestClock`.
 */
export const makeOutboundRateLimiter = (
  max: number,
  window: Duration.DurationInput,
): Effect.Effect<<A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>> =>
  Effect.gen(function* () {
    const windowMs = Duration.toMillis(window);
    const gate = yield* Effect.makeSemaphore(1);
    const stamps = yield* Ref.make<readonly number[]>([]);
    const acquire = gate.withPermits(1)(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const live = (yield* Ref.get(stamps)).filter((t) => now - t < windowMs);
        if (live.length >= max) {
          const oldest = live[live.length - max] ?? live[0] ?? now;
          yield* Effect.sleep(Math.max(0, oldest + windowMs - now));
        }
        const at = yield* Clock.currentTimeMillis;
        yield* Ref.set(stamps, [...live.filter((t) => at - t < windowMs), at]);
      }),
    );
    return <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.zipRight(acquire, effect);
  });

// ── Idempotency ───────────────────────────────────────────────────────────

/**
 * Bounded "have I seen this platform message id" set (oldest ids evicted first).
 * Returns true the first time a key is offered, false on every repeat.
 */
export const makeInboundDedupe = (capacity = 1024): ((key: string) => boolean) => {
  const seen = new Set<string>();
  return (key) => {
    if (seen.has(key)) return false;
    seen.add(key);
    if (seen.size > capacity) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
    return true;
  };
};
