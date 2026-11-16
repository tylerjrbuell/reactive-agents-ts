import { describe, expect, test } from "bun:test";
import { findingToolChip, findingsLabel, findingsOfPlan, withoutFinding } from "./plan-findings.js";

const F1 = { id: "f1", tool: "umami/get-websites", summary: "id abc" };
const F2 = { id: "f2", tool: "web-search", summary: "docs url" };

describe("findingsOfPlan", () => {
  test("reads findings and drops malformed entries", () => {
    expect(findingsOfPlan({ findings: [F1, { id: 3 }, null, F2] })).toEqual([F1, F2]);
  });
  test("[] for no plan, no field, or a non-array", () => {
    expect(findingsOfPlan(null)).toEqual([]);
    expect(findingsOfPlan(undefined)).toEqual([]);
    expect(findingsOfPlan({})).toEqual([]);
    expect(findingsOfPlan({ findings: "x" })).toEqual([]);
  });
});

describe("withoutFinding", () => {
  test("removes by id", () => expect(withoutFinding([F1, F2], "f1")).toEqual([F2]));
  test("returns the same list when the id is absent", () => {
    const list = [F1, F2];
    expect(withoutFinding(list, "zz")).toBe(list);
  });
});

describe("labels", () => {
  test("count label", () => expect(findingsLabel(3)).toBe("Findings (3)"));
  test("namespaced tool shows its short name and keeps the full name as title", () => {
    expect(findingToolChip("umami/get-websites")).toEqual({ label: "get-websites", title: "umami/get-websites" });
    expect(findingToolChip("web-search")).toEqual({ label: "web-search", title: "web-search" });
    expect(findingToolChip("odd/")).toEqual({ label: "odd/", title: "odd/" });
  });
});
