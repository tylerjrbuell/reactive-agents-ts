import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { AgentEvent } from "@reactive-agents/core";
import { makeMemoryLeases } from "../../src/routing/lease.js";
import { createChannelRouter } from "../../src/routing/router.js";
import { makeSqliteRouterStore, type SqliteRouterStoreOptions } from "../../src/routing/sqlite-store.js";
import type { AgentResolver, RouteSpecInput, RoutedTurn } from "../../src/routing/types.js";
import { env, makeScriptedAdapter, waitFor } from "./scripted.js";

const dirs: string[] = [];
const dbPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "router-inbox-"));
  dirs.push(dir);
  return join(dir, "inbox.db");
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const route: RouteSpecInput = {
  id: "r1",
  match: { channelId: "chan" },
  target: { agentId: "agent" },
  owners: ["scripted:alice"],
};

const msg = (id: string, text = "hi") => ({
  id,
  platform: "scripted",
  channelId: "chat-1",
  senderId: "alice",
  content: text,
  metadata: {},
  timestamp: new Date(1_700_000_000_000),
});

describe("sqlite router store", () => {
  test("accept dedupes, counts per status, settle clears the stored message", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* makeSqliteRouterStore({ path: ":memory:" });
          expect(store.durable).toBe(true);
          expect(yield* store.inbox.accept("chan:1", "chan", msg("1"))).toBe(true);
          expect(yield* store.inbox.accept("chan:1", "chan", msg("1"))).toBe(false);
          expect((yield* store.inbox.counts()).received).toBe(1);
          yield* store.inbox.start(["chan:1"]);
          expect((yield* store.inbox.counts()).running).toBe(1);
          yield* store.inbox.settle(["chan:1"], "done");
          expect(yield* store.inbox.counts()).toEqual({ received: 0, running: 0, done: 1, failed: 0, dropped: 0 });
          expect(yield* store.inbox.pending()).toEqual([]);
          // Settled rows keep the dedupe key.
          expect(yield* store.inbox.accept("chan:1", "chan", msg("1"))).toBe(false);
        }),
      ),
    );
  });

  test("retention prunes old terminal rows by count and by age, never live ones", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* makeSqliteRouterStore({ path: ":memory:", retentionMaxRows: 2 });
          for (const n of [1, 2, 3, 4, 5]) yield* store.inbox.accept(`chan:${n}`, "chan", msg(`${n}`));
          yield* store.inbox.settle(["chan:1", "chan:2", "chan:3", "chan:4"], "done");
          const removed = yield* store.inbox.prune();
          expect(removed).toBe(2);
          const counts = yield* store.inbox.counts();
          expect(counts.done).toBe(2);
          expect(counts.received).toBe(1);
          // The oldest key left retention, so it can be accepted again; a retained one cannot.
          expect(yield* store.inbox.accept("chan:1", "chan", msg("1"))).toBe(true);
          expect(yield* store.inbox.accept("chan:4", "chan", msg("4"))).toBe(false);
        }),
      ),
    );
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* makeSqliteRouterStore({ path: ":memory:", retentionMaxAgeMs: -1 });
          yield* store.inbox.accept("chan:1", "chan", msg("1"));
          yield* store.inbox.settle(["chan:1"], "done");
          yield* store.inbox.accept("chan:2", "chan", msg("2"));
          expect(yield* store.inbox.prune()).toBe(1);
          expect((yield* store.inbox.counts()).received).toBe(1);
        }),
      ),
    );
  });

  test("turn counters survive a reopen", async () => {
    const path = dbPath();
    const open = (): Promise<boolean[]> =>
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const store = yield* makeSqliteRouterStore({ path });
            return [yield* store.takeTurn("r:alice", 2, 3_600_000), yield* store.takeTurn("r:alice", 2, 3_600_000)];
          }),
        ),
      );
    expect(await open()).toEqual([true, true]);
    expect(await open()).toEqual([false, false]);
  });
});

/** One run of a router over `path`. `turns` records every turn text the resolver saw. */
const runRouter = <A>(
  path: string,
  options: {
    readonly store?: Partial<SqliteRouterStoreOptions>;
    readonly resolver: (turns: string[]) => AgentResolver;
    readonly events?: AgentEvent[];
  },
  body: (ctx: {
    chan: ReturnType<typeof makeScriptedAdapter>;
    turns: string[];
    status: () => Promise<{ durableStore: boolean; inbox?: Record<string, number> }>;
  }) => Promise<A>,
): Promise<A> => {
  const chan = makeScriptedAdapter({ id: "chan" });
  const turns: string[] = [];
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const store = yield* makeSqliteRouterStore({ path, ...options.store });
        const router = yield* createChannelRouter({
          channels: [chan],
          routes: [route],
          agents: options.resolver(turns),
          store,
          leases: makeMemoryLeases(),
          ...(options.events ? { eventBus: { publish: (e: AgentEvent) => Effect.sync(() => void options.events?.push(e)) } } : {}),
        });
        return yield* Effect.promise(() =>
          body({ chan, turns, status: () => Effect.runPromise(router.status) }),
        );
      }),
    ),
  );
};

const answering = (turns: string[]): AgentResolver => ({
  open: () =>
    Effect.succeed({
      send: (turn: RoutedTurn) => Effect.sync(() => (turns.push(turn.text), { text: `re:${turn.text}` })),
      close: Effect.void,
    }),
});

const hanging = (turns: string[]): AgentResolver => ({
  open: () =>
    Effect.succeed({
      send: (turn: RoutedTurn) => Effect.zipRight(Effect.sync(() => void turns.push(turn.text)), Effect.never),
      close: Effect.void,
    }),
});

describe("durable inbox through the router", () => {
  test("status reports durableStore and per-status counts", async () => {
    await runRouter(":memory:", { resolver: answering }, async ({ chan, status }) => {
      chan.push(env({ id: "m1", text: "one" }));
      await waitFor(() => chan.sends.length === 1);
      await new Promise<void>((r) => setTimeout(r, 40));
      const s = await status();
      expect(s.durableStore).toBe(true);
      expect(s.inbox?.["done"]).toBe(1);
    });
  });

  test("a crash mid-turn retries the message once on restart, and a redelivery does not run twice", async () => {
    const path = dbPath();
    const events: AgentEvent[] = [];
    // Run 1: the turn starts and never finishes; the scope closes (the "kill").
    const first = await runRouter(path, { resolver: hanging }, async ({ chan, turns, status }) => {
      chan.push(env({ id: "m1", text: "do it" }));
      await waitFor(() => turns.length === 1);
      expect((await status()).inbox?.["running"]).toBe(1);
      return turns;
    });
    expect(first).toEqual(["do it"]);

    // Run 2: same file. The orphaned row is retried exactly once, and answered.
    await runRouter(path, { resolver: answering, events }, async ({ chan, turns, status }) => {
      await waitFor(() => chan.sends.length === 1);
      expect(turns).toEqual(["do it"]);
      expect(chan.sends[0]?.text).toBe("re:do it");
      expect((await status()).inbox).toEqual({ received: 0, running: 0, done: 1, failed: 0, dropped: 0 });
      expect(events.some((e) => e._tag === "Custom" && e.type === "channel.inbox.retried")).toBe(true);
      // The platform redelivers the same update after the restart: deduped, no second turn.
      chan.push(env({ id: "m1", text: "do it" }));
      await new Promise<void>((r) => setTimeout(r, 60));
      expect(turns).toEqual(["do it"]);
      expect(chan.sends.length).toBe(1);
    });
  });

  test("a redelivery of an answered message after restart does not run", async () => {
    const path = dbPath();
    await runRouter(path, { resolver: answering }, async ({ chan, turns }) => {
      chan.push(env({ id: "m1", text: "once" }));
      await waitFor(() => turns.length === 1);
      await waitFor(() => chan.sends.length === 1);
    });
    await runRouter(path, { resolver: answering }, async ({ chan, turns, status }) => {
      chan.push(env({ id: "m1", text: "once" }));
      await new Promise<void>((r) => setTimeout(r, 60));
      expect(turns).toEqual([]);
      expect(chan.sends.length).toBe(0);
      expect((await status()).inbox?.["done"]).toBe(1);
    });
  });

  test("a message that keeps crashing runs out of attempts: failed, reported, never silent", async () => {
    const path = dbPath();
    const events: AgentEvent[] = [];
    await runRouter(path, { store: { maxAttempts: 1 }, resolver: hanging }, async ({ chan, turns }) => {
      chan.push(env({ id: "m1", text: "boom" }));
      await waitFor(() => turns.length === 1);
    });
    await runRouter(path, { store: { maxAttempts: 1 }, resolver: answering, events }, async ({ chan, turns, status }) => {
      await waitFor(() => events.some((e) => e._tag === "Custom" && e.type === "channel.inbox.failed"));
      expect(turns).toEqual([]);
      expect(chan.sends.length).toBe(0);
      expect((await status()).inbox?.["failed"]).toBe(1);
    });
  });

  test("a denied sender is recorded dropped, not run", async () => {
    await runRouter(":memory:", { resolver: answering }, async ({ chan, turns, status }) => {
      chan.push(env({ id: "m1", userId: "mallory", text: "let me in" }));
      await new Promise<void>((r) => setTimeout(r, 60));
      expect(turns).toEqual([]);
      expect((await status()).inbox?.["dropped"]).toBe(1);
    });
  });
});
