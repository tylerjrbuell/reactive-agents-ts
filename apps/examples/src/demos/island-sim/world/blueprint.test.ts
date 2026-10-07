// Run: bun test apps/examples/src/demos/island-sim/world/blueprint.test.ts --timeout 15000
import { describe, expect, it } from "bun:test";
import { parseWorld } from "./schema.js";
import { worldFromBlueprint } from "./blueprint.js";

const makeBlueprint = () => ({
  weather: { condition: "rain", tempC: 22 },
  terrainRows: [
    "OOOOOOOO",
    "OBGBGFBBO",
    "OBGFWFGFBO",
    "OBGRWRGBBO",
    "OBFGWWGFBO",
    "OBFGWGFBO",
    "OBGFGFBBO",
    "OOOOOOOO",
  ],
  secrets: ["A hidden stream runs below the camp.", "The old radio repeats at dusk."],
});

describe("compact Ollama world blueprint", () => {
  it("expands model terrain rows into a valid 8x8 world while keeping survivor routes safe", () => {
    const world = worldFromBlueprint(31, makeBlueprint());

    expect(world).toBeDefined();
    expect(parseWorld(world)).toBeDefined();
    expect(world?.terrain).toHaveLength(64);
    expect(world?.island).toEqual({ width: 8, height: 8 });
    expect(world?.weather).toEqual({ condition: "rain", tempC: 22 });
    expect(world?.hidden.secrets).toEqual(makeBlueprint().secrets);
    expect(world?.agents.every((agent) => world.terrain.find((tile) => tile.tile === agent.location)?.biome !== "ocean")).toBe(true);
    expect(world?.resources.every((resource) => world.terrain.find((tile) => tile.tile === resource.tile)?.biome !== "ocean")).toBe(true);
    expect(world?.structures.every((structure) => world.terrain.find((tile) => tile.tile === structure.tile)?.biome !== "ocean")).toBe(true);
    expect(world?.terrain.find((tile) => tile.tile === "D4")?.biome).toBe("freshwater");
  }, 15000);

  it("rejects incomplete blueprint row sets and falls back for unsupported biome codes", () => {
    const incomplete = { ...makeBlueprint(), terrainRows: ["OOOOOOOO"] };
    const invalidCode = { ...makeBlueprint(), terrainRows: ["OOOOOOOO", "OBGXGFBBO", ...makeBlueprint().terrainRows.slice(2)] };

    expect(worldFromBlueprint(32, incomplete)).toBeUndefined();
    const normalized = worldFromBlueprint(32, invalidCode);
    expect(normalized).toBeDefined();
    expect(normalized?.terrain.find((tile) => tile.tile === "B4")?.biome).toBe("beach");
  }, 15000);

  it("fills omitted trailing row cells from the deterministic land template", () => {
    const blueprint = makeBlueprint();
    blueprint.terrainRows[3] = blueprint.terrainRows[3].slice(0, 7);
    const world = worldFromBlueprint(33, blueprint);

    expect(world).toBeDefined();
    expect(parseWorld(world)).toBeDefined();
    expect(world?.terrain).toHaveLength(64);
  }, 15000);
});
