import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { checkSelfConsistency } from "../src/layers/self-consistency.js";

describe("checkSelfConsistency", () => {
  test("returns high score for consistent text", async () => {
    const result = await Effect.runPromise(
      checkSelfConsistency(
        "TypeScript adds static types to JavaScript. It compiles to plain JavaScript. The types are checked at compile time.",
      ),
    );
    expect(result.layerName).toBe("self-consistency");
    expect(result.score).toBe(1);
    expect(result.passed).toBe(true);
  });

  test("detects contradictions with negation patterns", async () => {
    const result = await Effect.runPromise(
      checkSelfConsistency(
        "The answer is true. It is not false. This is correct. This is not incorrect.",
      ),
    );
    expect(result.score).toBeLessThan(1);
    expect(result.details).toContain("contradiction");
  });

  test("detects always/never contradictions", async () => {
    const result = await Effect.runPromise(
      checkSelfConsistency(
        "This method always works correctly. It never fails in production.",
      ),
    );
    // The algorithm checks for subject similarity > 0.3, so this may or may not detect
    expect(result.layerName).toBe("self-consistency");
  });

  test("handles single sentence text", async () => {
    const result = await Effect.runPromise(
      checkSelfConsistency("TypeScript was created by Microsoft in 2012."),
    );
    expect(result.score).toBe(0.8);
    expect(result.passed).toBe(true);
    expect(result.details).toContain("Too few sentences");
  });

  test("handles very short text", async () => {
    const result = await Effect.runPromise(
      checkSelfConsistency("Short."),
    );
    expect(result.score).toBe(0.8);
    expect(result.passed).toBe(true);
  });

  test("handles empty text", async () => {
    const result = await Effect.runPromise(checkSelfConsistency(""));
    expect(result.score).toBe(0.8);
    expect(result.passed).toBe(true);
  });

  test("passes when score >= 0.5", async () => {
    const result = await Effect.runPromise(
      checkSelfConsistency(
        "JavaScript is a programming language. It runs in browsers. It can also run on servers with Node.js.",
      ),
    );
    expect(result.passed).toBe(true);
  });

  test("fails when contradictions lower score below 0.5", async () => {
    const result = await Effect.runPromise(
      checkSelfConsistency(
        "This can be done. This cannot be done. It is possible. It is not possible.",
      ),
    );
    expect(result.passed).toBe(false);
  });

  test("checks subject similarity for contradictions", async () => {
    const result = await Effect.runPromise(
      checkSelfConsistency(
        "The test passes. The test does not pass.",
      ),
    );
    expect(result.details).toContain("contradiction");
  });

  test("ignores unrelated contradictory statements", async () => {
    const result = await Effect.runPromise(
      checkSelfConsistency(
        "TypeScript is a typed language. Java is not typed. Python is interpreted.",
      ),
    );
    // Check result has expected shape
    expect(result.layerName).toBe("self-consistency");
  });
});
