// File: tests/types/plan.test.ts
import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import {
  LLMPlanOutputSchema,
  shortId,
  hydratePlan,
  resolveStepReferences,
} from "../../src/types/plan.js";
import type { PlanStep, PlanContext } from "../../src/types/plan.js";

describe("LLMPlanOutputSchema", () => {
  it("decodes valid LLMPlanOutput", () => {
    const raw = {
      steps: [
        {
          title: "Search the web",
          instruction: "Search for Effect-TS docs",
          type: "tool_call",
          toolName: "web-search",
          toolArgs: { query: "Effect-TS" },
        },
        {
          title: "Analyze results",
          instruction: "Summarize the search results",
          type: "analysis",
        },
      ],
    };
    const decoded = Schema.decodeSync(LLMPlanOutputSchema)(raw);
    expect(decoded.steps).toHaveLength(2);
    expect(decoded.steps[0].title).toBe("Search the web");
    expect(decoded.steps[0].type).toBe("tool_call");
    expect(decoded.steps[0].toolName).toBe("web-search");
    expect(decoded.steps[1].type).toBe("analysis");
  });

  it("rejects invalid step type", () => {
    const raw = {
      steps: [
        {
          title: "Bad step",
          instruction: "This has an invalid type",
          type: "invalid_type",
        },
      ],
    };
    expect(() => Schema.decodeSync(LLMPlanOutputSchema)(raw)).toThrow();
  });
});

describe("shortId", () => {
  it("generates short unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(shortId());
    }
    // All unique
    expect(ids.size).toBe(100);
    // All start with p_ and are <= 8 chars
    for (const id of ids) {
      expect(id.startsWith("p_")).toBe(true);
      expect(id.length).toBeLessThanOrEqual(8);
    }
  });
});

describe("hydratePlan", () => {
  it("assigns deterministic step IDs and metadata", () => {
    const raw = {
      steps: [
        {
          title: "Step one",
          instruction: "Do the first thing",
          type: "tool_call" as const,
          toolName: "web-search",
        },
        {
          title: "Step two",
          instruction: "Do the second thing",
          type: "analysis" as const,
        },
        {
          title: "Step three",
          instruction: "Do the third thing",
          type: "composite" as const,
          dependsOn: ["s1", "s2"],
        },
      ],
    };
    const context: PlanContext = {
      taskId: "task-1",
      agentId: "agent-1",
      goal: "Test the plan",
      planMode: "linear",
    };
    const plan = hydratePlan(raw, context);

    // Plan-level fields
    expect(plan.id.startsWith("p_")).toBe(true);
    expect(plan.taskId).toBe("task-1");
    expect(plan.agentId).toBe("agent-1");
    expect(plan.goal).toBe("Test the plan");
    expect(plan.mode).toBe("linear");
    expect(plan.status).toBe("active");
    expect(plan.version).toBe(1);
    expect(plan.totalTokens).toBe(0);
    expect(plan.totalCost).toBe(0);
    expect(plan.createdAt).toBeTruthy();
    expect(plan.updatedAt).toBe(plan.createdAt);

    // Step IDs are deterministic: s1, s2, s3
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[0].id).toBe("s1");
    expect(plan.steps[1].id).toBe("s2");
    expect(plan.steps[2].id).toBe("s3");

    // Step metadata defaults
    for (const step of plan.steps) {
      expect(step.status).toBe("pending");
      expect(step.retries).toBe(0);
      expect(step.tokensUsed).toBe(0);
    }

    // Step content preserved
    expect(plan.steps[0].title).toBe("Step one");
    expect(plan.steps[0].toolName).toBe("web-search");
    expect(plan.steps[2].dependsOn).toEqual(["s1", "s2"]);

    // Seq numbers
    expect(plan.steps[0].seq).toBe(1);
    expect(plan.steps[1].seq).toBe(2);
    expect(plan.steps[2].seq).toBe(3);
  });
});

describe("resolveStepReferences", () => {
  const completedSteps: PlanStep[] = [
    {
      id: "s1",
      seq: 1,
      title: "Search",
      instruction: "Search the web",
      type: "tool_call",
      status: "completed",
      result: "Found 10 results about Effect-TS",
      retries: 0,
      tokensUsed: 100,
    },
    {
      id: "s2",
      seq: 2,
      title: "Analyze",
      instruction: "Analyze results",
      type: "analysis",
      status: "completed",
      result: "A".repeat(800),
      retries: 0,
      tokensUsed: 200,
    },
  ];

  it("replaces {{from_step:sN}}", () => {
    const args = {
      context: "Previous result: {{from_step:s1}}",
      other: 42,
    };
    const resolved = resolveStepReferences(args, completedSteps);
    expect(resolved.context).toBe(
      "Previous result: Found 10 results about Effect-TS",
    );
    // Non-string values pass through unchanged
    expect(resolved.other).toBe(42);
  });

  it("with :summary truncates to 500 chars", () => {
    const args = {
      summary: "Result: {{from_step:s2:summary}}",
    };
    const resolved = resolveStepReferences(args, completedSteps);
    const value = resolved.summary as string;
    // "Result: " is 8 chars + 500 chars from truncation = 508
    expect(value.length).toBe(508);
    expect(value).toBe("Result: " + "A".repeat(500));
  });
});
