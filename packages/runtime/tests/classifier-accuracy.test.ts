import { describe, it, expect } from "bun:test";
import { diffClassifierAccuracy } from "../src/classifier-accuracy.js";

describe("diffClassifierAccuracy", () => {
  it("returns empty arrays when classifier matches actual", () => {
    const r = diffClassifierAccuracy(["web-search"], ["web-search"]);
    expect(r.falsePositives).toEqual([]);
    expect(r.falseNegatives).toEqual([]);
  });

  it("flags required-but-not-called as false positives", () => {
    const r = diffClassifierAccuracy(["web-search", "code-execute"], ["web-search"]);
    expect(r.falsePositives).toEqual(["code-execute"]);
  });

  it("flags called-heavily-but-not-required as false negatives when >=2 calls", () => {
    const r = diffClassifierAccuracy(
      [],
      ["http-get", "http-get", "http-get"],
    );
    expect(r.falseNegatives).toEqual(["http-get"]);
  });

  it("does NOT flag single incidental calls as false negatives", () => {
    const r = diffClassifierAccuracy([], ["http-get"]);
    expect(r.falseNegatives).toEqual([]);
  });

  it("handles empty inputs gracefully", () => {
    const r = diffClassifierAccuracy([], []);
    expect(r.falsePositives).toEqual([]);
    expect(r.falseNegatives).toEqual([]);
  });

  it("deduplicates false negatives when same tool called many times", () => {
    const r = diffClassifierAccuracy([], ["web-search", "web-search", "web-search", "web-search"]);
    expect(r.falseNegatives).toEqual(["web-search"]);
  });
});
