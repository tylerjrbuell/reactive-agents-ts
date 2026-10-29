import { describe, it, expect } from "bun:test";
import type { AdvisoryItem } from "@reactive-agents/core";
import { applyTodoChecklistAction, renderTodoChecklist } from "../../src/skills/todo.js";

const item = (id: string, title: string, status: AdvisoryItem["status"] = "pending"): AdvisoryItem => ({
  id,
  seq: Number(id),
  title,
  status,
});
const two = [item("1", "a"), item("2", "b")];
const PLAN_ONE = "Plan recorded (1 item). Present the plan to the user and stop; do not start work.";
const PLAN_N = "Plan recorded (2 items). Present the plan to the user and stop; do not start work.";
const noExecGuidance = (s: string): void => {
  expect(s).not.toContain("Work the first unchecked item");
  expect(s).not.toContain("Mark progress");
  expect(s).not.toContain("final answer");
};

describe("todo posture", () => {
  it("execute default is byte-identical to explicit execute for every action", () => {
    const calls: Record<string, unknown>[] = [
      { action: "add", items: ["x", "y"] },
      { action: "start", id: 1 },
      { action: "done", id: 2 },
      { action: "list" },
      { action: "bogus" },
    ];
    for (const c of calls) {
      expect(applyTodoChecklistAction(two, c, "execute")).toEqual(applyTodoChecklistAction(two, c));
    }
    expect(applyTodoChecklistAction(two, { action: "list" }).rendered).toContain("Work the first unchecked item next");
    expect(renderTodoChecklist(two, "execute")).toBe(renderTodoChecklist(two));
  });

  it("plan add: closing line for 1 and N items", () => {
    const one = applyTodoChecklistAction([], { action: "add", items: ["a"] }, "plan");
    expect(one.rendered.split("\n").at(-1)).toBe(PLAN_ONE);
    noExecGuidance(one.rendered);
    expect(one.changes.length).toBe(1);
    const n = applyTodoChecklistAction([], { action: "add", items: ["a", "b"] }, "plan");
    expect(n.rendered.split("\n").at(-1)).toBe(PLAN_N);
    noExecGuidance(n.rendered);
  });

  it("plan empty list", () => {
    const r = applyTodoChecklistAction([], { action: "list" }, "plan");
    expect(r.ok).toBe(true);
    expect(r.rendered).toContain("No plan recorded yet");
    noExecGuidance(r.rendered);
    expect(r.rendered).not.toContain("Open: 0");
  });

  it("plan list/start/done keep plan closing and same ledger changes", () => {
    for (const c of [{ action: "list" }, { action: "start", id: 1 }, { action: "done", id: 1 }]) {
      const p = applyTodoChecklistAction(two, c, "plan");
      const e = applyTodoChecklistAction(two, c);
      expect(p.rendered.split("\n").at(-1)).toBe(PLAN_N);
      noExecGuidance(p.rendered);
      expect(p.changes).toEqual(e.changes);
      expect(p.ok).toBe(e.ok);
    }
  });

  it("plan error paths and duplicate add carry no execute guidance", () => {
    for (const c of [{ action: "add" }, { action: "bogus" }, { action: "done", id: 99 }, { action: "add", items: ["a"] }]) {
      const r = applyTodoChecklistAction(two, c, "plan");
      noExecGuidance(r.rendered);
      expect(r.rendered.split("\n").at(-1)).toBe(PLAN_N);
    }
  });
});
