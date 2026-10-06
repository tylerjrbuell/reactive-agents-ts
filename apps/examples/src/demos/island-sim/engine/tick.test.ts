import { describe, it, expect } from "bun:test";
import { makeFallbackWorld } from "../world/fallback.js";
import { makeRng } from "./rng.js";
import { makeScriptedDecisionMaker } from "../decision/types.js";
import { runTick } from "./tick.js";

describe("runTick", () => {
  it("advances the clock by one hour and day every 24 ticks", async () => {
    let w = makeFallbackWorld(31);
    w.clock.hour = 23;
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
});