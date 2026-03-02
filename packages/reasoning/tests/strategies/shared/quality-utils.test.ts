import { describe, it, expect } from "bun:test";
import { isSatisfied, isCritiqueStagnant, parseScore } from "../../../src/strategies/shared/quality-utils.js";

describe("isSatisfied", () => {
  it("returns true for SATISFIED: prefix", () => {
    expect(isSatisfied("SATISFIED: The response is complete and accurate.")).toBe(true);
  });

  it("returns true for SATISFIED with space", () => {
    expect(isSatisfied("SATISFIED The result meets requirements.")).toBe(true);
  });

  it("returns false for improvement-needed text", () => {
    expect(isSatisfied("The response needs more examples.")).toBe(false);
  });

  it("returns false for text that contains SATISFIED mid-sentence", () => {
    expect(isSatisfied("I am not satisfied with this response.")).toBe(false);
  });
});

describe("isCritiqueStagnant", () => {
  it("returns false when no previous critiques", () => {
    expect(isCritiqueStagnant([], "new critique")).toBe(false);
  });

  it("returns true when critique is identical to last", () => {
    const prev = ["The response lacks examples."];
    expect(isCritiqueStagnant(prev, "The response lacks examples.")).toBe(true);
  });

  it("returns true for normalized match (different whitespace/case)", () => {
    const prev = ["The response  lacks  examples."];
    expect(isCritiqueStagnant(prev, "the response lacks examples.")).toBe(true);
  });

  it("returns true when critique is 80%+ substring overlap with last", () => {
    const prev = ["The response is missing detail about quantum states and entanglement"];
    // New critique is mostly the same (first 80% matches)
    expect(isCritiqueStagnant(prev, "The response is missing detail about quantum states and entanglement phenomena")).toBe(true);
  });

  it("returns false for genuinely different critiques", () => {
    const prev = ["Lacks concrete examples"];
    expect(isCritiqueStagnant(prev, "Grammar and spelling errors throughout the text")).toBe(false);
  });

  it("only compares against the LAST critique, not all previous ones", () => {
    const prev = ["Old critique 1", "Old critique 2", "Recent: lacks depth"];
    // Same as "Old critique 1" but not same as most recent
    expect(isCritiqueStagnant(prev, "Old critique 1")).toBe(false);
  });
});

describe("parseScore", () => {
  it("parses percentage: '75%' → 0.75", () => {
    expect(parseScore("75%")).toBe(0.75);
  });

  it("parses ratio: '3/4' → 0.75", () => {
    expect(parseScore("3/4")).toBeCloseTo(0.75);
  });

  it("parses decimal: '0.8' → 0.8", () => {
    expect(parseScore("0.8")).toBe(0.8);
  });

  it("parses labeled decimal: 'Score: 0.7' → 0.7", () => {
    expect(parseScore("Score: 0.7")).toBe(0.7);
  });

  it("parses labeled integer (0–10 scale): 'Rating: 7' → 0.7", () => {
    expect(parseScore("Rating: 7")).toBeCloseTo(0.7);
  });

  it("clamps to [0, 1]: '150%' → 1.0", () => {
    expect(parseScore("150%")).toBe(1.0);
  });

  it("strips <think>...</think> tags before parsing", () => {
    expect(parseScore("<think>Some reasoning here</think>\n0.8")).toBe(0.8);
  });

  it("returns 0.5 as safe default for unparseable input", () => {
    expect(parseScore("I think this response is quite good")).toBe(0.5);
  });

  it("returns 0.5 for empty string", () => {
    expect(parseScore("")).toBe(0.5);
  });
});
