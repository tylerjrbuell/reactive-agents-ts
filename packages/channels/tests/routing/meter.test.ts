import { describe, expect, test } from "bun:test";
import { Duration, Effect, Schema, TestClock, TestContext } from "effect";
import type { AgentEvent } from "@reactive-agents/core";
import { makeRouteMeter } from "../../src/routing/meter.js";
import { makeMemoryLeases } from "../../src/routing/lease.js";
import { createChannelRouter, type ChannelRouter } from "../../src/routing/router.js";
import { RouteSpec, type AgentResolver, type RouteSpecInput } from "../../src/routing/types.js";
import { env, makeScriptedAdapter } from "./scripted.js";

/** Decode through the schema so defaults apply. */
const spec = (over: Partial<RouteSpecInput> = {}): RouteSpec =>
  Schema.decodeUnknownSync(RouteSpec)({ id: "r1", match: { channelId: "chan" }, target: { agentId: "a" }, ...over });

const run = <A>(eff: Effect.Effect<A>) => Effect.runPromise(eff.pipe(Effect.provide(TestContext.TestContext)));

describe("RouteMeter", () => {
  test("refuses when settled spend plus the reservation would exceed the day cap", async () => {
    const meter = makeRouteMeter({ reserveUsd: 0.5 });
    const route = spec({ maxCostPerDayUsd: 1 });
    await run(
      Effect.gen(function* () {
        const a = yield* meter.reserve(route);
        expect(a.ok).toBe(true);
        if (a.ok) yield* meter.settle(a.id, 0.6);
        const b = yield* meter.reserve(route); // 0.6 + 0.5 > 1
        expect(b).toEqual({ ok: false, reason: "cost" });
      }),
    );
  });

  test("outstanding reservations count against the cap, and release frees them", async () => {
    const meter = makeRouteMeter({ reserveUsd: 0.4 });
    const route = spec({ maxCostPerDayUsd: 1 });
    await run(
      Effect.gen(function* () {
        const a = yield* meter.reserve(route);
        const b = yield* meter.reserve(route);
        const c = yield* meter.reserve(route); // 0.4 * 3 > 1
        expect(c.ok).toBe(false);
        if (a.ok) yield* meter.release(a.id);
        yield* meter.release(999); // unknown id: no-op
        expect((yield* meter.reserve(route)).ok).toBe(true);
        expect(b.ok).toBe(true);
      }),
    );
  });

  test("settle replaces the reservation with the actual cost and is idempotent", async () => {
    const meter = makeRouteMeter({ reserveUsd: 1 });
    const route = spec({ maxCostPerDayUsd: 10 });
    await run(
      Effect.gen(function* () {
        const a = yield* meter.reserve(route);
        if (!a.ok) throw new Error("expected reservation");
        expect((yield* meter.snapshot("r1")).reservedUsd).toBe(1);
        yield* meter.settle(a.id, 0.25);
        yield* meter.settle(a.id, 0.25);
        const snap = yield* meter.snapshot("r1");
        expect(snap).toEqual({ messages: 1, spentUsd: 0.25, reservedUsd: 0 });
      }),
    );
  });

  test("spend and messages age out of the 24h window (TestClock)", async () => {
    const meter = makeRouteMeter({ reserveUsd: 0, maxMessagesPerDay: 2 });
    const route = spec({ maxCostPerDayUsd: 1 });
    await run(
      Effect.gen(function* () {
        const a = yield* meter.reserve(route);
        if (a.ok) yield* meter.settle(a.id, 1);
        expect(yield* meter.reserve(route)).toEqual({ ok: false, reason: "cost" });
        const other = spec({ id: "r2" });
        expect((yield* meter.reserve(other)).ok).toBe(true);
        expect((yield* meter.reserve(other)).ok).toBe(true);
        expect(yield* meter.reserve(other)).toEqual({ ok: false, reason: "messages" });
        yield* TestClock.adjust(Duration.hours(24));
        expect((yield* meter.reserve(route)).ok).toBe(true);
        expect((yield* meter.reserve(other)).ok).toBe(true);
      }),
    );
  });

  test("counters are per route", async () => {
    const meter = makeRouteMeter({ reserveUsd: 0.6 });
    await run(
      Effect.gen(function* () {
        expect((yield* meter.reserve(spec({ id: "a", maxCostPerDayUsd: 1 }))).ok).toBe(true);
        expect((yield* meter.reserve(spec({ id: "b", maxCostPerDayUsd: 1 }))).ok).toBe(true);
        expect((yield* meter.reserve(spec({ id: "a", maxCostPerDayUsd: 1 }))).ok).toBe(false);
      }),
    );
  });
});

describe("router + RouteMeter", () => {
  const costly = (costUsd: number) => {
    const opens: string[] = [];
    const resolver: AgentResolver = {
      open: (req) =>
        Effect.sync(() => {
          opens.push(req.routeId);
          return { send: () => Effect.succeed({ text: "ok", costUsd }), close: Effect.void };
        }),
    };
    return { resolver, opens };
  };
  const baseRoute: RouteSpecInput = {
    id: "r1",
    match: { channelId: "chan" },
    target: { agentId: "a" },
    allow: ["scripted:alice"],
    maxCostPerDayUsd: 1,
    maxTurnsPerSenderPerHour: 100,
  };
  const start = <A>(
    opts: { resolver: AgentResolver; meter?: ReturnType<typeof makeRouteMeter>; events?: AgentEvent[] },
    body: (router: ChannelRouter) => Effect.Effect<A>,
  ) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.flatMap(
          createChannelRouter({
            channels: [makeScriptedAdapter({ id: "chan" })],
            routes: [baseRoute],
            agents: opts.resolver,
            leases: makeMemoryLeases(),
            ...(opts.meter ? { meter: opts.meter } : {}),
            ...(opts.events ? { eventBus: { publish: (e: AgentEvent) => Effect.sync(() => void opts.events?.push(e)) } } : {}),
          }),
          body,
        ),
      ),
    );

  test("a turn over the cap is refused with ChannelTurnDropped{budget} and the resolver is not called", async () => {
    const agents = costly(0.9);
    const events: AgentEvent[] = [];
    await start({ resolver: agents.resolver, meter: makeRouteMeter(), events }, (router) =>
      Effect.gen(function* () {
        const first = yield* router.simulate(env({ id: "m-1" }), "chan");
        expect(first._tag).toBe("Answered");
        const second = yield* router.simulate(env({ id: "m-2" }), "chan"); // 0.9 spent, cap 1 -> still room
        expect(second._tag).toBe("Answered");
        const third = yield* router.simulate(env({ id: "m-3" }), "chan"); // 1.8 spent
        expect(third).toEqual({ _tag: "Dropped", reason: "budget", routeId: "r1" });
        expect(agents.opens.length).toBe(1); // session reused; the refused turn never reached the resolver
        const status = yield* router.status;
        expect(status.dropped.budget).toBe(1);
      }),
    );
    expect(events.some((e) => e._tag === "ChannelTurnDropped" && e.reason === "budget" && e.routeId === "r1")).toBe(true);
  });

  test("without a meter the same traffic is never budget-refused", async () => {
    const agents = costly(0.9);
    await start({ resolver: agents.resolver }, (router) =>
      Effect.gen(function* () {
        for (const id of ["m-1", "m-2", "m-3"]) {
          expect((yield* router.simulate(env({ id }), "chan"))._tag).toBe("Answered");
        }
      }),
    );
  });

  test("a failed turn releases its reservation instead of spending it", async () => {
    const failing: AgentResolver = {
      open: () => Effect.succeed({ send: () => Effect.die("boom"), close: Effect.void }),
    };
    const meter = makeRouteMeter({ reserveUsd: 0.6 });
    await start({ resolver: failing, meter }, (router) =>
      Effect.gen(function* () {
        yield* Effect.exit(router.simulate(env({ id: "f-1" }), "chan"));
        yield* Effect.exit(router.simulate(env({ id: "f-2" }), "chan"));
        const snap = yield* meter.snapshot("r1");
        expect(snap.reservedUsd).toBe(0);
        expect(snap.spentUsd).toBe(0);
      }),
    );
  });
});
