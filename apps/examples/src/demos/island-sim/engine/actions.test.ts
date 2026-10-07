// Run: bun test apps/examples/src/demos/island-sim/engine/actions.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { makeFallbackWorld } from "../world/fallback.js";
import { makeRng } from "../engine/rng.js";
import { applyAction } from "../engine/actions.js";
import { decayNeeds, needsCritical } from "../engine/needs.js";
import { initializeIslandGameplay } from "./gameplay.js";

const dummyRng = makeRng(1);

describe("applyAction", () => {
  it("move valid", () => {
    const w = makeFallbackWorld(5);
    const a = w.agents[0];
    const isAdj = (a: string, b: string) => {
      const colA = a.charCodeAt(0);
      const rowA = parseInt(a.slice(1),10);
      const colB = b.charCodeAt(0);
      const rowB = parseInt(b.slice(1),10);
      return Math.max(Math.abs(colA-colB), Math.abs(rowA-rowB))===1;
    };
    const adj = w.terrain.find(t => t.tile !== a.location && t.biome !== "ocean" && isAdj(a.location, t.tile))?.tile;

    if (!adj) throw new Error("no adjacent");
    const res = applyAction(w, a.id, { type: "move", target: adj }, dummyRng);
    expect(res.ok).toBe(true);
    expect(res.world.agents[0].location).toBe(adj);
    expect(res.events[0].kind).toBe("agent-moved");
  });
  it("move invalid fails", () => {
    const w = makeFallbackWorld(5);
    const a = w.agents[0];
    const res = applyAction(w, a.id, { type: "move", target: "Z9" }, dummyRng);
    expect(res.ok).toBe(false);
    expect(res.events[0].kind).toBe("action-failed");
  });

  it("stores carried supplies in the shared camp cache when at camp", () => {
    const base = initializeIslandGameplay(makeFallbackWorld(11));
    const agent = base.agents[0]!;
    const world = {
      ...base,
      agents: base.agents.map((candidate) => candidate.id === agent.id
        ? { ...candidate, location: base.structures[0]!.tile, inventory: [{ kind: "berries", qty: 3 }, { kind: "water", qty: 2 }] }
        : candidate),
    };

    const result = applyAction(world, agent.id, { type: "store" }, dummyRng);

    expect(result.ok).toBe(true);
    expect(result.world.agents[0]!.inventory).toEqual([]);
    expect(result.world.gameplay?.campCache).toEqual([{ kind: "berries", qty: 3 }, { kind: "water", qty: 2 }]);
    expect(result.events.some((event) => event.kind === "inventory-stored")).toBe(true);
  }, 15000);

  it("retrieves a requested item from public camp storage", () => {
    const base = initializeIslandGameplay(makeFallbackWorld(12));
    const agent = base.agents[0]!;
    const world = {
      ...base,
      agents: base.agents.map((candidate) => candidate.id === agent.id
        ? { ...candidate, location: base.structures[0]!.tile }
        : candidate),
      gameplay: { ...base.gameplay!, campCache: [...base.gameplay!.campCache, { kind: "water", qty: 2 }] },
    };

    const result = applyAction(world, agent.id, { type: "retrieve", target: "water" }, dummyRng);

    expect(result.ok).toBe(true);
    expect(result.world.agents[0]!.inventory).toEqual([{ kind: "water", qty: 1 }]);
    expect(result.world.gameplay?.campCache).toEqual([{ kind: "water", qty: 1 }]);
  }, 15000);

  it("keeps alliance supplies private while leaving the public cache open", () => {
    const base = initializeIslandGameplay(makeFallbackWorld(13));
    const member = base.agents[0]!;
    const outsider = base.agents[2]!;
    const world = {
      ...base,
      agents: base.agents.map((agent) => agent.id === member.id
        ? { ...agent, location: base.structures[0]!.tile, inventory: [{ kind: "water", qty: 2 }] }
        : agent.id === outsider.id
          ? { ...agent, location: base.structures[0]!.tile }
          : agent),
      gameplay: {
        ...base.gameplay!,
        alliances: [{ id: "private-cache", name: "The Pact", members: [member.id, base.agents[1]!.id], formedAtTick: 0, stash: [] }],
      },
    };

    const stored = applyAction(world, member.id, { type: "store" }, dummyRng);
    const outsiderAttempt = applyAction(stored.world, outsider.id, { type: "retrieve", target: "water" }, dummyRng);

    expect(stored.world.gameplay?.alliances[0]?.stash).toEqual([{ kind: "water", qty: 2 }]);
    expect(stored.world.gameplay?.campCache).toEqual([]);
    expect(outsiderAttempt.ok).toBe(false);
    expect(outsiderAttempt.world.gameplay?.alliances[0]?.stash).toEqual([{ kind: "water", qty: 2 }]);
  }, 15000);

  it("sickens a castaway who drinks from the poisoned spring", () => {
    const base = initializeIslandGameplay(makeFallbackWorld(14));
    const waterNode = base.resources.find((resource) => resource.kind === "water")!;
    const agent = base.agents[0]!;
    const world = {
      ...base,
      gameplay: { ...base.gameplay!, poisonedSpring: waterNode.tile },
      agents: base.agents.map((candidate) => candidate.id === agent.id
        ? { ...candidate, location: waterNode.tile }
        : candidate),
    };
    const result = applyAction(world, agent.id, { type: "gather", target: waterNode.id }, makeRng(3));
    expect(result.ok).toBe(true);
    expect(result.events.some((event) => event.kind === "illness")).toBe(true);
    expect(result.world.agents.find((candidate) => candidate.id === agent.id)?.status).toBe("ill");
  }, 15000);
});

describe("needs", () => {
  it("decay adds hunger/thirst", () => {    const w = makeFallbackWorld(5);
    const a = w.agents[0];
    const before = a.needs.hunger;
    const newA = decayNeeds(a, w.weather);
    expect(newA.needs.hunger).toBeGreaterThanOrEqual(before);
  });
  it("critical need detection", () => {
    const a = {
      needs: { hunger: 9, thirst: 2, energy: 2 },
    } as any;
    expect(needsCritical(a)).toBe("hunger");
  });
});
