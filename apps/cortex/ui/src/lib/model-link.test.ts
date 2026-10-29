import { describe, expect, it } from "bun:test";
import { modelHref, providerHref } from "./model-link.js";

describe("modelHref", () => {
  it("encodes ':' and keeps '/' as path separators", () => {
    expect(modelHref("ollama", "cogito:14b")).toBe("/models/ollama/cogito%3A14b");
    expect(modelHref("litellm", "openai/gpt-4o")).toBe("/models/litellm/openai/gpt-4o");
  });
  it("encodes awkward characters per segment and round-trips", () => {
    const href = modelHref("ollama", "hf.co/a b/c?d:e");
    expect(href).toBe("/models/ollama/hf.co/a%20b/c%3Fd%3Ae");
    expect(href.split("/").slice(3).map(decodeURIComponent).join("/")).toBe("hf.co/a b/c?d:e");
  });
  it("links a provider alone", () => {
    expect(providerHref("anthropic")).toBe("/models/anthropic");
  });
});
