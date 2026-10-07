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

  it("names the salient moments: deaths, pacts, exile, and twists", () => {
    const world = makeFallbackWorld(64);
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
});
