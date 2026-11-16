import { describe, expect, test } from "bun:test";
import { addStep, planEdited, toPlanBody, type DraftStep } from "./plan-edit.js";

const s = (id: string, title: string, over: Partial<DraftStep> = {}): DraftStep => ({ id, title, status: "pending", ...over });

// The list rules (add, remove, move, reword, planEdited) are pinned in packages/ui-core/tests/plan-edit.test.ts.
describe("plan editing rules (Cortex side)", () => {
  test("the shared rules are re-exported", () => {
    expect(addStep([], " a ").map((x) => x.title)).toEqual(["a"]);
    expect(planEdited([s("1", "a")], [s("1", "b")])).toBe(true);
  });

  test("toPlanBody carries id, title, status and the tool hint when set", () => {
    expect(toPlanBody([s("1", "a", { tool: "t", status: "done" }), s("2", "b")])).toEqual([
      { id: "1", title: "a", status: "done", tool: "t" },
      { id: "2", title: "b", status: "pending" },
    ]);
  });
});
