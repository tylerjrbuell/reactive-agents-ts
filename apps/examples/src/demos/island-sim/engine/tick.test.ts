// Run: bun test apps/examples/src/demos/island-sim/engine/tick.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { makeFallbackWorld } from "../world/fallback.js";
import { makeRng } from "./rng.js";
import { makeScriptedDecisionMaker } from "../decision/types.js";
import { runTick } from "./tick.js";
import { initializeIslandGameplay } from "./gameplay.js";

describe("runTick", () => {
  it("advances the clock by one hour and day every 24 ticks", async () => {
    const base = makeFallbackWorld(31);
    const w = { ...base, clock: { ...base.clock, hour: 23 } };
    const r = await runTick(w, makeScriptedDecisionMaker(), makeRng(1));
    expect(r.world.clock.hour).toBe(0);
    expect(r.world.clock.day).toBe(2);
    expect(r.world.clock.tick).toBe(1);
  });
  it("produces one decision per living agent and only actions in the vocabulary", async () => {
    const w = makeFallbackWorld(31);
    const r = await runTick(w, makeScriptedDecisionMaker(), makeRng(1));
    expect(Object.keys(r.decisions)).toHaveLength(w.agents.filter(a => a.status !== "dead").length);
  });
  it("is deterministic for identical world, maker, and seed", async () => {
    const w = makeFallbackWorld(31);
    const a = await runTick(structuredClone(w), makeScriptedDecisionMaker(), makeRng(99));
    const b = await runTick(structuredClone(w), makeScriptedDecisionMaker(), makeRng(99));
    expect(a.events).toEqual(b.events);
    expect(a.world.agents.map(x => x.location)).toEqual(b.world.agents.map(x => x.location));
  });
  it("decays needs each tick", async () => {
    const w = makeFallbackWorld(31);
    const before = w.agents[0].needs.hunger;
    const r = await runTick(w, makeScriptedDecisionMaker(), makeRng(1));
    expect(r.world.agents[0].needs.hunger).toBeGreaterThanOrEqual(before);
  });

  it("initializes objectives and emits a seeded daily twist", async () => {
    const base = makeFallbackWorld(31);
    const world = { ...base, clock: { ...base.clock, tick: 24, hour: 23 } };
    const result = await runTick(world, makeScriptedDecisionMaker(), makeRng(1));

    expect(result.world.gameplay?.objectives.some((goal) => goal.kind === "rescue")).toBe(true);
    expect(result.events.some((event) => event.kind === "island-twist")).toBe(true);
  }, 15000);

  it("keeps exiled castaways out of the main decision loop until their return tick", async () => {
    const base = initializeIslandGameplay(makeFallbackWorld(32));
    const exiledId = base.agents[0]!.id;
    const world = {
      ...base,
      agents: base.agents.map((agent, index) => index === 0 ? { ...agent, location: "G6" } : agent),
      gameplay: { ...base.gameplay!, exiles: [{ agentId: exiledId, location: "G6", returnAtTick: 20, reason: "vote" }] },
    };
    let decisions = 0;
    const maker = {
      async decide() {
        decisions += 1;
        return { goal: "wait", reasoningSummary: "test", plan: [], action: { type: "inspect" as const } };
      },
    };

    const result = await runTick(world, maker, makeRng(2));

    expect(decisions).toBe(world.agents.length - 1);
    expect(result.world.gameplay?.exiles).toHaveLength(1);
    expect(result.world.agents.find((agent) => agent.id === exiledId)?.location).toBe("G6");
  }, 15000);

  it("does not re-emit a death event for a castaway already dead", async () => {
    const base = makeFallbackWorld(33);
    const deadId = base.agents[0]!.id;
    const world = {
      ...base,
      agents: base.agents.map((agent, index) => index === 0
        ? { ...agent, status: "dead" as const, needs: { hunger: 10, thirst: 10, energy: 10 } }
        : agent),
    };

    const result = await runTick(world, makeScriptedDecisionMaker(), makeRng(3));

    expect(result.events.filter((event) => event.kind === "agent-died" && event.agentId === deadId)).toHaveLength(0);
  }, 15000);

  it("keeps most castaways alive through the first day of autonomous play", async () => {
    let world = makeFallbackWorld(20261006);
    const rng = makeRng(world.seed);
    const maker = makeScriptedDecisionMaker();
    for (let hour = 0; hour < 24; hour += 1) {
      world = (await runTick(world, maker, rng)).world;
    }

    expect(world.agents.filter((agent) => agent.status !== "dead").length).toBeGreaterThanOrEqual(6);
  }, 15000);

  it("keeps a viable community through a four-day deterministic run", async () => {
    let world = makeFallbackWorld(20261006);
    const rng = makeRng(world.seed);
    const maker = makeScriptedDecisionMaker();
    for (let hour = 0; hour < 100; hour += 1) {
      world = (await runTick(world, maker, rng)).world;
    }

    expect(world.agents.filter((agent) => agent.status !== "dead").length).toBeGreaterThanOrEqual(6);
    expect(world.gameplay?.alliances.length).toBeGreaterThan(0);
  }, 15000);
});
