import { Schema } from "effect";

// Biome literals
export const Biome = Schema.Literal(
  "ocean",
  "beach",
  "forest",
  "grass",
  "rock",
  "freshwater"
);
// Weather condition literals (simplified)
export const WeatherCondition = Schema.Literal(
  "sunny",
  "rain",
  "storm",
  "cloudy"
);

// Simple needs schema (0..10 inclusive)
export const NeedsSchema = Schema.Struct({
  hunger: Schema.Number,
  thirst: Schema.Number,
  energy: Schema.Number,
});
export type Needs = typeof NeedsSchema.Type;

export const ActionType = Schema.Literal(
  "move",
  "gather",
  "hunt",
  "build",
  "craft",
  "eat",
  "drink",
  "rest",
  "trade",
  "share",
  "talk",
  "inspect"
);
export type ActionType = typeof ActionType.Type;

export const ActionRequestSchema = Schema.Struct({
  type: ActionType,
  target: Schema.optional(Schema.String),
});
export type ActionRequest = typeof ActionRequestSchema.Type;

export const AgentStateSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  personality: Schema.Struct({
    traits: Schema.Array(Schema.String),
    riskTolerance: Schema.Number,
  }),
  skills: Schema.Record({ key: Schema.String, value: Schema.Number }),
  needs: NeedsSchema,
  goals: Schema.Array(Schema.String),
  inventory: Schema.Array(Schema.Struct({ kind: Schema.String, qty: Schema.Number })),
  location: Schema.String,
  relationships: Schema.Record({ key: Schema.String, value: Schema.Struct({ trust: Schema.Number, lastInteraction: Schema.Number }) }),
  beliefs: Schema.Array(Schema.Struct({ subject: Schema.String, claim: Schema.String, confidence: Schema.Number })),
  memory: Schema.Array(Schema.Struct({ tick: Schema.Number, text: Schema.String })),
  plan: Schema.Array(Schema.String),
  status: Schema.Literal("alive", "injured", "ill", "dead"),
});
export type AgentState = typeof AgentStateSchema.Type;

export const TerrainTileSchema = Schema.Struct({
  tile: Schema.String,
  biome: Biome,
  elevation: Schema.Number,
});
export type TerrainTile = typeof TerrainTileSchema.Type;

export const WeatherSchema = Schema.Struct({
  condition: WeatherCondition,
  tempC: Schema.Number,
});
export type Weather = typeof WeatherSchema.Type;

export const ResourceNodeSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  tile: Schema.String,
  quantity: Schema.Number,
  regrowthPerDay: Schema.Number,
  initialQuantity: Schema.Number,
});
export type ResourceNode = typeof ResourceNodeSchema.Type;

export const StructureSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  tile: Schema.String,
  ownerId: Schema.optional(Schema.String),
  durability: Schema.Number,
});
export type Structure = typeof StructureSchema.Type;

export const HiddenFactsSchema = Schema.Struct({
  secrets: Schema.Array(Schema.String),
});
export type HiddenFacts = typeof HiddenFactsSchema.Type;

export const WorldStateSchema = Schema.Struct({
  id: Schema.String,
  seed: Schema.Number,
  clock: Schema.Struct({ tick: Schema.Number, day: Schema.Number, hour: Schema.Number }),
  island: Schema.Struct({ width: Schema.Number, height: Schema.Number }),
  terrain: Schema.Array(TerrainTileSchema),
  weather: WeatherSchema,
  resources: Schema.Array(ResourceNodeSchema),
  structures: Schema.Array(StructureSchema),
  agents: Schema.Array(AgentStateSchema),
  hidden: HiddenFactsSchema,
});
export type WorldState = typeof WorldStateSchema.Type;

/** Parse an unknown value into a WorldState. Returns undefined on schema failure. */
export function parseWorld(input: unknown): WorldState | undefined {
  try {
    const result = Schema.decodeUnknownSync(WorldStateSchema)(input as any);
    // Validate that each agent's needs are non-negative
    const ws = result as WorldState;
    for (const a of ws.agents) {
      if (a.needs.hunger < 0 || a.needs.thirst < 0 || a.needs.energy < 0) {
        return undefined;
      }
    }
    return ws as WorldState;
  } catch {
    return undefined;
  }
}
