import { describe, it, expect } from "bun:test";
import { buildToolIndexText, buildToolIndexCallableSchemas } from "../../../src/kernel/capabilities/reason/think.js";
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

// 2026-08-19 root-cause fix: buildToolIndexText only renders PROSE — it never
// made a hidden tool actually callable. The wire-level FC `tools:` array is
// built from a completely separate path (toolSurface.callable), so an
// index-listed tool was structurally uninvokable on native-fc dialects
// (confirmed live: 0% solved across a 5-rep, 2-catalog ablation). This is
// the other half of the fix — promoting the SAME capped hidden set into real
// callable schemas.
describe("buildToolIndexCallableSchemas", () => {
  it("returns nothing when nothing is hidden", () => {
    const universe = [tool("a", "Does A.")];
    expect(buildToolIndexCallableSchemas(universe, universe)).toEqual([]);
  });

  it("promotes every hidden tool with a trimmed (first-sentence-only) description", () => {
    const universe = [
      tool("a", "Does A."),
      tool("b", "Does B. Also does more B things in detail."),
    ];
    const promoted = buildToolIndexCallableSchemas(universe, [universe[0]!]);
    expect(promoted).toHaveLength(1);
    expect(promoted[0]!.name).toBe("b");
    expect(promoted[0]!.description).toBe("Does B.");
    // Params must survive verbatim — this is what makes the tool actually
    // invocable, not just visible.
    expect(promoted[0]!.parameters).toEqual(universe[1]!.parameters);
  });

  it("respects the same cap as buildToolIndexText — prose and callability never diverge", () => {
    const universe = [tool("a", "A."), tool("b", "B."), tool("c", "C."), tool("d", "D.")];
    const promoted = buildToolIndexCallableSchemas(universe, [], 2);
    expect(promoted.map((ts) => ts.name)).toEqual(["a", "b"]);
  });
});
