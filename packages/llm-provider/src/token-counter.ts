import { Effect } from "effect";
import type { LLMMessage } from "./types.js";

/**
 * Estimate token count for messages.
 * Uses a simple heuristic: ~4 characters per token for English text.
 * This is used as a fallback when the provider's token counting API is unavailable.
 */
export const estimateTokenCount = (
  messages: readonly LLMMessage[],
): Effect.Effect<number, never> =>
  Effect.sync(() => {
    let totalChars = 0;

    for (const msg of messages) {
      if (typeof msg.content === "string") {
        totalChars += msg.content.length;
      } else {
        // Content blocks
        for (const block of msg.content) {
          if (block.type === "text") {
            totalChars += block.text.length;
          } else if (block.type === "tool_result") {
            totalChars += block.content.length;
          } else if (block.type === "tool_use") {
            totalChars += JSON.stringify(block.input).length;
          }
          // Images not counted in token estimation
        }
      }
      // Add overhead for role/message framing (~4 tokens per message)
      totalChars += 16;
    }

    return Math.ceil(totalChars / 4);
  });

/**
 * Calculate cost in USD given token counts and model name.
 */
export const calculateCost = (
  inputTokens: number,
  outputTokens: number,
  model: string,
): number => {
  // Cost per 1M tokens lookup
  const costMap: Record<string, { input: number; output: number }> = {
    "claude-3-5-haiku-20241022": { input: 1.0, output: 5.0 },
    "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
    "claude-sonnet-4-5-20250929": { input: 3.0, output: 15.0 },
    "claude-opus-4-20250514": { input: 15.0, output: 75.0 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "gpt-4o": { input: 2.5, output: 10.0 },
  };

  const costs = costMap[model] ?? { input: 3.0, output: 15.0 };
  return (
    (inputTokens / 1_000_000) * costs.input +
    (outputTokens / 1_000_000) * costs.output
  );
};
