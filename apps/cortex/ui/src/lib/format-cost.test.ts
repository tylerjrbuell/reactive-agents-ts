import { describe, expect, it } from "bun:test";
import { formatUsd } from "./format-cost.js";

describe("formatUsd", () => {
  it("renders an exact known zero as $0.0000", () => {
    expect(formatUsd(0)).toBe("$0.0000");
  });
  it("never renders a positive sub-0.0001 amount as zero", () => {
    expect(formatUsd(1e-9)).toBe("<$0.0001");
    expect(formatUsd(0.00000795)).toBe("<$0.0001");
  });
  it("uses 4 decimals from 0.0001 up", () => {
    expect(formatUsd(0.0001)).toBe("$0.0001");
    expect(formatUsd(0.0003939)).toBe("$0.0004");
    expect(formatUsd(0.0123)).toBe("$0.0123");
    expect(formatUsd(1.5)).toBe("$1.5000");
  });
});
