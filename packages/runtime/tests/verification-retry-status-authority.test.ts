// Run: bun test packages/runtime/tests/verification-retry-status-authority.test.ts --timeout 20000
//
// Status authority after a failed verification retry (2026-11-10).
//
// The verifier rejects the first answer; the retry pass then FAILS. The retry
// keeps the first pass's metadata, so the kernel outcome minted on that pass
// (`extensions.terminalOutcome.status: "completed"`) rode to
// `AgentCompleted.outcome.status` while `runOutcome` said `failed`. The shared
// finalize fold now stamps the stale record, so both report `failed`.
//
// RED-ON-CUT:
//  - drop the STRATEGY_RESULT_FAILED_MARKER stamp in
//    engine/execute-success-invariants.ts -> the retry-failure test goes red.
//  - drop the `staleRecord` status spread in foldRuntimeAuthority
//    (engine/finalize/status-authority.ts) -> the retry-failure test goes red.
import { describe, it, expect } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import type { AgentEvent, AgentId, TaskId, Task } from "@reactive-agents/core";
import { VerificationService, defaultVerificationConfig } from "@reactive-agents/verification";
import type { VerificationResult } from "@reactive-agents/verification";
import { ExecutionEngine, ExecutionEngineLive, LifecycleHookRegistryLive } from "../src/index.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";

type AgentCompleted = Extract<AgentEvent, { _tag: "AgentCompleted" }>;

const task: Task = {
  id: "task-retry-status" as TaskId,
  agentId: "agent-retry-status" as AgentId,
  type: "query",
  input: { question: "What is the capital of France?" },
  priority: "medium",
  status: "pending",
  metadata: { tags: [] },
  createdAt: new Date(),
};

/** The first pass: a kernel-closed `completed` answer with its minted outcome. */
const firstPass = {
  output: "Paris is the capital of France.",
  status: "completed" as const,
  steps: [{ id: "s1", type: "thought", content: "Paris is the capital of France." }],
  metadata: {
    cost: 0,
    tokensUsed: 30,
    stepsCount: 1,
    extensions: {
      terminalOutcome: {
        status: "completed",
        terminatedBy: "final_answer",
        provenance: "model-final",
        verdict: null,
        answerSatisfied: null,
        success: true,
        authority: "model-final",
      },
    },
  },
};

const ReasoningServiceTag = Context.GenericTag<{
  execute: (params: Readonly<Record<string, unknown>>) => Effect.Effect<typeof firstPass, string>;
}>("ReasoningService");

/** Call 1 returns `firstPass`; later calls (the verification retry) fail when `retryFails`. */
const reasoning = (retryFails: boolean) => {
  let calls = 0;
  return Layer.succeed(ReasoningServiceTag, {
    execute: () => {
      calls++;
      return calls > 1 && retryFails ? Effect.fail("provider unavailable") : Effect.succeed(firstPass);
    },
  });
};

const verdict = (passed: boolean): VerificationResult => ({
  overallScore: passed ? 0.95 : 0.1,
  passed,
  riskLevel: passed ? "low" : "high",
  layerResults: passed ? [] : [{ layerName: "factuality", score: 0.1, passed: false, details: "wrong" }],
  recommendation: passed ? "accept" : "reject",
  verifiedAt: new Date(),
});

const verification = (passed: boolean) =>
  Layer.succeed(VerificationService, {
    verify: () => Effect.succeed(verdict(passed)),
    getConfig: () => Effect.succeed(defaultVerificationConfig),
  });

async function runOnce(opts: { readonly verifierPasses: boolean; readonly retryFails: boolean }) {
  const config = defaultReactiveAgentsConfig("agent-retry-status", {
    enableVerification: true,
    maxVerificationRetries: 1,
  });
  const hookLayer = LifecycleHookRegistryLive;
  const layer = Layer.mergeAll(
    hookLayer,
    ExecutionEngineLive(config).pipe(Layer.provide(hookLayer)),
    reasoning(opts.retryFails),
    verification(opts.verifierPasses),
    EventBusLive,
  );
  return Effect.runPromise(
    Effect.gen(function* () {
      const completed: AgentCompleted[] = [];
      const bus = yield* EventBus;
      yield* bus.on("AgentCompleted", (e) => Effect.sync(() => { completed.push(e); }));
      const engine = yield* ExecutionEngine;
      const result = yield* engine.execute(task);
      return { result, completed };
    }).pipe(Effect.provide(layer)),
  );
}

describe("status authority after a failed verification retry", () => {
  it("retry failure: outcome.status and runOutcome both report failed", async () => {
    const { result, completed } = await runOnce({ verifierPasses: false, retryFails: true });
    expect(result.success).toBe(false);
    expect(completed).toHaveLength(1);
    const ev = completed[0]!;
    // Vacuity guard: the kernel record was minted (the fold had something to read).
    expect(ev.outcome).toBeDefined();
    expect(ev.runOutcome).toBe("failed");
    expect(ev.outcome!.status).toBe("failed");
    expect(ev.outcome!.success).toBe(false);
    expect(ev.outcome!.authority).toBe("runtime-success-veto:strategy-result-failed");
    expect(ev.outcome!.kernelAuthority).toBe("model-final");
    // The minted status is still named, so the override is explained.
    expect(ev.outcome!.statusReason).toContain("kernel outcome was completed");
    // The cause is the retry failure, and the output stays empty.
    expect(result.output).toBe("");
    expect(String(result.error)).toContain("Verification retry failed");
  });

  it("normal success is unchanged: completed status, success runOutcome, kernel authority", async () => {
    const { result, completed } = await runOnce({ verifierPasses: true, retryFails: true });
    expect(result.success).toBe(true);
    const ev = completed[0]!;
    expect(ev.runOutcome).toBe("success");
    expect(ev.outcome!.status).toBe("completed");
    expect(ev.outcome!.success).toBe(true);
    expect(ev.outcome!.authority).toBe("model-final");
    expect(ev.outcome!.kernelAuthority).toBeUndefined();
    expect(result.output).toBe("Paris is the capital of France.");
  });
});
