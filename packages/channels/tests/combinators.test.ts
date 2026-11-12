import { describe, expect, test } from "bun:test";
import { Chunk, Effect, Fiber, Option, Ref, Stream, TestClock, TestContext } from "effect";
import {
  makeConnectionState,
  makeInboundDedupe,
  makeOutboundRateLimiter,
  withReconnect,
} from "../src/combinators.js";
import { channelError, classifyChannelFailure, ChannelError, type ChannelErrorKind } from "../src/errors.js";
import type { ConnectionState } from "../src/adapter.js";

const run = <A, E>(eff: Effect.Effect<A, E, import("effect").TestClock.TestClock>) =>
  Effect.runPromise(eff.pipe(Effect.provide(TestContext.TestContext)));

describe("withReconnect", () => {
  test("a retryable drop reconnects after backoff and the stream continues", async () => {
    const result = await run(
      Effect.gen(function* () {
        const conn = yield* makeConnectionState();
        const opens = yield* Ref.make(0);
        const seen: ConnectionState["status"][] = [];
        const open = Effect.gen(function* () {
          const n = yield* Ref.updateAndGet(opens, (x) => x + 1);
          // First connection yields 1 then drops; second yields 2 and 3 then stays open.
          return n === 1
            ? Stream.make(1).pipe(Stream.concat(Stream.fail(channelError("t", "network"))))
            : Stream.make(2, 3).pipe(Stream.concat(Stream.never));
        });
        const watcher = yield* Effect.fork(Stream.runForEach(conn.state, (s) => Effect.sync(() => void seen.push(s.status))));
        const fiber = yield* Effect.fork(
          withReconnect("t", open, conn).pipe(Stream.take(3), Stream.runCollect, Effect.map(Chunk.toReadonlyArray)),
        );
        yield* Effect.repeatN(Effect.yieldNow(), 20);
        yield* TestClock.adjust("1 second");
        const items = yield* Fiber.join(fiber);
        yield* Effect.repeatN(Effect.yieldNow(), 20);
        yield* Fiber.interrupt(watcher);
        return { items, seen, opens: yield* Ref.get(opens) };
      }),
    );
    expect(result.items).toEqual([1, 2, 3]);
    expect(result.opens).toBe(2);
    expect(result.seen).toContain("reconnecting");
    expect(result.seen[result.seen.length - 1]).toBe("connected");
  });

  test("a non-retryable error ends the stream, sets failed, and is not retried", async () => {
    const result = await run(
      Effect.gen(function* () {
        const conn = yield* makeConnectionState();
        const opens = yield* Ref.make(0);
        const open = Ref.update(opens, (x) => x + 1).pipe(Effect.zipRight(Effect.fail(channelError("t", "auth"))));
        const error = yield* Effect.flip(Stream.runCollect(withReconnect("t", open, conn)));
        yield* TestClock.adjust("5 minutes");
        return { error, state: yield* conn.current, opens: yield* Ref.get(opens) };
      }),
    );
    expect(result.error.kind).toBe("auth");
    expect(result.opens).toBe(1);
    expect(result.state.status).toBe("failed");
  });
});

describe("makeOutboundRateLimiter", () => {
  test("delays excess operations until the window slides, never drops", async () => {
    const done = await run(
      Effect.gen(function* () {
        const limit = yield* makeOutboundRateLimiter(1, "1 second");
        const log: number[] = [];
        const fibers = yield* Effect.forEach([1, 2, 3], (n) => Effect.fork(limit(Effect.sync(() => void log.push(n)))));
        yield* Effect.repeatN(Effect.yieldNow(), 20);
        const first = [...log];
        yield* TestClock.adjust("1 second");
        yield* Effect.repeatN(Effect.yieldNow(), 20);
        const second = [...log];
        yield* TestClock.adjust("1 second");
        yield* Effect.forEach(fibers, Fiber.join);
        return { first, second, all: [...log] };
      }),
    );
    expect(done.first).toEqual([1]);
    expect(done.second).toEqual([1, 2]);
    expect(done.all).toEqual([1, 2, 3]);
  });
});

describe("makeInboundDedupe", () => {
  test("first sight true, repeats false, oldest evicted past capacity", () => {
    const first = makeInboundDedupe(2);
    expect(first("a")).toBe(true);
    expect(first("a")).toBe(false);
    expect(first("b")).toBe(true);
    expect(first("c")).toBe(true); // evicts "a"
    expect(first("a")).toBe(true);
  });
});

describe("classifyChannelFailure", () => {
  const kindOf = (cause: unknown): ChannelErrorKind => classifyChannelFailure("t", cause).kind;
  test("maps HTTP status, Node codes and passthrough", () => {
    expect(kindOf({ status: 401 })).toBe("auth");
    expect(kindOf({ status: 403 })).toBe("forbidden");
    expect(kindOf({ status: 404 })).toBe("not_found");
    expect(kindOf({ status: 413 })).toBe("too_large");
    expect(kindOf({ status: 503 })).toBe("network");
    expect(kindOf({ code: "ETIMEDOUT" })).toBe("network");
    expect(kindOf(new Error("?"))).toBe("unknown");
    const e = channelError("t", "rate_limited", { retryAfterMs: 5 });
    expect(classifyChannelFailure("other", e)).toBe(e);
    expect(classifyChannelFailure("t", { status: 429, retryAfterMs: 7 }).retryAfterMs).toBe(7);
    expect(e instanceof ChannelError && e.retryable).toBe(true);
    expect(Option.isNone(Option.fromNullable(classifyChannelFailure("t", {}).retryAfterMs))).toBe(true);
  });
});
