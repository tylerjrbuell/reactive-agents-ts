import { describe, expect, test } from "bun:test";
import { resolveSynthesisConfigForStrategy, withoutStrategyIcsOverrides } from "../src/synthesis-resolve.js";

describe("withoutStrategyIcsOverrides", () => {
  test("strips ICS keys from a strategy bundle", () => {
    const stripped = withoutStrategyIcsOverrides({
      maxIterations: 3,
      temperature: 0.2,
      synthesis: "fast",
      synthesisModel: "x",
    } as Record<string, unknown>);
    expect(stripped).toEqual({ maxIterations: 3, temperature: 0.2 });
  });
});

describe("resolveSynthesisConfigForStrategy", () => {
  test("uses legacy synthesisConfig when reasoningOptions absent", () => {
    const cfg = resolveSynthesisConfigForStrategy(undefined, "reactive", { mode: "deep", model: "m1" });
    expect(cfg).toEqual({ mode: "deep", model: "m1" });
  });

  test("defaults to auto when no ro and no legacy", () => {
    expect(resolveSynthesisConfigForStrategy(undefined, "reactive")).toEqual({ mode: "auto" });
  });

  test("merges top-level reasoning synthesis", () => {
    const cfg = resolveSynthesisConfigForStrategy(
      { synthesis: "fast", synthesisModel: "mini" },
      "plan-execute-reflect",
    );
    expect(cfg.mode).toBe("fast");
    expect(cfg.model).toBe("mini");
  });

  test("per-strategy overrides win for mapped strategies", () => {
    const cfg = resolveSynthesisConfigForStrategy(
      {
        synthesis: "fast",
        strategies: {
          reactive: { synthesis: "deep", synthesisModel: "big" },
        },
      },
      "reactive",
    );
    expect(cfg.mode).toBe("deep");
    expect(cfg.model).toBe("big");
  });

  test("non-mapped strategy (adaptive) uses base only", () => {
    const cfg = resolveSynthesisConfigForStrategy(
      {
        synthesis: "off",
        strategies: {
          reactive: { synthesis: "deep" },
        },
      },
      "adaptive",
    );
    expect(cfg.mode).toBe("off");
  });

  test("tree-of-thought bundle overrides", () => {
    const cfg = resolveSynthesisConfigForStrategy(
      {
        synthesis: "fast",
        strategies: {
          treeOfThought: { synthesis: "deep", synthesisProvider: "openai" },
        },
      },
      "tree-of-thought",
    );
    expect(cfg.mode).toBe("deep");
    expect(cfg.provider).toBe("openai");
  });

  test("reflexion bundle overrides", () => {
    const cfg = resolveSynthesisConfigForStrategy(
      {
        synthesisTemperature: 0.1,
        strategies: {
          reflexion: { synthesisTemperature: 0.9 },
        },
      },
      "reflexion",
    );
    expect(cfg.temperature).toBe(0.9);
  });
});
