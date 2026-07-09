import { describe, expect, test } from "bun:test";
import { resolveAdaptiveModelPool } from "./adaptive-model-pool.js";

// G2 pool resolution (meta-loop Phase 6). Three-way gate: adaptive + configured
// pool + routable provider. Any gate fails → undefined → no routing (byte-identical).

const BASE = {
  adaptiveHarness: true as boolean | undefined,
  modelRouting: {} as
    | { tierModels?: Partial<Record<"haiku" | "sonnet" | "opus", string>>; minTier?: "haiku" | "sonnet" | "opus" }
    | undefined,
  provider: "anthropic" as string | undefined,
  strongModel: "claude-opus-4-8",
  estimatedPromptTokens: 500,
};

describe("resolveAdaptiveModelPool — gates", () => {
  test("all gates pass → a pool with a distinct cheap tier", () => {
    const pool = resolveAdaptiveModelPool(BASE);
    expect(pool).toBeDefined();
    expect(pool?.strong).toBe("claude-opus-4-8");
    // The cheapest capable anthropic model is not the configured opus model.
    expect(pool?.cheap).not.toBe("claude-opus-4-8");
    expect(typeof pool?.cheap).toBe("string");
  });

  test("gate (a): not adaptive → undefined", () => {
    expect(resolveAdaptiveModelPool({ ...BASE, adaptiveHarness: false })).toBeUndefined();
    expect(resolveAdaptiveModelPool({ ...BASE, adaptiveHarness: undefined })).toBeUndefined();
  });

  test("gate (b): no configured model routing → undefined", () => {
    expect(resolveAdaptiveModelPool({ ...BASE, modelRouting: undefined })).toBeUndefined();
  });

  test("gate (c): unroutable provider (e.g. 'test') → undefined", () => {
    expect(resolveAdaptiveModelPool({ ...BASE, provider: "test" })).toBeUndefined();
    expect(resolveAdaptiveModelPool({ ...BASE, provider: undefined })).toBeUndefined();
  });
});

describe("resolveAdaptiveModelPool — degenerate cases", () => {
  test("cheapest capable model already IS the configured model → undefined (byte-identical)", () => {
    // Pin the configured model to the cheapest tier's model via a tier override,
    // so cheap === strong and there is nothing to route.
    const pool = resolveAdaptiveModelPool({
      ...BASE,
      strongModel: "my-cheap-model",
      modelRouting: { tierModels: { haiku: "my-cheap-model" } },
    });
    expect(pool).toBeUndefined();
  });

  test("tierModels override is honoured for the cheap tier", () => {
    const pool = resolveAdaptiveModelPool({
      ...BASE,
      modelRouting: { tierModels: { haiku: "custom-cheap" } },
    });
    expect(pool?.cheap).toBe("custom-cheap");
  });
});
