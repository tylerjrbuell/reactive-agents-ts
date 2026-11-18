// Run: bun test packages/reasoning/tests/strategies/kernel-iterations-forwarding.test.ts --timeout 15000
//
// 2026-11-18 extra-iterations diagnosis, lever 1: the "iterations" users saw
// were `stepsCount` (thought + action + observation per tool turn, so about 3x
// the real turns). The kernel's own turn count was dropped at the strategy
// substrate (strategies/substrate/strategy-run.ts), which forwarded only
// `stepsCount` and `llmCalls`. The result now carries `kernelIterations`, the
// kernel turns every pass of the run took, so the runtime can publish it.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { executeReactive } from "../../src/strategies/reactive.js";
import { executeAdaptive } from "../../src/strategies/adaptive.js";
import { withKernelIterations } from "../../src/strategies/substrate/strategy-run.js";import { defaultReasoningConfig } from "../../src/types/config.js";
import { succeedingToolLayer } from "../../src/testing/tool-service-mock.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";

const GATHER_SCHEMA = {
  name: "gather",
  description: "gather research data",
  parameters: [{ name: "q", type: "string", description: "query", required: true }],
};

describe("strategy result carries the kernel's real turn count", () => {
  it("two tool turns + a final answer: kernelIterations is 3 turns, stepsCount stays the step count", async () => {
    const result = await Effect.runPromise(provideTestEnvelope(
      executeReactive({
        taskDescription: "Gather two facts about the topic.",
        taskType: "research",
        memoryContext: "",
        availableTools: ["gather"],
        availableToolSchemas: [GATHER_SCHEMA],
        config: defaultReasoningConfig,
      } as never).pipe(
        Effect.provide(
          Layer.merge(
            TestLLMServiceLayer([
              { toolCall: { name: "gather", args: { q: "first" } } },
              { toolCall: { name: "gather", args: { q: "second" } } },
              { text: "FINAL ANSWER: both facts gathered." },
            ]),
            succeedingToolLayer({ finding: "fact" }, GATHER_SCHEMA.parameters),
          ),
        ),
      ),
    ));
    const md = result.metadata;
    expect(md.kernelIterations).toBe(3);
    // stepsCount is unchanged: the step record, not the turn count.
    expect(md.stepsCount).toBe(result.steps.length);
    expect(md.stepsCount).toBeGreaterThan(md.kernelIterations ?? 0);
  }, 15000);

  it("a delegating strategy (adaptive -> reactive) relays the child's turn count", async () => {
    const result = await Effect.runPromise(provideTestEnvelope(
      executeAdaptive({
        taskDescription: "Gather the key fact about the topic.",
        taskType: "research",
        memoryContext: "",
        availableTools: ["gather"],
        availableToolSchemas: [GATHER_SCHEMA],
        config: defaultReasoningConfig,
      } as never).pipe(
        Effect.provide(
          Layer.merge(
            TestLLMServiceLayer([
              { toolCall: { name: "gather", args: { q: "topic" } } },
              { text: "FINAL ANSWER: the key fact." },
            ]),
            succeedingToolLayer({ finding: "fact" }, GATHER_SCHEMA.parameters),
          ),
        ),
      ),
    ));
    expect(result.metadata.kernelIterations).toBe(2);
  }, 15000);

  it("withKernelIterations: own passes add to a relayed child count; no pass leaves the result alone", () => {
    const metadata = { duration: 0, cost: 0, tokensUsed: 0, stepsCount: 7, confidence: 0.8 };
    const base = { metadata };
    expect(withKernelIterations(base, undefined)).toBe(base);
    expect(withKernelIterations(base, 3).metadata.kernelIterations).toBe(3);
    const relayed = { metadata: { ...metadata, kernelIterations: 2 } };
    expect(withKernelIterations(relayed, 1).metadata.kernelIterations).toBe(3);
    expect(withKernelIterations(relayed, 1).metadata.stepsCount).toBe(7);
  });
});
