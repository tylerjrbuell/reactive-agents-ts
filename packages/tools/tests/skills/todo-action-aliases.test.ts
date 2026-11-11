import { describe, it, expect } from "bun:test";
import type { AdvisoryItem } from "@reactive-agents/core";
import { applyTodoChecklistAction, normalizeTodoAction } from "../../src/skills/todo.js";

const items: readonly AdvisoryItem[] = [
  { id: "1", seq: 1, title: "a", status: "pending" },
  { id: "2", seq: 2, title: "b", status: "in_progress" },
];

const TABLE: Record<string, string> = {
  create: "add", new: "add", plan: "add",
  mark_done: "done", complete: "done", finish: "done", finished: "done",
  begin: "start", in_progress: "start", working: "start",
  show: "list", status: "list",
  delete: "remove", rm: "remove", del: "remove",
  rename: "edit", "update-text": "edit", update_text: "edit",
  reset: "clear",
  batch: "patch",
};

describe("todo action aliases", () => {
  for (const [alias, canon] of Object.entries(TABLE)) {
    it(`${alias} -> ${canon}: same result and changes as canonical`, () => {
      const args = { id: 1, items: ["x", "y"], text: "z", ops: [{ id: 1, text: "w" }] };
      const healed = applyTodoChecklistAction(items, { ...args, action: alias });
      const canonical = applyTodoChecklistAction(items, { ...args, action: canon });
      expect(healed.rendered).toBe(canonical.rendered);
      expect(healed.ok).toBe(canonical.ok);
      expect(healed.changes).toEqual(canonical.changes);
      expect(healed.healedFrom).toBe(alias);
      expect(canonical.healedFrom).toBeUndefined();
    });
  }

  it("is case and whitespace tolerant", () => {
    expect(normalizeTodoAction("  Mark_Done ")).toEqual({ action: "done", healedFrom: "  Mark_Done " });
  });

  it("canonical actions are not marked healed", () => {
    for (const a of ["add", "start", "done", "reopen", "edit", "remove", "clear", "patch", "list"]) {
      expect(normalizeTodoAction(a)).toEqual({ action: a });
    }
  });

  it("table is closed: unknown strings still error with the exact message", () => {
    for (const bad of ["update", "finalize", ""]) {
      const r = applyTodoChecklistAction(items, { action: bad });
      expect(r.ok).toBe(false);
      expect(r.healedFrom).toBeUndefined();
      expect(r.rendered.startsWith(`Unknown action "${bad}". Valid: add | start | done | reopen | edit | remove | clear | patch | list.\n`)).toBe(true);
    }
  });

  it("delete heals to remove and emits a remove op, never a status change", () => {
    const r = applyTodoChecklistAction(items, { action: "delete", id: 1 });
    expect(r.ok).toBe(true);
    expect(r.healedTo).toBe("remove");
    expect(r.changes).toEqual([{ op: "remove", ids: ["1"] }]);
  });
});
