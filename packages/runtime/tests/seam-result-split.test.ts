// Run: bun test packages/runtime/tests/seam-result-split.test.ts --timeout 20000
//
// Prompt/completion split at the result boundary (engine/execute-result-assembly.ts).
//
// The split must describe the same tokens as `tokensUsed`. Two sources can
// publish a split:
//   1. the run meter (settled by settleRunSpend), which owns tokensUsed; it is
//      used whenever the provider reported a split (in + out > 0);
//   2. the strategy's own metadata, used only as a fallback, and only when its
//      in + out equals the meter's tokens. A strategy split that disagrees with
//      tokensUsed is dropped, never published next to a total it does not
//      describe.
//
// Pins:
//   E3a — strategy split sums to the meter tokens: published.
//   E3b — strategy split does not sum to the meter tokens: both fields absent.
//   E3c — strategy split with only one side: absent (no half-split).
//   E3d — no split from either source (total-only provider): absent.
//   M1  — a settled meter split wins over a disagreeing strategy split.
//
// Red-on-cut: revert the strategySplit guard in execute-result-assembly.ts to
// `rr?.metadata?.inputTokens ?? ...` (unguarded); E3b fails.
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import type { AgentId, Task, TaskId } from "@reactive-agents/core";
import { addRunSpend, makeRunBudgetMeter, withRunBudgetMeter } from "@reactive-agents/reasoning";
import { assembleTaskResult } from "../src/engine/execute-result-assembly.js";
import { settleRunSpend } from "../src/engine/run-budget-arm.js";
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

function makeCtx(tokensUsed: number, metadata: ExecutionContext["metadata"] = {}): ExecutionContext {
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
    tokensUsed,
    startedAt: new Date(),
    metadata,
  };
}

type StrategyMeta = { inputTokens?: number; outputTokens?: number };

/** A reasoning result whose metadata carries only the given split fields. */
function rrWith(split: StrategyMeta): NonNullable<ExecutionContext["metadata"]["reasoningResult"]> {
  return {
    output: "done",
    status: "completed",
    metadata: { cost: 0, tokensUsed: 0, stepsCount: 1, ...split },
  } as NonNullable<ExecutionContext["metadata"]["reasoningResult"]>;
}

const assemble = (ctx: ExecutionContext, rr: ExecutionContext["metadata"]["reasoningResult"]) =>
  assembleTaskResult({
    task: TASK,
    ctx,
    rr,
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

describe("result split: strategy fallback only when it matches the meter tokens (E3)", () => {
  it("E3a publishes a strategy split whose in + out equals tokensUsed", () => {
    const result = assemble(makeCtx(100), rrWith({ inputTokens: 60, outputTokens: 40 }));
    expect(result.metadata.tokensUsed).toBe(100);
    expect(result.metadata.inputTokens).toBe(60);
    expect(result.metadata.outputTokens).toBe(40);
  });

  it("E3b drops a strategy split that disagrees with tokensUsed", () => {
    const result = assemble(makeCtx(100), rrWith({ inputTokens: 60, outputTokens: 10 }));
    expect(result.metadata.tokensUsed).toBe(100);
    expect(result.metadata.inputTokens).toBeUndefined();
    expect(result.metadata.outputTokens).toBeUndefined();
  });

  it("E3c publishes nothing for a one-sided strategy split", () => {
    const result = assemble(makeCtx(100), rrWith({ inputTokens: 100 }));
    expect(result.metadata.inputTokens).toBeUndefined();
    expect(result.metadata.outputTokens).toBeUndefined();
  });

  it("E3d leaves the split undefined when neither source reports one", () => {
    const result = assemble(makeCtx(100), rrWith({}));
    expect(result.metadata.tokensUsed).toBe(100);
    expect(result.metadata.inputTokens).toBeUndefined();
    expect(result.metadata.outputTokens).toBeUndefined();
  });
});

describe("result split: the settled meter split is the primary source (M1)", () => {
  it("a meter split wins over a disagreeing strategy split, and both fields match tokensUsed", async () => {
    const meter = makeRunBudgetMeter();
    const settled = await Effect.runPromise(
      withRunBudgetMeter(
        Effect.gen(function* () {
          yield* addRunSpend({ tokens: 100, cost: 0, inputTokens: 70, outputTokens: 30, llmCalls: 3 });
          return yield* settleRunSpend(makeCtx(0));
        }),
        meter,
      ),
    );
    expect(settled.tokensUsed).toBe(100);

    const result = assemble(settled, rrWith({ inputTokens: 5, outputTokens: 5 }));
    expect(result.metadata.tokensUsed).toBe(100);
    expect(result.metadata.inputTokens).toBe(70);
    expect(result.metadata.outputTokens).toBe(30);
    expect(result.metadata.llmCalls).toBe(3);
  });
});
