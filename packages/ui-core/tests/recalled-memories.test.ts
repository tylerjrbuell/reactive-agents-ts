import { describe, expect, test } from "bun:test";
import { foldRecalledMemories, MAX_RECALLED_MEMORIES, memoryRecalledOf } from "../src/index.js";

describe("memoryRecalledOf", () => {
  test("reads a MemoryRecalled payload and drops items without an id", () => {
    const got = memoryRecalledOf({
      _tag: "MemoryRecalled",
      taskId: "t1",
      tier: "semantic",
      query: "the cat",
      items: [{ id: "a", tier: "semantic", summary: "cats", score: 0.8, importance: 0.5 }, { summary: "no id" }, { id: "" }],
    });
    expect(got).toEqual({
      tier: "semantic",
      query: "the cat",
      taskId: "t1",
      items: [{ id: "a", tier: "semantic", summary: "cats", score: 0.8, importance: 0.5 }],
    });
  });

  test("anything else is undefined", () => {
    expect(memoryRecalledOf(null)).toBeUndefined();
    expect(memoryRecalledOf({ tier: "semantic" })).toBeUndefined();
    expect(memoryRecalledOf({ items: [] })).toBeUndefined();
  });
});

describe("foldRecalledMemories", () => {
  test("lists every recalled item in order, with tier, summary, score and importance", () => {
    const view = foldRecalledMemories([
      { tier: "semantic", items: [{ id: "s1", tier: "semantic", summary: "fact one", score: 0.9, importance: 0.4 }] },
      { tier: "procedural", items: [{ id: "p1", tier: "procedural", summary: "how to" }] },
    ]);
    expect(view).toEqual([
      { id: "s1", tier: "semantic", summary: "fact one", score: 0.9, importance: 0.4 },
      { id: "p1", tier: "procedural", summary: "how to" },
    ]);
  });

  test("the same item recalled twice is listed once; a later score fills a missing one", () => {
    const view = foldRecalledMemories([
      { tier: "semantic", items: [{ id: "s1", tier: "semantic", summary: "x" }] },
      { tier: "semantic", query: "q", items: [{ id: "s1", tier: "semantic", summary: "x", score: 0.7 }] },
    ]);
    expect(view).toEqual([{ id: "s1", tier: "semantic", summary: "x", score: 0.7 }]);
  });

  test("the same id in two tiers is two memories; the query that surfaced an item is kept", () => {
    const view = foldRecalledMemories([
      { tier: "semantic", query: "q1", items: [{ id: "x", tier: "semantic", summary: "a" }] },
      { tier: "episodic", items: [{ id: "x", tier: "episodic", summary: "b" }] },
    ]);
    expect(view.map((v) => [v.tier, v.query])).toEqual([["semantic", "q1"], ["episodic", undefined]]);
  });

  test("none reported is empty, and the list is capped", () => {
    expect(foldRecalledMemories([])).toEqual([]);
    const items = Array.from({ length: MAX_RECALLED_MEMORIES + 20 }, (_, i) => ({ id: `i${i}`, tier: "semantic", summary: "s" }));
    expect(foldRecalledMemories([{ tier: "semantic", items }])).toHaveLength(MAX_RECALLED_MEMORIES);
  });
});
