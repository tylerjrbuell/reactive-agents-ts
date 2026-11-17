import { describe, expect, test } from "bun:test";
import { TOOLS_TABS, toolsTabCounts } from "./tools-tabs.js";

describe("Lab > Tools sub-tabs", () => {
  test("three tabs: Servers, Custom tools, Catalog and test (the mixed Create tool panel is gone)", () => {
    expect(TOOLS_TABS.map((t) => t.label)).toEqual(["Servers", "Custom tools", "Catalog and test"]);
  });

  test("no counts while loading; counts after", () => {
    expect(toolsTabCounts(TOOLS_TABS, { servers: 2, custom: 0, catalog: 30 }, true).every((t) => t.count === undefined)).toBe(true);
    expect(toolsTabCounts(TOOLS_TABS, { servers: 2, custom: 0, catalog: 30 }, false).map((t) => t.count)).toEqual([2, 0, 30]);
  });
});
