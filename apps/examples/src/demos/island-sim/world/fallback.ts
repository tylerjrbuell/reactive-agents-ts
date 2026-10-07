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

const CAMP_TILES = ["C3", "C4", "D3", "D4", "E3", "E4", "C5", "D5"] as const;
const RESOURCES: ReadonlyArray<Pick<ResourceNode, "kind" | "tile" | "quantity">> = [
  { kind: "berries", tile: "C3", quantity: 8 },
  { kind: "wood", tile: "D3", quantity: 6 },
  { kind: "water", tile: "D4", quantity: 8 },
  { kind: "fish", tile: "B4", quantity: 4 },
  { kind: "stone", tile: "E3", quantity: 4 },
  { kind: "berries", tile: "F4", quantity: 8 },
  { kind: "water", tile: "E4", quantity: 8 },
  { kind: "wood", tile: "C5", quantity: 5 },
  { kind: "fish", tile: "G4", quantity: 3 },
  { kind: "berries", tile: "D5", quantity: 8 },
];

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function terrainFor(seed: number): TerrainTile[] {
  const random = makeRandom(seed);
  const terrain: TerrainTile[] = [];
  for (let row = 0; row < 8; row += 1) {
    for (let column = 1; column <= 8; column += 1) {
      const tile = `${String.fromCharCode(65 + row)}${column}`;
      const edge = row === 0 || row === 7 || column === 1 || column === 8;
      const rim = row === 1 || row === 6 || column === 2 || column === 7;
      const biome = edge
        ? "ocean"
        : tile === "D4"
          ? "freshwater"
          : tile === "B4" || rim
            ? "beach"
            : random() < 0.58
              ? "forest"
              : random() < 0.5
                ? "grass"
                : "rock";
      terrain.push({ tile, biome, elevation: Math.floor(random() * 8) + 1 });
    }
  }
  return terrain;
}

function makeAgents(seed: number): AgentState[] {
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
    location: CAMP_TILES[index]!,
    relationships: {},
    beliefs: [{ subject: "island role", claim: ["doctor", "scout", "forager", "morale keeper", "radio operator", "herbalist", "fisher", "tracker"][index]!, confidence: 1 }],
    memory: [],
    plan: [],
    status: "alive",
  }));
}

/** Create a deterministic, clustered 8x8 island with a safe camp, resource routes, and recognizable castaways. */
export function makeFallbackWorld(seed: number): WorldState {
  const terrain = terrainFor(seed);
  const resources: ResourceNode[] = RESOURCES.map((resource, index) => ({
    ...resource,
    id: `res-${index}`,
    regrowthPerDay: ["berries", "water", "fish"].includes(resource.kind) ? 4 : 1,
    initialQuantity: resource.quantity,
  }));
  const structures: Structure[] = [
    { id: "struct-0", kind: "camp", tile: "D4", ownerId: undefined, durability: 10 },
    { id: "struct-1", kind: "fire-pit", tile: "D3", ownerId: undefined, durability: 10 },
  ];
  const world = {
    id: randomUUID(),
    seed,
    clock: { tick: 0, day: 1, hour: 0 },
    island: { width: 8, height: 8 },
    terrain,
    weather: { condition: "sunny", tempC: 25 },
    resources,
    structures,
    agents: makeAgents(seed),
    hidden: { secrets: ["the northern spring is poisoned", "a cache is buried at D4"] },
  };
  return Schema.decodeUnknownSync(WorldStateSchema)(world);
}
