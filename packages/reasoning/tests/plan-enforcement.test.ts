import { describe, it, expect } from "bun:test";
import {
  stepsMissingRationale,
  injectMissingRequiredToolSteps,
  injectQuantityDeficitSteps,
  routeUnderspecifiedToolSteps,
} from "../src/strategies/plan-execute/plan-enforcement.js";
import type { Plan, PlanStep } from "../src/types/plan.js";
import type { ToolSchema } from "../src/kernel/capabilities/attend/tool-formatting.js";

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

  // h3-plan-only (2026-11-05): the planner emitted `file-read` with toolArgs {}
  // and `file-write` with only `content`. Dispatched directly, each call failed
  // on the missing path and the analysis steps invented the data.
  const schemas: ToolSchema[] = [
    { name: "file-read", description: "", parameters: [{ name: "path", type: "string", description: "", required: true }] },
    {
      name: "file-write",
      description: "",
      parameters: [
        { name: "path", type: "string", description: "", required: true },
        { name: "content", type: "string", description: "", required: true },
      ],
    },
  ];

  it("routes a tool_call step missing a required argument to a composite step for that tool", () => {
    const plan = planOf([
      step({ id: "s1", type: "tool_call", toolName: "file-read", toolArgs: {}, instruction: "Load the inventory CSV" }),
      step({ id: "s2", type: "analysis", dependsOn: ["s1"] }),
      step({ id: "s3", type: "tool_call", toolName: "file-write", toolArgs: { content: "{{from_step:s2}}" } }),
    ]);
    routeUnderspecifiedToolSteps(plan, schemas);
    const [s1, s2, s3] = plan.steps;
    expect(s1!.type).toBe("composite");
    expect(s1!.toolHints).toEqual(["file-read"]);
    expect(s1!.instruction).toContain("Load the inventory CSV");
    expect(s1!.instruction).toContain("path");
    expect(s2!.type).toBe("analysis");
    expect(s3!.type).toBe("composite");
    expect(s3!.toolHints).toEqual(["file-write"]);
    expect(s3!.toolArgs).toBeUndefined();
    // The known argument survives as an instruction and the data dependency is kept.
    expect(s3!.instruction).toContain("content");
    expect(s3!.instruction).toContain("s2");
    expect(s3!.dependsOn).toContain("s2");
  });

  it("leaves fully specified and unknown-schema tool_call steps untouched", () => {
    const full = step({ id: "s1", type: "tool_call", toolName: "file-read", toolArgs: { path: "./a.csv" } });
    const unknown = step({ id: "s2", type: "tool_call", toolName: "custom", toolArgs: {} });
    const plan = planOf([full, unknown]);
    routeUnderspecifiedToolSteps(plan, schemas);
    expect(plan.steps.map((s) => s.type)).toEqual(["tool_call", "tool_call"]);
  });

  it("treats a blank required argument as missing", () => {
    const plan = planOf([step({ id: "s1", type: "tool_call", toolName: "file-read", toolArgs: { path: "  " } })]);
    routeUnderspecifiedToolSteps(plan, schemas);
    expect(plan.steps[0]!.type).toBe("composite");
  });
});
