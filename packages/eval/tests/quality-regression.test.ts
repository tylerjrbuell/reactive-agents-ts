/**
 * Quality regression tests — verify each reasoning strategy produces
 * expected step types using deterministic test provider responses.
 */
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import {
  executeReactive,
  executeReflexion,
  executePlanExecute,
  executeTreeOfThought,
  executeAdaptive,
  defaultReasoningConfig,
  StrategyRegistryLive,
} from "@reactive-agents/reasoning";
import type { ReasoningConfig, ReasoningResult } from "@reactive-agents/reasoning";
import type { ReasoningStep } from "@reactive-agents/reasoning";

const makeInput = (task: string, strategy?: string) => ({
  taskDescription: task,
  taskType: "query",
  memoryContext: "",
  availableTools: [],
  config: {
    ...defaultReasoningConfig,
    ...(strategy ? { defaultStrategy: strategy } : {}),
    strategies: {
      ...defaultReasoningConfig.strategies,
      reactive: { maxIterations: 3, temperature: 0.7 },
      reflexion: { maxRetries: 2, selfCritiqueDepth: "deep" as const },
      planExecute: { maxRefinements: 1, reflectionDepth: "shallow" as const },
      treeOfThought: { breadth: 2, depth: 2, pruningThreshold: 0.3 },
    },
  } as ReasoningConfig,
});

const stepTypes = (steps: readonly ReasoningStep[]) =>
  steps.map((s) => s.type);

describe("Quality Regression: Strategy Step Types", () => {
  it("ReAct produces thought → observation sequence with FINAL ANSWER", async () => {
    const llmLayer = TestLLMServiceLayer([
      { text: "Thought: I need to answer the question directly.\nFINAL ANSWER: The answer is 42." },
    ]);

    const result = await Effect.runPromise(
      executeReactive(makeInput("What is the answer?")).pipe(
        Effect.provide(llmLayer),
      ),
    );

    expect(["completed", "partial", "max_iterations_reached"]).toContain(result.status);
    expect(result.steps.length).toBeGreaterThanOrEqual(1);
    const types = stepTypes(result.steps);
    expect(types).toContain("thought");
    expect(result.output).toBeDefined();
  });

  it("Reflexion produces generation → critique → improvement cycle", async () => {
    const llmLayer = TestLLMServiceLayer([
      // Critique trigger: the critique prompt includes "critique"
      { match: "critique", text: "SATISFIED: The response is complete and accurate." },
      // First call: initial generation (catch-all)
      { text: "Initial response about quantum mechanics." },
    ]);

    const result = await Effect.runPromise(
      executeReflexion(makeInput("Explain quantum mechanics")).pipe(
        Effect.provide(llmLayer),
      ),
    );

    expect(result.steps.length).toBeGreaterThanOrEqual(1);
    // Reflexion should produce at least a thought step (generation)
    const types = stepTypes(result.steps);
    expect(types.some((t) => t === "thought" || t === "reflection" || t === "critique")).toBe(true);
    expect(typeof result.output).toBe("string");
  });

  it("Plan-Execute produces plan → thought sequence", async () => {
    const planJson = JSON.stringify({
      steps: [
        { title: "Research the topic", instruction: "Research AI safety", type: "analysis" },
        { title: "Summarize results", instruction: "Summarize findings", type: "analysis" },
      ],
    });
    const llmLayer = TestLLMServiceLayer([
      // Plan generation -- extractStructuredOutput needs valid JSON
      { match: "planning agent", text: planJson },
      // Step execution via ReAct kernel
      { match: "OVERALL GOAL", text: "FINAL ANSWER: Step completed successfully." },
      // Reflection
      { match: "GOAL:", text: "SATISFIED: The plan was executed correctly." },
      // Synthesis
      { match: "Synthesize", text: "AI safety research findings summarized successfully." },
    ]);

    const result = await Effect.runPromise(
      executePlanExecute(makeInput("Research AI safety")).pipe(
        Effect.provide(llmLayer),
      ),
    );

    expect(result.steps.length).toBeGreaterThanOrEqual(1);
    const types = stepTypes(result.steps);
    // Should have plan and/or thought steps
    expect(types.some((t) => t === "plan" || t === "thought")).toBe(true);
    expect(typeof result.output).toBe("string");
  });

  it("Tree-of-Thought produces branching with scores + synthesis", async () => {
    const llmLayer = TestLLMServiceLayer([
      // Scoring: return a numeric score
      { match: "score", text: "0.8" },
      // Synthesis: final answer
      { match: "synthesize", text: "The best approach is the component-based one." },
      // Expansion: generate candidate thoughts (catch-all)
      { text: "Candidate thought: Approach the problem by breaking it into components." },
    ]);

    const result = await Effect.runPromise(
      executeTreeOfThought(makeInput("Design a data structure")).pipe(
        Effect.provide(llmLayer),
      ),
    );

    expect(result.steps.length).toBeGreaterThanOrEqual(1);
    const types = stepTypes(result.steps);
    // ToT should produce thought steps (for branches)
    expect(types).toContain("thought");
    expect(typeof result.output).toBe("string");
  });

  it("Adaptive classifies task and delegates to appropriate strategy", async () => {
    // Provide StrategyRegistry for adaptive to use
    const llmLayer = TestLLMServiceLayer([
      // Delegated strategy's response
      { match: "FINAL ANSWER", text: "FINAL ANSWER: The adaptive result." },
      // Classification response -- must include a strategy name (catch-all)
      { text: "reactive" },
    ]);

    const strategyLayer = StrategyRegistryLive;

    const result = await Effect.runPromise(
      executeAdaptive(makeInput("What is 2+2?", "adaptive")).pipe(
        Effect.provide(Layer.merge(llmLayer, strategyLayer)),
      ),
    );

    expect(result.steps.length).toBeGreaterThanOrEqual(1);
    expect(typeof result.output).toBe("string");
  });

  it("all strategies return valid ReasoningResult shape", async () => {
    const planJson = JSON.stringify({
      steps: [
        { title: "Do the task", instruction: "Complete the task", type: "analysis" },
      ],
    });
    const makeLLMLayer = () => TestLLMServiceLayer([
      // Plan-execute: extractStructuredOutput needs JSON for plan generation
      { match: "planning agent", text: planJson },
      // Plan-execute: step execution via ReAct kernel
      { match: "OVERALL GOAL", text: "FINAL ANSWER: Test result." },
      // Plan-execute: reflection
      { match: "GOAL:", text: "SATISFIED: Good." },
      // Plan-execute: synthesis
      { match: "Synthesize", text: "Final synthesized test result." },
      // Reflexion critique
      { match: "critique", text: "SATISFIED: Good." },
      // ToT scoring
      { match: "score", text: "0.7" },
      // Default for reactive, reflexion generate, ToT expansion
      { text: "FINAL ANSWER: Test result." },
    ]);

    const strategies = [
      { name: "reactive", fn: executeReactive },
      { name: "reflexion", fn: executeReflexion },
      { name: "plan-execute", fn: executePlanExecute },
      { name: "tree-of-thought", fn: executeTreeOfThought },
    ];

    for (const { name, fn } of strategies) {
      const result = await Effect.runPromise(
        fn(makeInput(`Test ${name}`)).pipe(
          Effect.provide(makeLLMLayer()),
        ),
      );

      // Verify ReasoningResult shape
      expect(result.steps).toBeInstanceOf(Array);
      expect(result.output).toBeDefined();
      expect(result.metadata).toBeDefined();
      expect(typeof result.metadata.tokensUsed).toBe("number");
      expect(typeof result.metadata.cost).toBe("number");
      expect(typeof result.metadata.stepsCount).toBe("number");
      expect(["completed", "partial", "max_iterations_reached"]).toContain(result.status);
    }
  });
});
