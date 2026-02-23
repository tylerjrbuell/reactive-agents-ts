import { Effect } from "effect";
import { CostTrackingError } from "../errors.js";

// Type-only interface for optional LLM dependency (avoids import coupling)
type LLMServiceLike = {
  complete: (req: any) => Effect.Effect<{ content: string }, any>;
};

export interface PromptCompressor {
  readonly compress: (
    prompt: string,
    maxTokens?: number,
  ) => Effect.Effect<{ compressed: string; savedTokens: number }, CostTrackingError>;
}

const HEURISTIC_MIN_TOKENS = 500;

function heuristicCompress(prompt: string): { compressed: string; savedTokens: number } {
  const originalTokens = Math.ceil(prompt.length / 4);
  const compressed = prompt
    .replace(/\n{3,}/g, "\n\n")       // Collapse multiple newlines
    .replace(/[ \t]{2,}/g, " ")        // Collapse multiple spaces
    .replace(/^\s+$/gm, "")            // Remove blank lines
    .replace(/\n\s*\n\s*\n/g, "\n\n"); // Clean up remaining multi-blanks
  const compressedTokens = Math.ceil(compressed.length / 4);
  return { compressed, savedTokens: originalTokens - compressedTokens };
}

/**
 * Factory for PromptCompressor.
 *
 * Tier 1 (default): Heuristic whitespace/blank-line removal. Always runs.
 * Tier 2 (with `llm`): After heuristic pass, if the result still exceeds
 *   `maxTokens`, calls an LLM to further summarize/compress while preserving
 *   key information. Falls back to heuristic result on any LLM error.
 */
export const makePromptCompressor = (llm?: LLMServiceLike): Effect.Effect<PromptCompressor, never> =>
  Effect.succeed({
    compress: (
      prompt: string,
      maxTokens?: number,
    ): Effect.Effect<{ compressed: string; savedTokens: number }, CostTrackingError> => {
      const originalTokens = Math.ceil(prompt.length / 4);

      // Skip compression for short prompts
      if (originalTokens < HEURISTIC_MIN_TOKENS) {
        return Effect.succeed({ compressed: prompt, savedTokens: 0 });
      }

      // Step 1: Heuristic compression (always runs, synchronous)
      const { compressed: heuristic, savedTokens: heuristicSaved } = heuristicCompress(prompt);
      const heuristicTokens = Math.ceil(heuristic.length / 4);

      // Step 2: LLM compression (only when: llm available + maxTokens given + still over budget)
      if (llm && maxTokens && heuristicTokens > maxTokens) {
        const compressionPrompt = [
          `You are a prompt compression assistant. Compress the following text to fit within approximately ${maxTokens} tokens while preserving all key information, instructions, and context.`,
          `Return ONLY the compressed text — no explanations, no markdown, no preamble.`,
          ``,
          `Text to compress:`,
          heuristic,
        ].join("\n");

        return llm.complete({
          model: "claude-haiku-4-20250514",
          messages: [{ role: "user", content: compressionPrompt }],
          maxTokens: maxTokens + 200, // Small buffer for LLM response
        }).pipe(
          Effect.map((res) => {
            const llmCompressed = res.content.trim();
            const llmTokens = Math.ceil(llmCompressed.length / 4);
            return { compressed: llmCompressed, savedTokens: originalTokens - llmTokens };
          }),
          Effect.catchAll(() => Effect.succeed({ compressed: heuristic, savedTokens: heuristicSaved })),
          Effect.mapError((e) => new CostTrackingError({ message: "Prompt compression failed", cause: e })),
        ) as Effect.Effect<{ compressed: string; savedTokens: number }, CostTrackingError>;
      }

      return Effect.succeed({ compressed: heuristic, savedTokens: heuristicSaved });
    },
  } satisfies PromptCompressor);
