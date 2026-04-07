import { describe, expect, it } from "bun:test";
import { listFrameworkModelsForProvider } from "../src/model-catalog.js";

describe("listFrameworkModelsForProvider", () => {
  it("returns Anthropic presets from ModelPresets", () => {
    const m = listFrameworkModelsForProvider("anthropic");
    expect(m.length).toBeGreaterThan(0);
    expect(m.some((x) => x.name.includes("claude"))).toBe(true);
  });

  it("returns OpenAI presets", () => {
    const m = listFrameworkModelsForProvider("openai");
    expect(m.map((x) => x.name)).toContain("gpt-4o");
  });

  it("returns Gemini presets plus default if missing from presets", () => {
    const m = listFrameworkModelsForProvider("gemini");
    expect(m.length).toBeGreaterThan(0);
  });

  it("returns LiteLLM placeholder from framework default", () => {
    const m = listFrameworkModelsForProvider("litellm");
    expect(m).toHaveLength(1);
    expect(m[0]!.name).toBe("gpt-4o");
  });

  it("returns test model", () => {
    const m = listFrameworkModelsForProvider("test");
    expect(m[0]!.name).toBe("test-model");
  });

  it("returns empty for ollama", () => {
    expect(listFrameworkModelsForProvider("ollama")).toEqual([]);
  });
});
