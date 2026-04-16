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

  test("provider-derived tier: ollama → local", () => {
    const entry = lookupModel("some-new-ollama-model:7b", undefined, "ollama");
    expect(entry.tier).toBe("local");
  });

  test("provider-derived tier: anthropic → frontier", () => {
    const entry = lookupModel("claude-future-model", undefined, "anthropic");
    expect(entry.tier).toBe("frontier");
  });

  test("provider-derived tier: openai → frontier", () => {
    const entry = lookupModel("gpt-5-turbo", undefined, "openai");
    expect(entry.tier).toBe("frontier");
  });

  test("provider-derived tier: gemini → frontier", () => {
    const entry = lookupModel("gemini-3-flash", undefined, "gemini");
    expect(entry.tier).toBe("frontier");
  });

  test("provider-derived tier: litellm → unknown (deferred)", () => {
    const entry = lookupModel("litellm-proxy-model", undefined, "litellm");
    expect(entry.tier).toBe("unknown");
  });

  test("registry match takes priority over provider fallback", () => {
    // cogito:14b is in registry as "local" — passing "anthropic" as provider shouldn't change it
    const entry = lookupModel("cogito:14b", undefined, "anthropic");
    expect(entry.tier).toBe("local");
  });
});
