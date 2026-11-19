// Run: bun run repo test packages/reasoning/tests/strategies/direct-plan-only.test.ts
//
// Direct + tools: the iteration budget comes from the ONE resolver
// (strategies/budget/iteration-cap.ts). With tools registered the default is 3
// (call, observe, answer); at the old default of 1 a tool-calling first turn
// ended as a failed `max_iterations` run with its batch unexecuted. A plan-only
// turn (text, no tool call) is delivered as the honest answer, not a failure.
//
// RED-ON-CUT: set Direct's tools-enabled default back to 1 (direct.ts
// DIRECT_TOOL_ITERATIONS) -> the "tool call then answer" case fails with
// terminatedBy "max_iterations".
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { LLMService, TestLLMService, type TestTurn } from "@reactive-agents/llm-provider";
import { executeDirect } from "../../src/strategies/direct.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { succeedingToolLayer } from "../../src/testing/tool-service-mock.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";

const PRICE = {
  name: "crypto-price",
  description: "price",
  parameters: [{ name: "q", type: "string", description: "q", required: true }],
};
const PLAN = "Let's start by getting the current prices.";

interface Out {
  status: string;
  output: unknown;
  metadata: { terminatedBy?: string };
}

const run = async (turns: TestTurn[], opts: { tools: boolean; cap?: number }): Promise<Out> => {
  const layer = Layer.merge(
    Layer.succeed(LLMService, LLMService.of(TestLLMService(turns))),
    succeedingToolLayer({ price: "100" }, PRICE.parameters),
  );
  const config = {
    ...defaultReasoningConfig,
    strategies: {
      ...defaultReasoningConfig.strategies,
      reactive: {
        ...defaultReasoningConfig.strategies.reactive,
        ...(opts.cap === undefined ? {} : { maxIterations: opts.cap, maxIterationsExplicit: true }),
      },
    },
  };
  return (await Effect.runPromise(
    provideTestEnvelope(
      executeDirect({
        taskDescription: "Get the current prices of BTC and ETH.",
        taskType: "query",
        memoryContext: "",
        availableTools: opts.tools ? ["crypto-price"] : [],
        ...(opts.tools ? { availableToolSchemas: [PRICE] } : {}),
        config,
      }).pipe(Effect.provide(layer)) as never,
    ) as never,
  )) as Out;
};

const CALL: TestTurn = { toolCall: { name: "crypto-price", args: { q: "BTC" } } };

describe("direct strategy with tools: iteration budget", () => {
  it("tool call then answer completes (default budget is 3 with tools)", async () => {
    const r = await run([CALL, { text: "BTC is 100." }], { tools: true });
    expect(r.metadata.terminatedBy).not.toBe("max_iterations");
    expect(r.status).toBe("completed");
    expect(String(r.output)).toContain("BTC is 100");
  });

  it("a plan-only first turn is delivered as the answer, not a failure", async () => {
    const r = await run([{ text: PLAN }, { text: PLAN }], { tools: true });
    expect(r.status).toBe("completed");
    expect(String(r.output)).toContain("current prices");
  });

  it("an explicit user cap of 1 is honored: the tool turn cannot be followed by an answer", async () => {
    const r = await run([CALL, { text: "BTC is 100." }], { tools: true, cap: 1 });
    expect(r.status).toBe("failed");
    expect(r.metadata.terminatedBy).toBe("max_iterations");
  });

  it("an explicit user cap above Direct's ceiling clamps to 3, not 16", async () => {
    const r = await run([CALL, CALL, CALL, CALL, { text: "done" }], { tools: true, cap: 16 });
    expect(r.metadata.terminatedBy).toBe("max_iterations");
  });

  it("without tools the default stays single-shot", async () => {
    const r = await run([{ text: "FINAL ANSWER: hi" }], { tools: false });
    expect(r.status).toBe("completed");
  });
});
