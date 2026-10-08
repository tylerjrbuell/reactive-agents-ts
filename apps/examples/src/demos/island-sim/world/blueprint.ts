import { Schema } from "effect";
import { makeFallbackWorld } from "./fallback.js";
import { parseWorld, WeatherSchema, type WorldState } from "./schema.js";

/** Small model-generated creative inputs expanded into a complete deterministic world. */
export const WorldBlueprintSchema = Schema.Struct({
  weather: WeatherSchema,
  terrainRows: Schema.Array(Schema.String),
  secrets: Schema.Array(Schema.String),
});

type WorldBlueprint = typeof WorldBlueprintSchema.Type;

const BIOME_CODES = {
  O: "ocean",
  B: "beach",
  F: "forest",
  G: "grass",
  R: "rock",
  W: "freshwater",
} as const;

const CAMP_TILES = new Set(["C3", "C4", "D3", "D4", "E3", "E4", "C5", "D5"]);
const SAFE_ROUTE_TILES = new Set(["B4", "C4", "D4", "E4", "F4", "G4"]);

function parseBlueprint(input: unknown): WorldBlueprint | undefined {
  try {
    const blueprint = Schema.decodeUnknownSync(WorldBlueprintSchema)(input);
    if (blueprint.terrainRows.length !== 8 || blueprint.secrets.filter((secret) => secret.trim().length > 0).length < 2) {
      return undefined;
    }
    if (blueprint.terrainRows.some((row) =>
      row.length === 0 || !Array.from(row.slice(0, 8)).some((code) => code in BIOME_CODES),
    )) {
      return undefined;
    }
    return blueprint;
  } catch {
    return undefined;
  }
}

/** Expand an Ollama blueprint into a complete, schema-validated 8x8 simulation world. */
export function worldFromBlueprint(seed: number, input: unknown): WorldState | undefined {
  const blueprint = parseBlueprint(input);
  if (!blueprint) return undefined;
  const base = makeFallbackWorld(seed, { size: 8 });
  const terrain = base.terrain.map((tile) => {
    const row = tile.tile.charCodeAt(0) - 65;
    const column = Number(tile.tile.slice(1)) - 1;
    const code = blueprint.terrainRows[row]?.[column];
    const proposedBiome = code && code in BIOME_CODES
      ? BIOME_CODES[code as keyof typeof BIOME_CODES]
      : tile.biome;
    const outerEdge = row === 0 || row === 7 || column === 0 || column === 7;
    const biome = outerEdge
      ? "ocean"
      : tile.tile === "D4"
        ? "freshwater"
        : (CAMP_TILES.has(tile.tile) || SAFE_ROUTE_TILES.has(tile.tile)) && proposedBiome === "ocean"
          ? "grass"
          : proposedBiome;
    return { ...tile, biome };
  });
  const landTiles = terrain.filter((tile) => tile.biome !== "ocean").map((tile) => tile.tile);
  const nearestLand = (tileId: string) => landTiles
    .slice()
    .sort((left, right) => {
      const distanceFrom = (candidate: string) => Math.max(
        Math.abs(candidate.charCodeAt(0) - tileId.charCodeAt(0)),
        Math.abs(Number(candidate.slice(1)) - Number(tileId.slice(1))),
      );
      return distanceFrom(left) - distanceFrom(right) || left.localeCompare(right);
    })[0] ?? "D4";
  const candidate = {
    ...base,
    terrain,
    resources: base.resources.map((resource) =>
      terrain.find((tile) => tile.tile === resource.tile)?.biome === "ocean"
        ? { ...resource, tile: nearestLand(resource.tile) }
        : resource,
    ),
    structures: base.structures.map((structure) =>
      terrain.find((tile) => tile.tile === structure.tile)?.biome === "ocean"
        ? { ...structure, tile: nearestLand(structure.tile) }
        : structure,
    ),
    weather: blueprint.weather,
    hidden: {
      secrets: blueprint.secrets.map((secret) => secret.trim()).filter((secret) => secret.length > 0).slice(0, 5),
    },
  };
  return parseWorld(candidate);
}
