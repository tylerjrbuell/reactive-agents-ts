import { describe, it, expect } from "bun:test";
import { extractUrls, validateCitations } from "../src/kernel/capabilities/verify/citation-policy.js";
import type { ReasoningStep } from "../src/types/index.js";

function observationStep(text: string): ReasoningStep {
  return {
    type: "observation",
    content: text,
  } as ReasoningStep;
}

describe("extractUrls", () => {
  it("finds http(s) URLs in text", () => {
    const urls = extractUrls("See https://halopedia.org/Master_Chief and http://example.com/x for details.");
    expect(urls).toEqual(["https://halopedia.org/Master_Chief", "http://example.com/x"]);
  });

  it("returns an empty array for text with no URLs", () => {
    expect(extractUrls("No links here.")).toEqual([]);
  });
});

describe("validateCitations", () => {
  it("ok:true when every cited URL appears in tool-observation evidence", () => {
    const steps = [observationStep("Fetched https://halopedia.org/Master_Chief -> Spartan-117")];
    const result = validateCitations("Per https://halopedia.org/Master_Chief, he is Spartan-117.", steps);
    expect(result.ok).toBe(true);
    expect(result.uncitedUrls).toEqual([]);
    expect(result.citedUrlCount).toBe(1);
  });

  it("ok:false when a cited URL never appeared in any observation", () => {
    const steps = [observationStep("Fetched https://halopedia.org/Master_Chief -> Spartan-117")];
    const result = validateCitations("Per https://halopedia.org/Cortana, she is an AI.", steps);
    expect(result.ok).toBe(false);
    expect(result.uncitedUrls).toEqual(["https://halopedia.org/Cortana"]);
  });

  it("ok:true (vacuously) when the output cites nothing", () => {
    const result = validateCitations("No sources needed for this answer.", []);
    expect(result.ok).toBe(true);
    expect(result.citedUrlCount).toBe(0);
  });
});
