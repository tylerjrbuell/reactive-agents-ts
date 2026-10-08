// Run: bun test apps/examples/src/demos/island-sim/engine/idols.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { makeFallbackWorld } from "../world/fallback.js";
import { initializeIslandGameplay } from "./gameplay.js";

describe("idols and advantages", () => {
  it("stores idol holdings on gameplay state", () => {
    const world = initializeIslandGameplay(makeFallbackWorld(20261006));
    expect(world.gameplay?.idols).toBeDefined();
    expect(Array.isArray(world.gameplay?.idols)).toBe(true);
  }, 15000);

  it("seeds an idol find from an inspect action deterministically", async () => {
    const { advanceIslandGameplay } = await import("./gameplay.js");
    const base = initializeIslandGameplay(makeFallbackWorld(20261006));
    const first = advanceIslandGameplay(base, [{ kind: "inspected", tick: 5, agentId: "agent-0", target: "H8" }]);
    const second = advanceIslandGameplay(base, [{ kind: "inspected", tick: 5, agentId: "agent-0", target: "H8" }]);
    const finds = first.events.filter((event) => event.kind === "idol-found");
    expect(finds.length).toBeGreaterThan(0);
    expect(first.events).toEqual(second.events);
    expect(first.world.gameplay?.idols?.length).toBeGreaterThan(0);
  }, 15000);

  it("negates council votes against a played immunity idol and exiles the next-highest", async () => {    const { advanceIslandGameplay } = await import("./gameplay.js");
    const rig = (withIdol: boolean) => {
      const base = initializeIslandGameplay(makeFallbackWorld(20261006));
      const agents = base.agents.map((agent) => {
        if (agent.id === "agent-0") return agent;
        return { ...agent, relationships: { ...agent.relationships, "agent-0": { trust: -1, lastInteraction: 60 } } };
      });
      const world = {
        ...base,
        clock: { tick: 68, day: 3, hour: 20 },
        agents,
        gameplay: {
          ...base.gameplay!,
          betrayalCounts: { "agent-0": 5 },
          idols: withIdol ? [{
            id: "idol-test", kind: "immunity-idol" as const, scope: "self" as const,
            holderId: "agent-0", foundAtTick: 10, expiresAtTick: 119, played: true,
          }] : [],
        },
      };
      return advanceIslandGameplay(world, []);
    };
    const plain = rig(false);
    expect(plain.world.gameplay?.lastVote?.exiledId).toBe("agent-0");
    const shielded = rig(true);
    const negated = shielded.events.filter((event) => event.kind === "vote-negated");
    expect(negated.length).toBe(1);
    expect(shielded.world.gameplay?.lastVote?.exiledId).not.toBe("agent-0");
    expect(shielded.world.gameplay?.exiles.map((exile) => exile.agentId)).not.toContain("agent-0");
  }, 15000);

  it("plays healing-herbs to cure an injured holder", async () => {    const { applyAction } = await import("./actions.js");
    const { makeRng } = await import("./rng.js");
    const base = initializeIslandGameplay(makeFallbackWorld(20261006));
    const world = {
      ...base,
      agents: base.agents.map((agent) => agent.id === "agent-3" ? { ...agent, status: "injured" as const } : agent),
      gameplay: {
        ...base.gameplay!,
        idols: [{ id: "idol-herbs", kind: "healing-herbs" as const, scope: "ally" as const, holderId: "agent-3", foundAtTick: 4, expiresAtTick: 119, played: false }],
      },
    };
    const result = applyAction(world, "agent-3", { type: "play", target: "idol-herbs" }, makeRng(1));
    expect(result.ok).toBe(true);
    expect(result.world.agents.find((agent) => agent.id === "agent-3")?.status).toBe("alive");
    expect(result.events.some((event) => event.kind === "idol-played")).toBe(true);
    expect(result.world.gameplay?.idols?.length ?? 0).toBe(0);
  }, 15000);

  it("gifts an advantage to an ally and burns expired holdings at Day 5", async () => {    const { applyAction } = await import("./actions.js");
    const { makeRng } = await import("./rng.js");
    const { advanceIslandGameplay } = await import("./gameplay.js");
    const base = initializeIslandGameplay(makeFallbackWorld(20261006));
    const world = {
      ...base,
      gameplay: {
        ...base.gameplay!,
        idols: [{ id: "idol-gift", kind: "trust-charm" as const, scope: "ally" as const, holderId: "agent-0", foundAtTick: 4, expiresAtTick: 119, played: false }],
      },
    };
    const gifted = applyAction(world, "agent-0", { type: "gift", target: "agent-1", item: "idol-gift" }, makeRng(1));
    expect(gifted.ok).toBe(true);
    expect(gifted.world.gameplay?.idols?.[0]?.holderId).toBe("agent-1");
    expect(gifted.events.some((event) => event.kind === "idol-gifted")).toBe(true);
    const stale = {
      ...base,
      clock: { tick: 120, day: 6, hour: 0 },
      gameplay: {
        ...base.gameplay!,
        idols: [{ id: "idol-old", kind: "extra-vote" as const, scope: "self" as const, holderId: "agent-0", foundAtTick: 4, expiresAtTick: 119, played: false }],
      },
    };
    const aged = advanceIslandGameplay(stale, []);
    expect(aged.world.gameplay?.idols?.length ?? 0).toBe(0);
    expect(aged.events.some((event) => event.kind === "idol-expired")).toBe(true);
  }, 15000);

  it("plants a clue tile on a cache twist and clears it when searched", async () => {
    const { advanceIslandGameplay } = await import("./gameplay.js");
    const base = initializeIslandGameplay(makeFallbackWorld(20261006));
    const tick = base.gameplay!.nextTwistTick;
    const twisted = advanceIslandGameplay({ ...base, clock: { tick, day: 2, hour: 1 } }, []);
    const clues = twisted.world.gameplay?.idolClues ?? [];
    expect(clues.length).toBeGreaterThan(0);
    const tile = clues[0]!;
    const searched = advanceIslandGameplay(twisted.world, [{ kind: "inspected", tick, agentId: "agent-0", target: tile }]);
    expect(searched.world.gameplay?.idolClues ?? []).not.toContain(tile);
    expect(searched.events.some((event) => event.kind === "idol-found")).toBe(true);
  }, 15000);
});
