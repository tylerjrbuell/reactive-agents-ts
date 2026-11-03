import { describe, it, expect } from "bun:test";
import { foldAdvisory } from "@reactive-agents/core";
import type { ChecklistFact } from "@reactive-agents/core";
import { applyTodoChecklistAction } from "../../src/skills/todo.js";

const fold = (r: { changes: readonly ChecklistFact["change"][] }, extra: ChecklistFact["change"][] = []) =>
  foldAdvisory(
    [...r.changes, ...extra].map((change, i): ChecklistFact => ({ kind: "checklist-item", seq: i + 1, iteration: 1, change })),
  );

describe("todo add dedupe", () => {
  const first = applyTodoChecklistAction([], { action: "add", items: ["Fetch BTC price", "Write btc.txt"] });
  const items = fold(first, [{ op: "status", id: "2", status: "completed" }]);

  it("duplicate add returns existing id, no change, list length unchanged", () => {
    const r = applyTodoChecklistAction(items, { action: "add", items: ["Fetch BTC price"] });
    expect(r.ok).toBe(true);
    expect(r.changes).toEqual([]);
    expect(r.rendered).toContain("Already on the list as #1 (open); not added.");
    expect(fold({ changes: [...first.changes, ...r.changes] }).length).toBe(2);
  });

  it("done item reports done", () => {
    const r = applyTodoChecklistAction(items, { action: "add", items: ["write btc.txt"] });
    expect(r.changes).toEqual([]);
    expect(r.rendered).toContain("Already on the list as #2 (done); not added.");
  });

  it("near-duplicates (case, spacing, trailing punctuation) are deduped", () => {
    const r = applyTodoChecklistAction(items, { action: "add", items: ["  FETCH   btc price... ", "fetch btc price."] });
    expect(r.changes).toEqual([]);
    expect(r.rendered).toContain("Skipped 2 duplicate item(s)");
  });

  it("distinct items still added with stable next id; in-batch repeat noted", () => {
    const r = applyTodoChecklistAction(items, { action: "add", items: ["New step", "new step"] });
    expect(r.changes).toEqual([{ op: "add", items: [{ id: "3", title: "New step" }] }]);
    expect(r.rendered).toContain("Repeated in this call; not added.");
  });

  it("plan posture closing line unchanged on duplicate add", () => {
    const r = applyTodoChecklistAction(items, { action: "add", items: ["Fetch BTC price"] }, "plan");
    expect(r.rendered.split("\n").at(-1)).toBe("Plan recorded (2 items). Present the plan to the user and stop; do not start work.");
  });
});
