import { describe, expect, test } from "bun:test";
import { foldAdvisory, type AdvisoryItem, type ChecklistFact } from "@reactive-agents/core";
import { applyTodoChecklistAction, renderTodoChecklist } from "../src/skills/todo.js";

/** Tiny ledger harness: apply an action, commit changes as facts, return folded items. */
function makeSession() {
  const facts: ChecklistFact[] = [];
  let seq = 0;
  return {
    items: (): readonly AdvisoryItem[] => foldAdvisory(facts),
    run(args: Record<string, unknown>) {
      const r = applyTodoChecklistAction(foldAdvisory(facts), args);
      for (const c of r.changes) facts.push({ kind: "checklist-item", seq: ++seq, iteration: 1, change: c });
      return r;
    },
  };
}

// P6a (2026-07-07): universal task checklist — leading-harness practice.
// Ported to the checklist API (Plan 3 Task 5). Malformed-entry parse case lives in
// packages/reasoning/src/kernel/state/checklist-migrate.test.ts.
describe("todo tool pure core", () => {
  test("add creates numbered pending items and renders full list", () => {
    const s = makeSession();
    const r = s.run({ action: "add", items: ["find file", "fix bug", "run tests"] });
    expect(r.ok).toBe(true);
    const items = s.items();
    expect(items.length).toBe(3);
    expect(items[0]).toMatchObject({ id: "1", title: "find file", status: "pending" });
    expect(r.rendered).toContain("0/3 done");
    expect(r.rendered).toContain("[ ] 2. fix bug");
  });

  test("done marks item and completion message appears when all done", () => {
    const s = makeSession();
    s.run({ action: "add", items: ["a", "b"] });
    let r = s.run({ action: "done", id: 1 });
    expect(r.rendered).toContain("[x] 1. a");
    expect(r.rendered).toContain("1/2 done");
    r = s.run({ action: "done", id: 2 });
    expect(r.rendered).toContain("All items done");
  });

  test("start marks in_progress", () => {
    const s = makeSession();
    s.run({ action: "add", items: ["a"] });
    const r = s.run({ action: "start", id: 1 });
    expect(r.rendered).toContain("[~] 1. a");
  });

  test("add appends with continuing ids", () => {
    const s = makeSession();
    s.run({ action: "add", items: ["a"] });
    s.run({ action: "add", items: ["b"] });
    expect(s.items().map((t) => t.id)).toEqual(["1", "2"]);
  });

  test("unknown id / action degrade with ok:false, never throw", () => {
    const s = makeSession();
    expect(s.run({ action: "done", id: 9 }).ok).toBe(false);
    const s1 = s.run({ action: "wat" });
    expect(s1.ok).toBe(false);
    expect(s1.rendered).toContain("Unknown action");
  });

  test("newline string form for items works (weak-model tolerance)", () => {
    const s = makeSession();
    s.run({ action: "add", items: "step one\nstep two" as unknown as string[] });
    expect(s.items().length).toBe(2);
  });

  test("empty render", () => {
    expect(renderTodoChecklist([])).toContain("empty");
  });
});
