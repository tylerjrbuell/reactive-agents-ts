// File: tests/types/plan-adapters.test.ts
import { describe, it, expect } from "bun:test";
import type { Plan as CorePlan } from "@reactive-agents/core";
import { fromCorePlan, toCorePlan, isCorePlan } from "../../src/types/plan-adapters.js";
import type { Plan } from "../../src/types/plan.js";

const ctx = { taskId: "t1", agentId: "a1", goal: "g", planMode: "dag" as const };

const core: CorePlan = {
  id: "p1",
  goal: "g",
  createdAt: 1_700_000_000_000,
  source: "user-edited",
  steps: [
    { id: "a", title: "search", tool: "web-search", args: { query: "x" }, status: "done" },
    { id: "b", title: "fetch", tool: "web-fetch", dependsOn: ["a"], status: "in-progress" },
    { id: "c", title: "summarize", dependsOn: ["a", "b"], status: "pending" },
    { id: "d", title: "skip me", status: "skipped" },
  ],
};

describe("plan adapters", () => {
  it("maps core -> strategy per the mapping table", () => {
    const plan = fromCorePlan(core, ctx);
    expect(plan.id).toBe("p1");
    expect(plan.mode).toBe("dag");
    expect(plan.steps.map((s) => [s.id, s.seq, s.type, s.status])).toEqual([
      ["a", 1, "tool_call", "completed"],
      ["b", 2, "tool_call", "in_progress"],
      ["c", 3, "analysis", "pending"],
      ["d", 4, "analysis", "skipped"],
    ]);
    expect(plan.steps[0]).toMatchObject({ toolName: "web-search", toolArgs: { query: "x" }, instruction: "search" });
    expect(plan.steps[2]!.dependsOn).toEqual(["a", "b"]);
    expect(plan.steps[2]!.toolName).toBeUndefined();
  });

  it("round-trips core -> strategy -> core", () => {
    const back = toCorePlan(fromCorePlan(core, ctx));
    expect(back.steps).toEqual(core.steps);
    expect(back.createdAt).toBe(core.createdAt);
    expect(back.goal).toBe("g");
  });

  it("maps failed -> skipped on the way out", () => {
    const plan: Plan = fromCorePlan(core, ctx);
    const failed: Plan = { ...plan, steps: plan.steps.map((s) => ({ ...s, status: "failed" as const })) };
    expect(toCorePlan(failed).steps.every((s) => s.status === "skipped")).toBe(true);
  });

  it("discriminates plan shapes", () => {
    expect(isCorePlan(core)).toBe(true);
    expect(isCorePlan(fromCorePlan(core, ctx))).toBe(false);
  });
});
