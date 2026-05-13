import { describe, it, expect } from "bun:test";
import { validateRationale, isRationale, type Rationale } from "../src/rationale.js";

describe("Rationale", () => {
  it("accepts minimal rationale", () => {
    const r: Rationale = { why: "needs fresh data" };
    expect(validateRationale(r)).toEqual(r);
  });

  it("caps why at 280 chars", () => {
    const long = "x".repeat(281);
    expect(() => validateRationale({ why: long })).toThrow();
  });

  it("rejects empty why", () => {
    expect(() => validateRationale({ why: "" })).toThrow();
  });

  it("requires alternatives entries to have option + rejectedBecause", () => {
    expect(() =>
      validateRationale({
        why: "picked tool A",
        alternatives: [{ option: "tool B" } as never],
      }),
    ).toThrow();
  });

  it("accepts well-formed alternatives", () => {
    const r: Rationale = {
      why: "picked tool A",
      alternatives: [{ option: "tool B", rejectedBecause: "stale data" }],
    };
    expect(validateRationale(r).alternatives).toHaveLength(1);
  });

  it("validates confidence in [0,1]", () => {
    expect(() => validateRationale({ why: "x", confidence: 1.5 })).toThrow();
    expect(() => validateRationale({ why: "x", confidence: -0.1 })).toThrow();
    expect(validateRationale({ why: "x", confidence: 0.5 }).confidence).toBe(0.5);
  });

  it("preserves refs[]", () => {
    const r = validateRationale({ why: "x", refs: ["obs:1", "scratch:goal"] });
    expect(r.refs).toEqual(["obs:1", "scratch:goal"]);
  });

  it("isRationale type guard returns false for invalid", () => {
    expect(isRationale({ why: "" })).toBe(false);
    expect(isRationale(null)).toBe(false);
    expect(isRationale({})).toBe(false);
    expect(isRationale("string")).toBe(false);
  });

  it("isRationale returns true for valid", () => {
    expect(isRationale({ why: "ok" })).toBe(true);
  });

  it("caps rejectedBecause at 160 chars", () => {
    const long = "x".repeat(161);
    expect(() =>
      validateRationale({
        why: "ok",
        alternatives: [{ option: "y", rejectedBecause: long }],
      }),
    ).toThrow();
  });
});
