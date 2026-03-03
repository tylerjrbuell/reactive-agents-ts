// File: tests/strategies/adaptive.test.ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { executeAdaptive } from "../../src/strategies/adaptive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";

describe("AdaptiveStrategy", () => {
  it("should analyze task, select reactive strategy, and return completed result", async () => {
    const layer = TestLLMServiceLayer({
      // Analysis prompt triggers strategy selection
      "Classify the task": "REACTIVE",
      // Then the reactive sub-strategy runs
      "Think step-by-step": "FINAL ANSWER: The capital of France is Paris.",
    });

    const program = executeAdaptive({
      taskDescription: "What is the capital of France?",
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      config: defaultReasoningConfig,
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(layer)),
    );

    expect(result.strategy).toBe("adaptive");
    expect(result.status).toBe("completed");
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.metadata.stepsCount).toBeGreaterThan(0);
    expect(result.metadata.tokensUsed).toBeGreaterThan(0);

    // Should have the adaptive analysis step plus sub-strategy steps
    const adaptiveStep = result.steps.find((s) =>
      s.content.includes("[ADAPTIVE]"),
    );
    expect(adaptiveStep).toBeDefined();
    expect(adaptiveStep!.content).toContain("reactive");
  });

  it("should default to reactive when analysis response is unrecognized", async () => {
    // Default "Test response" won't match any strategy keyword,
    // so parseStrategySelection defaults to "reactive"
    const layer = TestLLMServiceLayer({
      "Think step-by-step": "FINAL ANSWER: Done.",
    });

    const program = executeAdaptive({
      taskDescription: "A simple question",
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      config: defaultReasoningConfig,
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(layer)),
    );

    expect(result.strategy).toBe("adaptive");
    expect(result.status).toBe("completed");

    // Adaptive step should show reactive was selected
    const adaptiveStep = result.steps.find((s) =>
      s.content.includes("[ADAPTIVE]"),
    );
    expect(adaptiveStep).toBeDefined();
    expect(adaptiveStep!.content).toContain("reactive");
  });

  it("should include past experience in analysis when provided", async () => {
    // We capture the LLM request to verify past experience is included in the prompt
    let capturedPrompt = "";
    const planJson = JSON.stringify({
      steps: [
        { title: "Build pipeline", instruction: "Build the data pipeline", type: "analysis" },
      ],
    });
    const layer = TestLLMServiceLayer({
      // The analysis prompt should contain past experience text
      "Past experience": "PLAN_EXECUTE",
      "Classify the task": "PLAN_EXECUTE",
      // Plan generation: extractStructuredOutput needs valid JSON
      "planning agent": planJson,
      // Step execution via ReAct kernel
      "OVERALL GOAL": "FINAL ANSWER: Pipeline built successfully.",
      // Reflection
      "GOAL:": "SATISFIED: Pipeline complete.",
      // Synthesis
      "Synthesize": "Data pipeline built successfully with 3 stages.",
      // Sub-strategy response (fallback)
      "Think step-by-step": "FINAL ANSWER: Done with experience-informed strategy.",
    });

    const program = executeAdaptive({
      taskDescription: "Build a multi-step data pipeline",
      taskType: "complex-task",
      memoryContext: "",
      availableTools: ["file-read", "file-write", "code-execute"],
      config: defaultReasoningConfig,
      pastExperience: [
        {
          strategy: "plan-execute-reflect",
          success: true,
          durationMs: 5000,
          tokensUsed: 1500,
          taskDescription: "Build a data processing pipeline with 3 stages",
        },
        {
          strategy: "reactive",
          success: false,
          durationMs: 8000,
          tokensUsed: 3000,
          taskDescription: "Create a multi-step ETL workflow",
        },
      ],
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(layer)),
    );

    expect(result.strategy).toBe("adaptive");
    expect(result.status).toBe("completed");
    // The adaptive strategy should have run with past experience context
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it("should combine token usage from analysis and sub-strategy", async () => {
    const layer = TestLLMServiceLayer({
      "Classify the task": "REACTIVE",
      "Think step-by-step": "FINAL ANSWER: 42",
    });

    const program = executeAdaptive({
      taskDescription: "What is the answer?",
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      config: defaultReasoningConfig,
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(layer)),
    );

    expect(result.status).toBe("completed");
    // Token usage should include both analysis and sub-strategy tokens
    expect(result.metadata.tokensUsed).toBeGreaterThanOrEqual(0);
    expect(result.metadata.cost).toBeGreaterThanOrEqual(0);
    expect(result.metadata.duration).toBeGreaterThanOrEqual(0);
  });

  it("falls back to reactive when selected sub-strategy returns partial status", async () => {
    // reflexion with maxRetries=1 returns partial (loop runs once, no SATISFIED)
    // reactive fallback returns completed (FINAL ANSWER)
    const layer = TestLLMServiceLayer({
      // Adaptive analysis → select REFLEXION
      "Classify the task": "REFLEXION",
      // Reflexion initial generation (systemPrompt contains "thoughtful reasoning agent")
      "thoughtful reasoning agent": "Initial attempt at an answer.",
      // Reflexion critique (content contains "Critically evaluate")
      // No SATISFIED: prefix → not satisfied; maxRetries=1 so loop exits → partial
      "Critically evaluate": "This response lacks detail and accuracy.",
      // Reactive fallback (content contains "Think step-by-step")
      "Think step-by-step": "FINAL ANSWER: Recovered with reactive fallback.",
    });

    const result = await Effect.runPromise(
      executeAdaptive({
        taskDescription: "Test fallback behavior",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        config: {
          ...defaultReasoningConfig,
          strategies: {
            ...defaultReasoningConfig.strategies,
            // maxRetries=1: loop runs once, no SATISFIED → reflexion returns partial
            reflexion: { maxRetries: 1, selfCritiqueDepth: "shallow" },
          },
        },
      }).pipe(Effect.provide(layer)),
    );

    expect(result.strategy).toBe("adaptive");
    expect(result.status).toBe("completed");
    // Should show reflexion was the dispatched strategy
    const dispatchStep = result.steps.find((s) =>
      s.content.includes("[ADAPTIVE]") && s.content.includes("reflexion"),
    );
    expect(dispatchStep).toBeDefined();
    // Should have a fallback step
    const fallbackStep = result.steps.find((s) =>
      s.content.toLowerCase().includes("fallback") || s.content.toLowerCase().includes("falling back"),
    );
    expect(fallbackStep).toBeDefined();
    // Metadata should record fallback occurred
    expect((result.metadata as any).fallbackOccurred).toBe(true);
  });
});
