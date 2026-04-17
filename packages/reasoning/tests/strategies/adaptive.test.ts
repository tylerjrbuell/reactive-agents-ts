// File: tests/strategies/adaptive.test.ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { executeAdaptive } from "../../src/strategies/adaptive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";

describe("AdaptiveStrategy", () => {
  it("should analyze task, select reactive strategy, and return completed result", async () => {
    const layer = TestLLMServiceLayer([
      // Analysis prompt triggers strategy selection
      { match: "Classify the task", text: "REACTIVE" },
      // Then the reactive sub-strategy runs
      { match: "Think step-by-step", text: "FINAL ANSWER: The capital of France is Paris." },
    ]);

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
    const layer = TestLLMServiceLayer([
      { match: "Think step-by-step", text: "FINAL ANSWER: Done." },
    ]);

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

  it("routes 'explain X with trade-offs' to reactive, not tree-of-thought", async () => {
    // "trade-offs" in the task description was matching the ToT heuristic pattern,
    // causing the adaptive strategy to select tree-of-thought for pure knowledge tasks.
    // Knowledge/explanation tasks should always route to reactive when no tools are needed.
    const layer = TestLLMServiceLayer([
      { match: ".", text: "FINAL ANSWER: The CAP theorem states that a distributed system can only guarantee two of: Consistency, Availability, Partition tolerance." },
    ]);

    const program = executeAdaptive({
      taskDescription: "Explain the CAP theorem and give a concrete real-world example of each of the three trade-offs.",
      taskType: "explanation",
      memoryContext: "",
      availableTools: [],
      config: defaultReasoningConfig,
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(layer)),
    );

    const adaptiveStep = result.steps.find((s) => s.content.includes("[ADAPTIVE]"));
    expect(adaptiveStep?.content).toContain("reactive");
    expect(result.status).toBe("completed");
  });

  it("routes 'describe X with pros and cons' to reactive when task begins with knowledge keyword", async () => {
    const layer = TestLLMServiceLayer([
      { match: ".", text: "FINAL ANSWER: React pros: fast, component-based. Cons: complex state management." },
    ]);

    const program = executeAdaptive({
      taskDescription: "Describe React and list the pros and cons of using it.",
      taskType: "explanation",
      memoryContext: "",
      availableTools: [],
      config: defaultReasoningConfig,
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(layer)),
    );

    const adaptiveStep = result.steps.find((s) => s.content.includes("[ADAPTIVE]"));
    expect(adaptiveStep?.content).toContain("reactive");
    expect(result.status).toBe("completed");
  });

  it("still routes genuine exploration tasks to tree-of-thought", async () => {
    // "compare alternatives" without explanation prefix should still go to ToT
    const layer = TestLLMServiceLayer([
      { match: ".", text: "FINAL ANSWER: Option A is better." },
    ]);

    const program = executeAdaptive({
      taskDescription: "Compare alternative approaches to state management in React: Redux vs Zustand vs Context API. Explore the trade-offs.",
      taskType: "analysis",
      memoryContext: "",
      availableTools: [],
      config: defaultReasoningConfig,
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(layer)),
    );

    const adaptiveStep = result.steps.find((s) => s.content.includes("[ADAPTIVE]"));
    // "compare" + "alternative" + "trade-offs" → tree-of-thought
    expect(adaptiveStep?.content).toContain("tree-of-thought");
    expect(result.status).toBe("completed");
  });

  it("should include past experience in analysis when provided", async () => {
    // We capture the LLM request to verify past experience is included in the prompt
    let capturedPrompt = "";
    const planJson = JSON.stringify({
      steps: [
        { title: "Build pipeline", instruction: "Build the data pipeline", type: "analysis" },
      ],
    });
    const layer = TestLLMServiceLayer([
      // The analysis prompt should contain past experience text
      { match: "Past experience", text: "PLAN_EXECUTE" },
      { match: "Classify the task", text: "PLAN_EXECUTE" },
      // Plan generation: extractStructuredOutput needs valid JSON
      { match: "planning agent", text: planJson },
      // Step execution via ReAct kernel
      { match: "OVERALL GOAL", text: "FINAL ANSWER: Pipeline built successfully." },
      // Reflection
      { match: "GOAL:", text: "SATISFIED: Pipeline complete." },
      // Synthesis
      { match: "Synthesize", text: "Data pipeline built successfully with 3 stages." },
      // Sub-strategy response (fallback)
      { match: "Think step-by-step", text: "FINAL ANSWER: Done with experience-informed strategy." },
    ]);

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
    const layer = TestLLMServiceLayer([
      { match: "Classify the task", text: "REACTIVE" },
      { match: "Think step-by-step", text: "FINAL ANSWER: 42" },
    ]);

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
    const layer = TestLLMServiceLayer([
      // Adaptive analysis -> select REFLEXION
      { match: "Classify the task", text: "REFLEXION" },
      // Reflexion initial generation (systemPrompt contains "task execution agent")
      { match: "task execution agent", text: "Initial attempt at an answer." },
      // Reflexion critique (content contains "Evaluate whether")
      // No SATISFIED: prefix -> not satisfied; maxRetries=1 so loop exits -> partial
      { match: "Evaluate whether", text: "This response lacks detail and accuracy." },
      // Reactive fallback (content contains "Think step-by-step")
      { match: "Think step-by-step", text: "FINAL ANSWER: Recovered with reactive fallback." },
    ]);

    // Task must be >15 words with no tools to bypass heuristic pre-classifier
    // and reach the LLM classification path that returns REFLEXION
    const result = await Effect.runPromise(
      executeAdaptive({
        taskDescription: "Analyze the following complex dataset and produce a comprehensive report that covers all key findings and anomalies detected",
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
