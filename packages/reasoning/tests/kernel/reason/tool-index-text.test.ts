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

// 2026-08-19 (second fix, same day): buildToolIndexText USED to render a
// prose line for every capped/promoted tool — but buildToolIndexCallableSchemas
// promotes that SAME set into a real FC schema, so the name/params/
// description were being sent to the model TWICE (once as text, once as the
// structured tool it already sees). Found live: uncapped "index" mode cost
// MORE tokens per tool than "full" mode despite disclosing LESS information
// per tool. Fixed — a promoted tool needs no prose call-out at all (the
// schema IS the disclosure); only the truly-unreachable overflow (capped out,
// no schema, only reachable via discover-tools) still needs a mention, and
// only as a count.
describe("buildToolIndexText", () => {
  it("returns empty string when nothing is hidden", () => {
    const universe = [tool("a", "Does A.")];
    expect(buildToolIndexText(universe, universe)).toBe("");
  });

  it("no cap ⇒ everything hidden gets promoted ⇒ no prose needed at all", () => {
    const universe = [tool("a", "Does A."), tool("b", "Does B."), tool("c", "Does C.")];
    const visible = [universe[0]!];
    expect(buildToolIndexText(universe, visible)).toBe("");
  });

  it("hybrid mode: capped tools get no prose (promoted); overflow gets a count-only note", () => {
    const universe = [
      tool("a", "Does A."),
      tool("b", "Does B."),
      tool("c", "Does C."),
      tool("d", "Does D."),
    ];
    const visible: ToolSchema[] = [];
    const text = buildToolIndexText(universe, visible, 2);
    expect(text).not.toContain("Does A.");
    expect(text).not.toContain("Does B.");
    expect(text).not.toContain("- a(");
    expect(text).toContain("2 additional tool(s)");
    expect(text).toContain("discover-tools");
  });

  it("maxEntries at or above the hidden count is a no-op (no overflow note)", () => {
    const universe = [tool("a", "Does A."), tool("b", "Does B.")];
    const text = buildToolIndexText(universe, [], 5);
    expect(text).toBe("");
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
