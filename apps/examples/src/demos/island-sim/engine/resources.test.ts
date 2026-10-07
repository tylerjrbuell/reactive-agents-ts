// Run: bun test apps/examples/src/demos/island-sim/engine/resources.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { makeFallbackWorld } from "../world/fallback.js";
import { regrowResources } from "./resources.js";

describe("resource scarcity", () => {
  it("regrows renewable kinds by their per-day rate without exceeding the initial stock", () => {
    const world = makeFallbackWorld(40);
    const drained = {
      ...world,
      resources: world.resources.map((node) => ({ ...node, quantity: 0 })),
    };
    const after = regrowResources(drained, 1);
    for (const node of after.resources) {
      const expected = Math.min(node.initialQuantity, node.regrowthPerDay);
      expect(node.quantity).toBe(expected);
    }
  });

  it("never regrows non-renewable wood and stone", () => {
    const world = makeFallbackWorld(41);
    for (const kind of ["wood", "stone"]) {
      const nodes = world.resources.filter((node) => node.kind === kind);
      expect(nodes.length).toBeGreaterThan(0);
      for (const node of nodes) expect(node.regrowthPerDay).toBe(0);
    }
  });

  it("keeps renewable regrowth modest, never above three per day", () => {
    const world = makeFallbackWorld(42);
    for (const node of world.resources) {
      if (node.regrowthPerDay > 0) expect(node.regrowthPerDay).toBeLessThanOrEqual(3);
    }
  });

  it("does not regrow under storm conditions that day", () => {
    const world = makeFallbackWorld(43);
    const drained = {
      ...world,
      weather: { ...world.weather, condition: "storm" as const },
      resources: world.resources.map((node) => ({ ...node, quantity: 1 })),
    };
    const after = regrowResources(drained, 1);
    for (const node of after.resources) {
      if (node.kind === "wood" || node.kind === "stone") continue;
      expect(node.quantity).toBe(1);
    }
  });
});
