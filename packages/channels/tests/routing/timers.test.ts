import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { AgentEvent } from "@reactive-agents/core";
import { makeMemoryLeases } from "../../src/routing/lease.js";
import { createChannelRouter, type ChannelRouterOptions } from "../../src/routing/router.js";
import { makeSqliteRouterStore } from "../../src/routing/sqlite-store.js";
import {
  FollowUpTimers,
  makeFollowUpTool,
  makeMemoryTimers,
  parseFollowUpDelay,
  type FollowUpPort,
  type FollowUpRequest,
  type TimerBinding,
} from "../../src/routing/timers.js";
import type { AgentResolver, RouteSpecInput } from "../../src/routing/types.js";
import { env, makeScriptedAdapter, waitFor } from "./scripted.js";

const dirs: string[] = [];
const dbPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "router-timers-"));
  dirs.push(dir);
  return join(dir, "timers.db");
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const binding: TimerBinding = {
  adapterId: "chan",
  platform: "scripted",
  channelId: "chat-1",
  isGroup: false,
  routeId: "r1",
  senderId: "alice",
};

const run = <A, E>(e: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(e);

describe("follow-up timers: bounds", () => {
  test("parseFollowUpDelay reads durations and refuses anything else", () => {
    expect(parseFollowUpDelay("90s")).toBe(90_000);
    expect(parseFollowUpDelay("15m")).toBe(900_000);
    expect(parseFollowUpDelay("2 h")).toBe(7_200_000);
    expect(parseFollowUpDelay("1d")).toBe(86_400_000);
    expect(parseFollowUpDelay("soon")).toBeUndefined();
    expect(parseFollowUpDelay("-5m")).toBeUndefined();
  });

  test("schedule enforces exactly-one-of, horizon, minimum delay, note length and the pending cap", async () => {
    const port = new FollowUpTimers(makeMemoryTimers(), { maxPending: 2, maxHorizonMs: 3_600_000 }).bind(binding);
    const reason = async (request: FollowUpRequest): Promise<string> => (await run(Effect.flip(port.schedule(request)))).reason;
    expect(await reason({ note: "x" })).toBe("invalid");
    expect(await reason({ in: "10m", at: "2030-01-01T00:00:00Z", note: "x" })).toBe("invalid");
    expect(await reason({ in: "10m", note: "  " })).toBe("invalid");
    expect(await reason({ in: "1s", note: "x" })).toBe("in_past");
    expect(await reason({ in: "2h", note: "x" })).toBe("too_far");
    const a = await run(port.schedule({ in: "10m", note: "first" }));
    await run(port.schedule({ in: "20m", note: "second" }));
    expect(await reason({ in: "30m", note: "third" })).toBe("too_many");
    expect((await run(port.pending())).map((t) => t.note)).toEqual(["first", "second"]);
    // Cancel frees a slot; a cancelled timer is gone from the list.
    expect(await run(port.cancel(a.id))).toBe(true);
    expect(await run(port.cancel(a.id))).toBe(false);
    await run(port.schedule({ in: "30m", note: "third" }));
  });

  test("a conversation cannot see or cancel another conversation's timers", async () => {
    const timers = new FollowUpTimers(makeMemoryTimers());
    const mine = timers.bind(binding);
    const theirs = timers.bind({ ...binding, channelId: "chat-2" });
    const t = await run(mine.schedule({ in: "10m", note: "mine" }));
    expect(await run(theirs.pending())).toEqual([]);
    expect(await run(theirs.cancel(t.id))).toBe(false);
    expect((await run(mine.pending())).length).toBe(1);
  });

  test("the follow-up tool sets, lists and cancels, and reports an error as a result instead of failing", async () => {
    const port = new FollowUpTimers(makeMemoryTimers()).bind(binding);
    const tool = makeFollowUpTool(port);
    expect(tool.name).toBe("follow-up");
    const set = await run(tool.execute({ in: "10m", note: "check the build" }));
    expect(set).toMatchObject({ ok: true, action: "scheduled", timer: { note: "check the build" } });
    const list = await run(tool.execute({}));
    expect(list).toMatchObject({ ok: true, action: "list", timers: [{ note: "check the build" }] });
    const bad = await run(tool.execute({ in: "never", note: "x" }));
    expect(bad).toMatchObject({ ok: false, reason: "invalid" });
    const id = set.ok && set.action === "scheduled" ? set.timer.id : "";
    expect(await run(tool.execute({ cancel: id }))).toEqual({ ok: true, action: "cancelled", id, found: true });
  });
});

const route: RouteSpecInput = {
  id: "r1",
  match: { channelId: "chan", when: { _tag: "Keyword", patterns: ["deploy"] } },
  target: { agentId: "agent" },
  owners: ["scripted:alice"],
};

/** A resolver that records each turn's text and lets the first turn schedule a follow-up. */
const scheduling = (turns: string[], ports: Array<FollowUpPort | undefined>, onFirst?: (p: FollowUpPort) => Effect.Effect<unknown, unknown>): AgentResolver => ({
  open: (req) =>
    Effect.sync(() => {
      ports.push(req.followUp);
      return {
        send: (turn) =>
          Effect.gen(function* () {
            turns.push(turn.text);
            if (turns.length === 1 && req.followUp && onFirst) yield* Effect.ignore(onFirst(req.followUp));
            return { text: `re:${turn.text}` };
          }),
        close: Effect.void,
      };
    }),
});

const inMs = (ms: number): string => new Date(Date.now() + ms).toISOString();

const runRouter = <A>(
  path: string,
  options: Partial<ChannelRouterOptions> & { readonly events?: AgentEvent[] },
  chan: ReturnType<typeof makeScriptedAdapter>,
  body: (status: () => Promise<{ timers?: Record<string, number> }>) => Promise<A>,
): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const store = yield* makeSqliteRouterStore({ path });
        const router = yield* createChannelRouter({
          channels: [chan],
          routes: [route],
          agents: options.agents ?? scheduling([], []),
          leases: makeMemoryLeases(),
          store,
          ...options,
          ...(options.events ? { eventBus: { publish: (e: AgentEvent) => Effect.sync(() => void options.events?.push(e)) } } : {}),
        });
        return yield* Effect.promise(() => body(() => Effect.runPromise(router.status)));
      }),
    ),
  );

const FAST = { pollMs: 20, minDelayMs: 0 } as const;

describe("follow-up timers through the router", () => {
  test("a due timer wakes the conversation as a normal turn, even though its text does not match the route's keyword", async () => {
    const turns: string[] = [];
    const events: AgentEvent[] = [];
    const chan = makeScriptedAdapter({ id: "chan" });
    await runRouter(
      ":memory:",
      { followUp: FAST, events, agents: scheduling(turns, [], (p) => p.schedule({ at: inMs(150), note: "check the build" })) },
      chan,
      async (status) => {
        chan.push(env({ id: "m1", text: "deploy the thing" }));
        await waitFor(() => turns.length === 2);
        expect(turns[1]).toBe("Follow-up you scheduled: check the build");
        await waitFor(() => chan.sends.length === 2);
        expect(chan.sends[1]?.text).toBe("re:Follow-up you scheduled: check the build");
        await waitFor(() => events.some((e) => e._tag === "Custom" && e.type === "ChannelFollowUpFired"));
        expect(events.some((e) => e._tag === "Custom" && e.type === "ChannelFollowUpScheduled")).toBe(true);
        await waitFor(() => events.filter((e) => e._tag === "ChannelTurnCompleted").length === 2);
        // Marked fired once handled, so the poller does not wake it again.
        await new Promise<void>((r) => setTimeout(r, 100));
        expect(turns.length).toBe(2);
        expect((await status()).timers).toEqual({ pending: 0, fired: 1, cancelled: 0 });
      },
    );
  });

  test("a cancelled timer never fires", async () => {
    const turns: string[] = [];
    const chan = makeScriptedAdapter({ id: "chan" });
    await runRouter(
      ":memory:",
      {
        followUp: FAST,
        agents: scheduling(turns, [], (p) =>
          Effect.flatMap(p.schedule({ at: inMs(120), note: "nope" }), (t) => p.cancel(t.id)),
        ),
      },
      chan,
      async (status) => {
        chan.push(env({ id: "m1", text: "deploy" }));
        await waitFor(() => chan.sends.length === 1);
        await new Promise<void>((r) => setTimeout(r, 250));
        expect(turns).toEqual(["deploy"]);
        expect((await status()).timers?.["cancelled"]).toBe(1);
      },
    );
  });

  test("a timer survives a restart and fires late when it came due while the process was down", async () => {
    const path = dbPath();
    const first = makeScriptedAdapter({ id: "chan" });
    const t1: string[] = [];
    await runRouter(
      path,
      { followUp: { pollMs: 5_000, minDelayMs: 0 }, agents: scheduling(t1, [], (p) => p.schedule({ at: inMs(150), note: "after downtime" })) },
      first,
      async () => {
        first.push(env({ id: "m1", text: "deploy" }));
        await waitFor(() => first.sends.length === 1);
      },
    );
    await new Promise<void>((r) => setTimeout(r, 200));

    const second = makeScriptedAdapter({ id: "chan" });
    const t2: string[] = [];
    await runRouter(path, { followUp: FAST, agents: scheduling(t2, []) }, second, async (status) => {
      await waitFor(() => t2.length === 1);
      expect(t2[0]).toBe("Follow-up you scheduled: after downtime");
      await waitFor(() => second.sends.length === 1);
      await new Promise<void>((r) => setTimeout(r, 100));
      expect(t2.length).toBe(1);
      expect((await status()).timers).toMatchObject({ pending: 0, fired: 1 });
    });
  });

  test("sessions get a follow-up port only when the router runs with followUp", async () => {
    const ports: Array<FollowUpPort | undefined> = [];
    const off = makeScriptedAdapter({ id: "chan" });
    await runRouter(":memory:", { agents: scheduling([], ports) }, off, async () => {
      off.push(env({ id: "m1", text: "deploy" }));
      await waitFor(() => off.sends.length === 1);
    });
    expect(ports).toEqual([undefined]);
    const on = makeScriptedAdapter({ id: "chan" });
    await runRouter(":memory:", { followUp: true, agents: scheduling([], ports) }, on, async (status) => {
      on.push(env({ id: "m2", text: "deploy" }));
      await waitFor(() => on.sends.length === 1);
      expect((await status()).timers).toEqual({ pending: 0, fired: 0, cancelled: 0 });
    });
    expect(ports[1]).toBeDefined();
  });

  test("a platform message cannot claim a route through a timer-shaped id when timers are off", async () => {
    const turns: string[] = [];
    const chan = makeScriptedAdapter({ id: "chan" });
    await runRouter(":memory:", { agents: scheduling(turns, []) }, chan, async () => {
      // No keyword: the route does not match, and `timer-x` must not change that.
      chan.push({ ...env({ id: "timer-x", text: "hello" }), metadata: { timer: { routeId: "r1" } } });
      await new Promise<void>((r) => setTimeout(r, 80));
      expect(turns).toEqual([]);
    });
  });
});
