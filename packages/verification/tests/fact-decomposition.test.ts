import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { checkFactDecomposition } from "../src/layers/fact-decomposition.js";

describe("checkFactDecomposition", () => {
  test("extracts claims from multiple sentences", async () => {
    const result = await Effect.runPromise(
      checkFactDecomposition(
        "TypeScript was released in 2012. It was created by Microsoft. The current version is TypeScript 5.0.",
      ),
    );
    expect(result.layerName).toBe("fact-decomposition");
    expect(result.claims).toBeDefined();
    expect(result.claims!.length).toBe(3);
    expect(result.passed).toBe(true);
  });

  test("assigns higher confidence to claims with numbers", async () => {
    const result = await Effect.runPromise(
      checkFactDecomposition("The year 2023 had 365 days."),
    );
    expect(result.claims).toBeDefined();
    expect(result.claims![0]!.confidence).toBeGreaterThan(0.5);
  });

  test("assigns higher confidence to claims with proper nouns", async () => {
    const result = await Effect.runPromise(
      checkFactDecomposition("Microsoft developed TypeScript for JavaScript development."),
    );
    expect(result.claims).toBeDefined();
    expect(result.claims![0]!.confidence).toBeGreaterThan(0.5);
  });

  test("assigns higher confidence to claims with dates", async () => {
    const result = await Effect.runPromise(
      checkFactDecomposition("TypeScript 5.0 was released in March 2023."),
    );
    expect(result.claims).toBeDefined();
    expect(result.claims![0]!.confidence).toBeGreaterThan(0.5);
  });

  test("lowers confidence for weasel words", async () => {
    const result = await Effect.runPromise(
      checkFactDecomposition("Some people often say that many developers usually prefer TypeScript."),
    );
    expect(result.claims).toBeDefined();
    expect(result.claims![0]!.confidence).toBeLessThan(0.5);
  });

  test("handles text with no verifiable claims", async () => {
    const result = await Effect.runPromise(checkFactDecomposition("hello world"));
    // Text with > 10 chars gets processed
    expect(result.claims).toBeDefined();
    expect(result.claims!.length).toBeGreaterThanOrEqual(1);
  });

  test("calculates average confidence correctly", async () => {
    const result = await Effect.runPromise(
      checkFactDecomposition(
        "This is a vague statement. Some things might happen.",
      ),
    );
    expect(result.score).toBeLessThanOrEqual(0.5); // Weasel words may reduce to baseline or lower
    expect(result.details).toContain("avg confidence:");
  });

  test("handles empty text", async () => {
    const result = await Effect.runPromise(checkFactDecomposition(""));
    expect(result.score).toBe(0.5);
    expect(result.passed).toBe(true);
    expect(result.claims).toEqual([]);
  });

  test("handles very short sentences", async () => {
    const result = await Effect.runPromise(
      checkFactDecomposition("Short."),
    );
    expect(result.claims).toEqual([]);
  });

  test("passes when average confidence >= 0.5", async () => {
    const result = await Effect.runPromise(
      checkFactDecomposition("TypeScript 5.0 was released in 2023 by Microsoft."),
    );
    expect(result.passed).toBe(true);
  });

  test("fails when average confidence < 0.5", async () => {
    const result = await Effect.runPromise(
      checkFactDecomposition("Some things might be true sometimes."),
    );
    expect(result.passed).toBe(false);
  });
});
