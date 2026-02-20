import { Effect, Context, Layer } from "effect";
import type { LLMMessage, TruncationStrategy } from "./types.js";
import type { LLMErrors } from "./errors.js";
import { estimateTokenCount } from "./token-counter.js";

/**
 * Manages context window budgets.
 * Ensures prompts don't exceed model limits.
 * Implements truncation strategies.
 */
export class PromptManager extends Context.Tag("PromptManager")<
  PromptManager,
  {
    /**
     * Build a prompt within token budget.
     * Automatically truncates conversation history if needed.
     */
    readonly buildPrompt: (options: {
      readonly systemPrompt: string;
      readonly messages: readonly LLMMessage[];
      readonly reserveOutputTokens: number;
      readonly maxContextTokens: number;
      readonly truncationStrategy: TruncationStrategy;
    }) => Effect.Effect<readonly LLMMessage[], LLMErrors>;

    /**
     * Check if messages fit within context window.
     */
    readonly fitsInContext: (
      messages: readonly LLMMessage[],
      maxTokens: number,
    ) => Effect.Effect<boolean, LLMErrors>;
  }
>() {}

/**
 * Live PromptManager that uses heuristic token counting
 * and applies truncation strategies.
 */
export const PromptManagerLive = Layer.succeed(
  PromptManager,
  PromptManager.of({
    buildPrompt: (options) =>
      Effect.gen(function* () {
        const {
          systemPrompt,
          messages,
          reserveOutputTokens,
          maxContextTokens,
          truncationStrategy,
        } = options;

        const budget = maxContextTokens - reserveOutputTokens;

        // Always keep the system prompt
        const systemMessage: LLMMessage = {
          role: "system",
          content: systemPrompt,
        };
        const systemTokens = yield* estimateTokenCount([systemMessage]);

        if (systemTokens >= budget) {
          // System prompt alone exceeds budget — return just it (truncated scenario)
          return [systemMessage];
        }

        const remainingBudget = budget - systemTokens;

        // Apply truncation strategy
        const truncated = yield* applyTruncation(
          messages,
          remainingBudget,
          truncationStrategy,
        );

        return [systemMessage, ...truncated];
      }),

    fitsInContext: (messages, maxTokens) =>
      Effect.gen(function* () {
        const count = yield* estimateTokenCount(messages);
        return count <= maxTokens;
      }),
  }),
);

/**
 * Apply truncation strategy to fit messages within token budget.
 */
const applyTruncation = (
  messages: readonly LLMMessage[],
  budget: number,
  strategy: TruncationStrategy,
): Effect.Effect<readonly LLMMessage[], never> =>
  Effect.gen(function* () {
    const totalTokens = yield* estimateTokenCount(messages);

    if (totalTokens <= budget) {
      return messages;
    }

    switch (strategy) {
      case "drop-oldest": {
        // Remove messages from the beginning until we fit
        const result: LLMMessage[] = [];
        let usedTokens = 0;

        // Work backwards — keep most recent messages
        for (let i = messages.length - 1; i >= 0; i--) {
          const msgTokens = yield* estimateTokenCount([messages[i]!]);
          if (usedTokens + msgTokens <= budget) {
            result.unshift(messages[i]!);
            usedTokens += msgTokens;
          } else {
            break;
          }
        }
        return result;
      }

      case "sliding-window": {
        // Keep last N messages that fit
        const result: LLMMessage[] = [];
        let usedTokens = 0;

        for (let i = messages.length - 1; i >= 0; i--) {
          const msgTokens = yield* estimateTokenCount([messages[i]!]);
          if (usedTokens + msgTokens <= budget) {
            result.unshift(messages[i]!);
            usedTokens += msgTokens;
          } else {
            break;
          }
        }
        return result;
      }

      case "summarize-middle":
      case "importance-based":
        // For Phase 1: fall back to sliding-window behavior
        // Full implementation requires LLM calls (circular dependency)
        {
          const result: LLMMessage[] = [];
          let usedTokens = 0;

          // Keep first message (often has important context)
          if (messages.length > 0) {
            const firstTokens = yield* estimateTokenCount([messages[0]!]);
            if (firstTokens <= budget) {
              result.push(messages[0]!);
              usedTokens += firstTokens;
            }
          }

          // Fill from the end
          const tail: LLMMessage[] = [];
          for (let i = messages.length - 1; i >= 1; i--) {
            const msgTokens = yield* estimateTokenCount([messages[i]!]);
            if (usedTokens + msgTokens <= budget) {
              tail.unshift(messages[i]!);
              usedTokens += msgTokens;
            } else {
              break;
            }
          }

          return [...result, ...tail];
        }
    }
  });
