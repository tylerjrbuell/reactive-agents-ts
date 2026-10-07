// Run: bun test apps/examples/src/demos/island-sim/decision/types.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { makeFallbackWorld } from "../world/fallback.js";
import { perceive } from "../engine/perceive.js";
import { makeScriptedDecisionMaker } from "./types.js";

describe("scripted decisions", () => {
  it("chooses rest when energy is critical", async () => {
    const base = makeFallbackWorld(21);
    const a = base.agents[0]!;
    const w = {
      ...base,
      agents: base.agents.map((agent) => agent.id === a.id
        ? { ...agent, needs: { ...agent.needs, energy: 10 } }
        : agent),
    };
    const d = await makeScriptedDecisionMaker().decide({ world: w, agentId: a.id, perception: perceive(w, a.id) });
    expect(d.action.type).toBe("rest");
  });
  it("is deterministic for identical input", async () => {
    const w = makeFallbackWorld(21);
    const m = makeScriptedDecisionMaker();
    const a = w.agents[0];
    const one = await m.decide({ world: w, agentId: a.id, perception: perceive(w, a.id) });
    const two = await m.decide({ world: w, agentId: a.id, perception: perceive(w, a.id) });
    expect(one).toEqual(two);
  });
  it("always returns an action inside the vocabulary", async () => {
    const w = makeFallbackWorld(21);
    const vocab = new Set(["move","gather","hunt","build","craft","eat","drink","rest","trade","share","talk","inspect"]);
    for (const a of w.agents) {
      const d = await makeScriptedDecisionMaker().decide({ world: w, agentId: a.id, perception: perceive(w, a.id) });
      expect(vocab.has(d.action.type)).toBe(true);
    }
  });

  it("stores excess supplies instead of gathering into a full pack", async () => {
    const base = makeFallbackWorld(45);
    const agent = base.agents[0]!;
    const world = {
      ...base,
      agents: base.agents.map((candidate) => candidate.id === agent.id
        ? { ...candidate, location: base.structures[0]!.tile, needs: { hunger: 1, thirst: 1, energy: 1 }, inventory: [{ kind: "wood", qty: 10 }] }
        : candidate),
    };

    const decision = await makeScriptedDecisionMaker().decide({
      world,
      agentId: agent.id,
      perception: perceive(world, agent.id),
    });

    expect(decision.action.type).toBe("store");
  }, 15000);

  it("heads back toward camp before a full pack causes repeated gather failures", async () => {
    const base = makeFallbackWorld(46);
    const agent = base.agents[0]!;
    const camp = base.structures[0]!.tile;
    const remoteTile = base.terrain.find((tile) => tile.tile !== camp && tile.biome !== "ocean")!.tile;
    const world = {
      ...base,
      agents: base.agents.map((candidate) => candidate.id === agent.id
        ? { ...candidate, location: remoteTile, needs: { hunger: 1, thirst: 1, energy: 1 }, inventory: [{ kind: "wood", qty: 12 }] }
        : candidate),
      resources: [],
    };

    const decision = await makeScriptedDecisionMaker().decide({
      world,
      agentId: agent.id,
      perception: perceive(world, agent.id),
    });

    expect(decision.action.type).toBe("move");
    const currentLocation = world.agents.find((candidate) => candidate.id === agent.id)!.location;
    const destination = world.terrain.find((tile) => tile.tile === decision.action.target);
    expect(destination?.biome).not.toBe("ocean");
    expect(Math.max(
      Math.abs(decision.action.target!.charCodeAt(0) - currentLocation.charCodeAt(0)),
      Math.abs(Number(decision.action.target!.slice(1)) - Number(currentLocation.slice(1))),
    )).toBe(1);
  }, 15000);

  it("only talks with adjacent castaways, never distant ones", async () => {
    const base = makeFallbackWorld(30);
    const agent = base.agents[0]!;
    const other = base.agents[1]!;
    const [col, row] = [agent.location.charCodeAt(0), Number(agent.location.slice(1))];
    const distant = String.fromCharCode(col) + (row + 2);
    const world = {
      ...base,
      clock: { ...base.clock, tick: 4 },
      resources: [],
      gameplay: undefined,
      agents: base.agents.map((candidate) => {
        if (candidate.id === agent.id) return { ...candidate, needs: { hunger: 1, thirst: 1, energy: 1 } };
        if (candidate.id === other.id) return { ...candidate, location: distant, needs: { hunger: 1, thirst: 1, energy: 1 } };
        return { ...candidate, location: "ZZ9", needs: { hunger: 1, thirst: 1, energy: 1 } };
      }),
    };
    const decision = await makeScriptedDecisionMaker().decide({
      world,
      agentId: agent.id,
      perception: perceive(world, agent.id),
    });
    expect(decision.action.type).not.toBe("talk");
  }, 15000);

  it("prefers the nearest resource over a stockier distant one when starving", async () => {
    const base = makeFallbackWorld(32);
    const agent = base.agents[0]!;
    const near = { id: "res-near", kind: "berries", tile: agent.location, quantity: 2, regrowthPerDay: 1, initialQuantity: 2 };
    const farTile = "ZZ9";
    const rich = { id: "res-rich", kind: "water", tile: farTile, quantity: 9, regrowthPerDay: 2, initialQuantity: 9 };
    const world = {
      ...base,
      gameplay: undefined,
      resources: [near, rich],
      agents: base.agents.map((candidate) => candidate.id === agent.id
        ? { ...candidate, needs: { hunger: 9, thirst: 1, energy: 1 }, inventory: [] }
        : { ...candidate, location: "ZZ9", needs: { hunger: 1, thirst: 1, energy: 1 } }),
    };
    const decision = await makeScriptedDecisionMaker().decide({
      world,
      agentId: agent.id,
      perception: perceive(world, agent.id),
    });
    expect(decision.action.type).toBe("gather");
    expect(decision.action.target).toBe("res-near");
  }, 15000);

  it("steals from a neighboring survivor when starving and no food source is available", async () => {
    const base = makeFallbackWorld(33);
    const agent = base.agents[0]!;
    const victim = base.agents[1]!;
    const world = {
      ...base,
      clock: { ...base.clock, tick: 21 },
      resources: [],
      gameplay: undefined,
      agents: base.agents.map((candidate) => {
        if (candidate.id === agent.id) return { ...candidate, location: "D4", needs: { hunger: 9, thirst: 1, energy: 1 }, inventory: [] };
        if (candidate.id === victim.id) return { ...candidate, location: "D5", needs: { hunger: 1, thirst: 1, energy: 1 }, inventory: [{ kind: "fish", qty: 2 }] };
        return { ...candidate, location: "ZZ9", needs: { hunger: 1, thirst: 1, energy: 1 }, inventory: [] };
      }),
    };
    const decision = await makeScriptedDecisionMaker().decide({
      world,
      agentId: agent.id,
      perception: perceive(world, agent.id),
    });
    expect(decision.action.type).toBe("steal");
    expect(decision.action.target).toBe(victim.id);
  }, 15000);

  it("steals carried water when thirst is desperate", async () => {
    const base = makeFallbackWorld(35);
    const agent = base.agents[0]!;
    const victim = base.agents[1]!;
    const world = {
      ...base,
      clock: { ...base.clock, tick: 21 },
      resources: [],
      gameplay: undefined,
      agents: base.agents.map((candidate) => {
        if (candidate.id === agent.id) return { ...candidate, location: "D4", needs: { hunger: 1, thirst: 9, energy: 1 }, inventory: [] };
        if (candidate.id === victim.id) return { ...candidate, location: "D5", needs: { hunger: 1, thirst: 1, energy: 1 }, inventory: [{ kind: "water", qty: 2 }] };
        return { ...candidate, location: "ZZ9", needs: { hunger: 1, thirst: 1, energy: 1 }, inventory: [] };
      }),
    };
    const decision = await makeScriptedDecisionMaker().decide({
      world,
      agentId: agent.id,
      perception: perceive(world, agent.id),
    });
    expect(decision.action.type).toBe("steal");
    expect(decision.action.target).toBe(victim.id);
  }, 15000);

  it("never socializes with or targets a dead castaway", async () => {
    const base = makeFallbackWorld(34);
    const agent = base.agents[0]!;
    const other = base.agents[1]!;
    const world = {
      ...base,
      clock: { ...base.clock, tick: 4 },
      resources: [],
      gameplay: undefined,
      agents: base.agents.map((candidate) => {
        if (candidate.id === agent.id) return { ...candidate, location: "D4", needs: { hunger: 1, thirst: 1, energy: 1 } };
        if (candidate.id === other.id) return { ...candidate, location: "D5", status: "dead" as const, demise: { tick: 1, cause: "thirst" }, needs: { hunger: 1, thirst: 1, energy: 1 } };
        return { ...candidate, location: "ZZ9", needs: { hunger: 1, thirst: 1, energy: 1 } };
      }),
    };
    const decision = await makeScriptedDecisionMaker().decide({
      world,
      agentId: agent.id,
      perception: perceive(world, agent.id),
    });
    expect(decision.action.type).not.toBe("talk");
    expect(decision.action.target).not.toBe(other.id);
  }, 15000);
});
