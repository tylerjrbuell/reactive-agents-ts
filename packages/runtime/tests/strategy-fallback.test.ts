import { describe, it, expect } from "bun:test";
import { Effect, Layer, Context } from "effect";
import {
  ExecutionEngine,
  ExecutionEngineLive,
  LifecycleHookRegistryLive,
} from "../src/index.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";

// Minimal mock LLM service
const MockLLMServiceLive = Layer.succeed(
  Context.GenericTag<{
    complete: (req: unknown) => Effect.Effect<{
      content: string;
      stopReason: string;
      toolCalls?: unknown[];
      usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        estimatedCost: number;
      };
      model: string;
    }>;
  }>("LLMService"),
  {
    complete: (_req: unknown) =>
      Effect.succeed({
        content: "Fallback LLM response: Here is the answer.",
        stopReason: "end_turn",
        toolCalls: [],
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          estimatedCost: 0.001,
        },
        model: "test-model",
      }),
  },
);

// Mock reasoning service that always throws
const FailingReasoningServiceLive = Layer.succeed(
  Context.GenericTag<{
    execute: (params: unknown) => Effect.Effect<unknown>;
  }>("ReasoningService"),
  {
    execute: (_params: unknown) =>
      Effect.fail(new Error("Strategy configuration error: invalid strategy")) as any,
  },
);

// Mock reasoning service that works normally
const WorkingReasoningServiceLive = Layer.succeed(
  Context.GenericTag<{
    execute: (params: unknown) => Effect.Effect<unknown>;
  }>("ReasoningService"),
  {
    execute: (_params: unknown) =>
      Effect.succeed({
        output: "Strategy completed successfully.",
        status: "completed",
        steps: [
          {
            id: "step-1",
            type: "thought",
            content: "Reasoning step",
          },
        ],
        metadata: {
          cost: 0.002,
          tokensUsed: 50,
          stepsCount: 1,
        },
      }),
  },
);

const mockTask = {
  id: "task-001" as any,
  agentId: "agent-001" as any,
  type: "query" as const,
  input: { question: "What is 2+2?" },
  priority: "medium" as const,
  status: "pending" as const,
  metadata: { tags: [] },
  createdAt: new Date(),
};

describe("Strategy execution fallback (GAP-17)", () => {
  const config = {
    ...defaultReactiveAgentsConfig("agent-001"),
    enableReasoning: true,
  };

  const hookLayer = LifecycleHookRegistryLive;
  const engineLayer = ExecutionEngineLive(config).pipe(
    Layer.provide(hookLayer),
  );

  it("should fall back to direct LLM when strategy execution fails", async () => {
    const testLayer = Layer.mergeAll(
      hookLayer,
      engineLayer,
      MockLLMServiceLive,
      FailingReasoningServiceLive,
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    // Strategy fails but execution completes with fallback error result
    expect(result.output).toContain("Strategy execution failed");
    expect((result.metadata as any).strategyFallback).toBe(true);
  });

  it("should set strategyFallback: true in metadata when fallback is used", async () => {
    const testLayer = Layer.mergeAll(
      hookLayer,
      engineLayer,
      MockLLMServiceLive,
      FailingReasoningServiceLive,
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    expect((result.metadata as any).strategyFallback).toBe(true);
  });

  it("should not use fallback when strategy execution succeeds", async () => {
    const testLayer = Layer.mergeAll(
      hookLayer,
      engineLayer,
      MockLLMServiceLive,
      WorkingReasoningServiceLive,
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("Strategy completed successfully");
    const reasoningResult = (result.metadata as any).reasoningResult as any;
    expect(reasoningResult?.metadata?.strategyFallback).toBeUndefined();
  });
});
