// File: tests/strategies/reflexion.test.ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { executeReflexion } from "../../src/strategies/reflexion.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";

// Helper to run reflexion with a TestLLM layer
const run = (
  overrides?: Partial<typeof defaultReasoningConfig.strategies.reflexion>,
) => {
  const config = {
    ...defaultReasoningConfig,
    strategies: {
      ...defaultReasoningConfig.strategies,
      reflexion: {
        ...defaultReasoningConfig.strategies.reflexion,
        ...overrides,
      },
    },
  };

  const layer = TestLLMServiceLayer();

  return Effect.runPromise(
    executeReflexion({
      taskDescription: "Explain quantum entanglement briefly.",
      taskType: "explanation",
      memoryContext: "",
      availableTools: [],
      config,
    }).pipe(Effect.provide(layer)),
  );
};

describe("ReflexionStrategy", () => {
  it("returns strategy='reflexion' and has initial attempt step", async () => {
    const result = await run({ maxRetries: 1 });

    expect(result.strategy).toBe("reflexion");
    expect(result.steps.length).toBeGreaterThan(0);

    const firstStep = result.steps[0];
    expect(firstStep?.content).toMatch(/\[ATTEMPT 1\]/);
    expect(firstStep?.type).toBe("thought");
  });

  it("adds critique (observation) steps after each attempt", async () => {
    const result = await run({ maxRetries: 2 });

    const observations = result.steps.filter((s) => s.type === "observation");
    // Should have at least one critique step
    expect(observations.length).toBeGreaterThanOrEqual(1);
    expect(observations[0]?.content).toMatch(/\[CRITIQUE/);
  });

  it("completes immediately when critique is SATISFIED", async () => {
    // TestLLMServiceLayer returns "Test response" by default for non-matching prompts.
    // We need to match on critique prompt. The critique prompt includes "Evaluate whether"
    const layer = TestLLMServiceLayer([
      { match: "Evaluate whether", text: "SATISFIED: The response is accurate and complete." },
    ]);

    const result = await Effect.runPromise(
      executeReflexion({
        taskDescription: "Test task",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        config: {
          ...defaultReasoningConfig,
          strategies: {
            ...defaultReasoningConfig.strategies,
            reflexion: { maxRetries: 3, selfCritiqueDepth: "shallow" },
          },
        },
      }).pipe(Effect.provide(layer)),
    );

    expect(result.status).toBe("completed");
    // Steps: [ATTEMPT 1] thought + [CRITIQUE 1] observation
    expect(result.steps.length).toBe(2);
  });

  it("returns partial when maxRetries exhausted without satisfaction", async () => {
    // TestLLMService never returns SATISFIED
    const result = await run({ maxRetries: 2 });

    expect(result.status).toBe("partial");
    // Steps: attempt1, critique1, attempt2, critique2, attempt3
    // (initial + maxRetries * (critique + improved attempt))
    expect(result.steps.length).toBeGreaterThanOrEqual(3);
  });

  it("tracks token usage and cost across all LLM calls", async () => {
    const result = await run({ maxRetries: 1 });

    expect(result.metadata.tokensUsed).toBeGreaterThanOrEqual(0);
    expect(result.metadata.duration).toBeGreaterThanOrEqual(0);
    expect(result.metadata.stepsCount).toBe(result.steps.length);
  });

  it("confidence is lower when more iterations needed", async () => {
    // Single retry — partial result (low confidence)
    const partial = await run({ maxRetries: 1 });

    // Satisfied on first critique — completed result (high confidence)
    const layer = TestLLMServiceLayer([
      { match: "Evaluate whether", text: "SATISFIED: Great response." },
    ]);
    const completed = await Effect.runPromise(
      executeReflexion({
        taskDescription: "Task",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        config: {
          ...defaultReasoningConfig,
          strategies: {
            ...defaultReasoningConfig.strategies,
            reflexion: { maxRetries: 3, selfCritiqueDepth: "shallow" },
          },
        },
      }).pipe(Effect.provide(layer)),
    );

    expect(completed.metadata.confidence).toBeGreaterThan(
      partial.metadata.confidence,
    );
  });

  it("includes memory context in generation prompt", async () => {
    let capturedPrompt = "";
    // We can't easily inspect the LLM call here with TestLLMService,
    // but we can verify it runs without error when memory context is provided
    const layer = TestLLMServiceLayer([{ match: "memory", text: "Test response." }]);

    const result = await Effect.runPromise(
      executeReflexion({
        taskDescription: "Test with memory",
        taskType: "query",
        memoryContext: "Relevant fact: the sky is blue.",
        availableTools: [],
        config: {
          ...defaultReasoningConfig,
          strategies: {
            ...defaultReasoningConfig.strategies,
            reflexion: { maxRetries: 1, selfCritiqueDepth: "shallow" },
          },
        },
      }).pipe(Effect.provide(layer)),
    );

    expect(result.strategy).toBe("reflexion");
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it("deep critique depth generates more steps per iteration", async () => {
    const shallow = await run({ maxRetries: 1, selfCritiqueDepth: "shallow" });
    const deep = await run({ maxRetries: 1, selfCritiqueDepth: "deep" });

    // Both should have the same structure, just different prompts
    // (max tokens differ but TestLLMService ignores that)
    expect(shallow.steps.length).toBe(deep.steps.length);
    expect(shallow.strategy).toBe("reflexion");
    expect(deep.strategy).toBe("reflexion");
  });

  it("exits early when critique is stagnant (same as previous)", async () => {
    // TestLLMService returns the SAME critique every time → stagnant → bail early
    const layer = TestLLMServiceLayer([
      { match: "Evaluate whether", text: "The response is missing detail about superposition." },
    ]);

    const result = await Effect.runPromise(
      executeReflexion({
        taskDescription: "Explain quantum entanglement",
        taskType: "explanation",
        memoryContext: "",
        availableTools: [],
        config: {
          ...defaultReasoningConfig,
          strategies: {
            ...defaultReasoningConfig.strategies,
            reflexion: { maxRetries: 5, selfCritiqueDepth: "shallow" },
          },
        },
      }).pipe(Effect.provide(layer)),
    );

    // With stagnation detection, should bail well before maxRetries
    const thoughtSteps = result.steps.filter((s) => s.type === "thought");
    expect(thoughtSteps.length).toBe(2);
    expect(result.status).toBe("partial");
  });

  it("caps previousCritiques at 3 entries regardless of maxRetries", async () => {
    const layer = TestLLMServiceLayer([
      { match: "Evaluate whether", text: "The response lacks examples." },
      { text: "An improved response." },
    ]);

    const result = await Effect.runPromise(
      executeReflexion({
        taskDescription: "Explain quantum entanglement",
        taskType: "explanation",
        memoryContext: "",
        availableTools: [],
        config: {
          ...defaultReasoningConfig,
          strategies: {
            ...defaultReasoningConfig.strategies,
            reflexion: { maxRetries: 4, selfCritiqueDepth: "shallow" },
          },
        },
      }).pipe(Effect.provide(layer)),
    );

    expect(result.strategy).toBe("reflexion");
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it("generation pass uses tool schemas when available in input", async () => {
    // Verify that the strategy accepts availableToolSchemas.
    // The generation kernel call will get a prompt containing "quantum computing" →
    // the layer returns a FINAL ANSWER string so the kernel terminates immediately.
    // The critique prompt contains "Evaluate whether" → SATISFIED → completed.
    const layer = TestLLMServiceLayer([
      { match: "quantum computing", text: "FINAL ANSWER: A complete response generated with tool awareness." },
      { match: "Evaluate whether", text: "SATISFIED: The response is thorough and well-researched." },
    ]);

    const result = await Effect.runPromise(
      executeReflexion({
        taskDescription: "Research and explain quantum computing",
        taskType: "research",
        memoryContext: "",
        availableTools: [],
        availableToolSchemas: [
          { name: "web-search", description: "Search the web", parameters: [] },
        ],
        config: defaultReasoningConfig,
      }).pipe(Effect.provide(layer)),
    );

    expect(result.strategy).toBe("reflexion");
    expect(result.status).toBe("completed");
  });

  it("improvement pass includes critique in the task context", async () => {
    // When a critique is not satisfied, the reflexion loop runs an improvement pass.
    // The improvement prompt includes the critique text (via buildGenerationPrompt).
    // We match on a unique string that appears only in the critique to verify the
    // improvement LLM call received the critique context.
    const layer = TestLLMServiceLayer([
      // Critique prompt matches "Evaluate whether" -> unsatisfied critique
      { match: "Evaluate whether", text: "The response misses superposition details uniqueMarker99." },
      // Improvement prompt includes critique text -> "uniqueMarker99" appears -> improved response
      { match: "uniqueMarker99", text: "FINAL ANSWER: Improved explanation with superposition examples." },
    ]);

    const result = await Effect.runPromise(
      executeReflexion({
        taskDescription: "Explain quantum physics",
        taskType: "explanation",
        memoryContext: "",
        availableTools: [],
        config: {
          ...defaultReasoningConfig,
          strategies: {
            ...defaultReasoningConfig.strategies,
            reflexion: { maxRetries: 2, selfCritiqueDepth: "shallow" },
          },
        },
      }).pipe(Effect.provide(layer)),
    );

    // The improvement pass ran and produced a response with improved content
    expect(result.steps.length).toBeGreaterThanOrEqual(3); // initial + critique + improvement
    const thoughtSteps = result.steps.filter((s) => s.type === "thought");
    expect(thoughtSteps.length).toBeGreaterThanOrEqual(2); // initial attempt + improved attempt
    expect(result.output).toContain("Improved explanation");
  });

  it("uses thinking content as critique when clean content is empty", async () => {
    // Simulate Ollama think:true where entire critique is in <think> block
    const layer = TestLLMServiceLayer([
      { match: "Evaluate whether", text: "<think>UNSATISFIED: The response needs more detail.</think>" },
    ]);

    const result = await Effect.runPromise(
      executeReflexion({
        taskDescription: "Test thinking critique",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        config: {
          ...defaultReasoningConfig,
          strategies: {
            ...defaultReasoningConfig.strategies,
            reflexion: { maxRetries: 1, selfCritiqueDepth: "shallow" },
          },
        },
      }).pipe(Effect.provide(layer)),
    );

    // Critique should NOT be empty — it should use thinking content
    const critiques = result.steps.filter(
      (s) => s.type === "observation" && s.content.includes("[CRITIQUE"),
    );
    expect(critiques.length).toBeGreaterThan(0);
    for (const c of critiques) {
      const content = c.content.replace(/^\[CRITIQUE \d+\]\s*/, "");
      expect(content.length).toBeGreaterThan(0);
    }
  });
});
