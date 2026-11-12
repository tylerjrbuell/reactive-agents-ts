// Run: bun run repo test apps/cortex/server/tests/channel-hub-store.test.ts
//
// The durable router ports: dedupe and turn caps survive a new store instance, an invalid route row never
// goes live, the account lease refuses a second owner and takes over a dead one, the meter's spend
// persists, and the activity feed keeps counts without message text.
import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { Effect, Exit, Scope } from "effect";
import { type RouteSpec } from "@reactive-agents/channels";
import { applySchema } from "../db/schema.js";
import { insertChannel, insertRoute } from "../db/channel-hub-queries.js";
import { HubActivityTracker } from "../services/channel-hub-activity.js";
import { makeDbLeases, makeDurableRouteMeter, makeDurableRouterStore } from "../services/channel-hub-store.js";

const db = () => {
  const d = new Database(":memory:");
  applySchema(d);
  return d;
};
const run = <A, E>(e: Effect.Effect<A, E>) => Effect.runPromise(e);

describe("durable store", () => {
  it("a seen message id stays seen for a new store instance", async () => {
    const d = db();
    expect(await run(makeDurableRouterStore(d).markSeen("ch:1"))).toBe(true);
    expect(await run(makeDurableRouterStore(d).markSeen("ch:1"))).toBe(false);
    expect(await run(makeDurableRouterStore(d).markSeen("ch:2"))).toBe(true);
  });

  it("turn caps count across instances", async () => {
    const d = db();
    expect(await run(makeDurableRouterStore(d).takeTurn("r:*", 2, 3_600_000))).toBe(true);
    expect(await run(makeDurableRouterStore(d).takeTurn("r:*", 2, 3_600_000))).toBe(true);
    expect(await run(makeDurableRouterStore(d).takeTurn("r:*", 2, 3_600_000))).toBe(false);
  });

  it("fail-closed load: an open route without caps is rejected, not served", async () => {
    const d = db();
    insertChannel(d, { id: "ch-aaaa1111", platform: "telegram", settings: {} });
    insertRoute(d, { id: "ok", match: { channelId: "ch-aaaa1111" }, target: { agentId: "a" }, owners: ["telegram:1"] });
    insertRoute(d, { id: "bad", match: { channelId: "ch-aaaa1111" }, target: { agentId: "a" }, open: true });
    const store = makeDurableRouterStore(d);
    const routes: ReadonlyArray<RouteSpec> = await run(store.getRoutes);
    expect(routes.map((r) => r.id)).toEqual(["ok"]);
    expect(store.rejected()[0]?.routeId).toBe("bad");
  });

  it("setRoutes never deletes a route the router did not start with", async () => {
    const d = db();
    insertChannel(d, { id: "ch-aaaa1111", platform: "telegram", settings: {} });
    insertRoute(d, { id: "r1", match: { channelId: "ch-aaaa1111" }, target: { agentId: "a" } });
    insertRoute(d, { id: "r2", match: { channelId: "ch-aaaa1111" }, target: { agentId: "b" } });
    const store = makeDurableRouterStore(d);
    const [first] = await run(store.getRoutes);
    await run(store.setRoutes(first ? [first] : []));
    expect((await run(store.getRoutes)).map((r) => r.id).sort()).toEqual(["r1", "r2"]);
  });
});

describe("account lease", () => {
  const hold = async (leases: ReturnType<typeof makeDbLeases>, fp: string) => {
    const scope = await run(Scope.make());
    const exit = await Effect.runPromiseExit(Scope.extend(leases.acquire("ch-1", fp), scope));
    return { exit, release: () => run(Scope.close(scope, Exit.void)) };
  };

  it("refuses a second owner, and frees on release", async () => {
    const d = db();
    const a = await hold(makeDbLeases(d), "telegram:tok");
    expect(Exit.isSuccess(a.exit)).toBe(true);
    const b = await hold(makeDbLeases(d, { pid: process.pid + 1, pidAlive: () => true }), "telegram:tok");
    expect(Exit.isFailure(b.exit) && String(b.exit.cause)).toContain("ChannelAlreadyOwned");
    await a.release();
    const c = await hold(makeDbLeases(d, { pid: process.pid + 1, pidAlive: () => true }), "telegram:tok");
    expect(Exit.isSuccess(c.exit)).toBe(true);
    await c.release();
  });

  it("takes over a lease whose owner process is dead, or whose heartbeat is stale", async () => {
    const d = db();
    const dead = await hold(makeDbLeases(d, { pid: 999_001, pidAlive: () => true, heartbeatMs: 3_600_000 }), "signal:acct");
    expect(Exit.isSuccess(dead.exit)).toBe(true);
    const viaDeadPid = await hold(makeDbLeases(d, { pid: 999_002, pidAlive: () => false }), "signal:acct");
    expect(Exit.isSuccess(viaDeadPid.exit)).toBe(true);
    await viaDeadPid.release();

    const stale = await hold(makeDbLeases(d, { pid: 999_003, now: () => 1_000, heartbeatMs: 3_600_000 }), "signal:other");
    expect(Exit.isSuccess(stale.exit)).toBe(true);
    const later = await hold(makeDbLeases(d, { pid: 999_004, pidAlive: () => true, now: () => 1_000 + 31_000 }), "signal:other");
    expect(Exit.isSuccess(later.exit)).toBe(true);
    await Promise.all([dead.release(), stale.release(), later.release()]);
  });
});

describe("meter", () => {
  const route = { id: "r1", maxCostPerDayUsd: 1 } as RouteSpec;

  it("settled spend survives a new meter and closes the route at its cap", async () => {
    const d = db();
    const m1 = makeDurableRouteMeter(d);
    const r = await run(m1.reserve(route));
    if (!r.ok) throw new Error("expected a reservation");
    await run(m1.settle(r.id, 1.5));
    const refused = await run(makeDurableRouteMeter(d).reserve(route));
    expect(refused).toEqual({ ok: false, reason: "cost" });
  });
});

describe("activity feed", () => {
  it("counts per route and keeps no message text", () => {
    const t = new HubActivityTracker(() => 5);
    t.observe({ _tag: "ChannelRouteMatched", routeId: "r1", channelId: "c", role: "owner" });
    t.observe({ _tag: "ChannelTurnCompleted", routeId: "r1", role: "owner", ok: true, costUsd: 0.25 });
    t.observe({ _tag: "ChannelTurnDropped", routeId: "r1", reason: "budget" });
    expect(t.countersOf("r1")).toEqual({ matched: 1, denied: 0, answered: 1, failed: 0, dropped: 1, costUsd: 0.25 });
    expect(t.snapshot()[0]).toMatchObject({ kind: "dropped", detail: "budget" });
  });
});
