import { describe, it, expect } from "bun:test";
import { computeArgValidityRate } from "../src/arg-validity.js";

describe("computeArgValidityRate", () => {
  it("returns 1.0 when every call has a non-empty object arguments dict", () => {
    const rate = computeArgValidityRate([
      { toolName: "web-search", arguments: { query: "x" } },
      { toolName: "http-get", arguments: { url: "https://example.com" } },
    ]);
    expect(rate).toBe(1);
  });

  it("returns 0 when no calls were made", () => {
    expect(computeArgValidityRate([])).toBe(0);
  });

  it("docks fraction for malformed args", () => {
    const rate = computeArgValidityRate([
      { toolName: "web-search", arguments: { query: "ok" } },        // valid
      { toolName: "spawn-agent", arguments: { type: "object" } },     // schema leak
      { toolName: "file-write", arguments: {} },                       // empty
    ]);
    expect(rate).toBeCloseTo(1 / 3, 5);
  });

  it("rejects null arguments", () => {
    const rate = computeArgValidityRate([
      { toolName: "web-search", arguments: null },
    ]);
    expect(rate).toBe(0);
  });

  it("rejects array arguments", () => {
    const rate = computeArgValidityRate([
      { toolName: "web-search", arguments: ["query", "value"] },
    ]);
    expect(rate).toBe(0);
  });

  it("rejects string arguments (not object)", () => {
    const rate = computeArgValidityRate([
      { toolName: "web-search", arguments: "just a string" },
    ]);
    expect(rate).toBe(0);
  });

  it("detects schema leak: only key is 'type' with string value", () => {
    const rate = computeArgValidityRate([
      { toolName: "spawn-agent", arguments: { type: "object" } },
    ]);
    expect(rate).toBe(0);
  });

  it("allows objects with 'type' key alongside other keys", () => {
    const rate = computeArgValidityRate([
      { toolName: "spawn-agent", arguments: { type: "object", task: "do stuff" } },
    ]);
    expect(rate).toBe(1);
  });
});
