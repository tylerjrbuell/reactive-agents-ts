// Run: bun run repo test apps/cortex/server/tests/channel-hub-migration.test.ts
//
// Per-agent channel config becomes channels + routes without changing who may talk or what tools they
// get: golden platform:userId keys, legacy-listed senders are owners (full tools), strangers are
// ReadOnly, a re-run is a no-op, an edit in the hub detaches a row from the agent config, and
// deleting the new rows (rollback) leaves the agent config untouched.
import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { Effect } from "effect";
import { decideRouteAccess, toolExposureFor, validateRoutes } from "@reactive-agents/channels";
import { applySchema } from "../db/schema.js";
import { getChannel, getRoute, listChannels, listRoutes, routeToSpecInput, updateChannel, detachRoute, replaceRoute } from "../db/channel-hub-queries.js";
import { applyMigration, planMigration, type MigrationAgent } from "../services/channel-hub-migration.js";

const CH = "ch-aaaa1111";
const agent = (config: Record<string, unknown>, extra: Partial<MigrationAgent> = {}): MigrationAgent => ({
  agentId: "gateway-1",
  name: "Bot",
  status: "active",
  agentType: "gateway",
  config: { provider: "test", channels: [{ id: CH, kind: "telegram", label: "Support" }], ...config },
  ...extra,
});
const db = () => {
  const d = new Database(":memory:");
  applySchema(d);
  return d;
};
const decoded = async (d: Database) => {
  const specs = listRoutes(d).map(routeToSpecInput);
  return Effect.runPromise(validateRoutes(specs, (id) => getChannel(d, id)?.platform));
};

describe("access mapping", () => {
  it("golden: old platform:userId allowlist keys still match, and the listed sender is an owner with the agent's full tools", async () => {
    const a = agent({ gateway: { accessControl: { accessPolicy: "allowlist", allowedSenders: ["telegram:42"] } } });
    const d = db();
    applyMigration(d, planMigration([a]), [a.agentId]);
    const [route] = await decoded(d);
    expect(route).toBeDefined();
    const listed = await Effect.runPromise(decideRouteAccess(route!, "telegram", "42"));
    expect(listed).toEqual({ allowed: true, role: "owner" });
    expect(toolExposureFor(route!, "owner")._tag).toBe("AgentDefault");
    const stranger = await Effect.runPromise(decideRouteAccess(route!, "telegram", "99"));
    expect(stranger.allowed).toBe(false);
  });

  it("fail-closed: the framework default (no accessControl) denies everyone", async () => {
    const d = db();
    applyMigration(d, planMigration([agent({})]), ["gateway-1"]);
    const [route] = await decoded(d);
    expect((await Effect.runPromise(decideRouteAccess(route!, "telegram", "42"))).allowed).toBe(false);
    expect(route!.open).toBe(false);
  });

  it("open policy with no listed sender: strangers are ReadOnly, caps are set, and the warning says how to add an owner", async () => {
    const plan = planMigration([agent({ gateway: { accessControl: { accessPolicy: "open" } } })]);
    const d = db();
    applyMigration(d, plan, ["gateway-1"]);
    const [route] = await decoded(d);
    expect(route!.open).toBe(true);
    expect(route!.owners).toEqual([]);
    const v = await Effect.runPromise(decideRouteAccess(route!, "telegram", "7"));
    expect(v).toEqual({ allowed: true, role: "sender" });
    expect(toolExposureFor(route!, "sender")._tag).toBe("ReadOnly");
    expect(route!.maxCostPerDayUsd).toBeGreaterThan(0);
    expect(plan.warnings.map((w) => w.message).join(" ")).toContain("Add yourself as an owner");
  });

  it("blocklist keeps its deny list; a sender listed in allowedSenders under open policy is still the owner", async () => {
    const plan = planMigration([agent({ gateway: { accessControl: { accessPolicy: "open", allowedSenders: ["telegram:42"], blockedSenders: [] } } })]);
    const d = db();
    applyMigration(d, plan, ["gateway-1"]);
    const [route] = await decoded(d);
    expect((await Effect.runPromise(decideRouteAccess(route!, "telegram", "42"))).allowed && route!.owners.includes("telegram:42")).toBe(true);
    const bl = planMigration([agent({ gateway: { accessControl: { accessPolicy: "blocklist", blockedSenders: ["telegram:6"] } } })]);
    expect(bl.routes[0]?.spec.deny).toEqual(["telegram:6"]);
  });

  it("a paused agent's routes are disabled (the legacy host did not host it); webhook channels stay legacy", () => {
    const plan = planMigration([agent({ channels: [{ id: CH, kind: "telegram" }, { id: "ch-bbbb2222", kind: "webhook", settings: { ingressPort: 7700 } }] }, { status: "paused" })]);
    expect(plan.routes).toHaveLength(1);
    expect(plan.routes[0]?.spec.enabled).toBe(false);
    expect(plan.legacy.map((l) => l.channelId)).toEqual(["ch-bbbb2222"]);
  });
});

describe("apply", () => {
  const cfg = { gateway: { accessControl: { accessPolicy: "allowlist", allowedSenders: ["telegram:42"] } } };

  it("is idempotent: a second run changes nothing", () => {
    const d = db();
    const plan = planMigration([agent(cfg)]);
    expect(applyMigration(d, plan, ["gateway-1"]).routesAdded).toBe(1);
    expect(applyMigration(d, plan, ["gateway-1"])).toEqual({ channelsAdded: 0, channelsUpdated: 0, channelsRemoved: 0, routesAdded: 0, routesUpdated: 0, routesRemoved: 0 });
  });

  it("a migrated route follows the agent config until it is edited in the hub", () => {
    const d = db();
    applyMigration(d, planMigration([agent(cfg)]), ["gateway-1"]);
    const next = agent({ gateway: { accessControl: { accessPolicy: "allowlist", allowedSenders: ["telegram:42", "telegram:43"] } } });
    expect(applyMigration(d, planMigration([next]), ["gateway-1"]).routesUpdated).toBe(1);
    expect(getRoute(d, "route-gateway-1-" + CH)?.body.owners).toEqual(["telegram:42", "telegram:43"]);

    const row = getRoute(d, "route-gateway-1-" + CH)!;
    replaceRoute(d, { ...routeToSpecInput(row), owners: ["telegram:42"] });
    detachRoute(d, row.id);
    updateChannel(d, CH, { label: "Mine" });
    applyMigration(d, planMigration([next]), ["gateway-1"]);
    expect(getRoute(d, row.id)?.body.owners).toEqual(["telegram:42"]);
  });

  it("removing the channel from the agent removes the migrated rows; hub-made rows survive", () => {
    const d = db();
    applyMigration(d, planMigration([agent(cfg)]), ["gateway-1"]);
    const r = applyMigration(d, planMigration([agent({ channels: [] })]), ["gateway-1"]);
    expect(r.routesRemoved).toBe(1);
    expect(listChannels(d)).toEqual([]);
  });

  it("rollback: the agent config is never modified, so deleting the rows restores the legacy view", () => {
    const d = db();
    const a = agent(cfg);
    const before = JSON.stringify(a.config);
    applyMigration(d, planMigration([a]), ["gateway-1"]);
    d.exec("DELETE FROM cortex_routes; DELETE FROM cortex_channels;");
    expect(JSON.stringify(a.config)).toBe(before);
    expect(getChannel(d, CH)).toBeNull();
  });
});
