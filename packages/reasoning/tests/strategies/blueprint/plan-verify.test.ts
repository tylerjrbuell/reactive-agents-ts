// File: tests/strategies/blueprint/plan-verify.test.ts
import { describe, it, expect } from "bun:test";
import { verifyPlan } from "../../../src/strategies/blueprint/plan-verify.js";
import type { Plan, PlanStep } from "../../../src/types/plan.js";

// ─── Fixtures ───

const makeStep = (
  id: string,
  overrides: Partial<PlanStep> = {},
): PlanStep => ({
  id,
  seq: parseInt(id.replace("s", ""), 10),
  title: `Step ${id}`,
  instruction: `Do step ${id}`,
  type: "analysis",
  status: "pending",
  retries: 0,
  tokensUsed: 0,
  ...overrides,
});

const makePlan = (steps: PlanStep[]): Plan => ({
  id: "test-plan",
  taskId: "t1",
  agentId: "a1",
  goal: "test goal",
  mode: "dag",
  steps,
  status: "active",
  version: 1,
  createdAt: "2026-06-28T00:00:00.000Z",
  updatedAt: "2026-06-28T00:00:00.000Z",
  totalTokens: 0,
  totalCost: 0,
});

const AVAILABLE = ["web-search", "file-write", "calculator"] as const;

// ─── (a) valid plan → ok ───

describe("verifyPlan — clean plans", () => {
  it("(a) valid single-step plan → ok", () => {
    const plan = makePlan([
      makeStep("s1", { type: "tool_call", toolName: "web-search" }),
    ]);
    const result = verifyPlan(plan, { availableToolNames: AVAILABLE });
    expect(result.status).toBe("ok");
    expect(result.plan).toBe(plan); // unchanged identity on ok
  });

  it("(f) clean multi-step DAG with valid backward #E refs → ok", () => {
    const plan = makePlan([
      makeStep("s1", { type: "tool_call", toolName: "web-search" }),
      makeStep("s2", {
        type: "tool_call",
        toolName: "calculator",
        toolArgs: { input: "{{from_step:s1}}" },
      }),
      makeStep("s3", {
        type: "tool_call",
        toolName: "file-write",
        instruction: "Write {{from_step:s2}} and {{from_step:s1:summary}}",
        toolArgs: { content: "{{from_step:s2}}" },
      }),
    ]);
    const result = verifyPlan(plan, { availableToolNames: AVAILABLE });
    expect(result.status).toBe("ok");
    expect(result.reasons).toEqual([]);
  });
});

// ─── (b) missing required tool → repaired ───

describe("verifyPlan — required-tool repair", () => {
  it("(b) missing required tool → repaired with synthetic tool_call step", () => {
    const plan = makePlan([
      makeStep("s1", { type: "tool_call", toolName: "web-search" }),
    ]);
    const result = verifyPlan(plan, {
      availableToolNames: AVAILABLE,
      requiredTools: ["web-search", "file-write"],
    });
    expect(result.status).toBe("repaired");
    // synthetic file-write step injected
    const injected = result.plan.steps.find(
      (s) => s.toolName === "file-write" && s.type === "tool_call",
    );
    expect(injected).toBeDefined();
    expect(result.plan.steps.length).toBe(2);
    expect(result.reasons.some((r) => r.includes("file-write"))).toBe(true);
    // version bumped, input untouched
    expect(result.plan.version).toBe(2);
    expect(plan.steps.length).toBe(1);
  });

  it("present required tools → ok (no injection)", () => {
    const plan = makePlan([
      makeStep("s1", { type: "tool_call", toolName: "web-search" }),
      makeStep("s2", { type: "tool_call", toolName: "file-write" }),
    ]);
    const result = verifyPlan(plan, {
      availableToolNames: AVAILABLE,
      requiredTools: ["web-search", "file-write"],
    });
    expect(result.status).toBe("ok");
  });

  it("quantity deficit → repaired with extra synthetic steps", () => {
    const plan = makePlan([
      makeStep("s1", { type: "tool_call", toolName: "web-search" }),
    ]);
    const result = verifyPlan(plan, {
      availableToolNames: AVAILABLE,
      requiredToolQuantities: { "web-search": 3 },
    });
    expect(result.status).toBe("repaired");
    const searchSteps = result.plan.steps.filter(
      (s) => s.toolName === "web-search",
    );
    expect(searchSteps.length).toBe(3);
  });
});

// ─── (c) unknown tool name healed → repaired ───

describe("verifyPlan — tool-name healing", () => {
  it("(c) unknown tool name within edit distance → healed, repaired", () => {
    const plan = makePlan([
      // "web-serch" is 1 edit from "web-search"
      makeStep("s1", { type: "tool_call", toolName: "web-serch" }),
    ]);
    const result = verifyPlan(plan, { availableToolNames: AVAILABLE });
    expect(result.status).toBe("repaired");
    expect(result.plan.steps[0]!.toolName).toBe("web-search");
    expect(result.reasons.some((r) => r.includes("healed"))).toBe(true);
  });

  // ─── (d) unknown tool, no match → invalid ───

  it("(d) unknown tool with no close match → invalid", () => {
    const plan = makePlan([
      makeStep("s1", {
        type: "tool_call",
        toolName: "completely-different-tool",
      }),
    ]);
    const result = verifyPlan(plan, { availableToolNames: AVAILABLE });
    expect(result.status).toBe("invalid");
    expect(result.plan).toBe(plan);
    expect(result.reasons.some((r) => r.includes("unknown tool"))).toBe(true);
  });
});

// ─── (e) cyclic / forward #E ref → invalid ───

describe("verifyPlan — DAG + reference validity", () => {
  it("(e1) dependency cycle → invalid", () => {
    const plan = makePlan([
      makeStep("s1", { dependsOn: ["s2"] }),
      makeStep("s2", { dependsOn: ["s1"] }),
    ]);
    const result = verifyPlan(plan, { availableToolNames: AVAILABLE });
    expect(result.status).toBe("invalid");
    expect(result.reasons.some((r) => r.includes("cycle"))).toBe(true);
  });

  it("(e2) forward #E reference → invalid", () => {
    const plan = makePlan([
      // s1 references s2 which comes LATER (forward ref)
      makeStep("s1", {
        type: "tool_call",
        toolName: "calculator",
        toolArgs: { input: "{{from_step:s2}}" },
      }),
      makeStep("s2", { type: "tool_call", toolName: "web-search" }),
    ]);
    const result = verifyPlan(plan, { availableToolNames: AVAILABLE });
    expect(result.status).toBe("invalid");
    expect(result.reasons.some((r) => r.includes("forward reference"))).toBe(
      true,
    );
  });

  it("(e3) self reference → invalid", () => {
    const plan = makePlan([
      makeStep("s1", {
        type: "tool_call",
        toolName: "calculator",
        toolArgs: { input: "{{from_step:s1}}" },
      }),
    ]);
    const result = verifyPlan(plan, { availableToolNames: AVAILABLE });
    expect(result.status).toBe("invalid");
    // A self-ref via {{from_step}} also registers as a self-dependency, so the
    // DAG check catches it first as a 1-node cycle — either reason is correct.
    expect(
      result.reasons.some(
        (r) => r.includes("references itself") || r.includes("cycle"),
      ),
    ).toBe(true);
  });

  it("(e4) missing #E reference → invalid", () => {
    const plan = makePlan([
      makeStep("s2", {
        type: "tool_call",
        toolName: "file-write",
        toolArgs: { content: "{{from_step:s1}}" },
      }),
    ]);
    const result = verifyPlan(plan, { availableToolNames: AVAILABLE });
    expect(result.status).toBe("invalid");
    // A missing {{from_step}} target also registers as a dangling dependency,
    // so the DAG check catches it first — either reason is correct.
    expect(
      result.reasons.some(
        (r) => r.includes("missing step") || r.includes("dangling"),
      ),
    ).toBe(true);
  });

  it("(e5) dangling dependsOn → invalid", () => {
    const plan = makePlan([makeStep("s1", { dependsOn: ["s9"] })]);
    const result = verifyPlan(plan, { availableToolNames: AVAILABLE });
    expect(result.status).toBe("invalid");
    expect(result.reasons.some((r) => r.includes("dangling"))).toBe(true);
  });
});
