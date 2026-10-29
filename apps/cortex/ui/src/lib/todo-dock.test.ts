import { describe, expect, it } from "bun:test";
import type { ChecklistSnapshotWire } from "@reactive-agents/ui-core";
import { addTodo, clearCompleted, removeTodo, todoDockMode, todoToolEnabled, todoDockView, todoFromChecklist, toggleTodo, type TodoItem } from "./todo-dock.js";

const L: TodoItem[] = [
  { id: "1", title: "one", status: "completed" },
  { id: "2", title: "two", status: "in_progress" },
  { id: "3", title: "three", status: "pending" },
];

const snap = (rows: ChecklistSnapshotWire["root"]["rows"]): ChecklistSnapshotWire => ({
  lastSeq: 1,
  root: { key: "root", label: "root", rows, requirements: { done: 0, total: 0 }, advisory: { done: 0, total: 0 }, activeAdvisoryIds: [], children: [] },
});

describe("todoFromChecklist", () => {
  it("keeps root advisory rows only, done -> completed, blocked -> pending", () => {
    expect(
      todoFromChecklist(snap([
        { id: "answer", kind: "requirement", title: "r", status: "pending" },
        { id: "1", kind: "advisory", title: "a", status: "done" },
        { id: "2", kind: "advisory", title: "b", status: "in_progress" },
        { id: "3", kind: "advisory", title: "c", status: "blocked" },
      ])),
    ).toEqual([
      { id: "1", title: "a", status: "completed" },
      { id: "2", title: "b", status: "in_progress" },
      { id: "3", title: "c", status: "pending" },
    ]);
  });
  it("ignores child groups", () => {
    const base = snap([]);
    const s: ChecklistSnapshotWire = {
      ...base,
      root: { ...base.root, children: [{ key: "k", label: "k", rows: [{ id: "1", kind: "advisory", title: "x", status: "pending" }], requirements: { done: 0, total: 0 }, advisory: { done: 0, total: 1 }, activeAdvisoryIds: [], children: [] }] },
    };
    expect(todoFromChecklist(s)).toEqual([]);
  });
});

describe("todoDockView", () => {
  it("counts, current and header", () => {
    const v = todoDockView(L);
    expect([v.done, v.total, v.current?.id, v.allDone, v.progressPct]).toEqual([1, 3, "2", false, 33]);
    expect(v.header).toBe("To-do 1/3 · two");
  });
  it("header omits the dot when nothing is in progress; empty is empty", () => {
    expect(todoDockView([{ id: "1", title: "a", status: "pending" }]).header).toBe("To-do 0/1");
    const e = todoDockView([]);
    expect([e.empty, e.header, e.allDone]).toEqual([true, "", false]);
    expect(todoDockView([{ id: "1", title: "a", status: "completed" }]).allDone).toBe(true);
  });
});

describe("edits keep ids stable", () => {
  it("toggle", () => {
    expect(toggleTodo(L, "3").find((i) => i.id === "3")!.status).toBe("completed");
    expect(toggleTodo(L, "1").find((i) => i.id === "1")!.status).toBe("pending");
    expect(toggleTodo(L, "2").find((i) => i.id === "2")!.status).toBe("completed");
  });
  it("add continues numbering, trims, ignores blank", () => {
    expect(addTodo(L, "  four ").at(-1)).toEqual({ id: "4", title: "four", status: "pending" });
    expect(addTodo(L, "   ")).toEqual(L);
    expect(addTodo([], "a")[0]!.id).toBe("1");
  });
  it("clear completed / remove", () => {
    expect(clearCompleted(L).map((i) => i.id)).toEqual(["2", "3"]);
    expect(removeTodo(L, "2").map((i) => i.id)).toEqual(["1", "3"]);
  });
});

describe("todoDockMode / todoToolEnabled", () => {
  it("shows the full dock for a non-empty list, a slim add affordance when empty and enabled, nothing otherwise", () => {
    const one = [{ id: "a", title: "x", status: "pending" as const }];
    expect(todoDockMode(one, false)).toBe("full");
    expect(todoDockMode([], true)).toBe("empty");
    expect(todoDockMode([], false)).toBe("hidden");
  });
  it("reads the session config flag strictly", () => {
    expect(todoToolEnabled({ metaTools: { todo: true } })).toBe(true);
    expect(todoToolEnabled({ metaTools: { todo: false } })).toBe(false);
    expect(todoToolEnabled({ metaTools: "x" })).toBe(false);
    expect(todoToolEnabled({})).toBe(false);
  });
});
