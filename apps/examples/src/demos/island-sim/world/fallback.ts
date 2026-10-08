import { randomUUID } from "node:crypto";
import { Schema } from "effect";
import {
  WorldStateSchema,
  type AgentState,
  type ResourceNode,
  type Structure,
  type TerrainTile,
  type WorldState,
} from "./schema.js";
import { regrowthPolicyFor } from "../engine/resources.js";

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const tileId = (row: number, column: number): string => `${String.fromCharCode(65 + row)}${column + 1}`;

function chebyshev(left: string, right: string): number {
  return Math.max(
    Math.abs(left.charCodeAt(0) - right.charCodeAt(0)),
    Math.abs(Number(left.slice(1)) - Number(right.slice(1))),
  );
}

/** Seeded island archetype: lush, balanced, or rocky. Same seed, same character. */
function archetypeWeights(roll: number): { forest: number; grass: number; rock: number } {
  if (roll < 0.34) return { forest: 0.68, grass: 0.22, rock: 0.1 };
  if (roll < 0.67) return { forest: 0.45, grass: 0.35, rock: 0.2 };
  return { forest: 0.28, grass: 0.34, rock: 0.38 };
}

function terrainFor(seed: number, width: number, height: number, camp: string): TerrainTile[] {
  const random = makeRandom(seed);
  const weights = archetypeWeights(random());
  const terrain: TerrainTile[] = [];
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const tile = tileId(row, column);
      const edge = row === 0 || row === height - 1 || column === 0 || column === width - 1;
      const rim = row === 1 || row === height - 2 || column === 1 || column === width - 2;
      let biome: TerrainTile["biome"];
      if (edge) {
        biome = "ocean";
      } else if (tile === camp || chebyshev(tile, camp) <= 1) {
        biome = tile === camp ? "freshwater" : "grass";
      } else if (rim) {
        biome = "beach";
      } else {
        const roll = random();
        biome = roll < weights.forest ? "forest" : roll < weights.forest + weights.grass ? "grass" : "rock";
      }
      terrain.push({ tile, biome, elevation: Math.floor(random() * 8) + 1 });
    }
  }
  // Seed 1-2 extra freshwater ponds so every island holds at least two wells;
  // a single camp spring cannot water eight castaways and turns thirst fatal.
  const interiors = terrain.filter((t) =>
    t.biome !== "ocean" && t.tile !== camp && chebyshev(t.tile, camp) > 1,
  ).map((t) => ({ ...t }));
  const pondCount = 1 + Math.floor(random() * 2);
  for (let i = interiors.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [interiors[i], interiors[j]] = [interiors[j]!, interiors[i]!];
  }
  const ponds = new Set(interiors.slice(0, Math.min(pondCount, interiors.length)).map((t) => t.tile));
  return terrain.map((t) => ponds.has(t.tile) ? { ...t, biome: "freshwater" as const } : t);
}

const FOOD_KINDS = ["berries", "fish"] as const;

function placeResources(seed: number, terrain: TerrainTile[], camp: string): Array<Pick<ResourceNode, "kind" | "tile" | "quantity">> {
  const random = makeRandom(seed ^ 0x9e3779b9);
  const land = (biomes: readonly string[]) => terrain.filter((t) => biomes.includes(t.biome)).map((t) => t.tile);
  const shuffled = (tiles: string[]): string[] => {
    const copy = tiles.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
  };
  const qty = (min: number, max: number): number => min + Math.floor(random() * (max - min + 1));
  const placed: Array<Pick<ResourceNode, "kind" | "tile" | "quantity">> = [];
  const take = (kind: string, tiles: string[], count: number, min: number, max: number): void => {
    for (const tile of shuffled(tiles).slice(0, count)) {
      placed.push({ kind, tile, quantity: qty(min, max) });
    }
  };
  const forestGrass = land(["forest", "grass"]);
  const forest = land(["forest"]);
  const beach = land(["beach"]);
  const rock = land(["rock"]);
  const fresh = land(["freshwater"]);
  take("berries", forestGrass, 3, 6, 9);
  take("wood", forest.length > 0 ? forest : forestGrass, 2 + Math.floor(random() * 2), 4, 7);
  take("water", fresh.length > 0 ? fresh : [camp], 2, 6, 9);
  take("fish", beach, 2, 4, 6);
  take("stone", rock.length > 0 ? rock : land(["grass", "forest"]), 1, 3, 5);
  // Viability guard: food and water within two tiles of camp so no seed starts doomed.
  const near = (kind: readonly string[]) => placed.some((r) => kind.includes(r.kind as "berries") && chebyshev(r.tile, camp) <= 2);
  if (!near(FOOD_KINDS)) {
    const tile = shuffled(forestGrass).find((t) => chebyshev(t, camp) <= 2) ?? camp;
    placed.push({ kind: "berries", tile, quantity: qty(5, 8) });
  }
  if (!near(["water"])) {
    placed.push({ kind: "water", tile: camp, quantity: qty(6, 8) });
  }
  return placed;
}

const SECRET_POOL = [
  "goat tracks thread the high rocks; a patient hunter eats well",
  "an old signal mirror glints from the storm cellar",
  "the elders speak of a grove that fruits twice after rain",
  "a rusted radio hisses static from the tide caves",
] as const;

function secretsFor(seed: number, cacheTile: string): string[] {
  const random = makeRandom(seed ^ 0x27d4eb2f);
  const secrets = [
    "the northern spring is poisoned",
    `a cache is buried at ${cacheTile}`,
  ];
  const extra = SECRET_POOL[Math.floor(random() * SECRET_POOL.length)]!;
  secrets.push(extra);
  if (random() < 0.5) {
    const second = SECRET_POOL[Math.floor(random() * SECRET_POOL.length)]!;
    if (second !== extra) secrets.push(second);
  }
  return secrets;
}

function makeAgents(seed: number, spawnTiles: string[]): AgentState[] {
  const random = makeRandom(seed ^ 0x5f3759df);
  const names = ["Jack", "Kate", "Sawyer", "Hurley", "Sayid", "Sun", "Jin", "Locke"];
  return names.map((name, index) => ({
    id: `agent-${index}`,
    name,
    personality: {
      traits: [
        ["leader", "practical"],
        ["resourceful", "cautious"],
        ["opportunistic", "independent"],
        ["optimistic", "social"],
        ["methodical", "loyal"],
        ["empathetic", "observant"],
        ["hardworking", "reserved"],
        ["patient", "faithful"],
      ][index]!,
      riskTolerance: random(),
    },
    skills: {},
    needs: {
      hunger: Math.floor(random() * 3) + 2,
      thirst: Math.floor(random() * 3) + 2,
      energy: Math.floor(random() * 3) + 2,
    },
    goals: [],
    inventory: [],
    location: spawnTiles[index % spawnTiles.length]!,
    relationships: {},
    beliefs: [{ subject: "island role", claim: ["doctor", "scout", "forager", "morale keeper", "radio operator", "herbalist", "fisher", "tracker"][index]!, confidence: 1 }],
    memory: [],
    plan: [],
    status: "alive",
  }));
}

/**
 * Create a deterministic island whose character varies by seed: 7x7 to 9x9 shores,
 * lush/balanced/rocky archetypes, seeded resource spreads and starting weather, and a
 * rotating secret set. Constants per run: an outer ocean ring, a freshwater camp with a
 * grass spawn ring, nearby food plus water, and the poisoned-spring plus buried-cache secrets.
 */
export function makeFallbackWorld(seed: number, opts: { size?: number } = {}): WorldState {
  const random = makeRandom(seed ^ 0x1367b5ad);
  const width = opts.size ?? 7 + Math.floor(random() * 3);
  const height = opts.size ?? 7 + Math.floor(random() * 3);
  const camp = tileId(Math.floor(height / 2), Math.floor(width / 2));
  const terrain = terrainFor(seed, width, height, camp);
  const spawnTiles = terrain
    .filter((t) => chebyshev(t.tile, camp) <= 1 && t.biome !== "ocean")
    .map((t) => t.tile)
    .sort((a, b) => chebyshev(a, camp) - chebyshev(b, camp) || a.localeCompare(b));
  const resources: ResourceNode[] = placeResources(seed, terrain, camp).map((resource, index) => ({
    ...resource,
    id: `res-${index}`,
    regrowthPerDay: regrowthPolicyFor(resource.kind),
    initialQuantity: resource.quantity,
  }));
  const fireTile = spawnTiles.find((t) => t !== camp) ?? camp;
  const structures: Structure[] = [
    { id: "struct-0", kind: "camp", tile: camp, ownerId: undefined, durability: 10 },
    { id: "struct-1", kind: "fire-pit", tile: fireTile, ownerId: undefined, durability: 10 },
  ];
  if (random() < 0.4) {
    const leanTo = spawnTiles.find((t) => t !== camp && t !== fireTile);
    if (leanTo) structures.push({ id: "struct-2", kind: "shelter", tile: leanTo, ownerId: undefined, durability: 10 });
  }
  const weatherRoll = random();
  const weather = {
    condition: (weatherRoll < 0.6 ? "sunny" : weatherRoll < 0.85 ? "cloudy" : "rain") as "sunny" | "cloudy" | "rain",
    tempC: 22 + Math.floor(random() * 10),
  };
  const cacheTile = terrain
    .filter((t) => t.biome !== "ocean" && t.tile !== camp)
    .sort((a, b) => chebyshev(b.tile, camp) - chebyshev(a.tile, camp) || a.tile.localeCompare(b.tile))[0]?.tile ?? camp;
  const world = {
    id: randomUUID(),
    seed,
    clock: { tick: 0, day: 1, hour: 0 },
    island: { width, height },
    terrain,
    weather,
    resources,
    structures,
    agents: makeAgents(seed, spawnTiles),
    hidden: { secrets: secretsFor(seed, cacheTile) },
  };
  return Schema.decodeUnknownSync(WorldStateSchema)(world);
}
