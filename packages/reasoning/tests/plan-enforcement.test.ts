import { describe, it, expect } from "bun:test";
import {
  stepsMissingRationale,
  injectMissingRequiredToolSteps,
  injectQuantityDeficitSteps,
} from "../src/strategies/plan-execute/plan-enforcement.js";
import type { Plan, PlanStep } from "../src/types/plan.js";

const step = (over: Partial<PlanStep> & Pick<PlanStep, "id" | "type">): PlanStep =>
  ({
    seq: 1,
    title: "t",
    instruction: "i",
    dependsOn: [],
    status: "pending",
    retries: 0,
    tokensUsed: 0,
    ...over,
  }) as PlanStep;

const planOf = (steps: PlanStep[]): Plan => ({ steps }) as Plan;

describe("plan-enforcement", () => {
  it("flags only tool_call steps with a blank or missing rationale", () => {
    const plan = planOf([
      step({ id: "s1", type: "tool_call", toolName: "a" }),
      step({ id: "s2", type: "tool_call", toolName: "b", rationale: { why: "  " } as PlanStep["rationale"] }),
      step({ id: "s3", type: "tool_call", toolName: "c", rationale: { why: "ok" } as PlanStep["rationale"] }),
      step({ id: "s4", type: "analysis" }),
    ]);
    expect(stepsMissingRationale(plan).map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("appends a step per unplanned required tool, chained to the last step", () => {
    const plan = planOf([step({ id: "s1", type: "tool_call", toolName: "web-search" })]);
    injectMissingRequiredToolSteps(plan, ["web-search", "http-get"], "");
    expect(plan.steps.map((s) => s.toolName)).toEqual(["web-search", "http-get"]);
    expect(plan.steps[1]!.dependsOn).toEqual(["s1"]);
    expect(plan.steps[1]!.id).toBe("s2");
  });

  it("gives file-write the path from the task text and the prior step's output", () => {
    const plan = planOf([step({ id: "s1", type: "analysis" })]);
    injectMissingRequiredToolSteps(plan, ["file-write"], "summarize and write it to ./report.md");
    expect(plan.steps[1]!.toolArgs).toEqual({ path: "./report.md", content: "{{from_step:s1}}" });
  });

  it("is a no-op when every required tool is planned", () => {
    const plan = planOf([step({ id: "s1", type: "tool_call", toolName: "a" })]);
    injectMissingRequiredToolSteps(plan, ["a"], "");
    expect(plan.steps).toHaveLength(1);
  });

  it("pads each tool up to its required quantity and no further", () => {
    const plan = planOf([step({ id: "s1", type: "tool_call", toolName: "search" })]);
    injectQuantityDeficitSteps(plan, { search: 3, fetch: 1 });
    const count = (n: string) => plan.steps.filter((s) => s.toolName === n).length;
    expect(count("search")).toBe(3);
    expect(count("fetch")).toBe(1);
  });
});
