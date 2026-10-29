import { describe, it, expect } from "bun:test";
import { localFrameworkModelOptions, modelsFallbackNote } from "./framework-model-options-local.js";

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

describe("modelsFallbackNote", () => {
  it("is undefined when the list is live", () => {
    expect(modelsFallbackNote(true, undefined, 3)).toBeUndefined();
  });

  it("says built-in list and carries the reason when live is false", () => {
    const note = modelsFallbackNote(false, { reason: "no-credentials", message: "groq needs GROQ_API_KEY; none set" }, 2);
    expect(note).toContain("built-in list");
    expect(note).toContain("add GROQ_API_KEY in Settings");
  });

  it("asks for a typed model id when there are no built-in models either", () => {
    const note = modelsFallbackNote(false, { reason: "no-credentials", message: "groq needs GROQ_API_KEY; none set" }, 0);
    expect(note).toContain("Type a model id");
    expect(note).toContain("GROQ_API_KEY");
  });

  it("explains the fallback without a reason", () => {
    expect(modelsFallbackNote(false, undefined, 2)).toContain("built-in list");
  });
});
