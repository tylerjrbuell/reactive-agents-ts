import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { agentComboItems, COMBO_CAP, comboSelectedLabel, filterComboItems, matchRank, stepIndex, type ComboItem } from "./combobox.js";
import type { MemoryAgent } from "./memory-studio.js";
import { renderComponent } from "./components/kit/test-render.js";

const agent = (n: number, over: Partial<MemoryAgent> = {}): MemoryAgent => {
  const agentId = `01JKZ${String(n).padStart(20, "0")}`;
  return { agentId, label: agentId, kind: "other", runCount: 0, lastRunAt: null, ...over };
};

describe("agentComboItems", () => {
  test("named agents first, recent first; unnamed after, never a bare ULID as the label", () => {
    const items = agentComboItems([
      agent(1, { label: "Old researcher", kind: "saved-agent", lastRunAt: 100, runCount: 2 }),
      agent(2),
      agent(3, { label: "New writer", kind: "chat", lastRunAt: 900, runCount: 1 }),
      agent(4, { lastRunAt: 500, runCount: 7 }),
    ]);
    expect(items.map((i) => [i.label, i.group])).toEqual([
      ["New writer", "Named"],
      ["Old researcher", "Named"],
      ["Unnamed agent", "Unnamed"],
      ["Unnamed agent", "Unnamed"],
    ]);
    // Within Unnamed: the one that ran (500) before the one that never did.
    expect(items[2]!.value).toBe(agent(4).agentId);
    expect(items[2]!.hint).toBe("01JKZ0…0004 · 7 runs");
    expect(items[0]!.hint).toBe("01JKZ0…0003 · 1 run");
    expect(items.some((i) => i.label.startsWith("01JKZ"))).toBe(false);
  });

  test("the full id stays searchable", () => {
    const items = agentComboItems([agent(42)]);
    expect(filterComboItems(items, agent(42).agentId).flat).toHaveLength(1);
  });
});

describe("filterComboItems", () => {
  const items: ComboItem[] = [
    { value: "a", label: "Research agent", group: "Named" },
    { value: "b", label: "Daily summary", group: "Named" },
    { value: "c", label: "Weekly research digest", group: "Named" },
    { value: "d", label: "Unnamed agent", hint: "01ABCD…9999", group: "Unnamed" },
  ];

  test("no query keeps the given order and groups", () => {
    const v = filterComboItems(items, "");
    expect(v.flat.map((i) => i.value)).toEqual(["a", "b", "c", "d"]);
    expect(v.sections.map((s) => s.group)).toEqual(["Named", "Unnamed"]);
    expect(v.hidden).toBe(0);
  });

  test("prefix beats word start beats substring beats hint", () => {
    expect(matchRank(items[0]!, "res")).toBe(0);
    expect(matchRank(items[2]!, "res")).toBe(1);
    expect(matchRank(items[1]!, "mmar")).toBe(2);
    expect(matchRank(items[3]!, "abcd")).toBe(3);
    expect(matchRank(items[1]!, "zzz")).toBe(-1);
    expect(filterComboItems(items, "res").flat.map((i) => i.value)).toEqual(["a", "c"]);
  });

  test("is case-insensitive; no match gives an empty view", () => {
    expect(filterComboItems(items, "DAILY").flat.map((i) => i.value)).toEqual(["b"]);
    const none = filterComboItems(items, "nope");
    expect(none).toEqual({ sections: [], flat: [], total: 0, hidden: 0 });
  });

  test("the cap limits rows, fills sections in order, and counts what it hid", () => {
    const many = Array.from({ length: 600 }, (_, i) => ({ value: `v${i}`, label: `Agent ${i}`, group: i < 500 ? "Named" : "Unnamed" }));
    const v = filterComboItems(many, "");
    expect(v.flat).toHaveLength(COMBO_CAP);
    expect(v.total).toBe(600);
    expect(v.hidden).toBe(600 - COMBO_CAP);
    expect(v.sections.map((s) => s.group)).toEqual(["Named"]);
    expect(filterComboItems(many, "Agent 59", 5).flat.map((i) => i.value)).toEqual(["v59", "v590", "v591", "v592", "v593"]);
  });

  test("filtering 600 agents is fast", () => {
    const many = Array.from({ length: 600 }, (_, i) => ({ value: `v${i}`, label: `Agent ${i}`, hint: `id ${i}` }));
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) filterComboItems(many, "agent 5");
    expect((performance.now() - t0) / 100).toBeLessThan(5);
  });
});

describe("stepIndex / comboSelectedLabel", () => {
  test("wraps both ways; empty list stays 0", () => {
    expect(stepIndex(2, 1, 3)).toBe(0);
    expect(stepIndex(0, -1, 3)).toBe(2);
    expect(stepIndex(0, 1, 0)).toBe(0);
  });

  test("the closed label is the name, the short id for an unnamed agent, or empty", () => {
    const items = agentComboItems([agent(1, { label: "Writer", kind: "chat" }), agent(2)]);
    expect(comboSelectedLabel(items, agent(1).agentId)).toBe("Writer");
    expect(comboSelectedLabel(items, agent(2).agentId)).toBe("Unnamed agent (01JKZ0…0002)");
    expect(comboSelectedLabel(items, "")).toBe("");
    expect(comboSelectedLabel(items, "someotherlongidvalue123")).toBe("someot…e123");
  });
});

describe("Combobox render weight (600 agents)", () => {
  test("renders at most the cap, where a native select rendered every agent", async () => {
    const agents = Array.from({ length: 600 }, (_, i) => agent(i, i % 3 === 0 ? { label: `Agent ${i}`, kind: "runs", lastRunAt: i } : {}));
    const items = agentComboItems(agents);
    const dir = join(import.meta.dir, "components/kit");
    const open = await renderComponent(join(dir, "Combobox.svelte"), { id: "x", label: "Agent", items, value: "" });
    // Closed: no list at all.
    expect(open.match(/role="option"/g)?.length ?? 0).toBe(0);
    // The kit Select also renders its list only when open, so 600 options cost nothing closed.
    const select = await renderComponent(join(dir, "Select.svelte"), { id: "y", options: items.map((i) => ({ value: i.value, label: i.label })) });
    expect(select.match(/role="option"/g)?.length ?? 0).toBe(0);
  });
});
