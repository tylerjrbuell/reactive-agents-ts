import { describe, expect, test } from "bun:test";
import { foldAdvisory, type AdvisoryItem, type ChecklistItemFact } from "@reactive-agents/core";
import { applyTodoChecklistAction, renderTodoChecklist } from "../src/skills/todo.js";

/** Tiny ledger harness: apply an action, commit changes as facts, return folded items. */
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
    // boundary: deliberately malformed input (string where string[] is declared)
    s.run({ action: "add", items: "step one\nstep two" as unknown as string[] });
    expect(s.items().length).toBe(2);
  });

  test("empty render", () => {
    expect(renderTodoChecklist([])).toContain("empty");
  });
});

// Census 2026-11-10: models invented `create_list` and `clear`. Obvious intents
// map to the valid action; `clear`/`reset` stay errors that list the valid set.
describe("todo action aliases (trap heals)", () => {
  test.each(["create", "create_list", "plan", "add_items"])("%s → add", (verb) => {
    const s = makeSession();
    const r = s.run({ action: verb, items: ["one", "two"] });
    expect(r.ok).toBe(true);
    expect(r.healedTo).toBe("add");
    expect(s.items().map((t) => t.title)).toEqual(["one", "two"]);
  });

  test.each(["complete", "finish", "check"])("%s → done", (verb) => {
    const s = makeSession();
    s.run({ action: "add", items: ["one"] });
    const r = s.run({ action: verb, id: 1 });
    expect(r.ok).toBe(true);
    expect(r.healedTo).toBe("done");
    expect(s.items()[0]?.status).toBe("completed");
  });

  test.each(["begin", "in_progress"])("%s → start", (verb) => {
    const s = makeSession();
    s.run({ action: "add", items: ["one"] });
    const r = s.run({ action: verb, id: 1 });
    expect(r.healedTo).toBe("start");
    expect(s.items()[0]?.status).toBe("in_progress");
  });

  test.each(["show", "view", "get"])("%s → list", (verb) => {
    const s = makeSession();
    const r = s.run({ action: verb });
    expect(r.ok).toBe(true);
    expect(r.healedTo).toBe("list");
  });

  test.each(["clear", "reset"])("%s empties the list through the ledger", (verb) => {
    const s = makeSession();
    s.run({ action: "add", items: ["one", "two"] });
    const r = s.run({ action: verb });
    expect(r.ok).toBe(true);
    expect(s.items()).toHaveLength(0);
  });
});

// 2026-11-11 (owner): agents manage their list (edit, remove, clear, patch).
describe("todo list management through the ledger fold", () => {
  test("remove-then-add yields a new id, never a reused one", () => {
    const s = makeSession();
    s.run({ action: "add", items: ["a", "b", "c"] });
    s.run({ action: "remove", id: 3 });
    s.run({ action: "add", items: ["d"] });
    expect(s.items().map((t) => [t.id, t.title])).toEqual([["1", "a"], ["2", "b"], ["4", "d"]]);
  });

  test("clear then add starts after the old ids", () => {
    const s = makeSession();
    s.run({ action: "add", items: ["a", "b"] });
    s.run({ action: "clear" });
    s.run({ action: "add", items: ["c"] });
    expect(s.items().map((t) => t.id)).toEqual(["3"]);
  });

  test("edit, patch and completed-only clear fold as rendered", () => {
    const s = makeSession();
    s.run({ action: "add", items: ["a", "b", "c"] });
    s.run({ action: "edit", id: 1, text: "A" });
    const p = s.run({ action: "patch", ops: [{ id: 2, status: "done" }, { remove: 3 }] });
    expect(renderTodoChecklist(s.items())).toBe(p.rendered.split("\n").slice(1, -1).join("\n"));
    s.run({ action: "clear", status: "completed" });
    expect(s.items()).toEqual([{ id: "1", seq: 1, title: "A", status: "pending" }]);
  });
});
