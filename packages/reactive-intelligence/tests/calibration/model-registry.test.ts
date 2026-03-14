import { describe, test, expect } from "bun:test";
import { lookupModel } from "../../src/calibration/model-registry.js";

describe("model registry", () => {
  test("exact match for Ollama models", () => {
    const entry = lookupModel("cogito:14b");
    expect(entry.tier).toBe("local");
    expect(entry.logprobSupport).toBe(true);
    expect(entry.contextLimit).toBe(32_768);
  });

  test("prefix match for versioned Anthropic models", () => {
    const entry = lookupModel("claude-sonnet-4-20250514");
    expect(entry.tier).toBe("frontier");
    expect(entry.logprobSupport).toBe(false);
  });

  test("unknown model returns safe defaults", () => {
    const entry = lookupModel("totally-unknown-model-xyz");
    expect(entry.tier).toBe("unknown");
    expect(entry.logprobSupport).toBe(false);
    expect(entry.contextLimit).toBe(32_768);
  });

  test("custom models can be added via override", () => {
    const entry = lookupModel("my-custom-model", {
      "my-custom-model": { contextLimit: 8192, tier: "local", logprobSupport: true },
    });
    expect(entry.tier).toBe("local");
    expect(entry.contextLimit).toBe(8192);
  });
});
