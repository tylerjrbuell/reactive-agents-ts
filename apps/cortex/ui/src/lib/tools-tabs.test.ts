import { describe, expect, test } from "bun:test";
import { customToolsOf, TOOLS_TABS, toolsTabCounts } from "./tools-tabs.js";

describe("customToolsOf", () => {
  test("only the Lab's own tools: kind custom and a lab: id (MCP and built-in entries are not counted)", () => {
    const catalog = [
      { kind: "custom", id: "lab:a" },
      { kind: "custom", id: "mcp:x/y" },
      { kind: "mcp", id: "lab:b" },
      { kind: "builtin", id: "file-read" },
    ];
    expect(customToolsOf(catalog)).toEqual([{ kind: "custom", id: "lab:a" }]);
    expect(customToolsOf([])).toEqual([]);
  });
});

describe("Lab > Tools sub-tabs", () => {
  test("three tabs: Servers, Custom tools, Catalog and test (the mixed Create tool panel is gone)", () => {
    expect(TOOLS_TABS.map((t) => t.label)).toEqual(["Servers", "Custom tools", "Catalog and test"]);
  });

  test("no counts while loading; counts after", () => {
    expect(toolsTabCounts(TOOLS_TABS, { servers: 2, custom: 0, catalog: 30 }, true).every((t) => t.count === undefined)).toBe(true);
    expect(toolsTabCounts(TOOLS_TABS, { servers: 2, custom: 0, catalog: 30 }, false).map((t) => t.count)).toEqual([2, 0, 30]);
  });
});
