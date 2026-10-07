import { WorldState } from "../world/schema.js";
import { parseWorld } from "./schema.js";
import { makeFallbackWorld } from "./fallback.js";
import { worldFromBlueprint } from "./blueprint.js";

/** Agent-like interface for structured output. */
export interface StructuredAgentLike {
  run(input: string): Promise<{ object?: unknown; objectError?: string }>;
}

/** Result of a world generation attempt. */
export interface GenerationResult {
  world: WorldState;
  source: "llm" | "fallback";
  attempts: number;
}

/** World generator that attempts to get a structured world from an agent, with fallback. */
export interface WorldGenerator {
  generate(seed: number): Promise<GenerationResult>;
}

/**
 * Creates a world generator from a structured agent.
 * @param agent The structured agent.
 * @param opts Optional configuration (maxAttempts, fallback function).
 */
export function makeLlmWorldGenerator(
  agent: StructuredAgentLike,
  opts: { maxAttempts?: number; fallback?: (seed: number) => WorldState } = {}
): WorldGenerator {
  const maxAttempts = opts.maxAttempts ?? 3;
  const fallback = opts.fallback ?? makeFallbackWorld;
  return {
    async generate(seed) {
      let attempts = 0;
      while (attempts < maxAttempts) {
        attempts++;
        try {
          const result = await agent.run(
            `Create a compact 8x8 island-survival blueprint for deterministic seed ${seed}. ` +
            `Return JSON with weather {condition: sunny|rain|storm|cloudy, tempC: number}, ` +
            `terrainRows: exactly 8 strings of 8 codes using O ocean, B beach, F forest, G grass, R rock, W freshwater, ` +
            `and at least two short secrets. Keep the outer row and column ocean; put fresh water near D4; ` +
            `make inner shore and camp routes mostly traversable. Do not include agents or resources.`,
          );
          if (result.objectError) {
            continue;
          }
          const maybeWorld = parseWorld(result.object) ?? worldFromBlueprint(seed, result.object);
          if (maybeWorld !== undefined) {
            return { world: maybeWorld, source: "llm", attempts };
          }
          // parse failed, continue loop
        } catch (err) {
          // On error, break out of retry loop and go to fallback.
          break;
        }
      }
      // Exhausted attempts or error: use fallback.
      const world = fallback(seed);
      return { world, source: "fallback", attempts };
    },
  };
}
