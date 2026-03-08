import { Effect } from "effect";
import type { LLMMessage } from "./types.js";

/**
 * Estimate the chars-per-token ratio based on content characteristics.
 * Code and JSON are denser (~3 chars/token) while natural language is ~4.
 */
function charsPerToken(text: string): number {
  if (text.length === 0) return 4;
  // Sample first 2000 chars for classification
  const sample = text.slice(0, 2000);
  const codeSignals = (sample.match(/[{}();=<>\[\]]/g) ?? []).length;
  const jsonSignals = (sample.match(/"\w+"\s*:/g) ?? []).length;
  const ratio = (codeSignals + jsonSignals) / sample.length;
  // High density of code/JSON markers → lower chars-per-token
  if (ratio > 0.08) return 3;    // Mostly code/JSON
  if (ratio > 0.04) return 3.5;  // Mixed
  return 4;                       // Natural language
}

/**
 * Estimate token count for messages.
 * Uses content-aware heuristics: ~3 chars/token for code/JSON, ~4 for English text.
 * This is used as a fallback when the provider's token counting API is unavailable.
 */
export const estimateTokenCount = (
  messages: readonly LLMMessage[],
): Effect.Effect<number, never> =>
  Effect.sync(() => {
    let totalTokens = 0;

    for (const msg of messages) {
      if (typeof msg.content === "string") {
        totalTokens += Math.ceil(msg.content.length / charsPerToken(msg.content));
      } else {
        // Content blocks
        for (const block of msg.content) {
          if (block.type === "text") {
            totalTokens += Math.ceil(block.text.length / charsPerToken(block.text));
          } else if (block.type === "tool_result") {
            totalTokens += Math.ceil(block.content.length / charsPerToken(block.content));
          } else if (block.type === "tool_use") {
            const json = JSON.stringify(block.input);
            totalTokens += Math.ceil(json.length / 3); // Tool input is always JSON
          }
          // Images not counted in token estimation
        }
      }
      // Add overhead for role/message framing (~4 tokens per message)
      totalTokens += 4;
    }

    return totalTokens;
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
    "gemini-2.0-flash": { input: 0.1, output: 0.4 },
    "gemini-2.5-pro-preview-03-25": { input: 1.25, output: 10.0 },
    "gemini-embedding-001": { input: 0.0, output: 0.0 },
  };

  const costs = costMap[model] ?? { input: 3.0, output: 15.0 };
  return (
    (inputTokens / 1_000_000) * costs.input +
    (outputTokens / 1_000_000) * costs.output
  );
};
