import { describe, it, expect } from "bun:test";
import fc from "fast-check";
import { foldAdvisory, type ChecklistFact, type ChecklistItemOp } from "@reactive-agents/core";
import {
  applyTodoAction,
  applyTodoChecklistAction,
  renderTodoChecklist,
  renderTodoList,
  todoTool,
} from "../../src/skills/todo.js";
import type { ToolDefinition } from "../../src/types.js";

type Args = Record<string, unknown>;

/** Run legacy and checklist paths in lockstep; assert equality at every step. */
function lockstep(steps: readonly Args[]): void {
  let serialized: string | undefined;
  const facts: ChecklistFact[] = [];
  let seq = 0;
  for (const args of steps) {
    const legacy = applyTodoAction(serialized, args);
    const items = foldAdvisory(facts);
    const next = applyTodoChecklistAction(items, args);
    expect(next.rendered).toBe(legacy.rendered);
    expect(next.ok).toBe(legacy.ok);
    // changes non-empty exactly when legacy list changed
    const legacyChanged = JSON.stringify(legacy.list) !== JSON.stringify(applyTodoAction(serialized, { action: "list" }).list);
    expect(next.changes.length > 0).toBe(legacyChanged);
    for (const c of next.changes) {
      facts.push({ kind: "checklist-item", seq: ++seq, iteration: 1, change: c });
    }
    // fold state must mirror legacy list
    const folded = foldAdvisory(facts);
    expect(renderTodoChecklist(folded)).toBe(renderTodoList(legacy.list));
    for (const it of folded) expect(["pending", "in_progress", "completed"]).toContain(it.status);
    serialized = JSON.stringify(legacy.list);
  }
}

describe("todo checklist: lockstep golden vs legacy", () => {
  it("add as array, newline string, item and text aliases", () => {
    lockstep([
      { action: "add", items: ["a", "b"] },
      { action: "add", items: "a\n b \n\n" },
      { action: "add", item: "c" },
      { action: "add", text: "d\ne" },
    ]);
  });
  it("add with mixed array keeps strings only; add []", () => {
    lockstep([{ action: "add", items: ["", 3, "a"] }, { action: "add", items: [] }]);
  });
  it("action missing or non-string behaves as list", () => {
    lockstep([{}, { action: 5 }, { action: "add", items: ["x"] }, {}, { action: null }]);
  });
  it("id shapes", () => {
    lockstep([
      { action: "add", items: ["a", "b", "c"] },
      { action: "start", id: 1 },
      { action: "done", id: "2" },
      { action: "done", id: "2.0" },
      { action: "start", id: true },
      { action: "done", id: "abc" },
      { action: "done" },
      { action: "done", id: 9 },
    ]);
  });
  it("start unknown, done twice, start after done, add after all done, unknown action, list", () => {
    lockstep([
      { action: "start", id: 1 },
      { action: "add", items: ["a", "b"] },
      { action: "done", id: 1 },
      { action: "done", id: 1 },
      { action: "start", id: 1 },
      { action: "done", id: 1 },
      { action: "done", id: 2 },
      { action: "add", items: ["c"] },
      { action: "frobnicate" },
      { action: "list" },
    ]);
  });
  it("empty list render matches", () => {
    expect(renderTodoChecklist([])).toBe(renderTodoList([]));
  });
});

describe("todo checklist: property", () => {
  const idArb = fc.oneof(
    fc.constant(1), fc.constant("2"), fc.constant("2.0"), fc.constant(true),
    fc.constant("abc"), fc.constant(undefined), fc.constant(9), fc.integer({ min: 0, max: 12 }),
  );
  const argsArb: fc.Arbitrary<Args> = fc.oneof(
    fc.record({ action: fc.constant("add"), items: fc.array(fc.oneof(fc.string(), fc.integer()), { maxLength: 4 }) }),
    fc.record({ action: fc.constant("add"), items: fc.string() }),
    fc.record({ action: fc.constant("add"), item: fc.string() }),
    fc.record({ action: fc.constant("add"), text: fc.string() }),
    fc.record({ action: fc.constantFrom("start", "done"), id: idArb }),
    fc.record({ action: fc.constantFrom("start", "done") }),
    fc.constant({ action: "list" }),
    fc.constant({}),
    fc.constant({ action: "frobnicate" }),
    fc.constant({ action: 7 }),
  );
  it("random 1-20 step sequences stay in lockstep", () => {
    fc.assert(fc.property(fc.array(argsArb, { minLength: 1, maxLength: 20 }), (steps) => {
      lockstep(steps);
    }), { numRuns: 200 });
  });
});

describe("todo checklist: changes contract", () => {
  it("add uses nextAdvisoryIds; list/errors/no-ops are empty", () => {
    const first = applyTodoChecklistAction([], { action: "add", items: ["a", "b"] });
    expect(first.changes).toEqual<ChecklistItemOp[]>([
      { op: "add", items: [{ id: "1", title: "a" }, { id: "2", title: "b" }] },
    ]);
    const items = foldAdvisory([{ kind: "checklist-item", seq: 1, iteration: 1, change: first.changes[0]! }]);
    const second = applyTodoChecklistAction(items, { action: "add", items: ["c"] });
    expect(second.changes).toEqual([{ op: "add", items: [{ id: "3", title: "c" }] }]);
    expect(applyTodoChecklistAction(items, { action: "list" }).changes).toEqual([]);
    expect(applyTodoChecklistAction(items, { action: "done", id: 99 }).changes).toEqual([]);
    expect(applyTodoChecklistAction(items, { action: "start", id: 1 }).changes).toEqual([
      { op: "status", id: "1", status: "in_progress" },
    ]);
  });
});

describe("todoTool definition is unchanged", () => {
  it("matches the pre-edit literal", () => {
    const expected: ToolDefinition = {
      name: "todo",
      description:
        "Your task checklist — plan multi-step work and track progress. " +
        "Call todo({action:'add', items:['step 1','step 2',...]}) ONCE at the start of any task with 3+ distinct steps, " +
        "then todo({action:'done', id:N}) as you finish each item. " +
        "todo({action:'start', id:N}) marks an item in progress; todo({action:'list'}) shows current state. " +
        "Every call returns the full checklist so you always know what remains. " +
        "Finish every item (or explicitly note why one is unmeetable) before delivering your final answer.",
      parameters: [
        { name: "action", type: "string", description: "add | start | done | list", required: true },
        { name: "items", type: "array", description: "For 'add': list of step descriptions.", required: false },
        { name: "id", type: "number", description: "For 'start'/'done': the item id to update.", required: false },
      ],
      returnType: "string",
      riskLevel: "low",
      timeoutMs: 5_000,
      requiresApproval: false,
      source: "function",
      category: "data",
    };
    expect(todoTool).toEqual(expected);
  });
});
