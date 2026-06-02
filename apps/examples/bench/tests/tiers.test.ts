import { describe, it, expect } from "bun:test";
import { TIERS } from "../tiers.js";

describe("tier map", () => {
  it("defines frontier/mid/local with provider+model", () => {
    const names = TIERS.map((t) => t.tier).sort();
    expect(names).toEqual(["frontier", "local", "mid"]);
    for (const t of TIERS) {
      expect(t.provider.length).toBeGreaterThan(0);
      expect(t.model.length).toBeGreaterThan(0);
    }
  });
  it("does NOT include cogito:3b (runaway, excluded per harness-core)", () => {
    expect(TIERS.some((t) => t.model.includes("cogito:3b"))).toBe(false);
  });
});
