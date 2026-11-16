import { describe, it, expect } from "bun:test";
import { foldAdvisory, type AdvisoryItem, type ChecklistFact, type ChecklistItemOp } from "@reactive-agents/core";
import { applyTodoChecklistAction } from "../../src/skills/todo.js";
import { closestValid, healEnumArg, healParamNames } from "../../src/skills/arg-healing.js";

const empty: readonly AdvisoryItem[] = [];
const three: readonly AdvisoryItem[] = [
  { id: "1", seq: 1, title: "Research", status: "pending" },
  { id: "2", seq: 2, title: "Write", status: "in_progress" },
  { id: "3", seq: 3, title: "Review", status: "completed" },
];

function lastLine(s: string): string {
  return s.split("\n").at(-1) as string;
}

describe("todo healing: update/set + items", () => {
  it("the real user call heals to a working add", () => {
    const r = applyTodoChecklistAction(empty, {
      action: "update",
      id: 0,
      items: ["Find sources", "Read them", "Summarize", "Draft", "Review"],
    });
    expect(r.ok).toBe(true);
    expect(r.healedFrom).toBe("update");
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toMatchObject({ op: "add" });
    expect(r.rendered).toContain("[ ] 5. Review");
  });

  it("re-sent list never duplicates (normalized title)", () => {
    const first = applyTodoChecklistAction(empty, { action: "set", items: ["Alpha", "Beta"] });
    const facts: ChecklistFact[] = first.changes.map((change, i) => ({
      kind: "checklist-item", seq: i + 1, iteration: 1, change,
    }));
    const items = foldAdvisory(facts);
    const again = applyTodoChecklistAction(items, { action: "update", items: ["  alpha ", "BETA", "Gamma"] });
    expect(again.changes).toEqual([{ op: "add", items: [{ id: "3", title: "Gamma" }] }]);
    const all = applyTodoChecklistAction(items, { action: "replace", items: ["Alpha"] });
    expect(all.ok).toBe(true);
    expect(all.changes).toEqual([]);
    expect(all.rendered).toContain("already on the list");
  });

  describe("canonical add skips duplicate titles", () => {
    const seed = (): ReturnType<typeof foldAdvisory> => {
      const first = applyTodoChecklistAction(empty, { action: "add", items: ["Alpha", "Beta", "Gamma"] });
      const facts: ChecklistFact[] = [
        ...first.changes.map((change, i): ChecklistFact => ({ kind: "checklist-item", seq: i + 1, iteration: 1, change })),
        { kind: "checklist-item", seq: 4, iteration: 1, change: { op: "status", id: "1", status: "completed" } },
        { kind: "checklist-item", seq: 5, iteration: 1, change: { op: "status", id: "2", status: "in_progress" } },
      ];
      return foldAdvisory(facts);
    };

    it("skips an existing title in any status, adds only new ones", () => {
      const r = applyTodoChecklistAction(seed(), { action: "add", items: [" alpha", "BETA", "gamma", "Delta"] });
      expect(r.ok).toBe(true);
      expect(r.changes).toEqual([{ op: "add", items: [{ id: "4", title: "Delta" }] }]);
      expect(r.rendered).toContain("Skipped 3 duplicate item(s)");
      expect(r.rendered.split("\n").at(-1)).toContain("Open:");
    });

    it("all-duplicate add => ok, no changes, still ends with closing line", () => {
      const r = applyTodoChecklistAction(seed(), { action: "add", items: ["Alpha", "Beta"] });
      expect(r.ok).toBe(true);
      expect(r.changes).toEqual([]);
      expect(r.rendered).toContain("Skipped 2 duplicate item(s)");
      expect(r.rendered.split("\n").at(-1)).toContain("Open: 2");
    });

    it("dedupes within a single add call", () => {
      const r = applyTodoChecklistAction(empty, { action: "add", items: ["X", "x", "Y"] });
      expect(r.changes).toEqual([{ op: "add", items: [{ id: "1", title: "X" }, { id: "2", title: "Y" }] }]);
      expect(r.rendered).toContain("Skipped 1 duplicate item(s)");
    });

    it("no duplicates => no skip message", () => {
      const r = applyTodoChecklistAction(empty, { action: "add", items: ["A", "B"] });
      expect(r.rendered).not.toContain("Skipped");
    });
  });

  for (const verb of ["update", "set", "replace", "write", "save", "plan"]) {
    it(`${verb} + items => add`, () => {
      const r = applyTodoChecklistAction(empty, { action: verb, items: ["x"] });
      expect(r.changes).toEqual([{ op: "add", items: [{ id: "1", title: "x" }] }]);
    });
  }
});

describe("todo healing: param name aliases", () => {
  for (const key of ["item", "task", "tasks", "todos", "steps"]) {
    it(`${key} is an alias of items`, () => {
      const r = applyTodoChecklistAction(empty, { action: "add", [key]: ["x", "y"] });
      expect(r.changes).toEqual([{ op: "add", items: [{ id: "1", title: "x" }, { id: "2", title: "y" }] }]);
      expect(r.healedFrom).toBeUndefined();
    });
  }
  it("bare string => one item", () => {
    const r = applyTodoChecklistAction(empty, { action: "add", items: "single" });
    expect(r.changes).toEqual([{ op: "add", items: [{ id: "1", title: "single" }] }]);
  });
  for (const key of ["index", "number", "n"]) {
    it(`${key} is an alias of id`, () => {
      const r = applyTodoChecklistAction(three, { action: "done", [key]: "1" });
      expect(r.changes).toEqual([{ op: "status", id: "1", status: "completed" }]);
    });
  }
  it("out-of-range / 0-based id => message, no crash, no change", () => {
    const r = applyTodoChecklistAction(three, { action: "done", id: 0 });
    expect(r.ok).toBe(false);
    expect(r.changes).toEqual([]);
    expect(r.rendered).toContain("No todo item with id 0.");
  });
});

describe("todo healing: update/set/mark + id + status", () => {
  const cases: Array<[string, string, string]> = [
    ["update", "completed", "completed"],
    ["set", "done", "completed"],
    ["mark", "in_progress", "in_progress"],
    ["update", "pending", "pending"],
    ["set", "todo", "pending"],
  ];
  it("maps to the matching ledger transition", () => {
    const r = applyTodoChecklistAction(three, { action: "update", id: 1, status: "done" });
    expect(r.changes).toEqual([{ op: "status", id: "1", status: "completed" }]);
    expect(r.healedFrom).toBe("update");
    const reopen = applyTodoChecklistAction(three, { action: "update", id: 3, status: "pending" });
    expect(reopen.changes).toEqual([{ op: "status", id: "3", status: "pending" }]);
    expect(reopen.rendered).toContain("[ ] 3. Review");
    const noop = applyTodoChecklistAction(three, { action: "set", id: 1, status: "todo" });
    expect(noop.ok).toBe(true);
    expect(noop.changes).toEqual([]);
  });
  for (const [verb, word, status] of cases) {
    it(`${verb} id=2 status=${word} => ${status}`, () => {
      const r = applyTodoChecklistAction(three, { action: verb, id: "2", status: word });
      const expectChange = status === "in_progress" ? [] : [{ op: "status", id: "2", status }];
      expect(r.changes).toEqual(expectChange);
    });
  }
});

describe("todo healing: unknown actions teach", () => {
  it("unknown action still errors and names the closest valid call", () => {
    const r = applyTodoChecklistAction(three, { action: "frobnicate" });
    expect(r.ok).toBe(false);
    expect(r.rendered).toContain('Unknown action "frobnicate". Valid: add | start | done | reopen | edit | remove | clear | patch | list.');
    expect(r.rendered).toContain("Closest valid call:");
  });
  it("update with neither items nor id+status errors", () => {
    const r = applyTodoChecklistAction(three, { action: "update" });
    expect(r.ok).toBe(false);
    expect(r.healedFrom).toBeUndefined();
  });
});

describe("todo loop-closing line", () => {
  it("open items", () => {
    const r = applyTodoChecklistAction(three, { action: "list" });
    expect(lastLine(r.rendered)).toBe(
      'Open: 2. Mark progress: todo({action:"done", id:1}) when finished (todo({action:"start", id:1}) when you begin). Do not give your final answer while items are open.',
    );
  });
  it("teaches the exact call for the FIRST open item (skips completed)", () => {
    const r = applyTodoChecklistAction(three, { action: "done", id: 1 });
    expect(lastLine(r.rendered)).toContain('todo({action:"done", id:2})');
    expect(lastLine(r.rendered)).toContain('todo({action:"start", id:2})');
  });
  it("counts the state AFTER the action", () => {
    const r = applyTodoChecklistAction(three, { action: "done", id: 1 });
    expect(lastLine(r.rendered)).toContain("Open: 1.");
    const all = applyTodoChecklistAction(three, { action: "done", id: 1 });
    expect(all.changes).toHaveLength(1);
  });
  it("all done", () => {
    const done = three.map((t) => ({ ...t, status: "completed" as const }));
    expect(lastLine(applyTodoChecklistAction(done, { action: "list" }).rendered)).toBe("All items done.");
  });
  it("errors and empty list also end with a closing line", () => {
    expect(lastLine(applyTodoChecklistAction(three, { action: "done", id: 99 }).rendered)).toContain("Open: 2.");
    expect(lastLine(applyTodoChecklistAction(empty, { action: "list" }).rendered)).toContain("Open: 0.");
  });
});

// Run 01M7622DY0G1D8VEKYV2FVYZW7: todo({action:"start", items:[all 5]}) set all five
// to [~], the model repeated the identical call twice, and loop resolution ended the run.
describe("todo start: one item in progress at a time", () => {
  const titles = ["Read skill", "Run tests", "Diff docs", "Update docs", "Verify"];
  const five = (): readonly AdvisoryItem[] => {
    const added = applyTodoChecklistAction(empty, { action: "add", items: titles });
    return foldAdvisory(added.changes.map((change, i) => ({ kind: "checklist-item", seq: i + 1, iteration: 1, change })));
  };
  const inProgress = (r: { rendered: string }): number => r.rendered.split("\n").filter((l) => l.startsWith("[~]")).length;

  it("start with every item (by title) starts only the first open one", () => {
    const r = applyTodoChecklistAction(five(), { action: "start", items: titles });
    expect(r.changes).toEqual([{ op: "status", id: "1", status: "in_progress" }]);
    expect(inProgress(r)).toBe(1);
    expect(r.rendered).toContain("Started item 1 only");
  });

  it("start with several ids skips completed ones and starts one", () => {
    const r = applyTodoChecklistAction(three, { action: "start", ids: [3, 1] });
    expect(r.changes).toEqual([{ op: "status", id: "1", status: "in_progress" }]);
  });

  it("update/status in_progress over several ids is also narrowed to one", () => {
    const r = applyTodoChecklistAction(five(), { action: "update", ids: [1, 2, 3], status: "in_progress" });
    expect(r.changes).toEqual([{ op: "status", id: "1", status: "in_progress" }]);
  });

  it("start with no id starts the first open item", () => {
    const r = applyTodoChecklistAction(five(), { action: "start" });
    expect(r.ok).toBe(true);
    expect(r.changes).toEqual([{ op: "status", id: "1", status: "in_progress" }]);
  });

  it("start with no id on an empty list still fails", () => {
    const r = applyTodoChecklistAction(empty, { action: "start" });
    expect(r.ok).toBe(false);
  });

  it("done with several ids still marks them all", () => {
    expect(applyTodoChecklistAction(five(), { action: "done", ids: [1, 2] }).changes).toHaveLength(2);
  });
});

describe("todo no-op names the next concrete action", () => {
  it("repeating start on the in-progress item says No change and points at the work", () => {
    const r = applyTodoChecklistAction(three, { action: "start", id: 2 });
    expect(r.ok).toBe(true);
    expect(r.changes).toEqual([]);
    expect(r.rendered.split("\n")[0]).toBe(
      'No change: item 2 is already in progress — do its work now with a tool, then todo({action:"done", id:2}).',
    );
  });

  it("identical repeat of the all-items start returns a No change line", () => {
    const r = applyTodoChecklistAction(three, { action: "start", items: ["Write", "Research"] });
    expect(r.changes).toEqual([]);
    expect(r.rendered).toContain("No change: item 2 is already in progress");
  });

  it("done on a done item names the next open item", () => {
    const r = applyTodoChecklistAction(three, { action: "done", id: 3 });
    expect(r.changes).toEqual([]);
    expect(r.rendered.split("\n")[0]).toBe('No change: item 3 is already done. Next: todo({action:"start", id:1}).');
  });

  it("done on a done item when all are done says to answer", () => {
    const done = three.map((t) => ({ ...t, status: "completed" as const }));
    const r = applyTodoChecklistAction(done, { action: "done", id: 1 });
    expect(r.rendered.split("\n")[0]).toBe("No change: item 1 is already done. All items are done — deliver your final answer.");
  });

  it("start with no id when everything is done says No change", () => {
    const done = three.map((t) => ({ ...t, status: "completed" as const }));
    const r = applyTodoChecklistAction(done, { action: "start" });
    expect(r.changes).toEqual([]);
    expect(r.rendered.split("\n")[0]).toContain("No change: every item is done");
  });

  it("a call that changes state has no No change line", () => {
    expect(applyTodoChecklistAction(three, { action: "done", id: 2 }).rendered).not.toContain("No change");
  });
});

describe("todo reopen", () => {
  it("puts a done item back to pending", () => {
    const r = applyTodoChecklistAction(three, { action: "reopen", id: 3 });
    expect(r.ok).toBe(true);
    expect(r.changes).toEqual([{ op: "status", id: "3", status: "pending" }]);
    expect(r.rendered).toContain("[ ] 3. Review");
    expect(lastLine(r.rendered)).toContain("Open: 3.");
  });

  it.each(["undo", "re-open", "Reopen"])("alias %s heals to reopen", (verb) => {
    const r = applyTodoChecklistAction(three, { action: verb, id: 3 });
    expect(r.changes).toEqual([{ op: "status", id: "3", status: "pending" }]);
    if (verb !== "reopen") expect(r.healedTo).toBe("reopen");
  });

  it("leaves an open item alone and says so", () => {
    const r = applyTodoChecklistAction(three, { action: "reopen", ids: [1, 2] });
    expect(r.changes).toEqual([]);
    expect(r.rendered.split("\n")[0]).toBe("No change: items 1, 2 are not done, so there is nothing to reopen.");
  });

  it("reopens only the done ones of several ids", () => {
    const r = applyTodoChecklistAction(three, { action: "reopen", ids: [2, 3] });
    expect(r.changes).toEqual([{ op: "status", id: "3", status: "pending" }]);
  });

  it("needs a target", () => {
    expect(applyTodoChecklistAction(three, { action: "reopen" }).ok).toBe(false);
  });
});

describe("todo list management: edit", () => {
  it("replaces one item's title, keeps its status", () => {
    const r = applyTodoChecklistAction(three, { action: "edit", id: 2, text: "  Write the report  " });
    expect(r.ok).toBe(true);
    expect(r.changes).toEqual([{ op: "edit", id: "2", title: "Write the report" }]);
    expect(r.rendered).toContain("[~] 2. Write the report");
    expect(lastLine(r.rendered)).toContain("Open: 2.");
  });

  it("takes the title from title or a single item too", () => {
    expect(applyTodoChecklistAction(three, { action: "edit", id: 1, title: "Dig" }).changes).toEqual([
      { op: "edit", id: "1", title: "Dig" },
    ]);
    expect(applyTodoChecklistAction(three, { action: "edit", id: "#1", items: ["Dig"] }).changes).toEqual([
      { op: "edit", id: "1", title: "Dig" },
    ]);
  });

  it.each([{ text: "" }, { text: "   " }, {}])("refuses an empty title %p", (extra) => {
    const r = applyTodoChecklistAction(three, { action: "edit", id: 1, ...extra });
    expect(r.ok).toBe(false);
    expect(r.changes).toEqual([]);
    expect(r.rendered).toContain('todo({action:"edit", id:N, text:"new title"})');
    expect(r.rendered).toContain("[ ] 1. Research");
  });

  it("refuses a missing, unknown or multiple target", () => {
    expect(applyTodoChecklistAction(three, { action: "edit", text: "x" }).ok).toBe(false);
    const unknown = applyTodoChecklistAction(three, { action: "edit", id: 9, text: "x" });
    expect(unknown.ok).toBe(false);
    expect(unknown.rendered).toContain("Valid ids: 1, 2, 3.");
    const many = applyTodoChecklistAction(three, { action: "edit", ids: [1, 2], text: "x" });
    expect(many.ok).toBe(false);
    expect(many.rendered).toContain("one item at a time");
  });

  it("same title is a no-op", () => {
    const r = applyTodoChecklistAction(three, { action: "edit", id: 1, text: "Research" });
    expect(r.ok).toBe(true);
    expect(r.changes).toEqual([]);
    expect(r.rendered.split("\n")[0]).toBe("No change: item 1 already has that title.");
  });

  it("update/modify with an id and text heals to edit, not add", () => {
    const r = applyTodoChecklistAction(three, { action: "update", id: 1, text: "Dig" });
    expect(r.changes).toEqual([{ op: "edit", id: "1", title: "Dig" }]);
    expect(r.healedTo).toBe("edit");
  });
});

describe("todo list management: remove", () => {
  it("removes items by id, ids or title", () => {
    expect(applyTodoChecklistAction(three, { action: "remove", id: 2 }).changes).toEqual([{ op: "remove", ids: ["2"] }]);
    expect(applyTodoChecklistAction(three, { action: "remove", ids: [1, "3"] }).changes).toEqual([
      { op: "remove", ids: ["1", "3"] },
    ]);
    expect(applyTodoChecklistAction(three, { action: "remove", item: "review" }).changes).toEqual([
      { op: "remove", ids: ["3"] },
    ]);
  });

  it("renders the list without the removed item and says what went", () => {
    const r = applyTodoChecklistAction(three, { action: "remove", id: 2 });
    expect(r.ok).toBe(true);
    expect(r.rendered.split("\n")[0]).toBe("Removed item 2.");
    expect(r.rendered).not.toContain("2. Write");
    expect(r.rendered).toContain("Todo (1/2 done):");
    expect(lastLine(r.rendered)).toContain("Open: 1.");
  });

  it("an unknown id is a no-op with a clear message", () => {
    const r = applyTodoChecklistAction(three, { action: "remove", id: 9 });
    expect(r.ok).toBe(true);
    expect(r.changes).toEqual([]);
    expect(r.rendered.split("\n")[0]).toBe("No change: no item 9 to remove (already removed or never added). Valid ids: 1, 2, 3.");
  });

  it("removes the known ids and names the unknown ones", () => {
    const r = applyTodoChecklistAction(three, { action: "remove", ids: [1, 9] });
    expect(r.changes).toEqual([{ op: "remove", ids: ["1"] }]);
    expect(r.rendered.split("\n")[0]).toBe("Removed item 1. No item 9 (already removed or never added).");
  });

  it("refuses a call with no target and teaches clear", () => {
    const r = applyTodoChecklistAction(three, { action: "remove" });
    expect(r.ok).toBe(false);
    expect(r.rendered).toContain('todo({action:"clear"})');
  });
});

describe("todo list management: clear", () => {
  it("clears every item", () => {
    const r = applyTodoChecklistAction(three, { action: "clear" });
    expect(r.changes).toEqual([{ op: "remove", ids: ["1", "2", "3"] }]);
    expect(r.rendered.split("\n")[0]).toBe("Cleared 3 items.");
    expect(r.rendered).toContain("Todo list is empty.");
    expect(lastLine(r.rendered)).toContain("Open: 0.");
  });

  it.each([{ status: "completed" }, { status: "done" }])("clears only completed items with %p", (extra) => {
    const r = applyTodoChecklistAction(three, { action: "clear", ...extra });
    expect(r.changes).toEqual([{ op: "remove", ids: ["3"] }]);
    expect(r.rendered.split("\n")[0]).toBe("Cleared 1 completed item.");
    expect(r.rendered).toContain("[~] 2. Write");
  });

  it("clear_completed heals to a completed-only clear", () => {
    const r = applyTodoChecklistAction(three, { action: "clear_completed" });
    expect(r.changes).toEqual([{ op: "remove", ids: ["3"] }]);
    expect(r.healedTo).toBe("clear");
  });

  it("nothing to clear is a no-op", () => {
    expect(applyTodoChecklistAction(empty, { action: "clear" }).rendered.split("\n")[0]).toBe(
      "No change: the list is already empty.",
    );
    const open = three.filter((t) => t.status !== "completed");
    const r = applyTodoChecklistAction(open, { action: "clear", status: "completed" });
    expect(r.ok).toBe(true);
    expect(r.changes).toEqual([]);
    expect(r.rendered.split("\n")[0]).toBe("No change: no completed items to clear.");
  });

  it("an unknown status filter is refused", () => {
    const r = applyTodoChecklistAction(three, { action: "clear", status: "someday" });
    expect(r.ok).toBe(false);
    expect(r.changes).toEqual([]);
  });
});

describe("todo list management: patch", () => {
  it("applies several ops in order as one result", () => {
    const r = applyTodoChecklistAction(three, {
      action: "patch",
      ops: [{ id: 1, text: "Dig" }, { id: 2, status: "done" }, { remove: 3 }],
    });
    expect(r.ok).toBe(true);
    expect(r.changes).toEqual([
      { op: "edit", id: "1", title: "Dig" },
      { op: "status", id: "2", status: "completed" },
      { op: "remove", ids: ["3"] },
    ]);
    expect(r.rendered.split("\n")[0]).toBe("Applied 3 changes.");
    expect(r.rendered).toContain("[ ] 1. Dig");
    expect(r.rendered).toContain("[x] 2. Write");
    expect(r.rendered).not.toContain("3. Review");
    expect(lastLine(r.rendered)).toContain("Open: 1.");
  });

  it("accepts ops as a JSON string and `op` objects", () => {
    const r = applyTodoChecklistAction(three, {
      action: "patch",
      ops: JSON.stringify([{ op: "remove", id: 1 }, { op: "edit", id: 2, title: "Draft" }]),
    });
    expect(r.changes).toEqual([
      { op: "remove", ids: ["1"] },
      { op: "edit", id: "2", title: "Draft" },
    ]);
  });

  it("an invalid op changes nothing and names the op", () => {
    const r = applyTodoChecklistAction(three, { action: "patch", ops: [{ id: 1, text: "Dig" }, { id: 9, status: "done" }] });
    expect(r.ok).toBe(false);
    expect(r.changes).toEqual([]);
    expect(r.rendered).toContain("patch op 2:");
    expect(r.rendered).toContain("Nothing was changed.");
    expect(r.rendered).toContain("[ ] 1. Research");
  });

  it.each([
    [{ id: 1, text: "  " }],
    [{ id: 1, status: "someday" }],
    [{ id: 1 }],
    ["remove 1"],
  ])("refuses malformed op %p", (op) => {
    const r = applyTodoChecklistAction(three, { action: "patch", ops: [op] });
    expect(r.ok).toBe(false);
    expect(r.changes).toEqual([]);
  });

  it("refuses missing or empty ops with usage", () => {
    for (const ops of [undefined, [], "not json"]) {
      const r = applyTodoChecklistAction(three, { action: "patch", ops });
      expect(r.ok).toBe(false);
      expect(r.rendered).toContain('todo({action:"patch", ops:[');
    }
  });

  it("a later op sees an earlier op's result", () => {
    const r = applyTodoChecklistAction(three, { action: "patch", ops: [{ remove: 1 }, { id: 1, text: "x" }] });
    expect(r.ok).toBe(false);
    expect(r.rendered).toContain("patch op 2:");
  });

  it("removing an unknown id in a patch is a noted no-op", () => {
    const r = applyTodoChecklistAction(three, { action: "patch", ops: [{ remove: 9 }, { id: 1, status: "done" }] });
    expect(r.ok).toBe(true);
    expect(r.changes).toEqual([{ op: "status", id: "1", status: "completed" }]);
    expect(r.rendered.split("\n")[0]).toBe("Applied 1 change. No item 9 (already removed or never added).");
  });

  it("starts one item at a time", () => {
    const r = applyTodoChecklistAction(three, {
      action: "patch",
      ops: [{ id: 2, status: "done" }, { id: 1, status: "in_progress" }, { id: 3, status: "in_progress" }],
    });
    expect(r.changes).toEqual([
      { op: "status", id: "2", status: "completed" },
      { op: "status", id: "1", status: "in_progress" },
    ]);
    expect(r.rendered).toContain("Started item 1 only");
  });

  it("a patch that changes nothing says so", () => {
    const r = applyTodoChecklistAction(three, { action: "patch", ops: [{ id: 3, status: "done" }] });
    expect(r.ok).toBe(true);
    expect(r.changes).toEqual([]);
    expect(r.rendered.split("\n")[0]).toBe("No change: the patch changed nothing.");
  });
});

describe("todo list management: every result renders the list and the next step", () => {
  it.each([
    { action: "edit", id: 1, text: "Dig" },
    { action: "edit", id: 1, text: "" },
    { action: "remove", id: 1 },
    { action: "remove", id: 9 },
    { action: "clear", status: "completed" },
    { action: "clear" },
    { action: "patch", ops: [{ id: 1, status: "done" }] },
    { action: "patch", ops: [] },
  ])("%p", (args) => {
    const r = applyTodoChecklistAction(three, args);
    expect(r.rendered).toMatch(/Todo \(\d+\/\d+ done\):|Todo list is empty\./);
    expect(lastLine(r.rendered)).toMatch(/^(Open: \d+\.|All items done\.)/);
  });

  it("plan posture keeps the plan closing line", () => {
    const r = applyTodoChecklistAction(three, { action: "remove", id: 1 }, "plan");
    expect(lastLine(r.rendered)).toBe("Plan recorded (2 steps). Present it to the user; execution starts from this list.");
  });

  it("unknown-action teaching lists every action", () => {
    expect(applyTodoChecklistAction(three, { action: "frobnicate" }).rendered).toContain(
      "Valid: add | start | done | reopen | edit | remove | clear | patch | list.",
    );
  });
});

describe("todo ids are never reused", () => {
  const ops = (...changes: ChecklistItemOp[]) => changes;

  it("add continues after the highest id ever added, given the op history", () => {
    const history = ops(
      { op: "add", items: [{ id: "1", title: "a" }, { id: "2", title: "b" }, { id: "3", title: "c" }] },
      { op: "remove", ids: ["3"] },
    );
    const items = three.slice(0, 2);
    const r = applyTodoChecklistAction(items, { action: "add", items: ["d"] }, "execute", history);
    expect(r.changes).toEqual([{ op: "add", items: [{ id: "4", title: "d" }] }]);
  });

  it("after clearing everything, the next add does not restart at 1", () => {
    const history = ops(
      { op: "add", items: [{ id: "1", title: "a" }, { id: "2", title: "b" }] },
      { op: "remove", ids: ["1", "2"] },
    );
    const r = applyTodoChecklistAction(empty, { action: "add", items: ["c"] }, "execute", history);
    expect(r.changes).toEqual([{ op: "add", items: [{ id: "3", title: "c" }] }]);
  });
});

describe("arg-healing helpers", () => {
  it("healEnumArg: canonical unmarked, case healed, alias healed, unknown untouched", () => {
    expect(healEnumArg("text", ["text", "json"])).toEqual({ value: "text" });
    expect(healEnumArg("JSON", ["text", "json"])).toEqual({ value: "json", healedFrom: "JSON" });
    expect(healEnumArg("md", ["text", "markdown"], { md: "markdown" })).toEqual({ value: "markdown", healedFrom: "md" });
    expect(healEnumArg("yaml", ["text", "json"])).toEqual({ value: "yaml" });
  });
  it("healParamNames: canonical wins, null treated absent, input not mutated", () => {
    const input = { answer: "a", output: "o", q: null };
    const r = healParamNames(input, { output: ["answer"], query: ["q", "search"] });
    expect(r.args.output).toBe("o");
    expect(r.healed).toEqual([]);
    const r2 = healParamNames({ answer: "a" }, { output: ["answer"] });
    expect(r2.args.output).toBe("a");
    expect(r2.healed).toEqual(["answer->output"]);
    expect(input).toEqual({ answer: "a", output: "o", q: null });
  });
  it("closestValid", () => {
    expect(closestValid("dne", ["add", "start", "done", "list"])).toBe("done");
    expect(closestValid("starting", ["add", "start", "done", "list"])).toBe("start");
  });
});
