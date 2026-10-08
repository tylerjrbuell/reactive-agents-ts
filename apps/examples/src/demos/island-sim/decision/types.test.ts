// Run: bun test apps/examples/src/demos/island-sim/decision/types.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { makeFallbackWorld } from "../world/fallback.js";
import { perceive } from "../engine/perceive.js";
import { makeScriptedDecisionMaker } from "./types.js";
import { initializeIslandGameplay } from "../engine/gameplay.js";

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
    const vocab = new Set(["move","gather","hunt","build","craft","eat","drink","rest","trade","share","talk","inspect","play","gift"]);
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

  it("carries raw fish to a cook fire instead of eating it raw", async () => {
    const base = makeFallbackWorld(71);
    const agent = base.agents[0]!;
    const hearth = base.structures.find((st) => ["camp", "fire-pit", "signal-fire", "shelter"].includes(st.kind))!.tile;
    const wild = base.terrain.find((t) => t.biome !== "ocean" && t.tile !== hearth && !base.structures.some((st) => st.tile === t.tile))!.tile;
    const world = {
      ...base,
      agents: base.agents.map((candidate) => candidate.id === agent.id
        ? { ...candidate, location: wild, needs: { hunger: 9, thirst: 1, energy: 1 }, inventory: [{ kind: "fish", qty: 1 }] }
        : candidate),
    };
    const carry = await makeScriptedDecisionMaker().decide({ world, agentId: agent.id, perception: perceive(world, agent.id) });
    expect(carry.action.type).toBe("move");
    const home = {
      ...base,
      agents: base.agents.map((candidate) => candidate.id === agent.id
        ? { ...candidate, location: hearth, needs: { hunger: 9, thirst: 1, energy: 1 }, inventory: [{ kind: "fish", qty: 1 }] }
        : candidate),
    };
    const meal = await makeScriptedDecisionMaker().decide({ world: home, agentId: agent.id, perception: perceive(home, agent.id) });
    expect(meal.action).toEqual({ type: "eat", target: "fish" });
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

  it("builds a rescue signal fire once it carries enough wood, even without a personal build objective", async () => {
    const base = makeFallbackWorld(36);
    const agent = base.agents[0]!;
    const world = {
      ...base,
      gameplay: undefined,
      resources: [],
      agents: base.agents.map((candidate) => candidate.id === agent.id
        ? { ...candidate, location: "D5", needs: { hunger: 1, thirst: 1, energy: 1 }, inventory: [{ kind: "wood", qty: 2 }] }
        : { ...candidate, location: "ZZ9", needs: { hunger: 1, thirst: 1, energy: 1 } }),
    };
    const decision = await makeScriptedDecisionMaker().decide({
      world,
      agentId: agent.id,
      perception: perceive(world, agent.id),
    });
    expect(decision.action.type).toBe("build");
    expect(decision.action.target).toBe("signal-fire");
  }, 15000);

  it("retrieves stashed wood from the camp cache so a signal fire can still be raised", async () => {
    const base = makeFallbackWorld(37);
    const agent = base.agents[0]!;
    const camp = base.structures.find((structure) => structure.kind === "camp")!.tile;
    const world = {
      ...base,
      resources: [],
      gameplay: {
        campCache: [{ kind: "wood", qty: 3 }],
        objectives: [{ id: "objective-rescue", kind: "rescue" as const, title: "Build a signal fire and make contact", target: 3, progress: 0, completed: false }],
        alliances: [],
        exiles: [],
        betrayalCounts: {},
        nextTwistTick: 100,
        twistCount: 0,
      },
      agents: base.agents.map((candidate) => candidate.id === agent.id
        ? { ...candidate, location: camp, needs: { hunger: 1, thirst: 1, energy: 1 }, inventory: [] }
        : { ...candidate, location: "ZZ9", needs: { hunger: 1, thirst: 1, energy: 1 } }),
    };
    const decision = await makeScriptedDecisionMaker().decide({
      world,
      agentId: agent.id,
      perception: perceive(world, agent.id),
    });
    expect(decision.action.type).toBe("retrieve");
    expect(decision.action.target).toBe("wood");
  }, 15000);

  it("scouts toward open ground instead of idling when nothing else demands attention", async () => {    const base = makeFallbackWorld(38);
    const agent = base.agents[0]!;
    const world = {
      ...base,
      gameplay: undefined,
      resources: [],
      clock: { ...base.clock, tick: 22, hour: 12 },
      agents: base.agents.map((candidate) => candidate.id === agent.id
        ? { ...candidate, location: "D4", needs: { hunger: 1, thirst: 1, energy: 1 } }
        : { ...candidate, location: "ZZ9", needs: { hunger: 1, thirst: 1, energy: 1 } }),
    };
    const decision = await makeScriptedDecisionMaker().decide({
      world,
      agentId: agent.id,
      perception: perceive(world, agent.id),
    });
    expect(decision.action.type).toBe("move");
  }, 15000);

  it("rests to heal when wounded or ill", async () => {
    const base = makeFallbackWorld(39);
    const agent = base.agents[0]!;
    const world = {
      ...base,
      gameplay: undefined,
      resources: [],
      agents: base.agents.map((candidate) => candidate.id === agent.id
        ? { ...candidate, location: "D4", status: "injured" as const, needs: { hunger: 1, thirst: 1, energy: 5 } }
        : { ...candidate, location: "ZZ9", needs: { hunger: 1, thirst: 1, energy: 1 } }),
    };
    const decision = await makeScriptedDecisionMaker().decide({
      world,
      agentId: agent.id,
      perception: perceive(world, agent.id),
    });
    expect(decision.action.type).toBe("rest");
  }, 15000);

  it("prefers clean water over the tainted spring when both are in sight", async () => {
    const base = makeFallbackWorld(40);
    const agent = base.agents[0]!;
    const taintedTile = agent.location;
    const world = {
      ...base,
      gameplay: { ...initializeIslandGameplay(base).gameplay!, poisonedSpring: taintedTile },
      resources: [
        { id: "res-poisoned", kind: "water", tile: agent.location, quantity: 6, regrowthPerDay: 3, initialQuantity: 6 },
        { id: "res-clean", kind: "water", tile: "D5", quantity: 6, regrowthPerDay: 3, initialQuantity: 6 },
      ],
      agents: base.agents.map((candidate) => candidate.id === agent.id
        ? { ...candidate, location: agent.location, needs: { hunger: 1, thirst: 9, energy: 4 }, inventory: [] }
        : { ...candidate, location: "ZZ9", needs: { hunger: 1, thirst: 1, energy: 1 } }),
    };
    const decision = await makeScriptedDecisionMaker().decide({
      world,
      agentId: agent.id,
      perception: perceive(world, agent.id),
    });
    expect(decision.action.type).toBe("move");
    expect(decision.action.target).not.toBe(world.gameplay!.poisonedSpring);
  }, 15000);

  it("plays healing-herbs when injured instead of resting through it", async () => {
    const base = initializeIslandGameplay(makeFallbackWorld(70));
    const agent = base.agents[3]!;
    const world = {
      ...base,
      agents: base.agents.map((candidate) => candidate.id === agent.id
        ? { ...candidate, status: "injured" as const, needs: { hunger: 2, thirst: 2, energy: 5 } }
        : candidate),
      gameplay: {
        ...base.gameplay!,
        idols: [{ id: "idol-herbs", kind: "healing-herbs" as const, scope: "ally" as const, holderId: agent.id, foundAtTick: 4, expiresAtTick: 119, played: false }],
      },
    };
    const decision = await makeScriptedDecisionMaker().decide({
      world,
      agentId: agent.id,
      perception: perceive(world, agent.id),
    });
    expect(decision.action.type).toBe("play");
    expect(decision.action.target).toBe("idol-herbs");
  }, 15000);

  it("gifts a shareable edge to a strained adjacent ally when healthy", async () => {
    const base = initializeIslandGameplay(makeFallbackWorld(71));
    const agent = base.agents[0]!;
    const ally = base.agents[1]!;
    const world = {
      ...base,
      agents: base.agents.map((candidate) => {
        if (candidate.id === agent.id) return { ...candidate, location: "D4", needs: { hunger: 1, thirst: 1, energy: 1 } };
        if (candidate.id === ally.id) return { ...candidate, location: "D4", needs: { hunger: 9, thirst: 1, energy: 1 } };
        return { ...candidate, location: "ZZ9" };
      }),
      gameplay: {
        ...base.gameplay!,
        idols: [{ id: "idol-charm", kind: "trust-charm" as const, scope: "ally" as const, holderId: agent.id, foundAtTick: 4, expiresAtTick: 119, played: false }],
      },
    };
    const decision = await makeScriptedDecisionMaker().decide({
      world,
      agentId: agent.id,
      perception: perceive(world, agent.id),
    });
    expect(decision.action.type).toBe("gift");
    expect(decision.action.target).toBe(ally.id);
  }, 15000);
});
