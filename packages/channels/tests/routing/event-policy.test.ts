import { describe, expect, test } from "bun:test";
import { Deferred, Effect } from "effect";
import type { AgentEvent } from "@reactive-agents/core";
import { makeMemoryLeases } from "../../src/routing/lease.js";
import { createChannelRouter } from "../../src/routing/router.js";
import type { AgentResolver, RouteSpecInput, RoutedTurn } from "../../src/routing/types.js";
import { validateRoutes } from "../../src/routing/validate.js";
import { env, makeScriptedAdapter, waitFor } from "./scripted.js";

const route = (over: Partial<RouteSpecInput> = {}): RouteSpecInput => ({
  id: "r1",
  match: { channelId: "chan" },
  target: { agentId: "agent" },
  allow: ["scripted:bob"],
  owners: ["scripted:alice"],
  ...over,
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Ctx {
  readonly chan: ReturnType<typeof makeScriptedAdapter>;
  readonly events: AgentEvent[];
  readonly turns: RoutedTurn[];
}

const run = <A>(
  over: Partial<RouteSpecInput>,
  resolver: (ctx: Ctx) => AgentResolver,
  body: (ctx: Ctx) => Promise<A>,
): Promise<A> => {
  const chan = makeScriptedAdapter({ id: "chan" });
  const events: AgentEvent[] = [];
  const turns: RoutedTurn[] = [];
  const ctx: Ctx = { chan, events, turns };
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* createChannelRouter({
          channels: [chan],
          routes: [route(over)],
          agents: resolver(ctx),
          leases: makeMemoryLeases(),
          eventBus: { publish: (e) => Effect.sync(() => void events.push(e)) },
        });
        return yield* Effect.promise(() => body(ctx));
      }),
    ),
  );
};

/** Answers at once, echoing the turn text. */
const quick = (ctx: Ctx): AgentResolver => ({
  open: () =>
    Effect.succeed({
      send: (turn: RoutedTurn) => Effect.sync(() => (ctx.turns.push(turn), { text: `re:${turn.text}` })),
      close: Effect.void,
    }),
});

describe("defaults", () => {
  test("no batchWindowMs and midRun queue: every envelope is its own turn, in order", async () => {
    await run({}, quick, async ({ chan, turns }) => {
      chan.push(env({ id: "a", text: "a" }));
      chan.push(env({ id: "b", text: "b" }));
      await waitFor(() => chan.sends.length === 2);
      expect(turns.map((t) => t.text).sort()).toEqual(["a", "b"]);
    });
  });
});

describe("batchWindowMs", () => {
  test("joins one sender's burst into one turn: order kept, every source id recorded, one reply", async () => {
    await run({ batchWindowMs: 80 }, quick, async ({ chan, events, turns }) => {
      chan.push(env({ id: "a", text: "first" }));
      chan.push(env({ id: "b", text: "second" }));
      chan.push(env({ id: "c", text: "third" }));
      await waitFor(() => chan.sends.length === 1);
      await sleep(40);
      expect(turns).toHaveLength(1);
      expect(turns[0]?.text).toBe("first\nsecond\nthird");
      expect(turns[0]?.message.metadata["batch"]).toEqual({ sourceIds: ["a", "b", "c"], size: 3 });
      expect(chan.sends).toHaveLength(1);
      const batched = events.find((e) => e._tag === "ChannelInboxBatched");
      expect(batched).toEqual({
        _tag: "ChannelInboxBatched",
        routeId: "r1",
        size: 3,
        sourceIds: ["a", "b", "c"],
      });
    });
  });

  test("does not join different senders, and a message after the window starts a new turn", async () => {
    await run({ batchWindowMs: 60 }, quick, async ({ chan, turns }) => {
      chan.push(env({ id: "a", userId: "alice", text: "from alice" }));
      chan.push(env({ id: "b", userId: "bob", text: "from bob" }));
      await waitFor(() => chan.sends.length === 2);
      chan.push(env({ id: "c", userId: "alice", text: "later" }));
      await waitFor(() => chan.sends.length === 3);
      expect(turns.map((t) => t.text).sort()).toEqual(["from alice", "from bob", "later"]);
    });
  });
});

/** A resolver whose turn waits for `release`, and drains folded text first when `drain` is set. */
const gated = (ctx: Ctx, gate: Deferred.Deferred<void>, opts: { drain: boolean }): AgentResolver => ({
  open: () =>
    Effect.succeed({
      send: (turn: RoutedTurn) =>
        Effect.gen(function* () {
          ctx.turns.push(turn);
          if (ctx.turns.length === 1) yield* Deferred.await(gate);
          const folded = opts.drain ? (turn.takeFolded?.() ?? []) : [];
          return { text: [turn.text, ...folded].join("|") };
        }),
      close: Effect.void,
    }),
});

describe("midRun fold", () => {
  test("a message sent while the turn runs is drained at the safe boundary into the same turn", async () => {
    const gate = Effect.runSync(Deferred.make<void>());
    await run({ midRun: "fold" }, (ctx) => gated(ctx, gate, { drain: true }), async ({ chan, turns, events }) => {
      chan.push(env({ id: "a", text: "start" }));
      await waitFor(() => turns.length === 1);
      expect(turns[0]?.takeFolded).toBeDefined();
      chan.push(env({ id: "b", text: "also this" }));
      await waitFor(() => events.some((e) => e._tag === "ChannelInboxFolded"));
      Effect.runSync(Deferred.succeed(gate, undefined));
      await waitFor(() => chan.sends.length === 1);
      await sleep(40);
      expect(chan.sends[0]?.text).toBe("start|also this");
      expect(turns).toHaveLength(1);
    });
  });

  test("a folded message nobody drained runs as one follow-up turn", async () => {
    const gate = Effect.runSync(Deferred.make<void>());
    await run({ midRun: "fold" }, (ctx) => gated(ctx, gate, { drain: false }), async ({ chan, turns }) => {
      chan.push(env({ id: "a", text: "start" }));
      await waitFor(() => turns.length === 1);
      chan.push(env({ id: "b", text: "x" }));
      chan.push(env({ id: "c", text: "y" }));
      await sleep(40);
      Effect.runSync(Deferred.succeed(gate, undefined));
      await waitFor(() => chan.sends.length === 2);
      expect(turns.map((t) => t.text)).toEqual(["start", "x\ny"]);
    });
  });
});

describe("midRun interrupt", () => {
  test("a newer message cancels the running turn with a typed cancellation and restarts from the combined input", async () => {
    let interrupted = 0;
    const resolver = (ctx: Ctx): AgentResolver => ({
      open: () =>
        Effect.succeed({
          send: (turn: RoutedTurn) =>
            ctx.turns.push(turn) === 1
              ? Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(() => void (interrupted += 1))))
              : Effect.succeed({ text: `re:${turn.text}` }),
          close: Effect.void,
        }),
    });
    await run({ midRun: "interrupt" }, resolver, async ({ chan, turns, events }) => {
      chan.push(env({ id: "a", text: "book a table" }));
      await waitFor(() => turns.length === 1);
      chan.push(env({ id: "b", text: "for four" }));
      await waitFor(() => chan.sends.length === 1);
      expect(interrupted).toBe(1);
      expect(turns).toHaveLength(2);
      expect(turns[1]?.text).toBe("book a table\nfor four");
      expect(turns[1]?.message.metadata["batch"]).toEqual({ sourceIds: ["a", "b"], size: 2 });
      // One reply, and no failure notice for the cancelled attempt.
      expect(chan.sends.map((s) => s.text)).toEqual(["re:book a table\nfor four"]);
      expect(
        events.some((e) => e._tag === "ChannelTurnCompleted" && !e.ok && e.reason === "turn_interrupted"),
      ).toBe(true);
      expect(events.some((e) => e._tag === "ChannelInboxInterrupted")).toBe(true);
    });
  });
});

describe("validation", () => {
  const platformOf = (): string | undefined => "scripted";
  const check = (over: Partial<RouteSpecInput>, platform: () => string | undefined = platformOf) =>
    Effect.runPromise(Effect.either(validateRoutes([route(over)], platform)));

  test("accepts the new fields and leaves them absent by default", async () => {
    const ok = await check({ batchWindowMs: 1500, midRun: "fold" });
    expect(ok._tag).toBe("Right");
    const plain = await Effect.runPromise(validateRoutes([route()], platformOf));
    expect(plain[0]?.batchWindowMs).toBeUndefined();
    expect(plain[0]?.midRun).toBeUndefined();
  });

  test("rejects a bad window and an unknown midRun", async () => {
    for (const bad of [-1, 1.5, 30_001, Number.NaN]) {
      expect((await check({ batchWindowMs: bad }))._tag).toBe("Left");
    }
    expect((await check({ midRun: "burst" as never }))._tag).toBe("Left");
  });

  test("webhook routes reject both", async () => {
    const webhook = (): string | undefined => "webhook";
    expect((await check({ allow: [], owners: [], batchWindowMs: 100 }, webhook))._tag).toBe("Left");
    expect((await check({ allow: [], owners: [], midRun: "interrupt" }, webhook))._tag).toBe("Left");
    expect((await check({ allow: [], owners: [], midRun: "queue" }, webhook))._tag).toBe("Right");
  });
});
