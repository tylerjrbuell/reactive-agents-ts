import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { AgentEvent } from "@reactive-agents/core";
import type { DeliveryReceipt, OutboundMessage } from "../../src/adapter.js";
import { channelError, type ChannelError } from "../../src/errors.js";
import { makeMemoryLeases } from "../../src/routing/lease.js";
import { makeMemoryOutbox, OutboxDispatcher } from "../../src/routing/outbox.js";
import { createChannelRouter, type ChannelRouterOptions } from "../../src/routing/router.js";
import { makeSqliteRouterStore, openSqliteRouterStore } from "../../src/routing/sqlite-store.js";
import { RoutingError, type AgentResolver, type RouteSpecInput } from "../../src/routing/types.js";
import { env, makeScriptedAdapter, waitFor, type ScriptedAdapter } from "./scripted.js";

const dirs: string[] = [];
const dbPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "router-outbox-"));
  dirs.push(dir);
  return join(dir, "outbox.db");
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const route: RouteSpecInput = { id: "r1", match: { channelId: "chan" }, target: { agentId: "agent" }, owners: ["scripted:alice"] };
const answering: AgentResolver = {
  open: () => Effect.succeed({ send: (turn) => Effect.succeed({ text: `re:${turn.text}` }), close: Effect.void }),
};
const failing: AgentResolver = {
  open: () =>
    Effect.succeed({
      send: () => Effect.fail(new RoutingError({ reason: "turn_failed", message: "boom" })),
      close: Effect.void,
    }),
};

/** An adapter whose next sends fail with the planned errors, then succeed. `tries` counts every attempt. */
const flaky = (chan: ScriptedAdapter, plan: ChannelError[]): ScriptedAdapter & { readonly tries: () => number } => {
  let tries = 0;
  return {
    ...chan,
    tries: () => tries,
    send: (m) => {
      tries += 1;
      const next = plan.shift();
      return next ? Effect.fail(next) : chan.send(m);
    },
  };
};

const network = (): ChannelError => channelError("chan", "network");

const runRouter = <A>(
  chan: ScriptedAdapter,
  options: Partial<ChannelRouterOptions> & { readonly events?: AgentEvent[]; readonly path?: string },
  body: (status: () => Promise<{ outbox?: Record<string, number> }>) => Promise<A>,
): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const store = yield* makeSqliteRouterStore({ path: options.path ?? ":memory:" });
        const router = yield* createChannelRouter({
          channels: [chan],
          routes: [route],
          agents: answering,
          leases: makeMemoryLeases(),
          store,
          ...options,
          ...(options.events ? { eventBus: { publish: (e: AgentEvent) => Effect.sync(() => void options.events?.push(e)) } } : {}),
        });
        return yield* Effect.promise(() => body(() => Effect.runPromise(router.status)));
      }),
    ),
  );

describe("outbox through the router", () => {
  test("a transient failure is retried and the reply still arrives once", async () => {
    const chan = flaky(makeScriptedAdapter({ id: "chan" }), [network(), network()]);
    await runRouter(chan, { outbox: { maxAttempts: 3, baseBackoffMs: 1 } }, async (status) => {
      chan.push(env({ id: "m1", text: "hi" }));
      await waitFor(() => chan.sends.length === 1);
      expect(chan.sends[0]?.text).toBe("re:hi");
      expect(chan.tries()).toBe(3);
      await waitFor(() => chan.tries() === 3);
      expect((await status()).outbox).toEqual({ pending: 0, sent: 1, failed: 0 });
    });
  });

  test("a permanent failure is typed: one attempt, a ChannelSendFailed event, a failed row, the outcome still Answered with deliveryError", async () => {
    const events: AgentEvent[] = [];
    const chan = flaky(makeScriptedAdapter({ id: "chan" }), [channelError("chan", "auth")]);
    await runRouter(chan, { outbox: { maxAttempts: 3, baseBackoffMs: 1 }, events }, async (status) => {
      chan.push(env({ id: "m1", text: "hi" }));
      await waitFor(() => events.some((e) => e._tag === "ChannelSendFailed"));
      expect(chan.tries()).toBe(1);
      expect(chan.sends.length).toBe(0);
      expect(events.find((e) => e._tag === "ChannelSendFailed")).toEqual({
        _tag: "ChannelSendFailed",
        adapterId: "chan",
        conversationId: "chat-1",
        attempts: 1,
        kind: "auth",
        retryable: false,
        exhausted: false,
      });
      expect((await status()).outbox).toEqual({ pending: 0, sent: 0, failed: 1 });
    });
  });

  test("retries run out: failed after maxAttempts, event says exhausted", async () => {
    const events: AgentEvent[] = [];
    const chan = flaky(makeScriptedAdapter({ id: "chan" }), [network(), network(), network(), network()]);
    await runRouter(chan, { outbox: { maxAttempts: 2, baseBackoffMs: 1 }, events }, async () => {
      chan.push(env({ id: "m1", text: "hi" }));
      await waitFor(() => events.some((e) => e._tag === "ChannelSendFailed"));
      expect(chan.tries()).toBe(2);
      expect(events.find((e) => e._tag === "ChannelSendFailed")).toMatchObject({ attempts: 2, exhausted: true });
    });
  });

  test("defaults keep today's behavior: a retryable failure is one attempt, no retry", async () => {
    const chan = flaky(makeScriptedAdapter({ id: "chan" }), [network()]);
    await runRouter(chan, {}, async () => {
      chan.push(env({ id: "m1", text: "hi" }));
      await waitFor(() => chan.tries() === 1);
      await new Promise<void>((r) => setTimeout(r, 60));
      expect(chan.tries()).toBe(1);
      expect(chan.sends.length).toBe(0);
    });
  });

  test("a failed failure-notice send is recorded, not swallowed silently", async () => {
    const events: AgentEvent[] = [];
    const chan = flaky(makeScriptedAdapter({ id: "chan" }), [channelError("chan", "forbidden")]);
    await runRouter(chan, { agents: failing, events }, async (status) => {
      chan.push(env({ id: "m1", text: "hi" }));
      await waitFor(() => events.some((e) => e._tag === "ChannelSendFailed"));
      expect((await status()).outbox?.["failed"]).toBe(1);
    });
  });

  test("route minGapMs spaces two replies in one conversation", async () => {
    const chan = makeScriptedAdapter({ id: "chan" });
    const stamps: number[] = [];
    const timed: ScriptedAdapter = { ...chan, send: (m) => (stamps.push(Date.now()), chan.send(m)) };
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* createChannelRouter({
            channels: [timed],
            routes: [{ ...route, minGapMs: 80 }],
            agents: answering,
            leases: makeMemoryLeases(),
          });
          chan.push(env({ id: "m1", text: "a" }));
          chan.push(env({ id: "m2", text: "b" }));
          yield* Effect.promise(() => waitFor(() => stamps.length === 2));
          expect((stamps[1] ?? 0) - (stamps[0] ?? 0)).toBeGreaterThanOrEqual(70);
        }),
      ),
    );
  });
});

describe("outbox dispatcher", () => {
  const receipt = (n: number): DeliveryReceipt => ({ messageId: `m${n}`, adapterId: "a", platform: "p", status: "sent", sentAt: n });
  const msg = (text: string, channelId = "c"): OutboundMessage => ({ conversation: { channelId }, text });

  test("order holds per conversation even when an earlier message is retrying; other conversations are not blocked", async () => {
    const order: string[] = [];
    let firstFailures = 1;
    const dispatcher = new OutboxDispatcher(
      {
        store: makeMemoryOutbox(),
        emit: () => Effect.void,
        deliver: (_a, m) => {
          if (m.text === "one" && firstFailures-- > 0) return Effect.fail(network());
          order.push(m.text);
          return Effect.succeed(receipt(order.length));
        },
      },
      { maxAttempts: 3, baseBackoffMs: 40 },
    );
    const opts = { taskId: "t" };
    await Effect.runPromise(
      Effect.all(
        [
          dispatcher.send("a", msg("one"), opts),
          dispatcher.send("a", msg("two"), opts),
          dispatcher.send("a", msg("other", "c2"), opts),
        ],
        { concurrency: "unbounded" },
      ),
    );
    expect(order.indexOf("one")).toBeLessThan(order.indexOf("two"));
    // The other conversation went out while "one" waited out its backoff.
    expect(order.indexOf("other")).toBeLessThan(order.indexOf("one"));
  });

  test("a platform retryAfterMs is honored but capped by maxBackoffMs", async () => {
    let calls = 0;
    const dispatcher = new OutboxDispatcher(
      {
        store: makeMemoryOutbox(),
        emit: () => Effect.void,
        deliver: () => (++calls === 1 ? Effect.fail(channelError("a", "rate_limited", { retryAfterMs: 60_000 })) : Effect.succeed(receipt(1))),
      },
      { maxAttempts: 2, maxBackoffMs: 20 },
    );
    const start = Date.now();
    await Effect.runPromise(dispatcher.send("a", msg("x"), { taskId: "t" }));
    expect(Date.now() - start).toBeLessThan(2000);
    expect(calls).toBe(2);
  });
});

describe("durable outbox", () => {
  test("a reply a crash left pending is sent on restart; stale acks and superseded replies are failed, not sent", async () => {
    const path = dbPath();
    // Run 1 (the "crash"): rows enqueued, nothing sent.
    const store = await Effect.runPromise(openSqliteRouterStore({ path }));
    const base = { adapterId: "chan", conversationKey: "chan:chat-1" } as const;
    const m = (text: string): OutboundMessage => ({ conversation: { channelId: "chat-1" }, text });
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* store.outbox.enqueue({ ...base, message: m("the answer"), resume: true, sourceKey: "chan:gone" });
        yield* store.outbox.enqueue({ ...base, message: m("On it..."), resume: false });
        yield* store.outbox.enqueue({ ...base, message: m("rerun me"), resume: true, sourceKey: "chan:rerun" });
        yield* store.inbox.accept("chan:rerun", "chan", {
          id: "rerun",
          platform: "scripted",
          channelId: "chat-1",
          senderId: "alice",
          content: "again",
          metadata: {},
          timestamp: new Date(1_700_000_000_000),
        });
        yield* store.inbox.start(["chan:rerun"]);
      }),
    );
    await Effect.runPromise(store.close);

    // Run 2: the answer is sent; the ack is abandoned; the turn that will run again produces its own reply.
    const chan = makeScriptedAdapter({ id: "chan" });
    await runRouter(chan, { path }, async (status) => {
      await waitFor(() => chan.sends.some((s) => s.text === "the answer"));
      await waitFor(() => chan.sends.some((s) => s.text === "re:again"));
      expect(chan.sends.map((s) => s.text).sort()).toEqual(["re:again", "the answer"]);
      expect((await status()).outbox).toMatchObject({ pending: 0, failed: 2 });
    });
  });
});
