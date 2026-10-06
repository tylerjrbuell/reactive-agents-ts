import { WorldState } from "../world/schema.js";
import { parseWorld } from "./schema.js";
import { makeFallbackWorld } from "./fallback.js";

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
          const result = await agent.run(`Generate a world with seed ${seed}.`);
          if (result.objectError) {
            continue;
          }
          const maybeWorld = parseWorld(result.object);
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