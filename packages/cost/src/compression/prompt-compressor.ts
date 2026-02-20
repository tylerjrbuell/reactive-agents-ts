import { Effect } from "effect";
import { CostTrackingError } from "../errors.js";

export interface PromptCompressor {
  readonly compress: (
    prompt: string,
    maxTokens?: number,
  ) => Effect.Effect<{ compressed: string; savedTokens: number }, CostTrackingError>;
}

/**
 * Tier 1: Heuristic prompt compression (no LLM calls).
 * Removes redundant whitespace, blank lines, and repeated patterns.
 * Tier 2 will add LLM-based summarization for large contexts.
 */
export const makePromptCompressor = Effect.succeed({
  compress: (
    prompt: string,
    _maxTokens?: number,
  ): Effect.Effect<{ compressed: string; savedTokens: number }, CostTrackingError> =>
    Effect.try({
      try: () => {
        const originalTokens = Math.ceil(prompt.length / 4);

        // Skip compression for short prompts
        if (originalTokens < 500) {
          return { compressed: prompt, savedTokens: 0 };
        }

        // Heuristic compression
        let compressed = prompt
          .replace(/\n{3,}/g, "\n\n")       // Collapse multiple newlines
          .replace(/[ \t]{2,}/g, " ")        // Collapse multiple spaces
          .replace(/^\s+$/gm, "")            // Remove blank lines
          .replace(/\n\s*\n\s*\n/g, "\n\n"); // Clean up remaining multi-blanks

        const compressedTokens = Math.ceil(compressed.length / 4);

        return {
          compressed,
          savedTokens: originalTokens - compressedTokens,
        };
      },
      catch: (e) => new CostTrackingError({ message: "Prompt compression failed", cause: e }),
    }),
} satisfies PromptCompressor);
