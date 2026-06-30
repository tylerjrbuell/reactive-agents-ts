// File: tests/strategies/blueprint/progress-format.test.ts
//
// Pure formatters that surface what the blueprint agent is attempting — the
// plan listing (shown live at PLAN time) and the per-step "attempting" line
// (emitted by the worker the moment each step starts running).
import { describe, it, expect } from "bun:test";
import {
  formatPlanListing,
  formatStepAttempt,
} from "../../../src/strategies/blueprint/progress-format.js";
import type { Plan, PlanStep } from "../../../src/types/plan.js";

function step(id: string, seq: number, extra: Partial<PlanStep> = {}): PlanStep {
  return {
    id,
    seq,
    title: `step ${id}`,
    instruction: `do ${id}`,
    type: "tool_call",
    status: "pending",
    retries: 0,
    tokensUsed: 0,
    ...extra,
  };
}

function plan(steps: PlanStep[]): Plan {
  const now = new Date().toISOString();
  return {
    id: "p", taskId: "t", agentId: "a", goal: "g", mode: "dag", steps,
    status: "active", version: 1, createdAt: now, updatedAt: now,
    totalTokens: 0, totalCost: 0,
  };
}

describe("blueprint progress formatters", () => {
  it("formatPlanListing numbers each step and shows tool / analysis intent", () => {
    const out = formatPlanListing(
      plan([
        step("s1", 1, { title: "Fetch last 15 commits", toolName: "github/list_commits" }),
        step("s2", 2, { title: "Format into a numbered list", type: "analysis" }),
      ]),
    );

    // Each step on its own line, numbered, with its intent.
    expect(out).toContain("1. Fetch last 15 commits → github/list_commits");
    expect(out).toContain("2. Format into a numbered list (analysis)");
    // Multi-line so the plan reads as a list.
    expect(out.split("\n").length).toBeGreaterThanOrEqual(2);
  });

  it("formatStepAttempt surfaces the running step's title and tool", () => {
    const out = formatStepAttempt(
      step("s1", 1, { title: "Fetch last 15 commits", toolName: "github/list_commits" }),
      3,
    );

    // Live "attempting" marker + the human-readable intent + which tool.
    expect(out).toContain("▶");
    expect(out).toContain("Fetch last 15 commits");
    expect(out).toContain("github/list_commits");
    // Position among the plan's tool steps.
    expect(out).toContain("1/3");
  });

  it("formatStepAttempt omits the arrow→tool when the step has no tool", () => {
    const out = formatStepAttempt(step("s2", 2, { title: "Think", toolName: undefined }), 2);
    expect(out).toContain("Think");
    expect(out).not.toContain("→");
  });
});
