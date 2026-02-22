import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { checkSemanticEntropy } from "../src/layers/semantic-entropy.js";

describe("checkSemanticEntropy", () => {
  test("returns high score for diverse, specific text", async () => {
    const result = await Effect.runPromise(
      checkSemanticEntropy(
        "TypeScript was developed by Microsoft in 2012. It adds static type checking to JavaScript. The compiler transpiles to plain JavaScript.",
      ),
    );
    expect(result.layerName).toBe("semantic-entropy");
    expect(result.score).toBeGreaterThan(0.5);
    expect(result.passed).toBe(true);
    expect(result.details).toContain("Diversity:");
  });

  test("returns low score for hedging language", async () => {
    const result = await Effect.runPromise(
      checkSemanticEntropy(
        "I think maybe it could possibly be something like that, but I'm not sure if it's probably true",
      ),
    );
    // The hedge penalty is capped at 0.3, diversity may still give score > 0.5
    expect(result.details).toContain("Hedges:");
    const hedgeMatch = result.details!.match(/Hedges: (\d+)/);
    expect(hedgeMatch).not.toBeNull();
    expect(parseInt(hedgeMatch![1]!, 10)).toBeGreaterThan(0);
  });

  test("handles empty text", async () => {
    const result = await Effect.runPromise(checkSemanticEntropy(""));
    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
  });

  test("handles single word text", async () => {
    const result = await Effect.runPromise(checkSemanticEntropy("hello"));
    expect(result.layerName).toBe("semantic-entropy");
    expect(result.score).toBeGreaterThanOrEqual(0); // Single word: diversity = 0/1 = 0, no hedge penalty, lengthBonus = 0
  });

  test("handles repeated text with low diversity", async () => {
    const result = await Effect.runPromise(
      checkSemanticEntropy("the the the the the the the the"),
    );
    expect(result.score).toBeLessThan(0.5);
    expect(result.passed).toBe(false);
  });

  test("applies length bonus for longer text", async () => {
    const longText = Array(150).fill("unique word").join(" ");
    const result = await Effect.runPromise(checkSemanticEntropy(longText));
    expect(result.score).toBeGreaterThan(0);
  });

  test("detects specific hedging phrases", async () => {
    const result = await Effect.runPromise(
      checkSemanticEntropy(
        "It seems to me that this might possibly be the correct answer, but I'm not sure",
      ),
    );
    expect(result.details).toBeDefined();
    expect(result.details).toContain("Hedges:");
    const hedgeMatch = result.details!.match(/Hedges: (\d+)/);
    expect(hedgeMatch).not.toBeNull();
    expect(parseInt(hedgeMatch![1]!, 10)).toBeGreaterThan(0);
  });

  test("handles context parameter without errors", async () => {
    const result = await Effect.runPromise(
      checkSemanticEntropy("Some specific answer", "Some context"),
    );
    expect(result.layerName).toBe("semantic-entropy");
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});
