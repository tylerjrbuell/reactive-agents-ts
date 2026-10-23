import { describe, it, expect } from "bun:test";
import { validateRationale, isRationale, type Rationale } from "../src/rationale.js";
import type { RationaleValidationError } from "../src/errors.js";

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

// D3 tagged-error identity (quality program Task 14, tranche 1).
// One case per converted throw site in src/rationale.ts: asserts the
// error VALUE now carries `_tag: "RationaleValidationError"` AND that the
// message is byte-identical to the pre-conversion string-error text.
describe("validateRationale tagged errors (D3)", () => {
  const thrownFrom = (value: unknown): RationaleValidationError => {
    let err: RationaleValidationError | undefined;
    try {
      validateRationale(value);
    } catch (e) {
      err = e as RationaleValidationError;
    }
    expect(err?._tag).toBe("RationaleValidationError");
    return err as RationaleValidationError;
  };

  // [input, expected message] — one row per converted site, in source order.
  const sites: ReadonlyArray<readonly [unknown, string]> = [
    ["string", "Rationale: must be an object"],
    [null, "Rationale: must be an object"],
    [{}, "Rationale: 'why' must be a non-empty string"],
    [{ why: "" }, "Rationale: 'why' must be a non-empty string"],
    [{ why: "x".repeat(281) }, "Rationale: 'why' must be ≤280 chars (got 281)"],
    [{ why: "ok", refs: ["a", 1] }, "Rationale: 'refs' must be string[]"],
    [{ why: "ok", alternatives: "nope" }, "Rationale: 'alternatives' must be an array"],
    [{ why: "ok", alternatives: ["nope"] }, "Rationale: each alternative must be an object"],
    [{ why: "ok", alternatives: [{ rejectedBecause: "r" }] }, "Rationale: alternative 'option' must be a non-empty string"],
    [{ why: "ok", alternatives: [{ option: "y" }] }, "Rationale: alternative 'rejectedBecause' is required"],
    [
      { why: "ok", alternatives: [{ option: "y", rejectedBecause: "x".repeat(161) }] },
      "Rationale: alternative 'rejectedBecause' must be ≤160 chars",
    ],
    [{ why: "ok", confidence: 1.5 }, "Rationale: 'confidence' must be in [0,1]"],
  ];

  for (const [value, message] of sites) {
    it(`throws tagged with byte-identical message: ${message}`, () => {
      expect(thrownFrom(value).message).toBe(message);
    });
  }
});
