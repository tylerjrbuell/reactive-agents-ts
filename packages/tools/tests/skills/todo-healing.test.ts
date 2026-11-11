import { describe, it, expect } from "bun:test";
import { foldAdvisory, type AdvisoryItem, type ChecklistFact } from "@reactive-agents/core";
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
    expect(r.rendered).toContain('Unknown action "frobnicate". Valid: add | start | done | reopen | list.');
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

describe("todo list-management verbs not supported yet", () => {
  it.each(["remove", "delete", "rm", "edit", "rename", "clear", "reset", "patch"])(
    "%s is refused honestly, not healed to a near verb",
    (verb) => {
      const r = applyTodoChecklistAction(three, { action: verb, id: 1 });
      expect(r.ok).toBe(false);
      expect(r.changes).toEqual([]);
      expect(r.rendered).toContain("cannot edit, remove or clear items yet");
      expect(r.rendered).not.toContain("Closest valid call");
    },
  );

  it("unknown-action teaching lists reopen", () => {
    expect(applyTodoChecklistAction(three, { action: "frobnicate" }).rendered).toContain(
      'Valid: add | start | done | reopen | list.',
    );
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
