import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { checkSemanticEntropy } from "../src/layers/semantic-entropy.js";
import { checkFactDecomposition } from "../src/layers/fact-decomposition.js";
import { checkMultiSource, checkMultiSourceLLM } from "../src/layers/multi-source.js";
import { checkSelfConsistency } from "../src/layers/self-consistency.js";
import { checkNli } from "../src/layers/nli.js";

describe("Semantic Entropy Layer", () => {
  test("scores specific text higher than vague text", () => {
    const specific = Effect.runSync(
      checkSemanticEntropy("TypeScript was created by Microsoft in 2012. It adds static typing to JavaScript and compiles to plain JavaScript."),
    );
    const vague = Effect.runSync(
      checkSemanticEntropy("I think it might possibly be something that could perhaps do some things, maybe probably likely."),
    );
    expect(specific.score).toBeGreaterThan(vague.score);
    expect(specific.layerName).toBe("semantic-entropy");
  });

  test("handles empty text", () => {
    const result = Effect.runSync(checkSemanticEntropy(""));
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });
});

describe("Fact Decomposition Layer", () => {
  test("scores claims with specifics higher", () => {
    const result = Effect.runSync(
      checkFactDecomposition(
        "TypeScript was released in 2012. Microsoft maintains the project. Over 50 million developers use JavaScript.",
      ),
    );
    expect(result.claims).toBeDefined();
    expect(result.claims!.length).toBe(3);
    expect(result.score).toBeGreaterThan(0.5);
  });

  test("scores vague claims lower", () => {
    const result = Effect.runSync(
      checkFactDecomposition(
        "Some things are often generally useful. Many people usually think that things work somehow.",
      ),
    );
    expect(result.score).toBeLessThanOrEqual(0.5);
  });

  test("handles empty text", () => {
    const result = Effect.runSync(checkFactDecomposition(""));
    expect(result.score).toBe(0.5);
    expect(result.claims).toEqual([]);
  });
});

describe("Multi-Source Layer", () => {
  test("heuristic returns neutral confidence score", () => {
    const result = Effect.runSync(checkMultiSource("anything"));
    expect(result.layerName).toBe("multi-source");
    expect(result.score).toBe(0.5);
    expect(result.passed).toBe(true);
    expect(result.details).toContain("not yet implemented");
  });

  test("LLM tier skips when TAVILY_API_KEY is missing", async () => {
    const original = process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_API_KEY;

    const mockLLM = {
      complete: (_req: any) =>
        Effect.succeed({ content: '["TypeScript was created by Microsoft"]' }),
    };

    try {
      const result = await Effect.runPromise(
        checkMultiSourceLLM("TypeScript was created by Microsoft in 2012.", mockLLM),
      );
      expect(result.layerName).toBe("multi-source");
      expect(result.score).toBe(0.5);
      expect(result.details).toContain("TAVILY_API_KEY not set");
    } finally {
      if (original) process.env.TAVILY_API_KEY = original;
    }
  });

  test("LLM tier falls back to heuristic on LLM error", async () => {
    const original = process.env.TAVILY_API_KEY;
    process.env.TAVILY_API_KEY = "test-key";

    const mockLLM = {
      complete: (_req: any) =>
        Effect.fail(new Error("LLM unavailable")),
    };

    try {
      const result = await Effect.runPromise(
        checkMultiSourceLLM("Some text to verify.", mockLLM),
      );
      expect(result.layerName).toBe("multi-source");
      expect(result.score).toBe(0.5);
      expect(result.passed).toBe(true);
    } finally {
      if (original) process.env.TAVILY_API_KEY = original;
      else delete process.env.TAVILY_API_KEY;
    }
  });

  test("LLM tier returns neutral when no claims extracted", async () => {
    const original = process.env.TAVILY_API_KEY;
    process.env.TAVILY_API_KEY = "test-key";

    const mockLLM = {
      complete: (_req: any) => Effect.succeed({ content: "[]" }),
    };

    try {
      const result = await Effect.runPromise(
        checkMultiSourceLLM("Just an opinion, nothing verifiable.", mockLLM),
      );
      expect(result.layerName).toBe("multi-source");
      expect(result.score).toBe(0.5);
      expect(result.details).toContain("No verifiable claims");
    } finally {
      if (original) process.env.TAVILY_API_KEY = original;
      else delete process.env.TAVILY_API_KEY;
    }
  });

  test("LLM tier falls back on invalid JSON from LLM", async () => {
    const original = process.env.TAVILY_API_KEY;
    process.env.TAVILY_API_KEY = "test-key";

    const mockLLM = {
      complete: (_req: any) => Effect.succeed({ content: "not valid json" }),
    };

    try {
      const result = await Effect.runPromise(
        checkMultiSourceLLM("Some text.", mockLLM),
      );
      // Falls back to heuristic
      expect(result.layerName).toBe("multi-source");
      expect(result.score).toBe(0.5);
    } finally {
      if (original) process.env.TAVILY_API_KEY = original;
      else delete process.env.TAVILY_API_KEY;
    }
  });
});

describe("Self-Consistency Layer", () => {
  test("detects contradictions", () => {
    const result = Effect.runSync(
      checkSelfConsistency(
        "The feature is always available to all users. The feature is never available to all users.",
      ),
    );
    expect(result.score).toBeLessThan(1);
    expect(result.layerName).toBe("self-consistency");
  });

  test("scores consistent text high", () => {
    const result = Effect.runSync(
      checkSelfConsistency(
        "TypeScript adds static types. TypeScript compiles to JavaScript. TypeScript is maintained by Microsoft.",
      ),
    );
    expect(result.score).toBeGreaterThanOrEqual(0.8);
  });

  test("handles single sentence", () => {
    const result = Effect.runSync(checkSelfConsistency("Just one sentence here."));
    expect(result.score).toBe(0.8);
  });
});

describe("NLI Layer", () => {
  test("scores relevant response high", () => {
    const result = Effect.runSync(
      checkNli(
        "TypeScript is a typed superset of JavaScript that compiles to plain JavaScript. TypeScript was developed by Microsoft to address JavaScript shortcomings in large applications.",
        "What is TypeScript and how does TypeScript improve JavaScript development?",
      ),
    );
    expect(result.score).toBeGreaterThan(0.5);
    expect(result.layerName).toBe("nli");
  });

  test("penalizes off-topic responses", () => {
    const result = Effect.runSync(
      checkNli(
        "As an AI, I cannot provide that information. I apologize for any inconvenience.",
        "What is TypeScript?",
      ),
    );
    const relevant = Effect.runSync(
      checkNli(
        "TypeScript is a programming language developed by Microsoft for building typed JavaScript applications.",
        "What is TypeScript?",
      ),
    );
    expect(relevant.score).toBeGreaterThan(result.score);
  });
});
