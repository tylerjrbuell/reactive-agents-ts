import { describe, it, expect } from "bun:test";
import { Effect, Layer, Context } from "effect";
import {
  ExecutionEngine,
  ExecutionEngineLive,
  LifecycleHookRegistryLive,
} from "../src/index.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";
import { VerificationService } from "@reactive-agents/verification";

// ── S3: verification retry must route through ReasoningService when wired ──
//
// When `enableVerification` rejects a response, the engine retries the think
// phase. Pre-S3 the retry called LLMService.complete() inline, bypassing
// kernel state.steps[], entropy scoring, RI dispatcher, healing, FC tool
// execution, episodic memory, and telemetry. This test pins the new contract:
// when a ReasoningService is in the runtime, the retry MUST reuse it (so all
// kernel mechanisms fire). The fallback path (no reasoning) is covered by
// verification-quality-gate.test.ts which still asserts llmCallCount === 2.

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

const ReasoningServiceTag = Context.GenericTag<{
  execute: (params: {
    initialMessages?: readonly { readonly role: "user" | "assistant"; readonly content: string }[];
    [k: string]: unknown;
  }) => Effect.Effect<{
    output: unknown;
    status: string;
    steps?: readonly { id: string; type: string; content: string }[];
    metadata: { cost: number; tokensUsed: number; stepsCount: number };
  }>;
}>("ReasoningService");

const mockTask = {
  id: "task-vrk-001" as any,
  agentId: "agent-001" as any,
  type: "query" as const,
  input: { question: "What is the capital of France?" },
  priority: "medium" as const,
  status: "pending" as const,
  metadata: { tags: [] },
  createdAt: new Date(),
};

describe("Verification retry routes through ReasoningService when wired (S3)", () => {
  it("retries via ReasoningService.execute(), passes feedback in initialMessages, and bypasses inline LLM", async () => {
    let reasoningExecuteCallCount = 0;
    const capturedParams: Array<{
      initialMessages?: readonly { readonly role: string; readonly content: string }[];
    }> = [];

    const stubReasoning = {
      execute: (params: any) => {
        reasoningExecuteCallCount++;
        capturedParams.push(params);
        const isRetry = reasoningExecuteCallCount > 1;
        return Effect.succeed({
          output: isRetry
            ? "Paris is the capital of France."
            : "I don't know the answer.",
          status: isRetry ? "completed" : "completed",
          steps: [
            {
              id: `s-${reasoningExecuteCallCount}`,
              type: "thought",
              content: isRetry ? "corrected after feedback" : "weak answer",
            },
          ],
          metadata: { cost: 0, tokensUsed: 30, stepsCount: 1 },
        });
      },
    };
    const MockReasoning = Layer.succeed(ReasoningServiceTag, stubReasoning);

    // Safety net: provide a no-op LLM. If anything regresses to inline-LLM,
    // the count > 0 here will surface that the kernel route was bypassed.
    let llmCallCount = 0;
    const MockLLM = Layer.succeed(LLMServiceTag, {
      complete: () => {
        llmCallCount++;
        return Effect.succeed({
          content: "INLINE-LLM-CALLED-SHOULD-NOT-HAPPEN",
          stopReason: "end_turn",
          toolCalls: [],
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            estimatedCost: 0,
          },
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
      MockReasoning,
      MockVerification,
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    // Primary assertion — retry routed through reasoning kernel, not inline LLM.
    expect(reasoningExecuteCallCount).toBe(2);

    // Secondary assertion — retry call carries verification feedback in initialMessages.
    const retryParams = capturedParams[1];
    expect(retryParams).toBeDefined();
    expect(retryParams!.initialMessages).toBeDefined();
    const feedbackMsg = (retryParams!.initialMessages ?? []).find(
      (m) =>
        m.role === "user" &&
        typeof m.content === "string" &&
        /\[Verification Feedback\]/.test(m.content),
    );
    expect(feedbackMsg).toBeDefined();

    // Final outcome — verification passes after retry.
    expect(result.success).toBe(true);

    // Sentinel — inline LLM was never invoked. Reasoning is the sole codepath.
    expect(llmCallCount).toBe(0);

    // Sanity — verifier was called twice (initial + post-retry re-verify).
    expect(verifyCallCount).toBe(2);
  });
});
