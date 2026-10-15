// Run: bun test packages/runtime/tests/engine-mint-shape.test.ts --timeout 30000
//
// Wave 5.3 review fix (Minor): the delegation join reads `terminatedBy` plus
// honesty markers off the child engine result, but core's `TaskResultSchema` /
// `ResultMetadata` declare neither — a future schema-validated re-mint of the
// result would silently strip them and envelopes would degrade to
// success-bit-only. This pins the mint shape: what the strategies stamp on
// `rr.metadata` must survive onto the result the parent executor reads.
import { describe, expect, it } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { ExecutionEngine, ExecutionEngineLive, LifecycleHookRegistryLive } from "../src/index.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";

const ReasoningServiceTag = Context.GenericTag<{
  execute: (params: { [k: string]: unknown }) => Effect.Effect<{
    output: unknown;
    status: "completed" | "failed" | "partial";
    steps?: readonly { id: string; type: string; content: string }[];
    metadata: Record<string, unknown>;
  }>;
}>("ReasoningService");

const mockReasoning = (metadata: Record<string, unknown>) =>
  Layer.succeed(ReasoningServiceTag, {
    execute: (_params: { [k: string]: unknown }) =>
      Effect.succeed({
        output: "done",
        status: "completed" as const,
        steps: [{ id: "step-1", type: "thought", content: "done" }],
        metadata: { cost: 0.001, tokensUsed: 30, stepsCount: 1, ...metadata },
      }),
  });

const mockTask = {
  id: "task-001" as any,
  agentId: "agent-001" as any,
  type: "query" as const,
  input: { question: "Do the thing." },
  priority: "medium" as const,
  status: "pending" as const,
  metadata: { tags: [] },
  createdAt: new Date(),
};

const makeTestLayer = (reasoningLayer: Layer.Layer<any, any>) => {
  const config = defaultReactiveAgentsConfig("agent-001");
  const hookLayer = LifecycleHookRegistryLive;
  const engineLayer = ExecutionEngineLive(config).pipe(Layer.provide(hookLayer));
  return Layer.mergeAll(hookLayer, engineLayer, reasoningLayer);
};

const run = (metadata: Record<string, unknown>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const engine = yield* ExecutionEngine;
      return yield* engine.execute(mockTask);
    }).pipe(Effect.provide(makeTestLayer(mockReasoning(metadata)))),
  ) as Promise<{ metadata: Record<string, unknown>; terminatedBy?: string; success: boolean }>;

describe("engine mint shape (5.3 chain)", () => {
  it("forwards terminatedBy + honesty markers onto the result", async () => {
    const r = await run({
      terminatedBy: "abstained",
      outstandingCriteria: ["answer"],
      verificationWarning: "reqs open",
      budgetTerminalPartial: true,
      harnessAuthoredOutput: true,
    });
    expect(r.terminatedBy).toBe("abstained");
    expect(r.metadata.outstandingCriteria).toEqual(["answer"]);
    // The engine's own boundary warning keeps precedence over the strategy's
    // (documented FOLD rule) — the pin asserts the precedence, not the value.
    expect(typeof r.metadata.verificationWarning).toBe("string");
    expect(r.metadata.budgetTerminalPartial).toBe(true);
    expect(r.metadata.harnessAuthoredOutput).toBe(true);
    // The FOLD veto: outstanding criteria force success false.
    expect(r.success).toBe(false);
  });
});
