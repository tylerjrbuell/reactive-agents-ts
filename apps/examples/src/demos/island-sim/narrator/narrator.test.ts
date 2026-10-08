// Run: bun test apps/examples/src/demos/island-sim/narrator/narrator.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import type { WorldState } from "../world/schema.js";
import { makeFallbackWorld } from "../world/fallback.js";
import { makeTemplateNarrator, type NarrationEntry } from "./narrator.js";
import type { SimEvent } from "../engine/events.js";

describe("narrator", () => {
  it("writes a deterministic shelter-style recap for a day of events", () => {
    const world = makeFallbackWorld(60);
    const events: SimEvent[] = [
      { kind: "agent-moved", tick: 0, agentId: "agent-0", from: "D4", to: "C3" },
      { kind: "resource-gathered", tick: 1, agentId: "agent-0", resourceId: "res-0", amount: 1 },
      { kind: "talked", tick: 4, from: "agent-0", to: "agent-1", topic: "the island", trustDelta: 0.1 },
      { kind: "agent-died", tick: 12, agentId: "agent-2", cause: "thirst" },
    ];
    const one = makeTemplateNarrator().narrate({ world, day: 1, dayStartTick: 0, dayEndTick: 23, events: events.map((event) => ({ sequence: 1, event })) });
    const two = makeTemplateNarrator().narrate({ world, day: 1, dayStartTick: 0, dayEndTick: 23, events: events.map((event) => ({ sequence: 1, event })) });
    const entry: NarrationEntry = one as NarrationEntry;
    expect(entry.day).toBe(1);
    expect(entry.headline.length).toBeGreaterThan(3);
    expect(entry.recap.length).toBeGreaterThan(10);
    expect(entry.recap).toContain("Sawyer");
    expect(entry.recap).toContain("thirst");
    expect(entry.confessional.name.length).toBeGreaterThan(0);
    expect(entry.confessional.quote.length).toBeGreaterThan(0);
    expect(entry.confessional.mood).toBe("grieving");
    expect(one).toEqual(two);
  }, 15000);

  it("records and lists chronicle entries", () => {
    const narrator = makeTemplateNarrator();
    const world = makeFallbackWorld(61);
    narrator.narrate({ world, day: 1, dayStartTick: 0, dayEndTick: 23, events: [] });
    const second = narrator.narrate({ world, day: 2, dayStartTick: 24, dayEndTick: 47, events: [] });
    const list = narrator.chronicle();
    expect(list.length).toBe(2);
    expect(list.at(-1)!.day).toBe(2);
  }, 15000);

  it("clears the chronicle on reset so a new island starts a fresh journal", () => {
    const narrator = makeTemplateNarrator();
    const world = makeFallbackWorld(62);
    narrator.narrate({ world, day: 1, dayStartTick: 0, dayEndTick: 23, events: [] });
    expect(narrator.chronicle().length).toBe(1);
    narrator.reset();
    expect(narrator.chronicle()).toEqual([]);
  }, 15000);

  it("names the salient moments: deaths, pacts, exile, and twists", () => {    const world = makeFallbackWorld(64);
    const events: SimEvent[] = [
      { kind: "agent-died", tick: 2, agentId: "agent-4", cause: "hunger" },
      { kind: "alliance-formed", tick: 3, allianceId: "alliance-1", name: "The Shoreline", members: ["agent-0", "agent-1"] },
      { kind: "exile-started", tick: 4, agentId: "agent-2", location: "H8", returnAtTick: 16, reason: "vote" },
      { kind: "island-twist", tick: 5, twist: "weather-front", description: "Dark clouds gather offshore." },
      { kind: "rescue-arrived", tick: 6, survivors: ["agent-0"] },
    ];
    const entry = makeTemplateNarrator().narrate({
      world, day: 1, dayStartTick: 0, dayEndTick: 23,
      events: events.map((event, index) => ({ sequence: index + 1, event })),
    }) as NarrationEntry;
    expect(entry.recap).toContain("Sayid");
    expect(entry.recap).toContain("hunger");
    expect(entry.recap.toLowerCase()).toContain("shoreline");
    expect(entry.recap.toLowerCase()).toContain("exile");
    expect(entry.recap.toLowerCase()).toContain("weather");
    expect(entry.recap.toLowerCase()).toContain("rescue");
  }, 15000);

  it("only ever gives the confessional to a living castaway", () => {    const base = makeFallbackWorld(65);
    // Make the most active castaway dead, so the naive "most events" pick would be a corpse.
    const dead = base.agents[2]!;
    const world = {
      ...base,
      agents: base.agents.map((agent) => agent.id === dead.id
        ? { ...agent, status: "dead" as const, demise: { tick: 2, cause: "thirst" } }
        : agent),
    };
    const busy: SimEvent[] = Array.from({ length: 9 }, (_, index) => ({
      kind: "resource-gathered", tick: index, agentId: dead.id, resourceId: "res-0", amount: 1,
    }));
    const entry = makeTemplateNarrator().narrate({
      world, day: 1, dayStartTick: 0, dayEndTick: 23,
      events: busy.map((event, index) => ({ sequence: index + 1, event })),
    }) as NarrationEntry;
    const speaker = world.agents.find((agent) => agent.name === entry.confessional.name);
    expect(speaker?.status).not.toBe("dead");
  }, 15000);

  it("grounds the recap in the true roster: living, dead with causes, injuries, discoveries, goals, and named rescue", () => {
    const base = makeFallbackWorld(66);
    const world = {
      ...base,
      clock: { tick: 15, day: 1, hour: 15 },
      agents: base.agents.map((agent) => {
        if (agent.id === "agent-2") return { ...agent, status: "dead" as const, demise: { tick: 5, cause: "thirst" } };
        if (agent.id === "agent-4") return { ...agent, status: "dead" as const, demise: { tick: 9, cause: "hunger" } };
        if (agent.id === "agent-3") return { ...agent, status: "injured" as const };
        return agent;
      }),
      gameplay: {
        campCache: [],
        objectives: [{ id: "o1", kind: "gather" as const, title: "Secure food", ownerId: "agent-0", target: 3, progress: 3, completed: true }],
        alliances: [{ id: "a1", name: "The Shoreline Pact", members: ["agent-0", "agent-1"], formedAtTick: 2, stash: [] }],
        exiles: [{ agentId: "agent-5", returnAtTick: 30, location: "H8", reason: "vote" }],
        betrayalCounts: {},
        nextTwistTick: 99,
        twistCount: 0,
        discovered: ["the northern spring is poisoned"],
      },
    };
    const events: SimEvent[] = [
      { kind: "agent-died", tick: 5, agentId: "agent-2", cause: "thirst" },
      { kind: "agent-died", tick: 9, agentId: "agent-4", cause: "hunger" },
      { kind: "discovered", tick: 10, agentId: "agent-0", secret: "the northern spring is poisoned", description: "A warning: the northern spring is poisoned." },
      { kind: "objective-completed", tick: 11, agentId: "agent-0", objectiveId: "o1", title: "Secure food" },
      { kind: "injured", tick: 12, agentId: "agent-3", cause: "fall" },
      { kind: "rescue-arrived", tick: 15, survivors: ["agent-0", "agent-1"] },
    ];
    const entry = makeTemplateNarrator().narrate({
      world, day: 1, dayStartTick: 0, dayEndTick: 23,
      events: events.map((event, index) => ({ sequence: index + 1, event })),
    }) as NarrationEntry;
    expect(entry.recap).toContain("6 alive");
    expect(entry.recap).toContain("2 lost");
    expect(entry.recap).toContain("Sawyer");
    expect(entry.recap).toContain("Sayid");
    expect(entry.recap).toContain("Hurley");
    expect(entry.recap.toLowerCase()).toContain("poison");
    expect(entry.recap).toContain("Secure food");
    expect(entry.recap).toContain("Jack");
    expect(entry.recap).toContain("Kate");
    expect(entry.confessional.quote).toContain("Sawyer");
    expect(entry.confessional.quote).toContain("Sayid");
    const speaker = world.agents.find((agent) => agent.name === entry.confessional.name);
    expect(speaker?.status).not.toBe("dead");
  }, 15000);

  it("gives ballot-heavy days a grouped council line and an exile confessional from the living", () => {
    const world = makeFallbackWorld(67);
    const events: SimEvent[] = [
      { kind: "vote-called", tick: 20 },
      { kind: "vote-cast", tick: 20, voterId: "agent-0", targetId: "agent-5" },
      { kind: "vote-cast", tick: 20, voterId: "agent-1", targetId: "agent-5" },
      { kind: "vote-cast", tick: 20, voterId: "agent-3", targetId: "agent-5" },
      { kind: "vote-cast", tick: 20, voterId: "agent-6", targetId: "agent-5" },
      { kind: "exile-started", tick: 21, agentId: "agent-5", location: "H8", returnAtTick: 33, reason: "vote" },
    ];
    const entry = makeTemplateNarrator().narrate({
      world, day: 1, dayStartTick: 0, dayEndTick: 23,
      events: events.map((event, index) => ({ sequence: index + 1, event })),
    }) as NarrationEntry;
    expect(entry.recap).toContain("Sun");
    expect(entry.recap.toLowerCase()).toContain("ballot");
    expect(entry.headline.toLowerCase()).toContain("exile");
    expect(entry.confessional.name).toBe("Jack");
  }, 15000);
});
