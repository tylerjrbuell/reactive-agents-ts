import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { executeReflexion } from "../../src/strategies/reflexion.js";
import { executePlanExecute } from "../../src/strategies/plan-execute.js";
import { executeTreeOfThought } from "../../src/strategies/tree-of-thought.js";
import { defaultReasoningConfig } from "../../src/types/config.js";

const mockLLM = Layer.succeed(LLMService, {
  complete: () =>
    Effect.succeed({
      content: "FINAL ANSWER: test result",
      usage: { totalTokens: 10, estimatedCost: 0 },
      model: "test",
    }),
  stream: () =>
    Effect.succeed({
      content: "FINAL ANSWER: test result",
      usage: { totalTokens: 10, estimatedCost: 0 },
      model: "test",
    }),
  embed: () => Effect.succeed([]),
  getModelInfo: () =>
    Effect.succeed({ contextWindow: 8000, id: "test", provider: "test" }),
} as any);

/**
 * Reflexion needs a mock that returns SATISFIED for critique prompts.
 * The critique prompt contains "Critically evaluate".
 */
const reflexionLLM = TestLLMServiceLayer({
  "Critically evaluate": "SATISFIED: The response is accurate and complete.",
});

const baseInput = {
  taskDescription: "Say hello",
  taskType: "simple",
  memoryContext: "",
  availableTools: [] as string[],
  config: defaultReasoningConfig,
};

describe("Strategy threading", () => {
  it("reflexion accepts resultCompression", async () => {
    const result = await Effect.runPromise(
      executeReflexion({
        ...baseInput,
        resultCompression: { budget: 400, previewItems: 2 },
      }).pipe(Effect.provide(reflexionLLM)),
    );
    expect(result.status).toBe("completed");
  });

  it("plan-execute accepts resultCompression", async () => {
    const result = await Effect.runPromise(
      executePlanExecute({
        ...baseInput,
        resultCompression: { budget: 400, previewItems: 2 },
      }).pipe(Effect.provide(mockLLM)),
    );
    expect(result.status).toBe("completed");
  });

  it("tree-of-thought accepts resultCompression", async () => {
    const result = await Effect.runPromise(
      executeTreeOfThought({
        ...baseInput,
        resultCompression: { budget: 400, previewItems: 2 },
      }).pipe(Effect.provide(mockLLM)),
    );
    expect(result.status).toBe("completed");
  });

  it("reflexion respects kernelMaxIterations config", async () => {
    const config = {
      ...defaultReasoningConfig,
      strategies: {
        ...defaultReasoningConfig.strategies,
        reflexion: {
          ...defaultReasoningConfig.strategies.reflexion,
          kernelMaxIterations: 5,
        },
      },
    };
    const result = await Effect.runPromise(
      executeReflexion({ ...baseInput, config }).pipe(Effect.provide(reflexionLLM)),
    );
    expect(result.status).toBe("completed");
  });

  it("reflexion accepts agentId and sessionId", async () => {
    const result = await Effect.runPromise(
      executeReflexion({
        ...baseInput,
        agentId: "test-agent-123",
        sessionId: "test-session-456",
      }).pipe(Effect.provide(reflexionLLM)),
    );
    expect(result.status).toBe("completed");
  });

  it("plan-execute accepts agentId and sessionId", async () => {
    const result = await Effect.runPromise(
      executePlanExecute({
        ...baseInput,
        agentId: "test-agent-123",
        sessionId: "test-session-456",
      }).pipe(Effect.provide(mockLLM)),
    );
    expect(result.status).toBe("completed");
  });

  it("tree-of-thought accepts agentId and sessionId", async () => {
    const result = await Effect.runPromise(
      executeTreeOfThought({
        ...baseInput,
        agentId: "test-agent-123",
        sessionId: "test-session-456",
      }).pipe(Effect.provide(mockLLM)),
    );
    expect(result.status).toBe("completed");
  });

  it("reflexion seeds previousCritiques from priorCritiques input", async () => {
    const result = await Effect.runPromise(
      executeReflexion({
        ...baseInput,
        priorCritiques: ["Previous run found the answer lacked error handling"],
      }).pipe(Effect.provide(reflexionLLM)),
    );
    expect(result.status).toBe("completed");
    // Critiques should be stored in result metadata for downstream persistence
    expect(result.metadata.reflexionCritiques).toBeDefined();
    expect(Array.isArray(result.metadata.reflexionCritiques)).toBe(true);
  });

  it("reflexion without priorCritiques still works (backward compat)", async () => {
    const result = await Effect.runPromise(
      executeReflexion({
        ...baseInput,
      }).pipe(Effect.provide(reflexionLLM)),
    );
    expect(result.status).toBe("completed");
    expect(Array.isArray(result.metadata.reflexionCritiques)).toBe(true);
  });

  it("plan-execute respects stepKernelMaxIterations config", async () => {
    const config = {
      ...defaultReasoningConfig,
      strategies: {
        ...defaultReasoningConfig.strategies,
        planExecute: {
          ...defaultReasoningConfig.strategies.planExecute,
          stepKernelMaxIterations: 4,
        },
      },
    };
    const result = await Effect.runPromise(
      executePlanExecute({ ...baseInput, config }).pipe(Effect.provide(mockLLM)),
    );
    expect(result.status).toBe("completed");
  });
});
