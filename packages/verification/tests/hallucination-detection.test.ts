import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import {
  extractClaims,
  checkHallucination,
  checkHallucinationLLM,
} from "../src/layers/hallucination-detection.js";

describe("extractClaims", () => {
  test("extracts factual claims from text with facts", () => {
    const text =
      "TypeScript was created by Microsoft in 2012. It adds static typing to JavaScript. Over 50 million developers use it worldwide.";
    const claims = extractClaims(text);
    expect(claims.length).toBeGreaterThanOrEqual(2);
    expect(claims.every((c) => c.text.length >= 15)).toBe(true);
    expect(claims.every((c) => c.verified === false)).toBe(true);
    expect(
      claims.every((c) =>
        ["certain", "likely", "uncertain"].includes(c.confidence),
      ),
    ).toBe(true);
  });

  test("returns empty for vague text without claims", () => {
    const text = "maybe something could happen, who knows, things are stuff.";
    const claims = extractClaims(text);
    expect(claims.length).toBe(0);
  });

  test("returns empty for empty text", () => {
    expect(extractClaims("")).toEqual([]);
    expect(extractClaims("  ")).toEqual([]);
  });

  test("filters out questions", () => {
    const text = "What is TypeScript? How does it work? JavaScript was created by Brendan Eich in 1995.";
    const claims = extractClaims(text);
    // Only the last sentence should remain
    expect(claims.length).toBe(1);
    expect(claims[0].text).toContain("Brendan Eich");
  });

  test("filters out imperatives", () => {
    const text = "Please install TypeScript first. Try running the compiler. Let's begin the setup. Node.js was created by Ryan Dahl in 2009.";
    const claims = extractClaims(text);
    expect(claims.length).toBe(1);
    expect(claims[0].text).toContain("Ryan Dahl");
  });

  test("filters out pure opinions without numbers", () => {
    const text = "I think TypeScript is great. I believe it improves productivity. I think there are 50 million users.";
    const claims = extractClaims(text);
    // Only the opinion with a number should pass
    expect(claims.length).toBe(1);
    expect(claims[0].text).toContain("50 million");
  });

  test("detects uncertain confidence", () => {
    const text = "TypeScript might have been released around 2012. Python was perhaps created by Guido van Rossum.";
    const claims = extractClaims(text);
    expect(claims.length).toBeGreaterThanOrEqual(1);
    expect(claims.every((c) => c.confidence === "uncertain")).toBe(true);
  });

  test("detects certain confidence", () => {
    const text = "TypeScript was definitely created by Microsoft. JavaScript is always interpreted.";
    const claims = extractClaims(text);
    expect(claims.length).toBeGreaterThanOrEqual(1);
    expect(claims.every((c) => c.confidence === "certain")).toBe(true);
  });
});

describe("checkHallucination (heuristic)", () => {
  test("passes when response is grounded in source", () => {
    const source = "TypeScript was created by Microsoft in 2012. It adds static typing to JavaScript and compiles to plain JavaScript.";
    const response = "TypeScript was created by Microsoft in 2012. It adds static typing to JavaScript.";
    const result = Effect.runSync(checkHallucination(response, source));
    expect(result.layerName).toBe("hallucination");
    expect(result.score).toBeGreaterThanOrEqual(0.8);
    expect(result.passed).toBe(true);
    expect(result.details).toBeDefined();
  });

  test("flags when response has unsupported claims", () => {
    const source = "TypeScript was created by Microsoft in 2012.";
    const response =
      "TypeScript was created by Microsoft in 2012. Python was invented by Google in 2020. Rust was built by Amazon in 2015.";
    const result = Effect.runSync(checkHallucination(response, source));
    expect(result.layerName).toBe("hallucination");
    expect(result.score).toBeLessThan(1.0);
    // With unsupported claims, hallucination rate should be significant
    expect(result.details).toContain("unverified");
  });

  test("returns LayerResult with correct shape", () => {
    const result = Effect.runSync(
      checkHallucination("TypeScript is a language by Microsoft.", "TypeScript is a language."),
    );
    expect(result).toHaveProperty("layerName");
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("passed");
    expect(result).toHaveProperty("details");
    expect(typeof result.layerName).toBe("string");
    expect(typeof result.score).toBe("number");
    expect(typeof result.passed).toBe("boolean");
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  test("returns score 1.0 when no claims extracted", () => {
    const result = Effect.runSync(checkHallucination("ok sure", "some source text"));
    expect(result.score).toBe(1.0);
    expect(result.passed).toBe(true);
  });

  test("respects custom threshold", () => {
    const source = "TypeScript was created by Microsoft.";
    const response =
      "TypeScript was created by Microsoft. Python was invented by Google in 2020. Rust was built by Amazon in 2015.";
    // Very lenient threshold — should pass even with hallucinations
    const lenient = Effect.runSync(checkHallucination(response, source, 0.99));
    expect(lenient.passed).toBe(true);
  });
});

describe("checkHallucinationLLM", () => {
  test("uses mock LLM returning JSON with claims array", async () => {
    const mockLLM = {
      complete: (_req: any) =>
        Effect.succeed({
          content: JSON.stringify({
            claims: [
              { text: "TypeScript was created by Microsoft", confidence: "certain", verified: true },
              { text: "It was released in 2012", confidence: "likely", verified: true },
              { text: "Python is owned by Google", confidence: "certain", verified: false },
            ],
          }),
        }),
    };

    const result = await Effect.runPromise(
      checkHallucinationLLM(
        "TypeScript was created by Microsoft in 2012. Python is owned by Google.",
        "TypeScript was created by Microsoft. TypeScript was first released in 2012.",
        mockLLM,
      ),
    );

    expect(result.layerName).toBe("hallucination");
    expect(result.score).toBeCloseTo(0.667, 1); // 2/3 verified -> rate 1/3 -> score ~0.667
    expect(result.passed).toBe(false); // rate 0.33 > threshold 0.10
    expect(result.details).toContain("verified: 2");
    expect(result.details).toContain("unverified: 1");
  });

  test("falls back to heuristic on invalid JSON from LLM", async () => {
    const mockLLM = {
      complete: (_req: any) => Effect.succeed({ content: "not valid json at all" }),
    };

    const result = await Effect.runPromise(
      checkHallucinationLLM("TypeScript was created by Microsoft.", "TypeScript is a language.", mockLLM),
    );

    expect(result.layerName).toBe("hallucination");
    expect(typeof result.score).toBe("number");
    expect(typeof result.passed).toBe("boolean");
  });

  test("falls back to heuristic on LLM error", async () => {
    const mockLLM = {
      complete: (_req: any) => Effect.fail(new Error("LLM unavailable")),
    };

    const result = await Effect.runPromise(
      checkHallucinationLLM("TypeScript was created by Microsoft.", "TypeScript is a language.", mockLLM),
    );

    expect(result.layerName).toBe("hallucination");
    expect(typeof result.score).toBe("number");
  });

  test("returns score 1.0 when LLM finds no claims", async () => {
    const mockLLM = {
      complete: (_req: any) =>
        Effect.succeed({
          content: JSON.stringify({ claims: [] }),
        }),
    };

    const result = await Effect.runPromise(
      checkHallucinationLLM("Just an opinion.", "Some source.", mockLLM),
    );

    expect(result.score).toBe(1.0);
    expect(result.passed).toBe(true);
  });
});
