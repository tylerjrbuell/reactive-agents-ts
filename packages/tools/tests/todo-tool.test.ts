import { describe, expect, test } from "bun:test";
import { applyTodoAction, parseTodoList, renderTodoList } from "../src/skills/todo.js";

// P6a (2026-07-07): universal task checklist — leading-harness practice.
describe("todo tool pure core", () => {
  test("add creates numbered pending items and renders full list", () => {
    const r = applyTodoAction(undefined, { action: "add", items: ["find file", "fix bug", "run tests"] });
    expect(r.ok).toBe(true);
    expect(r.list.length).toBe(3);
    expect(r.list[0]).toEqual({ id: 1, text: "find file", status: "pending" });
    expect(r.rendered).toContain("0/3 done");
    expect(r.rendered).toContain("[ ] 2. fix bug");
  });

  test("done marks item and completion message appears when all done", () => {
    let state = applyTodoAction(undefined, { action: "add", items: ["a", "b"] });
    state = applyTodoAction(JSON.stringify(state.list), { action: "done", id: 1 });
    expect(state.rendered).toContain("[x] 1. a");
    expect(state.rendered).toContain("1/2 done");
    state = applyTodoAction(JSON.stringify(state.list), { action: "done", id: 2 });
    expect(state.rendered).toContain("All items done");
  });

  test("start marks in_progress", () => {
    let state = applyTodoAction(undefined, { action: "add", items: ["a"] });
    state = applyTodoAction(JSON.stringify(state.list), { action: "start", id: 1 });
    expect(state.rendered).toContain("[~] 1. a");
  });

  test("add appends with continuing ids", () => {
    let state = applyTodoAction(undefined, { action: "add", items: ["a"] });
    state = applyTodoAction(JSON.stringify(state.list), { action: "add", items: ["b"] });
    expect(state.list.map((t) => t.id)).toEqual([1, 2]);
  });

  test("unknown id / action degrade with ok:false, never throw", () => {
    const s0 = applyTodoAction(undefined, { action: "done", id: 9 });
    expect(s0.ok).toBe(false);
    const s1 = applyTodoAction("not json", { action: "wat" });
    expect(s1.ok).toBe(false);
    expect(s1.rendered).toContain("Unknown action");
  });

  test("newline string form for items works (weak-model tolerance)", () => {
    const r = applyTodoAction(undefined, { action: "add", items: "step one\nstep two" as unknown as string[] });
    expect(r.list.length).toBe(2);
  });

  test("parse round-trip filters malformed entries", () => {
    const good = [{ id: 1, text: "a", status: "pending" }];
    const mixed = JSON.stringify([...good, { id: "x" }, null, 5]);
    expect(parseTodoList(mixed)).toEqual(good as never);
    expect(renderTodoList([])).toContain("empty");
  });
});
