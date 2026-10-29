import { describe, it, expect } from "bun:test";
import fc from "fast-check";
import { foldAdvisory, type ChecklistFact, type ChecklistItemOp } from "@reactive-agents/core";
import {
  applyTodoChecklistAction,
  renderTodoChecklist,
  todoTool,
} from "../../src/skills/todo.js";
import type { ToolDefinition } from "../../src/types.js";

// ── Frozen legacy oracle ─────────────────────────────────────────────────────
// Verbatim copy of the deleted applyTodoAction/renderTodoList/parseTodoList
// (Plan 3 Task 5). Lockstep reference only; production code no longer has it.
// The malformed-entry parse case is covered by
// packages/reasoning/src/kernel/state/checklist-migrate.test.ts.
interface TodoItem {
  readonly id: number;
  readonly text: string;
  readonly status: "pending" | "in_progress" | "done";
}
interface TodoActionResult {
  readonly list: readonly TodoItem[];
  readonly rendered: string;
  readonly ok: boolean;
}
const STATUS_ICON: Record<TodoItem["status"], string> = {
  pending: "[ ]",
  in_progress: "[~]",
  done: "[x]",
};
function renderTodoList(list: readonly TodoItem[]): string {
  if (list.length === 0) {
    return "Todo list is empty. Call todo with action 'add' and items to plan your task.";
  }
  const lines = list.map((t) => `${STATUS_ICON[t.status]} ${t.id}. ${t.text}`);
  const doneCount = list.filter((t) => t.status === "done").length;
  return [
    `Todo (${doneCount}/${list.length} done):`,
    ...lines,
    doneCount === list.length
      ? "All items done — deliver your final answer now."
      : "Work the first unchecked item next. Mark items done as you complete them.",
  ].join("\n");
}
function parseTodoList(serialized: string | undefined): TodoItem[] {
  if (!serialized) return [];
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is TodoItem =>
        typeof t === "object" && t !== null &&
        typeof (t as TodoItem).id === "number" &&
        typeof (t as TodoItem).text === "string" &&
        ["pending", "in_progress", "done"].includes((t as TodoItem).status),
    );
  } catch {
    return [];
  }
}
function applyTodoAction(
  serialized: string | undefined,
  args: Record<string, unknown>,
): TodoActionResult {
  const list = parseTodoList(serialized);
  const action = typeof args.action === "string" ? args.action : "list";
  switch (action) {
    case "add": {
      const raw = args.items ?? args.item ?? args.text;
      const texts = Array.isArray(raw)
        ? raw.filter((x): x is string => typeof x === "string")
        : typeof raw === "string"
          ? raw.split("\n").map((s) => s.trim()).filter(Boolean)
          : [];
      if (texts.length === 0) {
        return { list, rendered: `No items provided. Usage: todo({action:"add", items:["step 1","step 2"]})\n${renderTodoList(list)}`, ok: false };
      }
      let nextId = list.reduce((m, t) => Math.max(m, t.id), 0) + 1;
      const added = texts.map((text) => ({ id: nextId++, text, status: "pending" as const }));
      const next = [...list, ...added];
      return { list: next, rendered: renderTodoList(next), ok: true };
    }
    case "start":
    case "done": {
      const id = typeof args.id === "number" ? args.id : Number(args.id);
      const target = list.find((t) => t.id === id);
      if (!target) {
        return { list, rendered: `No todo item with id ${String(args.id)}.\n${renderTodoList(list)}`, ok: false };
      }
      const status = action === "done" ? ("done" as const) : ("in_progress" as const);
      const next = list.map((t) => (t.id === id ? { ...t, status } : t));
      return { list: next, rendered: renderTodoList(next), ok: true };
    }
    case "list":
      return { list, rendered: renderTodoList(list), ok: true };
    default:
      return {
        list,
        rendered: `Unknown action "${action}". Valid: add | start | done | list.\n${renderTodoList(list)}`,
        ok: false,
      };
  }
}

type Args = Record<string, unknown>;

/**
 * Drop the lines added after the legacy contract was frozen: the trailing
 * loop-closing line and the unknown-action teaching line. Everything else must
 * stay byte-identical to the legacy oracle.
 */
function stripAdditions(rendered: string): string {
  const lines = rendered.split("\n").filter((l) => !l.startsWith("Closest valid call:"));
  lines.pop();
  return lines.join("\n");
}

/** Run legacy and checklist paths in lockstep; assert equality at every step. */
function lockstep(steps: readonly Args[]): void {
  let serialized: string | undefined;
  const facts: ChecklistFact[] = [];
  let seq = 0;
  for (const args of steps) {
    const legacy = applyTodoAction(serialized, args);
    const items = foldAdvisory(facts);
    const next = applyTodoChecklistAction(items, args);
    expect(stripAdditions(next.rendered)).toBe(legacy.rendered);
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
      // Titles are distinct: duplicate-title adds are a deliberate divergence
      // from the legacy oracle (canonical add skips them; see todo-healing.test.ts).
      { action: "add", items: "f\n g \n\n" },
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

// Owner override 2026-10-29: description deliberately rewritten (user-observed
// failures: models left items open and invented actions). Params/metadata unchanged.
describe("todoTool definition is pinned", () => {
  it("matches the pinned literal", () => {
    const expected: ToolDefinition = {
      name: "todo",
      description:
        "Your task checklist. Plan once with todo({action:'add', items:['step 1','step 2',...]}); " +
        "set the item you are working on with todo({action:'start', id:N}). " +
        "Mark it done immediately after finishing it with todo({action:'done', id:N}); before your final answer make sure no item is left open.",
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
