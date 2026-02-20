import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import {
  ContextWindowManager,
  ContextWindowManagerLive,
} from "../src/index.js";

describe("ContextWindowManager", () => {
  const run = <A, E>(effect: Effect.Effect<A, E, ContextWindowManager>) =>
    Effect.runPromise(effect.pipe(Effect.provide(ContextWindowManagerLive)));

  it("should estimate tokens", async () => {
    const tokens = await run(
      Effect.gen(function* () {
        const cwm = yield* ContextWindowManager;
        return yield* cwm.estimateTokens("hello world"); // 11 chars => ceil(11/4) = 3
      }),
    );

    expect(tokens).toBe(3);
  });

  it("should check if messages fit in context", async () => {
    const fits = await run(
      Effect.gen(function* () {
        const cwm = yield* ContextWindowManager;
        const messages = [{ role: "user", content: "hi" }];
        return yield* cwm.fitsInContext(messages, 1000);
      }),
    );

    expect(fits).toBe(true);
  });

  it("should detect messages that exceed context", async () => {
    const fits = await run(
      Effect.gen(function* () {
        const cwm = yield* ContextWindowManager;
        const messages = [{ role: "user", content: "x".repeat(1000) }];
        return yield* cwm.fitsInContext(messages, 10);
      }),
    );

    expect(fits).toBe(false);
  });

  it("should truncate with drop-oldest strategy", async () => {
    const result = await run(
      Effect.gen(function* () {
        const cwm = yield* ContextWindowManager;
        const messages = [
          { role: "user", content: "message 1" },
          { role: "assistant", content: "response 1" },
          { role: "user", content: "message 2" },
          { role: "assistant", content: "response 2" },
          { role: "user", content: "message 3" },
        ];
        // Very small budget forces truncation
        return yield* cwm.truncate(messages, 50, "drop-oldest");
      }),
    );

    // Should have dropped some oldest messages
    expect(result.length).toBeLessThan(5);
    expect(result.length).toBeGreaterThan(0);
  });

  it("should truncate with drop-middle strategy", async () => {
    const result = await run(
      Effect.gen(function* () {
        const cwm = yield* ContextWindowManager;
        const messages = [
          { role: "user", content: "first" },
          { role: "assistant", content: "middle-1" },
          { role: "user", content: "middle-2" },
          { role: "assistant", content: "middle-3" },
          { role: "user", content: "last" },
        ];
        return yield* cwm.truncate(messages, 50, "drop-middle");
      }),
    );

    expect(result.length).toBeLessThanOrEqual(5);
    expect(result.length).toBeGreaterThan(0);
  });

  it("should fail for unimplemented strategy", async () => {
    const result = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const cwm = yield* ContextWindowManager;
        return yield* cwm.truncate(
          [
            { role: "user", content: "a".repeat(500) },
            { role: "assistant", content: "b".repeat(500) },
            { role: "user", content: "c".repeat(500) },
          ],
          10,
          "summarize-oldest",
        );
      }).pipe(Effect.provide(ContextWindowManagerLive)),
    );

    expect(result._tag).toBe("Failure");
  });

  it("should build context with system prompt", async () => {
    const result = await run(
      Effect.gen(function* () {
        const cwm = yield* ContextWindowManager;
        return yield* cwm.buildContext({
          systemPrompt: "You are a helpful assistant.",
          messages: [{ role: "user", content: "hello" }],
          maxTokens: 4000,
          reserveOutputTokens: 1000,
        });
      }),
    );

    expect(result.length).toBe(2); // system + 1 user message
    const systemMsg = result[0] as { role: string; content: string };
    expect(systemMsg.role).toBe("system");
    expect(systemMsg.content).toBe("You are a helpful assistant.");
  });

  it("should build context with memory context injected", async () => {
    const result = await run(
      Effect.gen(function* () {
        const cwm = yield* ContextWindowManager;
        return yield* cwm.buildContext({
          systemPrompt: "You are a helpful assistant.",
          messages: [{ role: "user", content: "hello" }],
          memoryContext: "The user prefers concise answers.",
          maxTokens: 4000,
          reserveOutputTokens: 1000,
        });
      }),
    );

    const systemMsg = result[0] as { role: string; content: string };
    expect(systemMsg.content).toContain("Agent Memory");
    expect(systemMsg.content).toContain("The user prefers concise answers.");
  });

  it("should not return single-element arrays as-is during truncation", async () => {
    const result = await run(
      Effect.gen(function* () {
        const cwm = yield* ContextWindowManager;
        return yield* cwm.truncate(
          [{ role: "user", content: "single" }],
          1, // very small budget
          "drop-oldest",
        );
      }),
    );

    // Single message should not be truncated further
    expect(result.length).toBe(1);
  });
});
