import { describe, it, expect } from "bun:test";
import { Effect, Layer, Context } from "effect";
import {
  ExecutionEngine,
  ExecutionEngineLive,
  LifecycleHookRegistryLive,
} from "../src/index.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";
import { VerificationService } from "@reactive-agents/verification";

// ── Stub ReasoningService (Move 1 dead-arm removal, 2026-08-21) ────────────
//
// `ExecutionEngineLive` now always routes through the kernel arm when a
// `ReasoningService` is available; the raw `LLMService` mocks this file used
// to drive the (now-deleted) inline arm directly are no longer on the
// execution path. Crucially, the verification-retry mechanism itself
// (`verification-think-retry.ts`) ALSO routes through `ReasoningService`
// when available — "Kernel-routed retry": it calls
// `reasoningOpt.value.execute({..., availableTools: [], contextProfile:
// { maxIterations: 1 }})` with the verifier feedback already folded into
// `c.messages`, which flows in via `params.initialMessages`. So a single
// `ReasoningService` stub, called once for the initial think and again for
// each retry, is the correct real boundary — not a special-cased mock.
type StubReasoningResult = {
  output: unknown;
  status: "completed" | "failed" | "partial";
  steps?: readonly { id: string; type: string; content: string }[];
  metadata: { cost: number; tokensUsed: number; stepsCount: number };
};

const ReasoningServiceTag = Context.GenericTag<{
  execute: (params: { [k: string]: unknown }) => Effect.Effect<StubReasoningResult>;
}>("ReasoningService");

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

/** A stub whose per-call output is driven by `contentByCall` (1-indexed by
 * call count; the last entry repeats for any further calls). Mirrors the old
 * `makeMockLLM`'s callCount-driven content selection, at the
 * `ReasoningService.execute()` boundary instead of `LLMService.complete()`. */
function makeMockReasoning(contentByCall: readonly string[]) {
  let callCount = 0;
  const calls: { [k: string]: unknown }[] = [];
  const layer = Layer.succeed(ReasoningServiceTag, {
    execute: (params: { [k: string]: unknown }) => {
      callCount++;
      calls.push(params);
      const content = contentByCall[Math.min(callCount, contentByCall.length) - 1]!;
      return Effect.succeed({
        output: content,
        status: "completed" as const,
        steps: [{ id: `step-${callCount}`, type: "thought", content }],
        metadata: { cost: 0, tokensUsed: 30, stepsCount: 1 },
      });
    },
  });
  return { layer, calls, callCount: () => callCount };
}

// ── Tests ──

describe("Verification Quality Gate", () => {
  it("should proceed normally when verification passes", async () => {
    const reasoning = makeMockReasoning(["Paris is the capital of France."]);

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
      reasoning.layer,
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
    const reasoning = makeMockReasoning([
      "I don't know the answer.",
      "Paris is the capital of France.",
    ]);

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
      reasoning.layer,
      MockVerification,
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.success).toBe(true);
    // ReasoningService should be called at least twice (initial + retry)
    expect(reasoning.callCount()).toBeGreaterThanOrEqual(2);
    // Verification should be called twice (initial + re-verify after retry)
    expect(verifyCallCount).toBe(2);
    // Final answer should be the improved one
    expect(result.output).toContain("Paris");
  });

  it("should respect maxVerificationRetries and not loop forever", async () => {
    const reasoning = makeMockReasoning(["I still don't know."]);

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
      reasoning.layer,
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
    // ReasoningService called: 1 initial + 1 retry = 2
    expect(reasoning.callCount()).toBe(2);
  });

  it("should not trigger retry when recommendation is 'review' (not 'reject')", async () => {
    const reasoning = makeMockReasoning(["Maybe Paris?"]);

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
      reasoning.layer,
      MockVerification,
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.success).toBe(true);
    // No retry — only 1 ReasoningService call and 1 verify call
    expect(reasoning.callCount()).toBe(1);
    expect(verifyCallCount).toBe(1);
  });

  it("should work normally when verification is disabled (backward compat)", async () => {
    const reasoning = makeMockReasoning(["Paris is the capital."]);

    // No verification service provided, verification disabled in config
    const config = defaultReactiveAgentsConfig("agent-001", {
      enableVerification: false,
    });
    const hookLayer = LifecycleHookRegistryLive;
    const engineLayer = ExecutionEngineLive(config).pipe(
      Layer.provide(hookLayer),
    );
    const testLayer = Layer.mergeAll(hookLayer, engineLayer, reasoning.layer);

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
    const reasoning = makeMockReasoning([
      "Bad answer",
      "Paris is the capital of France.",
    ]);

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
      reasoning.layer,
      MockVerification,
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    // The retry ReasoningService call should include verification feedback
    // in its seeded initialMessages (the kernel-routed retry's carrier for
    // verifier feedback — see verification-think-retry.ts).
    expect(reasoning.calls.length).toBeGreaterThanOrEqual(2);
    const retryParams = reasoning.calls[reasoning.calls.length - 1]!;
    const retryMessages = (retryParams.initialMessages ?? []) as readonly {
      role: string;
      content: string;
    }[];
    const feedbackMsg = retryMessages.find(
      (m) =>
        m.role === "user" &&
        typeof m.content === "string" &&
        m.content.includes("Verification Feedback"),
    );
    expect(feedbackMsg).toBeDefined();
    // Should include the layer details
    expect(feedbackMsg?.content).toContain("factuality");
    expect(feedbackMsg?.content).toContain("factually incorrect");
  });

  // ── F10: onReject enforcement (end-to-end through the engine) ──────────
  const alwaysBadReasoning = () =>
    makeMockReasoning(["This answer is wrong and unverifiable."]);

  const alwaysRejectVerification = () =>
    Layer.succeed(VerificationService as any, {
      verify: (_response: string, _input: string) =>
        Effect.succeed({
          overallScore: 0.15,
          passed: false,
          riskLevel: "high" as const,
          layerResults: [
            { layerName: "factuality", score: 0.15, passed: false, details: "wrong" },
          ],
          recommendation: "reject" as const,
          verifiedAt: new Date(),
        }),
    });

  const runWith = async (onReject: "block" | "annotate" | "proceed" | undefined) => {
    const config = defaultReactiveAgentsConfig("agent-001", {
      enableVerification: true,
      maxVerificationRetries: 1,
      ...(onReject ? { verificationOnReject: onReject } : {}),
    });
    const hookLayer = LifecycleHookRegistryLive;
    const engineLayer = ExecutionEngineLive(config).pipe(Layer.provide(hookLayer));
    const testLayer = Layer.mergeAll(
      hookLayer,
      engineLayer,
      alwaysBadReasoning().layer,
      alwaysRejectVerification(),
    );
    return Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );
  };

  it("onReject:'block' withholds the answer and fails the run", async () => {
    const result = await runWith("block");
    expect(result.success).toBe(false);
    expect(String(result.output)).not.toContain("This answer is wrong");
    expect(String(result.output).toLowerCase()).toContain("withheld");
  });

  it("onReject:'annotate' ships the answer with a warning", async () => {
    const result = await runWith("annotate");
    expect(String(result.output)).toContain("failed verification");
    expect(String(result.output)).toContain("This answer is wrong");
  });

  it("default (proceed) ships the rejected answer unchanged", async () => {
    const result = await runWith(undefined);
    expect(String(result.output)).toContain("This answer is wrong");
    expect(String(result.output).toLowerCase()).not.toContain("withheld");
  });
});
