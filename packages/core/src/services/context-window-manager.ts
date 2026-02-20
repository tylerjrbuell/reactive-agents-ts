import { Effect, Context, Layer, Data } from "effect";

// ─── Truncation Strategy ───

export type TruncationStrategy =
  | "drop-oldest" // Remove oldest messages first
  | "drop-middle" // Keep first + last, drop middle
  | "summarize-oldest"; // Summarize oldest messages (requires LLM — future Phase 2)

// ─── Context Error ───

export class ContextError extends Data.TaggedError("ContextError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ─── Service Tag ───

export class ContextWindowManager extends Context.Tag("ContextWindowManager")<
  ContextWindowManager,
  {
    /**
     * Build a context-window-safe message array.
     * Injects memory context as a system message and truncates if needed.
     */
    readonly buildContext: (options: {
      systemPrompt: string;
      messages: readonly unknown[];
      memoryContext?: string;
      maxTokens: number;
      reserveOutputTokens: number;
    }) => Effect.Effect<readonly unknown[], ContextError>;

    /**
     * Estimate token count for a string.
     * Uses character-based heuristic (1 token ~ 4 chars) when no tokenizer available.
     */
    readonly estimateTokens: (text: string) => Effect.Effect<number, never>;

    /**
     * Check if a message array fits within the context limit.
     */
    readonly fitsInContext: (
      messages: readonly unknown[],
      maxTokens: number,
    ) => Effect.Effect<boolean, never>;

    /**
     * Truncate messages to fit within targetTokens.
     */
    readonly truncate: (
      messages: readonly unknown[],
      targetTokens: number,
      strategy: TruncationStrategy,
    ) => Effect.Effect<readonly unknown[], ContextError>;
  }
>() {}

// ─── Helper functions (avoid self-referencing the service tag) ───

const estimateTokensImpl = (text: string): number =>
  Math.ceil(text.length / 4);

const fitsInContextImpl = (
  messages: readonly unknown[],
  maxTokens: number,
): boolean => {
  const text = JSON.stringify(messages);
  const estimated = estimateTokensImpl(text);
  return estimated <= maxTokens;
};

// ─── Live Implementation ───

export const ContextWindowManagerLive = Layer.succeed(ContextWindowManager, {
  estimateTokens: (text) => Effect.succeed(estimateTokensImpl(text)),

  fitsInContext: (messages, maxTokens) =>
    Effect.succeed(fitsInContextImpl(messages, maxTokens)),

  truncate: (messages, targetTokens, strategy) =>
    Effect.gen(function* () {
      const arr = [...messages] as unknown[];

      if (arr.length <= 1) return arr;

      switch (strategy) {
        case "drop-oldest": {
          while (arr.length > 1) {
            if (fitsInContextImpl(arr, targetTokens)) break;
            arr.shift(); // Remove oldest
          }
          return arr;
        }
        case "drop-middle": {
          while (arr.length > 2) {
            if (fitsInContextImpl(arr, targetTokens)) break;
            const mid = Math.floor(arr.length / 2);
            arr.splice(mid, 1); // Remove middle message
          }
          return arr;
        }
        default:
          return yield* Effect.fail(
            new ContextError({
              message: `Truncation strategy '${strategy}' not implemented in Phase 1`,
            }),
          );
      }
    }),

  buildContext: (options) =>
    Effect.gen(function* () {
      const budget = options.maxTokens - options.reserveOutputTokens;

      // Build system message with memory context injected
      const systemContent = options.memoryContext
        ? `${options.systemPrompt}\n\n## Agent Memory\n${options.memoryContext}`
        : options.systemPrompt;

      const systemMsg = { role: "system", content: systemContent };
      const systemTokens = estimateTokensImpl(systemContent);
      const conversationBudget = budget - systemTokens;

      // Truncate conversation to fit budget
      const arr = [...options.messages] as unknown[];
      while (arr.length > 1) {
        if (fitsInContextImpl(arr, conversationBudget)) break;
        arr.shift();
      }

      return [systemMsg, ...arr];
    }),
});
