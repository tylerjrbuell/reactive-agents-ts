import { describe, it, expect } from "bun:test";
import { Effect, Layer, Context } from "effect";
import {
  ExecutionEngine,
  ExecutionEngineLive,
  LifecycleHookRegistryLive,
} from "../src/index.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";
import { VerificationService } from "@reactive-agents/verification";

// ── Helpers ──

const LLMServiceTag = Context.GenericTag<{
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
}>("LLMService");

const mockTask = {
  id: "task-vg-001" as any,
  agentId: "agent-001" as any,
  type: "query" as const,
  input: { question: "What is the capital of France?" },
  priority: "medium" as const,
  status: "pending" as const,
  metadata: { tags: [] },
  createdAt: new Date(),
};

const makeUsage = () => ({
  inputTokens: 10,
  outputTokens: 20,
  totalTokens: 30,
  estimatedCost: 0,
});

// ── Tests ──

describe("Verification Quality Gate", () => {
  it("should proceed normally when verification passes", async () => {
    const MockLLM = Layer.succeed(LLMServiceTag, {
      complete: () =>
        Effect.succeed({
          content: "Paris is the capital of France.",
          stopReason: "end_turn",
          toolCalls: [],
          usage: makeUsage(),
          model: "test-model",
        }),
    });

    const MockVerification = Layer.succeed(VerificationService as any, {
      verify: (_response: string, _input: string) =>
        Effect.succeed({
          overallScore: 0.95,
          passed: true,
          riskLevel: "low" as const,
          layerResults: [],
          recommendation: "accept" as const,
          verifiedAt: new Date(),
        }),
    });

    const config = defaultReactiveAgentsConfig("agent-001", {
      enableVerification: true,
    });
    const hookLayer = LifecycleHookRegistryLive;
    const engineLayer = ExecutionEngineLive(config).pipe(
      Layer.provide(hookLayer),
    );
    const testLayer = Layer.mergeAll(
      hookLayer,
      engineLayer,
      MockLLM,
      MockVerification,
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("Paris");
  });

  it("should retry think phase when verification rejects the response", async () => {
    let llmCallCount = 0;

    const MockLLM = Layer.succeed(LLMServiceTag, {
      complete: () => {
        llmCallCount++;
        // First call gives bad answer, second call gives good answer
        const content =
          llmCallCount === 1
            ? "I don't know the answer."
            : "Paris is the capital of France.";
        return Effect.succeed({
          content,
          stopReason: "end_turn",
          toolCalls: [],
          usage: makeUsage(),
          model: "test-model",
        });
      },
    });

    let verifyCallCount = 0;

    const MockVerification = Layer.succeed(VerificationService as any, {
      verify: (_response: string, _input: string) => {
        verifyCallCount++;
        // First verify rejects, second accepts
        if (verifyCallCount === 1) {
          return Effect.succeed({
            overallScore: 0.2,
            passed: false,
            riskLevel: "high" as const,
            layerResults: [
              {
                layerName: "factuality",
                score: 0.2,
                passed: false,
                details: "Response does not answer the question",
              },
            ],
            recommendation: "reject" as const,
            verifiedAt: new Date(),
          });
        }
        return Effect.succeed({
          overallScore: 0.9,
          passed: true,
          riskLevel: "low" as const,
          layerResults: [],
          recommendation: "accept" as const,
          verifiedAt: new Date(),
        });
      },
    });

    const config = defaultReactiveAgentsConfig("agent-001", {
      enableVerification: true,
      maxVerificationRetries: 1,
    });
    const hookLayer = LifecycleHookRegistryLive;
    const engineLayer = ExecutionEngineLive(config).pipe(
      Layer.provide(hookLayer),
    );
    const testLayer = Layer.mergeAll(
      hookLayer,
      engineLayer,
      MockLLM,
      MockVerification,
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.success).toBe(true);
    // LLM should be called at least twice (initial + retry)
    expect(llmCallCount).toBeGreaterThanOrEqual(2);
    // Verification should be called twice (initial + re-verify after retry)
    expect(verifyCallCount).toBe(2);
    // Final answer should be the improved one
    expect(result.output).toContain("Paris");
  });

  it("should respect maxVerificationRetries and not loop forever", async () => {
    let llmCallCount = 0;

    const MockLLM = Layer.succeed(LLMServiceTag, {
      complete: () => {
        llmCallCount++;
        return Effect.succeed({
          content: "I still don't know.",
          stopReason: "end_turn",
          toolCalls: [],
          usage: makeUsage(),
          model: "test-model",
        });
      },
    });

    let verifyCallCount = 0;

    // Always rejects
    const MockVerification = Layer.succeed(VerificationService as any, {
      verify: (_response: string, _input: string) => {
        verifyCallCount++;
        return Effect.succeed({
          overallScore: 0.1,
          passed: false,
          riskLevel: "critical" as const,
          layerResults: [
            {
              layerName: "factuality",
              score: 0.1,
              passed: false,
              details: "Response is not helpful",
            },
          ],
          recommendation: "reject" as const,
          verifiedAt: new Date(),
        });
      },
    });

    const config = defaultReactiveAgentsConfig("agent-001", {
      enableVerification: true,
      maxVerificationRetries: 1,
    });
    const hookLayer = LifecycleHookRegistryLive;
    const engineLayer = ExecutionEngineLive(config).pipe(
      Layer.provide(hookLayer),
    );
    const testLayer = Layer.mergeAll(
      hookLayer,
      engineLayer,
      MockLLM,
      MockVerification,
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    // Should still complete (not crash) even though verification always rejects
    expect(result.success).toBe(true);
    // Verify was called exactly 2 times: initial + after 1 retry
    expect(verifyCallCount).toBe(2);
    // LLM called: 1 initial + 1 retry = 2
    expect(llmCallCount).toBe(2);
  });

  it("should not trigger retry when recommendation is 'review' (not 'reject')", async () => {
    let llmCallCount = 0;

    const MockLLM = Layer.succeed(LLMServiceTag, {
      complete: () => {
        llmCallCount++;
        return Effect.succeed({
          content: "Maybe Paris?",
          stopReason: "end_turn",
          toolCalls: [],
          usage: makeUsage(),
          model: "test-model",
        });
      },
    });

    let verifyCallCount = 0;

    const MockVerification = Layer.succeed(VerificationService as any, {
      verify: (_response: string, _input: string) => {
        verifyCallCount++;
        return Effect.succeed({
          overallScore: 0.6,
          passed: false,
          riskLevel: "medium" as const,
          layerResults: [],
          recommendation: "review" as const, // not "reject"
          verifiedAt: new Date(),
        });
      },
    });

    const config = defaultReactiveAgentsConfig("agent-001", {
      enableVerification: true,
      maxVerificationRetries: 1,
    });
    const hookLayer = LifecycleHookRegistryLive;
    const engineLayer = ExecutionEngineLive(config).pipe(
      Layer.provide(hookLayer),
    );
    const testLayer = Layer.mergeAll(
      hookLayer,
      engineLayer,
      MockLLM,
      MockVerification,
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.success).toBe(true);
    // No retry — only 1 LLM call and 1 verify call
    expect(llmCallCount).toBe(1);
    expect(verifyCallCount).toBe(1);
  });

  it("should work normally when verification is disabled (backward compat)", async () => {
    const MockLLM = Layer.succeed(LLMServiceTag, {
      complete: () =>
        Effect.succeed({
          content: "Paris is the capital.",
          stopReason: "end_turn",
          toolCalls: [],
          usage: makeUsage(),
          model: "test-model",
        }),
    });

    // No verification service provided, verification disabled in config
    const config = defaultReactiveAgentsConfig("agent-001", {
      enableVerification: false,
    });
    const hookLayer = LifecycleHookRegistryLive;
    const engineLayer = ExecutionEngineLive(config).pipe(
      Layer.provide(hookLayer),
    );
    const testLayer = Layer.mergeAll(hookLayer, engineLayer, MockLLM);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("Paris");
  });

  it("should pass verification feedback to the retry think phase", async () => {
    const messagesReceived: unknown[][] = [];

    const MockLLM = Layer.succeed(LLMServiceTag, {
      complete: (req: unknown) => {
        const messages = (req as any).messages ?? [];
        messagesReceived.push(messages);
        return Effect.succeed({
          content:
            messagesReceived.length === 1
              ? "Bad answer"
              : "Paris is the capital of France.",
          stopReason: "end_turn",
          toolCalls: [],
          usage: makeUsage(),
          model: "test-model",
        });
      },
    });

    let verifyCallCount = 0;
    const MockVerification = Layer.succeed(VerificationService as any, {
      verify: (_response: string, _input: string) => {
        verifyCallCount++;
        if (verifyCallCount === 1) {
          return Effect.succeed({
            overallScore: 0.2,
            passed: false,
            riskLevel: "high" as const,
            layerResults: [
              {
                layerName: "factuality",
                score: 0.2,
                passed: false,
                details: "Answer is factually incorrect",
              },
            ],
            recommendation: "reject" as const,
            verifiedAt: new Date(),
          });
        }
        return Effect.succeed({
          overallScore: 0.9,
          passed: true,
          riskLevel: "low" as const,
          layerResults: [],
          recommendation: "accept" as const,
          verifiedAt: new Date(),
        });
      },
    });

    const config = defaultReactiveAgentsConfig("agent-001", {
      enableVerification: true,
      maxVerificationRetries: 1,
    });
    const hookLayer = LifecycleHookRegistryLive;
    const engineLayer = ExecutionEngineLive(config).pipe(
      Layer.provide(hookLayer),
    );
    const testLayer = Layer.mergeAll(
      hookLayer,
      engineLayer,
      MockLLM,
      MockVerification,
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    // The retry LLM call should include verification feedback in messages
    expect(messagesReceived.length).toBeGreaterThanOrEqual(2);
    const retryMessages = messagesReceived[messagesReceived.length - 1];
    const feedbackMsg = retryMessages.find(
      (m: any) =>
        m.role === "user" &&
        typeof m.content === "string" &&
        m.content.includes("Verification Feedback"),
    );
    expect(feedbackMsg).toBeDefined();
    // Should include the layer details
    expect((feedbackMsg as any).content).toContain("factuality");
    expect((feedbackMsg as any).content).toContain("factually incorrect");
  });
});
