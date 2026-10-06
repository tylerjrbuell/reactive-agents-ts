import { WorldState, WorldStateSchema, AgentState, ResourceNode, Structure, TerrainTile, HiddenFacts } from "./schema.js";
import { randomUUID } from "node:crypto";

/** Simple deterministic 12x12 island generator for demo purposes. */
export function makeFallbackWorld(seed: number): WorldState {
  // deterministic simple RNG (linear congruential) for world generation only
  const rng = (function* () {
    let s = seed;
    while (true) {
      s = (s * 1664525 + 1013904223) % 0x100000000;
      yield s / 0xffffffff;
    }
  })();
  const rand = () => rng.next().value as number;

  const width = 12;
  const height = 12;
  const terrain: TerrainTile[] = [];
  const biomes = ["ocean", "beach", "forest", "grass", "rock", "freshwater"] as const;
  for (let r = 0; r < height; r++) {
    const rowLetter = String.fromCharCode(65 + r);
    for (let c = 1; c <= width; c++) {
      const tileId = `${rowLetter}${c}`;
      const biome = biomes[Math.floor(rand() * biomes.length)];
      const elevation = Math.floor(rand() * 10);
      terrain.push({ tile: tileId, biome, elevation });
    }
  }

  // Simple resource nodes (berries, fish, wood, stone, water)
  const resourceKinds = ["berries", "fish", "wood", "stone", "water"] as const;
  const resources: ResourceNode[] = [];
  for (let i = 0; i < 10; i++) {
    const tile = terrain[Math.floor(rand() * terrain.length)].tile;
    const kind = resourceKinds[Math.floor(rand() * resourceKinds.length)];
    const qty = Math.floor(rand() * 5) + 1;
    const id = `res-${i}`;
    resources.push({ id, kind, tile, quantity: qty, regrowthPerDay: 1, initialQuantity: qty });
  }

  // Simple structures (lean-to, fire pit)
  const structures: Structure[] = [];
  for (let i = 0; i < 2; i++) {
    const tile = terrain[Math.floor(rand() * terrain.length)].tile;
    structures.push({ id: `struct-${i}`, kind: i === 0 ? "lean-to" : "fire-pit", tile, ownerId: undefined, durability: 10 });
  }

  // Create 8 agents with deterministic names and locations
  const agents: AgentState[] = [];
  const agentNames = ["Mira", "Kell", "Orin", "Jade", "Lio", "Nia", "Bren", "Tara"];
  for (let i = 0; i < 8; i++) {
    const locTile = terrain[Math.floor(rand() * terrain.length)].tile;
    const id = `agent-${i}`;
    const needs = { hunger: Math.floor(rand() * 5) + 5, thirst: Math.floor(rand() * 5) + 5, energy: Math.floor(rand() * 5) + 5 };
    agents.push({
      id,
      name: agentNames[i],
      personality: { traits: ["cautious", "practical"], riskTolerance: rand() },
      skills: {},
      needs,
      goals: [],
      inventory: [],
      location: locTile,
      relationships: {},
      beliefs: [],
      memory: [],
      plan: [],
      status: "alive",
    });
  }

  const hidden: HiddenFacts = { secrets: ["the northern spring is poisoned", "a cache is buried at D4"] };

  return {
    id: randomUUID(),
    seed,
    clock: { tick: 0, day: 1, hour: 0 },
    island: { width, height },
    terrain,
    weather: { condition: "sunny", tempC: 25 },
    resources,
    structures,
    agents,
    hidden,
  } as any;
}
