import { describe, it, expect } from "bun:test";
import {
  buildPlanGenerationPrompt,
  buildPatchPrompt,
  buildStepExecutionPrompt,
  buildReflectionPrompt,
  buildAugmentPrompt,
} from "../../src/strategies/plan-prompts.js";
import type { PlanStep } from "../../src/types/plan.js";

describe("Plan prompts", () => {
  it("buildPlanGenerationPrompt includes goal and tools", () => {
    const prompt = buildPlanGenerationPrompt({
      goal: "Send morning briefing",
      tools: [
        { name: "github/list_commits", signature: "({ owner, repo, perPage })" },
        { name: "signal/send_message_to_user", signature: "({ recipient, message })" },
      ],
      pastPatterns: [],
      modelTier: "mid",
    });

    expect(prompt).toContain("Send morning briefing");
    expect(prompt).toContain("github/list_commits");
    expect(prompt).toContain("signal/send_message_to_user");
    expect(prompt).toContain('"type"');
    expect(prompt).toContain("tool_call");
    expect(prompt).toContain("JSON");
  });

  it("buildPlanGenerationPrompt includes past patterns when available", () => {
    const prompt = buildPlanGenerationPrompt({
      goal: "Send briefing",
      tools: [],
      pastPatterns: ["3-step linear: tool_call → analysis → tool_call"],
      modelTier: "frontier",
    });

    expect(prompt).toContain("SIMILAR PAST PLANS");
    expect(prompt).toContain("3-step linear");
  });

  it("buildPatchPrompt shows completed and failed steps", () => {
    const steps: PlanStep[] = [
      { id: "s1", seq: 1, title: "Fetch", instruction: "Get data", type: "tool_call", status: "completed", retries: 0, tokensUsed: 100, result: "10 commits" },
      { id: "s2", seq: 2, title: "Draft", instruction: "Write msg", type: "analysis", status: "failed", retries: 1, tokensUsed: 50, error: "Empty response" },
      { id: "s3", seq: 3, title: "Send", instruction: "Send msg", type: "tool_call", status: "pending", retries: 0, tokensUsed: 0 },
    ];
    const prompt = buildPatchPrompt("Send briefing", steps);

    expect(prompt).toContain("s1");
    expect(prompt).toContain("completed");
    expect(prompt).toContain("failed");
    expect(prompt).toContain("Empty response");
    expect(prompt).toContain("pending");
  });

  it("buildStepExecutionPrompt includes overall goal and step context", () => {
    const prompt = buildStepExecutionPrompt({
      goal: "Send morning briefing",
      step: { id: "s2", seq: 2, title: "Draft briefing", instruction: "Analyze commits, write message", type: "analysis", status: "in_progress", retries: 0, tokensUsed: 0 },
      stepIndex: 1,
      totalSteps: 3,
      priorResults: [{ stepId: "s1", title: "Fetch commits", result: "10 commits found" }],
      scopedTools: [],
    });

    expect(prompt).toContain("OVERALL GOAL: Send morning briefing");
    expect(prompt).toContain("CURRENT STEP (2 of 3)");
    expect(prompt).toContain("Draft briefing");
    expect(prompt).toContain("10 commits found");
  });

  it("buildStepExecutionPrompt includes scoped tools for composite steps", () => {
    const prompt = buildStepExecutionPrompt({
      goal: "Research topic",
      step: { id: "s1", seq: 1, title: "Search", instruction: "Search web", type: "composite", status: "in_progress", retries: 0, tokensUsed: 0, toolHints: ["web-search"] },
      stepIndex: 0,
      totalSteps: 2,
      priorResults: [],
      scopedTools: [{ name: "web-search", signature: "({ query, maxResults? })" }],
    });

    expect(prompt).toContain("web-search");
    expect(prompt).toContain("query");
  });

  it("buildReflectionPrompt lists step results with status", () => {
    const prompt = buildReflectionPrompt("Send briefing", [
      { stepId: "s1", title: "Fetch", status: "completed", result: "10 commits" },
      { stepId: "s2", title: "Draft", status: "completed", result: "Message drafted" },
      { stepId: "s3", title: "Send", status: "completed", result: "Delivered" },
    ]);

    expect(prompt).toContain("SATISFIED");
    expect(prompt).toContain("s1");
    expect(prompt).toContain("10 commits");
  });

  it("buildPlanGenerationPrompt no longer contains FEWEST or over-combining instruction", () => {
    const prompt = buildPlanGenerationPrompt({
      goal: "Get prices of XRP, XLM, ETH, and Bitcoin",
      tools: [{ name: "web-search", signature: "({ query })" }],
      pastPatterns: [],
      modelTier: "mid",
    });

    expect(prompt).not.toContain("FEWEST");
    expect(prompt).not.toContain("Combine related work into one step");
    expect(prompt).toContain("SEPARATE tool_call step for each item");
    expect(prompt).toContain("Parallel-safe");
  });

  it("buildPlanGenerationPrompt includes TOOL CALL REQUIREMENTS when requiredToolQuantities provided", () => {
    const prompt = buildPlanGenerationPrompt({
      goal: "Get prices of XRP, XLM, ETH, and Bitcoin",
      tools: [{ name: "web-search", signature: "({ query })" }],
      pastPatterns: [],
      modelTier: "mid",
      requiredToolQuantities: { "web-search": 4 },
    });

    expect(prompt).toContain("TOOL CALL REQUIREMENTS");
    expect(prompt).toContain("web-search must be called at least 4 times");
  });

  it("buildPlanGenerationPrompt omits TOOL CALL REQUIREMENTS when no quantities", () => {
    const prompt = buildPlanGenerationPrompt({
      goal: "Simple task",
      tools: [],
      pastPatterns: [],
      modelTier: "mid",
    });

    expect(prompt).not.toContain("TOOL CALL REQUIREMENTS");
  });

  it("buildAugmentPrompt includes goal, completed steps, reflection feedback, and tools", () => {
    const prompt = buildAugmentPrompt({
      goal: "Get prices of XRP, XLM, ETH, and Bitcoin",
      completedSteps: [
        { stepId: "s1", title: "Search XRP price", result: "XRP is $0.52" },
        { stepId: "s2", title: "Render table", result: "| Currency | Price |..." },
      ],
      reflectionFeedback: "The prices for XLM, ETH, and Bitcoin were not found.",
      tools: [{ name: "web-search", signature: "({ query })" }],
    });

    expect(prompt).toContain("Get prices of XRP, XLM, ETH, and Bitcoin");
    expect(prompt).toContain("COMPLETED STEPS AND RESULTS");
    expect(prompt).toContain("s1 (completed)");
    expect(prompt).toContain("XRP is $0.52");
    expect(prompt).toContain("REFLECTION FEEDBACK");
    expect(prompt).toContain("XLM, ETH, and Bitcoin were not found");
    expect(prompt).toContain("AVAILABLE TOOLS");
    expect(prompt).toContain("web-search");
    expect(prompt).toContain("Do NOT re-execute completed steps");
    expect(prompt).toContain("JSON only");
  });

  it("buildAugmentPrompt works without tools", () => {
    const prompt = buildAugmentPrompt({
      goal: "Research topic",
      completedSteps: [{ stepId: "s1", title: "Initial research" }],
      reflectionFeedback: "Missing coverage of subtopic B.",
      tools: [],
    });

    expect(prompt).not.toContain("AVAILABLE TOOLS");
    expect(prompt).toContain("Missing coverage of subtopic B.");
  });
});
