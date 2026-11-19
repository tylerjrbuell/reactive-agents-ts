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

  it("says known models and carries the key hint when live is false", () => {
    const note = modelsFallbackNote(false, { reason: "no-credentials", message: "groq needs GROQ_API_KEY; none set" }, 2);
    expect(note).toBe(
      "Live list unavailable (save a key in Settings · Providers, or set GROQ_API_KEY in the server's environment and restart Cortex); showing known models.",
    );
  });

  it("names an out-of-credits account for reason quota", () => {
    const note = modelsFallbackNote(false, { reason: "quota", message: "xai 403: team has no credits" }, 12, "xai");
    expect(note).toBe("Live list unavailable: xai account out of credits or spending limit reached; showing known models.");
  });

  it("carries the message for any other reason", () => {
    const note = modelsFallbackNote(false, { reason: "http", message: "openai 500" }, 3);
    expect(note).toBe("Live list unavailable (openai 500); showing known models.");
  });

  it("asks for a typed model id when there are no known models either", () => {
    const note = modelsFallbackNote(false, { reason: "no-credentials", message: "groq needs GROQ_API_KEY; none set" }, 0);
    expect(note).toContain("no known models. Type a model id.");
    expect(note).toContain("GROQ_API_KEY");
  });

  it("explains the fallback without a reason", () => {
    expect(modelsFallbackNote(false, undefined, 2)).toBe("Live list unavailable; showing known models.");
  });
});
