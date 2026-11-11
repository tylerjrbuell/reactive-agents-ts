// Run: bun test packages/runtime/tests/seam-token-halves-unknown.test.ts --timeout 20000
//
// Token halves are optional: an unknown prompt/completion half is reported
// absent, never as 0 (user-approved 2026-11-10). A provider that reports a
// total only leaves the run meter's halves unknown (reasoning: addKnown /
// contributedHalf); the runtime must carry that through unchanged.
//
// Pins:
//   H1 — settleRunSpend on a total-only meter records a split with both
//        halves absent (engine/run-budget-arm.ts splitOf), keeping llmCalls.
//   H2 — a total-only run: assembled result has tokensUsed > 0 and no
//        inputTokens / outputTokens (engine/execute-result-assembly.ts).
//   H3 — one half known, one unknown: neither half is published.
//   H4 — the debrief's synthesisTokens omits halves the provider did not
//        report, and keeps the total (debrief.ts).
//
// Red-on-cut: restore `meter.inputTokens ?? 0` in run-budget-arm.ts splitOf;
// H1 fails (0 recorded for an unknown half).
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import type { AgentId, Task, TaskId } from "@reactive-agents/core";
import { LLMService } from "@reactive-agents/llm-provider";
import { addRunSpend, makeRunBudgetMeter, withRunBudgetMeter } from "@reactive-agents/reasoning";
import { assembleTaskResult } from "../src/engine/execute-result-assembly.js";
import { readSettledRunSplit, settleRunSpend } from "../src/engine/run-budget-arm.js";
import { synthesizeDebrief } from "../src/debrief.js";
import type { ExecutionContext } from "../src/types.js";

const TASK: Task = {
  id: "t1" as TaskId,
  agentId: "a1" as AgentId,
  type: "query",
  input: { question: "q" },
  priority: "medium",
  status: "running",
  metadata: { tags: [] },
  createdAt: new Date(),
};

function makeCtx(): ExecutionContext {
  return {
    taskId: "t1",
    agentId: "a1",
    sessionId: "s1",
    phase: "complete",
    agentState: "completed",
    iteration: 1,
    maxIterations: 4,
    messages: [],
    toolResults: [],
    cost: 0,
    tokensUsed: 0,
    startedAt: new Date(),
    metadata: {},
  };
}

type Spend = Parameters<typeof addRunSpend>[0];

/** Feed `spends` into a fresh run meter, then settle it onto a ctx. */
const settledAfter = (spends: readonly Spend[]) =>
  Effect.runPromise(
    withRunBudgetMeter(
      Effect.gen(function* () {
        for (const s of spends) yield* addRunSpend(s);
        return yield* settleRunSpend(makeCtx());
      }),
      makeRunBudgetMeter(),
    ),
  );

/** The reasoning result of a total-only run: the strategy reports no halves. */
const totalOnlyRr = (tokensUsed: number) =>
  ({
    output: "done",
    status: "completed",
    metadata: { cost: 0, tokensUsed, stepsCount: 1 },
  }) as NonNullable<ExecutionContext["metadata"]["reasoningResult"]>;

const assemble = (ctx: ExecutionContext) =>
  assembleTaskResult({
    task: TASK,
    ctx,
    rr: totalOnlyRr(ctx.tokensUsed),
    verificationOutcome: { output: "done", success: true, blocked: false },
    executionDurationMs: 1,
    toolCallLog: [],
    entropyLog: [],
    terminatedByRaw: "final_answer",
    debrief: undefined,
    boundaryVerification: undefined,
    traceLinkage: null,
    ambientRunMeter: null,
  });

describe("unknown token halves stay absent through the runtime", () => {
  it("H1: a total-only meter settles a split with both halves absent", async () => {
    const ctx = await settledAfter([{ tokens: 120, cost: 0.01, llmCalls: 2 }]);
    expect(ctx.tokensUsed).toBe(120);
    const split = readSettledRunSplit(ctx.metadata);
    expect(split).toBeDefined();
    expect(split?.inputTokens).toBeUndefined();
    expect(split?.outputTokens).toBeUndefined();
    expect(split?.llmCalls).toBe(2);
  });

  it("H2: a total-only run reports tokensUsed > 0 and no inputTokens/outputTokens", async () => {
    const ctx = await settledAfter([{ tokens: 120, cost: 0, llmCalls: 1 }]);
    const result = assemble(ctx);
    expect(result.metadata.tokensUsed).toBe(120);
    expect(result.metadata.tokensUsed).toBeGreaterThan(0);
    expect("inputTokens" in result.metadata).toBe(false);
    expect("outputTokens" in result.metadata).toBe(false);
    expect(result.metadata.llmCalls).toBe(1);
  });

  it("H3: one known half and one unknown half publish neither", async () => {
    const ctx = await settledAfter([{ tokens: 100, cost: 0, inputTokens: 70, llmCalls: 1 }]);
    const split = readSettledRunSplit(ctx.metadata);
    expect(split?.inputTokens).toBe(70);
    expect(split?.outputTokens).toBeUndefined();
    const result = assemble(ctx);
    expect("inputTokens" in result.metadata).toBe(false);
    expect("outputTokens" in result.metadata).toBe(false);
  });

  it("H4: the debrief omits synthesis halves the provider did not report", async () => {
    const layer = Layer.succeed(LLMService, {
      complete: () =>
        Effect.succeed({
          content: JSON.stringify({ summary: "synth", keyFindings: [], errorsEncountered: [], lessonsLearned: [] }),
          stopReason: "end_turn",
          toolCalls: [],
          usage: { totalTokens: 300, estimatedCost: 0.002 },
          model: "test",
        }),
      embed: () => Effect.succeed([]),
      countTokens: () => Effect.succeed(0),
      getModelConfig: () => ({ provider: "test", model: "test", contextWindow: 8000 }),
      capabilities: { nativeStructuredOutput: false, streaming: false, toolUse: false },
    } as never);
    const { debrief } = await Effect.runPromise(
      synthesizeDebrief({
        taskPrompt: "test",
        agentId: "a-1",
        taskId: "t-1",
        terminatedBy: "end_turn",
        finalOutputText: "done",
        toolCallHistory: [],
        errorsFromLoop: [],
        metrics: { tokens: 100, duration: 50, iterations: 1, cost: 0 },
      }).pipe(Effect.provide(layer)),
    );
    const synth = debrief.metrics.synthesisTokens;
    expect(synth).toBeDefined();
    expect(synth?.total).toBe(300);
    expect(synth?.cost).toBe(0.002);
    expect(synth !== undefined && "input" in synth).toBe(false);
    expect(synth !== undefined && "output" in synth).toBe(false);
  });
});
