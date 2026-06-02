import { describe, it, expect } from "bun:test";
import { sectionCoverage } from "../faithfulness.js";

describe("sectionCoverage", () => {
  it("is 1.0 when all expected sections are present", () => {
    const r = sectionCoverage("## A\nx\n## B\ny", ["## A", "## B"]);
    expect(r.coverage).toBe(1);
    expect(r.missing).toEqual([]);
  });
  it("is fractional and lists the missing sections", () => {
    const r = sectionCoverage("## A\nx", ["## A", "## B"]);
    expect(r.coverage).toBe(0.5);
    expect(r.missing).toEqual(["## B"]);
  });
  it("treats absent/empty deliverable as 0 coverage", () => {
    expect(sectionCoverage(null, ["## A"]).coverage).toBe(0);
    expect(sectionCoverage("", ["## A"]).coverage).toBe(0);
  });
});
