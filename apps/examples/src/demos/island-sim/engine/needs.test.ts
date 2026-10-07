// Run: bun test apps/examples/src/demos/island-sim/engine/needs.test.ts --timeout 15000
import { describe, expect, it } from "bun:test";
import { makeFallbackWorld } from "../world/fallback.js";
import { decayNeeds } from "./needs.js";

describe("need balance", () => {
  it("keeps fallback characters alive through the first 20 simulation hours", async () => {
    let world = makeFallbackWorld(2026);
    for (let tick = 0; tick < 20; tick++) {
      const agents = world.agents.map((agent) => ({
        ...decayNeeds(agent, world.weather, tick),
        status: "alive" as const,
      }));
      world = { ...world, agents };
    }
    expect(world.agents.every((agent) => agent.needs.hunger < 10)).toBe(true);
    expect(world.agents.every((agent) => agent.needs.thirst < 10)).toBe(true);
    expect(world.agents.every((agent) => agent.needs.energy > 0)).toBe(true);
  }, 15000);

  it("caps hunger and thirst at the shared fatal threshold", () => {
    const world = makeFallbackWorld(2026);
    const agent = {
      ...world.agents[0],
      needs: { hunger: 10, thirst: 10, energy: 8 },
    };
    const updated = decayNeeds(agent, world.weather, 0);
    expect(updated.needs.hunger).toBe(10);
    expect(updated.needs.thirst).toBe(10);
  }, 15000);

  it("models fatigue from exertion and makes storms more tiring", () => {
    const world = makeFallbackWorld(2026);
    const agent = world.agents[0]!;
    const resting = decayNeeds(agent, { condition: "sunny", tempC: 24 }, 1, false);
    const active = decayNeeds(agent, { condition: "sunny", tempC: 24 }, 1, true);
    const stormActive = decayNeeds(agent, { condition: "storm", tempC: 18 }, 1, true);

    expect(resting.needs.energy).toBe(agent.needs.energy);
    expect(active.needs.energy).toBe(agent.needs.energy + 1);
    expect(stormActive.needs.energy).toBe(agent.needs.energy + 2);
  }, 15000);
});
