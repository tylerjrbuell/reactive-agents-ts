import { describe, it, expect } from "bun:test";
import { chooseStructuredEngine } from "./structured-route.js";

describe("chooseStructuredEngine", () => {
  it("respects explicit fast", () => {
    expect(chooseStructuredEngine({ mode: "fast", nativeJsonMode: true, toolsRegistered: true, calibrated: false })).toBe("fast");
  });
  it("respects explicit grounded", () => {
    expect(chooseStructuredEngine({ mode: "grounded", nativeJsonMode: true, toolsRegistered: false, calibrated: true })).toBe("grounded");
  });
  it("auto → grounded when tools registered", () => {
    expect(chooseStructuredEngine({ mode: "auto", nativeJsonMode: true, toolsRegistered: true, calibrated: true })).toBe("grounded");
  });
  it("auto → grounded when uncalibrated/local", () => {
    expect(chooseStructuredEngine({ mode: "auto", nativeJsonMode: false, toolsRegistered: false, calibrated: false })).toBe("grounded");
  });
  it("auto → fast when frontier+native+no tools", () => {
    expect(chooseStructuredEngine({ mode: "auto", nativeJsonMode: true, toolsRegistered: false, calibrated: true })).toBe("fast");
  });
});
