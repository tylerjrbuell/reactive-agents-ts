import { describe, it, expect } from "bun:test";
import { getVariant } from "../src/session.js";

describe("assembly A/B variants", () => {
  it("ra-full-assembly-off sets RA_ASSEMBLY=0 via config.env", () => {
    const v = getVariant("ra-full-assembly-off");
    expect(v.type).toBe("internal");
    if (v.type === "internal") expect(v.config.env?.RA_ASSEMBLY).toBe("0");
  });
  it("ra-full (default project()) exists as the baseline arm", () => {
    expect(getVariant("ra-full").id).toBe("ra-full");
  });
});
