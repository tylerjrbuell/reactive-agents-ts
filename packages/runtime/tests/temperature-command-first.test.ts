// Run: bun test packages/runtime/tests/temperature-command-first.test.ts --timeout 15000
/**
 * GH temp-threading (Wave-4 capture defect): commanded temperature must reach
 * the kernel request, COMMAND-FIRST: `config.temperature ?? config.contextProfile?.temperature`.
 *
 * The defect: reasoning-think.ts:336 forwarded ONLY `contextProfile.temperature`
 * into the kernel, dropping the commanded `.withModel({ temperature })` sitting
 * on the same config object. think.ts:339 (`input.temperature ??
 * profile.temperature ?? 0.7`) then always stamped a nonzero tier/profile value,
 * shadowing every adapter's `request.temperature ?? defaultTemperature`.
 * Captures claiming "temp 0" sampled at the tier-profile temperature instead.
 *
 * Harness: builder-seam-behavioral.test.ts's `.withReplayLLM` capturing-LLMService
 * pattern (harness A), pointed at the REASONING kernel path: the capture reads
 * the exact CompletionRequest the kernel builds, so `request.temperature` here
 * IS `think.ts:339`'s `temp` on its way to the wire.
 *
 * Arms:
 *  1. RED-ON-HEAD: command 0 + profile default 0.5 => captured request carries
 *     temperature 0 verbatim (at HEAD: 0.5, the profile value wins).
 *  2. Regression, green both sides: NO command + profile default 0.5 => 0.5
 *     (unset command keeps today's behavior; also pins that the command-first
 *     swap did not break the profile path).
 */
import { describe, it, expect } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { ReactiveAgents } from "../src/builder.js";
import { LLMService, TestLLMService } from "@reactive-agents/llm-provider";
import {
  ExecutionEngine,
  ExecutionEngineLive,
  LifecycleHookRegistryLive,
} from "../src/index.js";
import { defaultReactiveAgentsConfig, type ReactiveAgentsConfig } from "../src/types.js";
import { generateAgentId, generateTaskId, type Task } from "@reactive-agents/core";
import { VerificationService } from "@reactive-agents/verification";
import type { VerificationConfig, VerificationResult } from "@reactive-agents/verification";

type Req = import("@reactive-agents/llm-provider").CompletionRequest;

function capturingLayer(captured: Req[]): Layer.Layer<LLMService> {
  const base = TestLLMService([{ text: "FINAL ANSWER: done" }]);
  return Layer.succeed(
    LLMService,
    LLMService.of({
      ...base,
      complete: (r) => {
        captured.push(r);
        return base.complete(r);
      },
      stream: (r) => {
        captured.push(r);
        return base.stream(r);
      },
    }),
  );
}

/** Run the REASONING kernel with a capturing LLMService; return the first request. */
async function kernelCapture(
  apply: (b: ReturnType<typeof ReactiveAgents.create>) => ReturnType<typeof ReactiveAgents.create>,
): Promise<Req | undefined> {
  const captured: Req[] = [];
  const agent = await apply(
    ReactiveAgents.create()
      .withName("temp-threading")
      .withProvider("test")
      .withModel("test-model")
      .withReasoning({ defaultStrategy: "reactive" })
      .withMaxIterations(2),
  )
    .withReplayLLM(capturingLayer(captured))
    .build();
  try {
    await agent.run("What is 2 + 2?");
    return captured[0];
  } finally {
    await agent.dispose();
  }
}

describe("Commanded temperature threads command-first to the kernel (GH temp-threading)", () => {
  it("commanded 0 beats the tier/profile default (0.5) and reaches the request verbatim", async () => {
    const req = await kernelCapture((b) =>
      b
        .withContextProfile({ temperature: 0.5 })
        .withModel({ temperature: 0 }),
    );
    expect(req).toBeDefined();
    // RED at HEAD: reasoning-think.ts:336 drops config.temperature, so the
    // kernel stamps the profile's 0.5. After the fix: 0 survives `??` chains.
    expect(req!.temperature).toBe(0);
  }, 15000);

  it("unset command keeps the profile default on the request (no behavior change)", async () => {
    const req = await kernelCapture((b) => b.withContextProfile({ temperature: 0.5 }));
    expect(req).toBeDefined();
    expect(req!.temperature).toBe(0.5);
  }, 15000);
});

// ── Seam 3 (review round-1, Important #1): the verification think-retry ──
//
// `verification-think-retry.ts:81` re-ran the REAL task while forwarding only
// `config.contextProfile?.temperature`, dropping the command exactly like the
// pre-fix reasoning-think.ts:336 did. Its output becomes the user-visible
// answer, so the command-first merge must hold on this route too.
// Harness: the stubbed-engine pattern from
// verification-retry-routes-through-kernel.test.ts (ReasoningService stub
// captures the execute params of BOTH the primary pass and the retry pass;
// VerificationService fails the first output so the retry route fires).

type ExecuteParams = Record<string, unknown>;

const LLMServiceStubTag = Context.GenericTag<{
  complete: (req: unknown) => Effect.Effect<{
    content: string;
    stopReason: string;
    usage: { inputTokens: number; outputTokens: number; totalTokens: number; estimatedCost: number };
    model: string;
  }>;
}>("LLMService");

const ReasoningServiceStubTag = Context.GenericTag<{
  execute: (params: ExecuteParams) => Effect.Effect<{
    output: unknown;
    status: string;
    steps?: readonly { id: string; type: string; content: string }[];
    metadata: { cost: number; tokensUsed: number; stepsCount: number };
  }>;
}>("ReasoningService");

function verifyResult(passed: boolean): VerificationResult {
  return {
    overallScore: passed ? 0.9 : 0.2,
    passed,
    riskLevel: passed ? ("low" as const) : ("high" as const),
    layerResults: [],
    recommendation: passed ? ("accept" as const) : ("reject" as const),
    verifiedAt: new Date(),
  };
}

const stubVerificationConfig: VerificationConfig = {
  enableSemanticEntropy: false,
  enableFactDecomposition: false,
  enableMultiSource: false,
  enableSelfConsistency: false,
  enableNli: false,
  passThreshold: 0.7,
  riskThreshold: 0.5,
};

const mockTask: Task = {
  id: generateTaskId(),
  agentId: generateAgentId(),
  type: "query",
  input: { question: "What is the capital of France?" },
  priority: "medium",
  status: "pending",
  metadata: { tags: [] },
  createdAt: new Date(),
};

/**
 * Run the stubbed engine until the verification-retry route fires; return the
 * captured ReasoningService.execute params of the primary and retry passes.
 */
async function retryRouteCapture(
  overrides: Partial<ReactiveAgentsConfig>,
): Promise<{ primary: ExecuteParams; retry: ExecuteParams }> {
  const captured: ExecuteParams[] = [];
  let verifyCallCount = 0;

  const stubReasoning = {
    execute: (params: ExecuteParams) => {
      captured.push(params);
      const isRetry = captured.length > 1;
      return Effect.succeed({
        output: isRetry ? "Paris is the capital of France." : "I don't know the answer.",
        status: "completed",
        steps: [{ id: `s-${captured.length}`, type: "thought", content: "step" }],
        metadata: { cost: 0, tokensUsed: 30, stepsCount: 1 },
      });
    },
  };
  const MockReasoning = Layer.succeed(ReasoningServiceStubTag, stubReasoning);

  const MockLLM = Layer.succeed(LLMServiceStubTag, {
    complete: () =>
      Effect.succeed({
        content: "INLINE-LLM-SHOULD-NOT-BE-CALLED",
        stopReason: "end_turn",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 },
        model: "test-model",
      }),
  });

  const MockVerification = Layer.succeed(VerificationService, {
    verify: () => {
      verifyCallCount += 1;
      return Effect.succeed(verifyResult(verifyCallCount > 1));
    },
    getConfig: () => Effect.succeed(stubVerificationConfig),
  });

  const config = defaultReactiveAgentsConfig("agent-tc-retry", {
    enableVerification: true,
    maxVerificationRetries: 1,
    provider: "test",
    defaultModel: "test-model",
    ...overrides,
  });
  const hookLayer = LifecycleHookRegistryLive;
  const engineLayer = ExecutionEngineLive(config).pipe(Layer.provide(hookLayer));
  const testLayer = Layer.mergeAll(hookLayer, engineLayer, MockLLM, MockReasoning, MockVerification);

  await Effect.runPromise(
    Effect.gen(function* () {
      const engine = yield* ExecutionEngine;
      yield* engine.execute(mockTask);
    }).pipe(Effect.provide(testLayer)),
  );

  expect(captured.length).toBeGreaterThanOrEqual(2);
  return { primary: captured[0]!, retry: captured[1]! };
}

describe("Verification think-retry temperature seam (review Important #1)", () => {
  it("commanded 0 survives the retry route: retry-pass temperature is 0, not the profile's 0.5", async () => {
    const { primary, retry } = await retryRouteCapture({
      temperature: 0,
      contextProfile: { temperature: 0.5 },
    });
    // Primary pass: reasoning-think.ts command-first merge (129fc70b).
    expect(primary["temperature"]).toBe(0);
    // RED at HEAD of this round: verification-think-retry.ts:81 forwarded only
    // contextProfile?.temperature => 0.5 here, dropping the command.
    expect(retry["temperature"]).toBe(0);
  }, 15000);

  it("unset command on the retry route keeps the profile default 0.5 (no behavior change)", async () => {
    const { retry } = await retryRouteCapture({
      contextProfile: { temperature: 0.5 },
    });
    expect(retry["temperature"]).toBe(0.5);
  }, 15000);
});
