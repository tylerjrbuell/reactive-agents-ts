import { describe, it, expect } from "bun:test";
import { buildToolIndexText } from "../../../src/kernel/capabilities/reason/think.js";
import type { ToolSchema } from "../../../src/kernel/capabilities/attend/tool-formatting.js";

function tool(name: string, description: string): ToolSchema {
  return {
    name,
    description,
    parameters: [{ name: "query", type: "string", description: "", required: true }],
  };
}

describe("buildToolIndexText", () => {
  it("returns empty string when nothing is hidden", () => {
    const universe = [tool("a", "Does A.")];
    expect(buildToolIndexText(universe, universe)).toBe("");
  });

  it("lists every hidden tool with no cap", () => {
    const universe = [tool("a", "Does A."), tool("b", "Does B."), tool("c", "Does C.")];
    const visible = [universe[0]!];
    const text = buildToolIndexText(universe, visible);
    expect(text).toContain("- b(query: string) — Does B.");
    expect(text).toContain("- c(query: string) — Does C.");
    expect(text).not.toContain("more. Call discover-tools");
  });

  it("hybrid mode: truncates at maxEntries and names the overflow count", () => {
    const universe = [
      tool("a", "Does A."),
      tool("b", "Does B."),
      tool("c", "Does C."),
      tool("d", "Does D."),
    ];
    const visible: ToolSchema[] = [];
    const text = buildToolIndexText(universe, visible, 2);
    expect(text).toContain("- a(query: string) — Does A.");
    expect(text).toContain("- b(query: string) — Does B.");
    expect(text).not.toContain("- c(");
    expect(text).not.toContain("- d(");
    expect(text).toContain("…and 2 more. Call discover-tools with a query to search them.");
  });

  it("maxEntries at or above the hidden count is a no-op (no overflow line)", () => {
    const universe = [tool("a", "Does A."), tool("b", "Does B.")];
    const text = buildToolIndexText(universe, [], 5);
    expect(text).not.toContain("more. Call discover-tools");
  });
});
