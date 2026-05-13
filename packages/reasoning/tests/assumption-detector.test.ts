import { describe, it, expect } from "bun:test";
import { detectAssumptions } from "../src/kernel/capabilities/reason/assumption-detector.js";

describe("detectAssumptions", () => {
  it("extracts explicit 'I assume X because Y'", () => {
    const out = detectAssumptions("I assume the user wants USD because no currency given.");
    expect(out).toHaveLength(1);
    expect(out[0]?.assumption).toBe("the user wants USD");
    expect(out[0]?.rationale.why).toBe("no currency given");
  });

  it("extracts 'I assume X' without explicit reason (rationale.why = 'implicit')", () => {
    const out = detectAssumptions("I assume the user wants USD.");
    expect(out).toHaveLength(1);
    expect(out[0]?.rationale.why).toBe("implicit");
  });

  it("matches 'I am assuming X'", () => {
    const out = detectAssumptions("I am assuming the data is fresh.");
    expect(out).toHaveLength(1);
    expect(out[0]?.assumption).toBe("the data is fresh");
  });

  it("matches 'I assume that X'", () => {
    const out = detectAssumptions("I assume that prices are in USD.");
    expect(out).toHaveLength(1);
    expect(out[0]?.assumption).toBe("prices are in USD");
  });

  it("returns [] when no assumption marker present", () => {
    expect(detectAssumptions("I will search the web.")).toEqual([]);
  });

  it("returns [] for empty input", () => {
    expect(detectAssumptions("")).toEqual([]);
  });

  it("caps at 3 assumptions per call", () => {
    const text = "I assume A. I assume B. I assume C. I assume D.";
    expect(detectAssumptions(text)).toHaveLength(3);
  });

  it("is case-insensitive", () => {
    const out = detectAssumptions("i ASSUME the input is valid.");
    expect(out).toHaveLength(1);
  });

  it("handles multiline thought text", () => {
    const out = detectAssumptions("Looking at this:\nI assume X because Y.\nAlso, I assume Z.");
    expect(out).toHaveLength(2);
  });

  it("does not produce empty assumptions", () => {
    const out = detectAssumptions("I assume .");
    expect(out).toEqual([]);
  });
});
