// Run: bun test apps/examples/src/demos/island-sim/decision/target-criteria.test.ts --timeout 15000
import { describe, expect, it } from "bun:test";
import { makeFallbackWorld } from "../world/fallback.js";
import { perceive } from "../engine/perceive.js";
import { buildTargetChoices } from "./target-criteria.js";

describe("bounded judgment target choices", () => {
  it("keeps large visible target sets within the Ollama 2..26 choice limit", () => {
    const world = makeFallbackWorld(8);
    const initial = perceive(world, world.agents[0].id);
    const perception = {
      ...initial,
      self: {
        ...initial.self,
        needs: { hunger: 9, thirst: 9, energy: 8 },
        inventory: [{ kind: "berries", qty: 1 }, { kind: "water", qty: 1 }],
      },
      visibleResources: Array.from({ length: 40 }, (_, index) => ({
        id: `resource-${index}`,
        kind: index === 0 ? "berries" : index === 1 ? "water" : "wood",
        tile: `B${(index % 8) + 1}`,
        quantity: 1,
        regrowthPerDay: 1,
        initialQuantity: 1,
      })),
      visibleAgents: Array.from({ length: 20 }, (_, index) => ({
        id: `agent-visible-${index}`,
        name: `Survivor ${index}`,
        location: initial.self.location,
        status: "alive" as const,
        needs: { hunger: 5, thirst: 5, energy: 5 },
        inventory: [{ kind: "water", qty: 1 }],
      })),
    };
    const result = buildTargetChoices(perception);
    const count = Object.keys(result.criteria).length;

    expect(count).toBeGreaterThanOrEqual(2);
    expect(count).toBeLessThanOrEqual(26);
    expect(Object.values(result.targets)).toContain("resource-0");
    expect(Object.values(result.criteria).some((label) => label.startsWith("water at"))).toBe(true);
    expect(Object.keys(result.criteria).some((key) => key.startsWith("agent:"))).toBe(true);
    expect(Object.keys(result.criteria).some((key) => key.startsWith("tile:"))).toBe(true);
  }, 15000);

  it("always provides at least two distinct safe choices when perception has no targets", () => {
    const world = makeFallbackWorld(9);
    const initial = perceive(world, world.agents[0].id);
    const result = buildTargetChoices({
      ...initial,
      visibleResources: [],
      visibleAgents: [],
      visibleTiles: [],
      self: { ...initial.self, inventory: [] },
    });

    expect(Object.keys(result.criteria).length).toBeGreaterThanOrEqual(2);
    expect(new Set(Object.keys(result.criteria)).size).toBe(Object.keys(result.criteria).length);
    expect(result.targets).toHaveProperty("none");
    expect(result.targets).toHaveProperty("here");
  }, 15000);

  it("offers only adjacent survivors as social-action targets", () => {
    const world = makeFallbackWorld(10);
    const initial = perceive(world, world.agents[0].id);
    const distantAgent = { ...initial.visibleAgents[0], location: "H8" };
    const result = buildTargetChoices({
      ...initial,
      visibleResources: [],
      visibleTiles: [],
      visibleAgents: [distantAgent],
      self: { ...initial.self, location: "A1", inventory: [] },
    });

    expect(Object.values(result.targets)).not.toContain(distantAgent.id);
  }, 15000);
});
