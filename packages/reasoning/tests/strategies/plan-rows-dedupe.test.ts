import { describe, expect, it } from "bun:test";
import type { ChecklistItemOp } from "@reactive-agents/core";
import { emptyPlanChecklist, planChecklistFacts, type PlanChecklistStep } from "../../src/strategies/planning/plan-checklist.js";
import { MAX_AUGMENT_STEPS, dedupeNewSteps } from "../../src/strategies/planning/plan-mutation.js";

const step = (id: string, title: string, status: PlanChecklistStep["status"], toolName?: string): PlanChecklistStep => ({
  id,
  title,
  status,
  ...(toolName !== undefined ? { toolName } : {}),
});

const opsOf = (r: ReturnType<typeof planChecklistFacts>): ChecklistItemOp[] => r.facts.map((f) => f.change);

describe("plan rows: replaced steps and tool hints", () => {
  it("removes rows of replaced non-completed steps, keeps completed, carries the tool", () => {
    const first = [
      step("s1", "Research bitcoin", "pending", "web-search"),
      step("s2", "Research ethereum", "pending"),
      step("s7", "Verify report", "pending"),
      step("s8", "Return the final answer", "pending"),
    ];
    const a = planChecklistFacts(emptyPlanChecklist, first, new Set(), 0);
    expect(opsOf(a)[0]).toEqual({
      op: "add",
      items: [
        { id: "s1", title: "Research bitcoin", tool: "web-search" },
        { id: "s2", title: "Research ethereum" },
        { id: "s7", title: "Verify report" },
        { id: "s8", title: "Return the final answer" },
      ],
    });
    // s1 completes; s7 in progress then replaced by patch tail (new ids/titles); s8 replaced too.
    const mid = [
      step("s1", "Research bitcoin", "completed", "web-search"),
      step("s2", "Research ethereum", "pending"),
      step("s7", "Verify report", "in_progress"),
      step("s8", "Return the final answer", "pending"),
    ];
    const b = planChecklistFacts(a.state, mid, new Set(["s7"]), 1);
    const patched = [mid[0]!, step("s3", "Recover s7", "pending")];
    const c = planChecklistFacts(b.state, patched, new Set(), 2);
    const removes = opsOf(c).filter((o) => o.op === "remove");
    expect(removes).toEqual([{ op: "remove", ids: ["s2", "s7", "s8"] }]);
    expect([...c.state.rows.values()].map((r) => r.rowId).sort()).toEqual(["s1", "s3"]);
    expect([...c.state.rows.values()].some((r) => r.status === "in_progress")).toBe(false);
  });
});

describe("plan rows: dedupe of refine/augment steps", () => {
  const existing = ["Research bitcoin", "Verify report", "Return the final answer"];
  const proposed = [
    { title: "Verify the report file content" },
    { title: "Verify the report file content" },
    { title: "Return the final answer" },
    { title: "Return the final answer." },
    { title: "Compare ethereum fees" },
  ];

  it("drops near-duplicates of existing titles and of each other", () => {
    expect(dedupeNewSteps(proposed, existing).map((s) => s.title)).toEqual(["Compare ethereum fees"]);
  });

  it("caps additions", () => {
    const many = ["alpha one", "beta two", "gamma three", "delta four", "epsilon five"].map((title) => ({ title }));
    expect(dedupeNewSteps(many, [], MAX_AUGMENT_STEPS)).toHaveLength(MAX_AUGMENT_STEPS);
  });
});
