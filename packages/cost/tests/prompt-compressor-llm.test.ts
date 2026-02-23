import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { makePromptCompressor } from "../src/compression/prompt-compressor.js";

const run = <A>(eff: Effect.Effect<A, any>) => Effect.runPromise(eff);

// ─── Phase 2.4: LLM-Based Prompt Compression ───

const makeLongPrompt = (chars: number) =>
  "This is a long context message. ".repeat(Math.ceil(chars / 32)).slice(0, chars);

describe("PromptCompressor — Tier 2 (LLM-based)", () => {
  it("returns original for short prompts regardless of LLM", async () => {
    const mockLLM = { complete: () => Effect.fail(new Error("should not be called")) };
    const result = await run(
      Effect.gen(function* () {
        const compressor = yield* makePromptCompressor(mockLLM as any);
        return yield* compressor.compress("Short prompt", 100);
      }),
    );
    expect(result.compressed).toBe("Short prompt");
    expect(result.savedTokens).toBe(0);
  });

  it("applies heuristic compression when no LLM provided", async () => {
    const longPrompt = makeLongPrompt(3000) + "\n\n\n  Extra whitespace  \n\n\n";
    const result = await run(
      Effect.gen(function* () {
        const compressor = yield* makePromptCompressor(); // no LLM
        return yield* compressor.compress(longPrompt);
      }),
    );
    expect(result.savedTokens).toBeGreaterThanOrEqual(0);
    expect(result.compressed.length).toBeLessThanOrEqual(longPrompt.length);
  });

  it("calls LLM when heuristic result still exceeds maxTokens", async () => {
    let llmCalled = false;
    const mockLLM = {
      complete: (_req: any) => {
        llmCalled = true;
        return Effect.succeed({ content: "Compressed by LLM." });
      },
    };
    const longPrompt = makeLongPrompt(4000); // ~1000 tokens

    await run(
      Effect.gen(function* () {
        const compressor = yield* makePromptCompressor(mockLLM as any);
        // maxTokens=50 → heuristic (~1000 tokens) still way above 50 → LLM invoked
        return yield* compressor.compress(longPrompt, 50);
      }),
    );
    expect(llmCalled).toBe(true);
  });

  it("does NOT call LLM when heuristic result fits within maxTokens", async () => {
    let llmCalled = false;
    const mockLLM = {
      complete: (_req: any) => {
        llmCalled = true;
        return Effect.succeed({ content: "Should not be returned" });
      },
    };
    const longPrompt = makeLongPrompt(3000); // ~750 tokens after heuristic

    await run(
      Effect.gen(function* () {
        const compressor = yield* makePromptCompressor(mockLLM as any);
        // maxTokens=5000 → already below → LLM not needed
        return yield* compressor.compress(longPrompt, 5000);
      }),
    );
    expect(llmCalled).toBe(false);
  });

  it("does NOT call LLM when no maxTokens provided", async () => {
    let llmCalled = false;
    const mockLLM = {
      complete: (_req: any) => {
        llmCalled = true;
        return Effect.succeed({ content: "Should not be returned" });
      },
    };
    const longPrompt = makeLongPrompt(3000);

    await run(
      Effect.gen(function* () {
        const compressor = yield* makePromptCompressor(mockLLM as any);
        return yield* compressor.compress(longPrompt); // no maxTokens
      }),
    );
    expect(llmCalled).toBe(false);
  });

  it("returns LLM-compressed text when LLM is invoked", async () => {
    const mockLLM = {
      complete: (_req: any) =>
        Effect.succeed({ content: "LLM-compressed result." }),
    };
    const longPrompt = makeLongPrompt(4000);

    const result = await run(
      Effect.gen(function* () {
        const compressor = yield* makePromptCompressor(mockLLM as any);
        return yield* compressor.compress(longPrompt, 50);
      }),
    );
    expect(result.compressed).toBe("LLM-compressed result.");
  });

  it("falls back to heuristic result when LLM fails", async () => {
    const failingLLM = {
      complete: (_req: any) => Effect.fail(new Error("LLM unavailable")),
    };
    const longPrompt = makeLongPrompt(4000);

    const result = await run(
      Effect.gen(function* () {
        const compressor = yield* makePromptCompressor(failingLLM as any);
        return yield* compressor.compress(longPrompt, 50);
      }),
    );
    // Should fall back to heuristic compression, not fail
    expect(result.compressed.length).toBeGreaterThan(0);
    expect(result.compressed).not.toContain("LLM unavailable");
  });
});
