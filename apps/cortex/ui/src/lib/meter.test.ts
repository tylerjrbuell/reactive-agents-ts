import { describe, expect, test } from "bun:test";
import { meterFraction, meterWidth } from "./meter.js";

describe("meter", () => {
  test("fraction of max, clamped", () => {
    expect(meterFraction(0.5)).toBe(0.5);
    expect(meterFraction(3, 4)).toBe(0.75);
    expect(meterFraction(9, 4)).toBe(1);
    expect(meterFraction(-1, 4)).toBe(0);
  });

  test("bad input reads empty", () => {
    expect(meterFraction(1, 0)).toBe(0);
    expect(meterFraction(Number.NaN, 4)).toBe(0);
  });

  test("width as a percentage", () => {
    expect(meterWidth(0.425)).toBe("42.5%");
    expect(meterWidth(2, 3)).toBe("66.7%");
  });
});
