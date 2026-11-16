import { describe, expect, test } from "bun:test";
import { foldAdvisory, type AdvisoryItem, type ChecklistItemFact } from "@reactive-agents/core";
import { applyTodoChecklistAction } from "../src/skills/todo.js";
import { applyTodoOps } from "../src/skills/todo-manage.js";

function makeSession() {
  const facts: ChecklistItemFact[] = [];
  let seq = 0;
  return {
    items: (): readonly AdvisoryItem[] => foldAdvisory(facts),
    run(args: Record<string, unknown>) {
      const r = applyTodoChecklistAction(foldAdvisory(facts), args, "execute", facts.map((f) => f.change));
      for (const c of r.changes) facts.push({ kind: "checklist-item", seq: ++seq, iteration: 1, change: c });
      return r;
    },
  };
}

describe("todo add: duplicate attaches its tool to a tool-less row", () => {
  test("structured tool on a near-duplicate sets the row tool and says so", () => {
    const s = makeSession();
    s.run({ action: "add", items: ["Fetch page views for the site"] });
    const r = s.run({ action: "add", items: [{ text: "fetch page views for the site", tool: "umami/stats" }] });
    expect(r.changes).toEqual([{ op: "tool", id: "1", tool: "umami/stats" }]);
    expect(s.items().length).toBe(1);
    expect(s.items()[0]?.tool).toBe("umami/stats");
    expect(r.rendered).toContain("Already on the list as #1 (open); set its tool to umami/stats.");
  });

  test("text hint on the duplicate attaches too", () => {
    const s = makeSession();
    s.run({ action: "add", items: ["Fetch page views for the site"] });
    const r = s.run({ action: "add", items: ["Fetch page views for the site (tool: umami/stats)"] });
    expect(r.changes).toEqual([{ op: "tool", id: "1", tool: "umami/stats" }]);
    expect(s.items()[0]?.tool).toBe("umami/stats");
  });

  test("row that already has a tool is left alone", () => {
    const s = makeSession();
    s.run({ action: "add", items: [{ text: "Fetch page views for the site", tool: "first" }] });
    const r = s.run({ action: "add", items: [{ text: "fetch page views for the site", tool: "second" }] });
    expect(r.changes).toEqual([]);
    expect(s.items()[0]?.tool).toBe("first");
    expect(r.rendered).toContain("not added");
  });

  test("duplicate without a tool changes nothing", () => {
    const s = makeSession();
    s.run({ action: "add", items: ["Fetch page views for the site"] });
    expect(s.run({ action: "add", items: ["fetch page views for the site"] }).changes).toEqual([]);
  });

  test("attach rides along with a genuinely new item", () => {
    const s = makeSession();
    s.run({ action: "add", items: ["Fetch page views for the site"] });
    const r = s.run({ action: "add", items: [{ text: "fetch page views for the site", tool: "t1" }, "write the summary"] });
    expect(r.changes.map((c) => c.op)).toEqual(["add", "tool"]);
    expect(s.items().map((t) => t.tool)).toEqual(["t1", undefined]);
  });
});

describe("applyTodoOps tool op mirrors core fold", () => {
  const base: readonly AdvisoryItem[] = [
    { id: "1", seq: 1, title: "run it (tool: from-text)", status: "in_progress", tool: "explicit" },
    { id: "2", seq: 2, title: "plain", status: "pending" },
  ];
  test("set wins; status and order untouched", () => {
    const next = applyTodoOps(base, [{ op: "tool", id: "2", tool: " x/y " }]);
    expect(next[1]).toEqual({ id: "2", seq: 2, title: "plain", status: "pending", tool: "x/y" });
    expect(next[0]).toEqual(base[0]!);
  });
  test("empty clears and falls back to the title hint", () => {
    expect(applyTodoOps(base, [{ op: "tool", id: "1", tool: "  " }])[0]?.tool).toBe("from-text");
    expect(applyTodoOps(base, [{ op: "tool", id: "1" }])[0]?.tool).toBe("from-text");
  });
  test("clear with no hint removes the key", () => {
    const next = applyTodoOps([{ id: "2", seq: 2, title: "plain", status: "pending", tool: "x" }], [{ op: "tool", id: "2" }]);
    expect("tool" in next[0]!).toBe(false);
  });
  test("unknown id and same value are no-ops; agrees with core foldAdvisory", () => {
    expect(applyTodoOps(base, [{ op: "tool", id: "9", tool: "z" }])).toEqual(base);
    expect(applyTodoOps(base, [{ op: "tool", id: "1", tool: "explicit" }])).toEqual(base);
    const facts: ChecklistItemFact[] = [
      { kind: "checklist-item", seq: 1, iteration: 1, change: { op: "add", items: [{ id: "1", title: "run it (tool: from-text)", tool: "explicit" }] } },
      { kind: "checklist-item", seq: 2, iteration: 1, change: { op: "tool", id: "1" } },
    ];
    expect(applyTodoOps([], facts.map((f) => f.change))).toEqual(foldAdvisory(facts));
  });
});
