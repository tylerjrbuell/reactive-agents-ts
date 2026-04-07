import { describe, it, expect } from "bun:test";
import { localFrameworkModelOptions } from "./framework-model-options-local.js";

describe("localFrameworkModelOptions", () => {
  it("returns anthropic presets + default", () => {
    const opts = localFrameworkModelOptions("anthropic");
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.some((o) => o.value.includes("claude"))).toBe(true);
  });

  it("returns empty for ollama (live tags from API only)", () => {
    expect(localFrameworkModelOptions("ollama")).toEqual([]);
  });
});
