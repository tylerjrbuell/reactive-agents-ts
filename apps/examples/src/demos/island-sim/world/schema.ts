import { Schema, Number, String, Literal, Struct, Array as SchemaArray, Optional } from "effect";

// Biome literals
export const Biome = Literal(
  "ocean",
  "beach",
  "forest",
  "grass",
  "rock",
  "freshwater"
);
// Weather condition literals (simplified)
export const WeatherCondition = Literal(
  "sunny",
  "rain",
  "storm",
  "cloudy"
);

// Simple needs schema (0..10 inclusive)
export const NeedsSchema = Struct({
  hunger: Number.pipe(Number.greaterThanOrEqualTo(0), Number.lessThanOrEqualTo(10)),
  thirst: Number.pipe(Number.greaterThanOrEqualTo(0), Number.lessThanOrEqualTo(10)),
  energy: Number.pipe(Number.greaterThanOrEqualTo(0), Number.lessThanOrEqualTo(10)),
});

export type Needs = typeof NeedsSchema.Type;

export const ActionType = Literal(
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

export const ActionRequestSchema = Struct({
  type: ActionType,
  target: Optional(String),
});
export type ActionRequest = typeof ActionRequestSchema.Type;

export const AgentStateSchema = Struct({
  id: String,
  name: String,
  personality: Struct({
    traits: SchemaArray(String),
    riskTolerance: Number,
  }),
  skills: Schema.struct({}), // free-form map of skill name -> level
  needs: NeedsSchema,
  goals: SchemaArray(String),
  inventory: SchemaArray(Struct({ kind: String, qty: Number })),
  location: String,
  relationships: Schema.struct({}), // map of agentId -> { trust: Number, lastInteraction: Number }
  beliefs: SchemaArray(Struct({ subject: String, claim: String, confidence: Number })),
  memory: SchemaArray(Struct({ tick: Number, text: String })),
  plan: SchemaArray(String),
  status: Literal("alive", "injured", "ill", "dead"),
});
export type AgentState = typeof AgentStateSchema.Type;

export const TerrainTileSchema = Struct({
  tile: String,
  biome: Biome,
  elevation: Number,
});
export type TerrainTile = typeof TerrainTileSchema.Type;

export const WeatherSchema = Struct({
  condition: WeatherCondition,
  tempC: Number,
});
export type Weather = typeof WeatherSchema.Type;

export const ResourceNodeSchema = Struct({
  id: String,
  kind: String,
  tile: String,
  quantity: Number,
  regrowthPerDay: Number,
  initialQuantity: Number,
});
export type ResourceNode = typeof ResourceNodeSchema.Type;

export const StructureSchema = Struct({
  id: String,
  kind: String,
  tile: String,
  ownerId: Optional(String),
  durability: Number,
});
export type Structure = typeof StructureSchema.Type;

export const HiddenFactsSchema = Struct({
  secrets: SchemaArray(String),
});
export type HiddenFacts = typeof HiddenFactsSchema.Type;

export const WorldStateSchema = Struct({
  id: String,
  seed: Number,
  clock: Struct({ tick: Number, day: Number, hour: Number }),
  island: Struct({ width: Number, height: Number }),
  terrain: SchemaArray(TerrainTileSchema),
  weather: WeatherSchema,
  resources: SchemaArray(ResourceNodeSchema),
  structures: SchemaArray(StructureSchema),
  agents: SchemaArray(AgentStateSchema),
  hidden: HiddenFactsSchema,
});
export type WorldState = typeof WorldStateSchema.Type;

/** Parse an unknown value into a WorldState. Returns undefined on schema failure. */
export function parseWorld(input: unknown): WorldState | undefined {
  try {
    const result = Schema.decodeUnknownSync(WorldStateSchema)(input as any);
    return result as WorldState;
  } catch {
    return undefined;
  }
}
