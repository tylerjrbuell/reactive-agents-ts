// Run: bun test apps/examples/src/demos/island-sim/world/variance.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { makeFallbackWorld } from "./fallback.js";

const dist = (a: string, b: string) =>
  Math.max(Math.abs(a.charCodeAt(0) - b.charCodeAt(0)), Math.abs(Number(a.slice(1)) - Number(b.slice(1))));

describe("fallback world variance", () => {
  it("is deterministic for the same seed", () => {
    const left = JSON.stringify({ ...makeFallbackWorld(777), id: "x" });
    const right = JSON.stringify({ ...makeFallbackWorld(777), id: "x" });
    expect(left).toBe(right);
  }, 15000);
  it("varies island size across seeds while staying an island", () => {
    const sizes = new Set<string>();
    for (let seed = 1; seed <= 12; seed += 1) {
      const world = makeFallbackWorld(seed);
      sizes.add(`${world.island.width}x${world.island.height}`);
      expect(world.island.width).toBeGreaterThanOrEqual(7);
      expect(world.island.width).toBeLessThanOrEqual(9);
      expect(world.island.height).toBeGreaterThanOrEqual(7);
      expect(world.island.height).toBeLessThanOrEqual(9);
      expect(world.terrain.length).toBe(world.island.width * world.island.height);
      for (const tile of world.terrain) {
        const row = tile.tile.charCodeAt(0) - 65;
        const col = Number(tile.tile.slice(1));
        const edge = row === 0 || row === world.island.height - 1 || col === 1 || col === world.island.width;
        if (edge) expect(tile.biome).toBe("ocean");
      }
    }
    expect(sizes.size).toBeGreaterThan(1);
  }, 15000);
  it("keeps camp on freshwater with land spawn ring and food plus water nearby", () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const world = makeFallbackWorld(seed);
      const camp = world.structures.find((s) => s.kind === "camp")!;
      expect(camp).toBeDefined();
      expect(world.terrain.find((t) => t.tile === camp.tile)?.biome).toBe("freshwater");
      for (const agent of world.agents) {
        expect(world.terrain.find((t) => t.tile === agent.location)?.biome).not.toBe("ocean");
      }
      const near = world.resources.filter((r) => r.quantity > 0 && dist(r.tile, camp.tile) <= 2);
      expect(near.some((r) => ["berries", "fish"].includes(r.kind))).toBe(true);
      expect(near.some((r) => r.kind === "water")).toBe(true);
    }
  }, 15000);
  it("varies resource counts and quantities across seeds", () => {
    const signatures = new Set<string>();
    for (let seed = 1; seed <= 12; seed += 1) {
      const world = makeFallbackWorld(seed);
      signatures.add(world.resources.map((r) => `${r.kind}@${r.tile}x${r.quantity}`).sort().join("|"));
    }
    expect(signatures.size).toBeGreaterThan(1);
  }, 15000);
  it("always seeds the poisoned-spring and buried-cache secrets", () => {
    for (let seed = 1; seed <= 6; seed += 1) {
      const secrets = makeFallbackWorld(seed).hidden.secrets.join(" ").toLowerCase();
      expect(secrets).toContain("poison");
      expect(secrets).toContain("cache");
    }
  }, 15000);
});
