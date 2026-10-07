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
    expect(entry.confessional.name.length).toBeGreaterThan(0);
    expect(entry.confessional.quote.length).toBeGreaterThan(0);
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
});
