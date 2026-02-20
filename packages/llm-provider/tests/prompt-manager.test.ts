import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { PromptManager, PromptManagerLive } from "../src/index.js";

const run = <A>(effect: Effect.Effect<A, unknown, PromptManager>) =>
  Effect.runPromise(effect.pipe(Effect.provide(PromptManagerLive)));

describe("PromptManager", () => {
  it("should build a prompt within budget", async () => {
    const result = await run(
      Effect.gen(function* () {
        const pm = yield* PromptManager;
        return yield* pm.buildPrompt({
          systemPrompt: "You are a helpful assistant.",
          messages: [
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Hi there!" },
          ],
          reserveOutputTokens: 500,
          maxContextTokens: 4000,
          truncationStrategy: "drop-oldest",
        });
      }),
    );

    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0]).toEqual({
      role: "system",
      content: "You are a helpful assistant.",
    });
  });

  it("should truncate when messages exceed budget", async () => {
    const longMessages = Array.from({ length: 100 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `This is message number ${i} with some extra content to make it longer and use more tokens.`,
    }));

    const result = await run(
      Effect.gen(function* () {
        const pm = yield* PromptManager;
        return yield* pm.buildPrompt({
          systemPrompt: "System prompt.",
          messages: longMessages,
          reserveOutputTokens: 100,
          maxContextTokens: 200,
          truncationStrategy: "drop-oldest",
        });
      }),
    );

    expect(result.length).toBeLessThan(longMessages.length + 1);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("should check if messages fit in context", async () => {
    const result = await run(
      Effect.gen(function* () {
        const pm = yield* PromptManager;
        return yield* pm.fitsInContext(
          [{ role: "user", content: "Hello" }],
          1000,
        );
      }),
    );

    expect(result).toBe(true);
  });

  it("should detect messages that exceed context", async () => {
    const result = await run(
      Effect.gen(function* () {
        const pm = yield* PromptManager;
        return yield* pm.fitsInContext(
          [{ role: "user", content: "a".repeat(10000) }],
          10,
        );
      }),
    );

    expect(result).toBe(false);
  });
});
