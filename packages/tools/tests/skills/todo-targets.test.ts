import { describe, expect, it } from "bun:test";
import type { AdvisoryItem } from "@reactive-agents/core";
import { applyTodoChecklistAction } from "../../src/skills/todo.js";
import { resolveTodoTargets } from "../../src/skills/todo-targets.js";

const mk = (id: string, title: string): AdvisoryItem => ({ id, seq: Number(id), title, status: "pending" });
const items: readonly AdvisoryItem[] = [mk("1", "find the file"), mk("2", "fix the bug"), mk("3", "run tests")];
const changedIds = (args: Record<string, unknown>): string[] =>
  applyTodoChecklistAction(items, args).changes.map((c) => (c.op === "status" ? c.id : "?"));

describe("todo target healing (done/start)", () => {
  it.each([
    ["number", { id: 2 }],
    ["numeric string", { id: "2" }],
    ["hash string", { id: "#2" }],
    ["index", { index: 2 }],
    ["number key", { number: "2" }],
    ["n", { n: 2 }],
    ["item number", { item: 2 }],
    ["title exact", { item: "fix the bug" }],
    ["title substring", { id: "bug" }],
    ["ids single", { ids: [2] }],
  ])("%s", (_n, extra) => {
    expect(changedIds({ action: "done", ...extra })).toEqual(["2"]);
  });

  it("marks several: array, csv string, ids", () => {
    expect(changedIds({ action: "done", id: [1, 3] })).toEqual(["1", "3"]);
    expect(changedIds({ action: "done", id: "1,2" })).toEqual(["1", "2"]);
    expect(changedIds({ action: "start", ids: [1, 2] })).toEqual(["1", "2"]);
  });

  it("unknown id names valid ids; ambiguous title refuses", () => {
    const r = applyTodoChecklistAction(items, { action: "done", id: 9 });
    expect(r.ok).toBe(false);
    expect(r.rendered).toContain("Valid ids: 1, 2, 3");
    const amb = resolveTodoTargets(items, { id: "the" });
    expect(amb.ok).toBe(false);
    const none = applyTodoChecklistAction(items, { action: "done" });
    expect(none.ok).toBe(false);
    expect(none.changes).toEqual([]);
  });

  it.each(["complete", "completed", "finish", "finished", "check", "tick", "mark_done", "mark-done", "markdone", "close"])(
    "action alias %s -> done, healedFrom kept",
    (verb) => {
      const r = applyTodoChecklistAction(items, { action: verb, id: 1 });
      expect(r.changes).toEqual([{ op: "status", id: "1", status: "completed" }]);
      expect(r.healedFrom).toBe(verb);
      expect(r.healedTo).toBe("done");
    },
  );

  it("update verb with ids+status heals to set-status", () => {
    const r = applyTodoChecklistAction(items, { action: "update", ids: [1, 2], status: "done" });
    expect(r.changes.length).toBe(2);
    expect(r.healedTo).toBe("status");
  });
});

describe("todo add corrective no-op", () => {
  it("all duplicates -> hint naming done/start", () => {
    const r = applyTodoChecklistAction(items, { action: "add", id: 1, items: ["find the file", "fix the bug"] });
    expect(r.ok).toBe(true);
    expect(r.changes).toEqual([]);
    expect(r.rendered).toContain("Nothing new added");
    expect(r.rendered).toContain('todo({action:"done", id:N})');
  });
  it("stray id/ids on add are ignored and new items still added", () => {
    const r = applyTodoChecklistAction(items, { action: "add", id: 1, ids: [2], items: ["new step"] });
    expect(r.ok).toBe(true);
    expect(r.changes).toEqual([{ op: "add", items: [{ id: "4", title: "new step" }] }]);
  });
});
