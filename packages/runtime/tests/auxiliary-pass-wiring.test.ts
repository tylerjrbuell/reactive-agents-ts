// auxiliary-pass-wiring.test.ts — review C1, the RUNTIME half.
//
// `finalize-result.test.ts` pins what the mint DOES with
// `envelope.policy.auxiliaryPass`. This pins that the two builders which emit
// FRAGMENT passes actually set it — the mint's fence is inert otherwise, and a
// unit test of `buildRunEnvelopeFromConfig` alone would not notice the call
// site losing the flag.
//
// Both builders are called directly with a fake `ReasoningService` that records
// the request, so no provider, no keys and no Ollama are involved.
//
// Cutting `auxiliaryPass: true` from either builder turns the matching
// assertion red.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import type { Task } from "@reactive-agents/core";
import { runReasoningHarnessHooks } from "../src/engine/phases/agent-loop/reasoning-harness-hooks.js";
import { runVerificationThinkRetry } from "../src/engine/phases/agent-loop/verification-think-retry.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";
import type { ExecutionContext, ReactiveAgentsConfig } from "../src/types.js";
import type { ReasoningServiceLike } from "../src/engine/types-reasoning.js";

type ExecuteRequest = Parameters<ReasoningServiceLike["execute"]>[0];

const task: Task = {
  id: "t1",
  type: "analysis",
  input: "write the report",
  priority: "normal",
  createdAt: new Date(),
} as unknown as Task;

const makeCtx = (): ExecutionContext =>
  ({
    taskId: "t1",
    agentId: "a1",
    sessionId: "s1",
    phase: "think",
    agentState: "running",
    iteration: 1,
    maxIterations: 4,
    messages: [{ role: "user", content: "write the report" }],
    toolResults: [],
    cost: 0,
    tokensUsed: 0,
    startedAt: new Date(),
    selectedStrategy: "reactive",
    metadata: { lastResponse: "The report is written." },
  }) as unknown as ExecutionContext;

/** A reasoning service that records every request and answers trivially. */
const recordingService = (
  sink: ExecuteRequest[],
  output = "refined answer",
): ReasoningServiceLike =>
  ({
    execute: (params: ExecuteRequest) => {
      sink.push(params);
      return Effect.succeed({
        strategy: "reactive",
        steps: [],
        output,
        status: "completed",
        metadata: { duration: 0, cost: 0, tokensUsed: 0, stepsCount: 0, confidence: 0.8 },
      });
    },
    registerStrategy: () => Effect.void,
  }) as unknown as ReasoningServiceLike;

const baseConfig = (over: Partial<ReactiveAgentsConfig>): ReactiveAgentsConfig => ({
  ...defaultReactiveAgentsConfig("a1"),
  provider: "test",
  fabricationGuard: "block",
  ...over,
});

describe("auxiliary passes declare themselves on the envelope (review C1)", () => {
  it("post-think continuation (withCustomTermination) carries auxiliaryPass: true", async () => {
    const seen: ExecuteRequest[] = [];
    const config = baseConfig({ customTermination: () => false });

    await Effect.runPromise(
      runReasoningHarnessHooks(makeCtx(), {
        config,
        task,
        cacheHit: false,
        reasoningOpt: { _tag: "Some", value: recordingService(seen) },
        availableToolNames: ["file-write"],
        availableToolSchemas: [],
        allToolSchemas: [],
        effectiveRequiredTools: ["file-write"],
        effectiveRequiredToolQuantities: undefined,
        classifiedRelevantTools: undefined,
        autoMaxCallsPerTool: {},
        taskCategory: "general",
        resolvedCalibration: undefined,
        obs: null,
      }),
    );

    expect(seen.length).toBeGreaterThan(0);
    for (const req of seen) {
      expect(req.envelope?.policy.auxiliaryPass).toBe(true);
      // The rails half is unchanged — the fragment still runs under the run's
      // harness; only the terminal JUDGMENT is fenced.
      expect(req.envelope?.policy.fabricationGuard).toBe("block");
    }
  });

  it("post-think continuation (withOutputValidator) carries auxiliaryPass: true", async () => {
    const seen: ExecuteRequest[] = [];
    const config = baseConfig({
      outputValidator: () => ({ valid: false, feedback: "add detail" }),
      outputValidatorOptions: { maxRetries: 1 },
    });

    await Effect.runPromise(
      runReasoningHarnessHooks(makeCtx(), {
        config,
        task,
        cacheHit: false,
        reasoningOpt: { _tag: "Some", value: recordingService(seen) },
        availableToolNames: ["file-write"],
        availableToolSchemas: [],
        allToolSchemas: [],
        effectiveRequiredTools: ["file-write"],
        effectiveRequiredToolQuantities: undefined,
        classifiedRelevantTools: undefined,
        autoMaxCallsPerTool: {},
        taskCategory: "general",
        resolvedCalibration: undefined,
        obs: null,
      }),
    );

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((r) => r.envelope?.policy.auxiliaryPass === true)).toBe(true);
  });

  it("verification THINK retry carries auxiliaryPass: true", async () => {
    const seen: ExecuteRequest[] = [];

    await Effect.runPromise(
      runVerificationThinkRetry(makeCtx(), {
        config: baseConfig({}),
        task,
        reasoningOpt: { _tag: "Some", value: recordingService(seen) },
        taskCategory: "general",
        resolvedCalibration: undefined,
        obs: null,
        eb: null,
      }),
    );

    expect(seen.length).toBe(1);
    expect(seen[0]?.envelope?.policy.auxiliaryPass).toBe(true);
    expect(seen[0]?.envelope?.policy.fabricationGuard).toBe("block");
    // The two resume rails stay deliberately absent (see `RunEnvelopeExtras`):
    // a fresh pass has no restored pause to apply them against.
    expect(seen[0]?.envelope?.rails.approvalDecision).toBeUndefined();
    expect(seen[0]?.envelope?.rails.interactionResponse).toBeUndefined();
  });

  it("the verify JUDGE pass stays exempt — no envelope at all", async () => {
    const seen: ExecuteRequest[] = [];
    const config = baseConfig({ verificationStep: { mode: "reflect" } });

    await Effect.runPromise(
      runReasoningHarnessHooks(makeCtx(), {
        config,
        task,
        cacheHit: false,
        // A PASS verdict, so no REVISE continuation follows and the only
        // request in `seen` is the judge call itself.
        reasoningOpt: { _tag: "Some", value: recordingService(seen, "PASS") },
        availableToolNames: ["file-write"],
        availableToolSchemas: [],
        allToolSchemas: [],
        effectiveRequiredTools: ["file-write"],
        effectiveRequiredToolQuantities: undefined,
        classifiedRelevantTools: undefined,
        autoMaxCallsPerTool: {},
        taskCategory: "general",
        resolvedCalibration: undefined,
        obs: null,
      }),
    );

    expect(seen.length).toBe(1);
    expect(seen[0]?.envelope).toBeUndefined();
  });

  it("an ENFORCED abstention is never continued past (the C1 fence's mirror)", async () => {
    // The fence stops an auxiliary pass being judged; this stops an auxiliary
    // pass OVERWRITING a judgment. Without it, `.withFabricationGuard("block")`
    // + a continuation hook would ship the continuation's ungrounded prose in
    // place of the sentinel the terminal pass produced.
    const seen: ExecuteRequest[] = [];
    const ctx = makeCtx();
    const abstained: ExecutionContext = {
      ...ctx,
      metadata: {
        ...ctx.metadata,
        lastResponse: "Could not complete the task — no grounded answer could be produced.",
        reasoningResult: {
          output: "Could not complete the task — no grounded answer could be produced.",
          status: "failed",
          metadata: {
            cost: 0,
            tokensUsed: 0,
            stepsCount: 0,
            verdict: { enforced: true, groundedOnRequired: false, failed: ["grounding-on-required"] },
          },
        },
      },
    };

    const after = await Effect.runPromise(
      runReasoningHarnessHooks(abstained, {
        config: baseConfig({ customTermination: () => false }),
        task,
        cacheHit: false,
        reasoningOpt: { _tag: "Some", value: recordingService(seen) },
        availableToolNames: ["file-write"],
        availableToolSchemas: [],
        allToolSchemas: [],
        effectiveRequiredTools: ["file-write"],
        effectiveRequiredToolQuantities: undefined,
        classifiedRelevantTools: undefined,
        autoMaxCallsPerTool: {},
        taskCategory: "general",
        resolvedCalibration: undefined,
        obs: null,
      }),
    );

    expect(seen.length).toBe(0);
    expect(String(after.metadata.lastResponse)).toContain("Could not complete the task");

    // Same for the verification retry.
    const retried = await Effect.runPromise(
      runVerificationThinkRetry(abstained, {
        config: baseConfig({}),
        task,
        reasoningOpt: { _tag: "Some", value: recordingService(seen) },
        taskCategory: "general",
        resolvedCalibration: undefined,
        obs: null,
        eb: null,
      }),
    );
    expect(seen.length).toBe(0);
    expect(String(retried.metadata.lastResponse)).toContain("Could not complete the task");
  });
});
