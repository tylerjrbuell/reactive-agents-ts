import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { executePlanExecute } from "../../src/strategies/plan-execute.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { TestLLMService, LLMService, LLMError } from "@reactive-agents/llm-provider";
import { ToolService } from "@reactive-agents/tools";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";

/** Seam pin for plan-execute/step-run.ts: a failing step is retried (stepRetries) and recovers. */
const PLAN = JSON.stringify({
  steps: [
    {
      title: "Fetch",
      instruction: "fetch data",
      type: "tool_call",
      toolName: "web-search",
      toolArgs: { query: "x" },
      rationale: { why: "need data" },
    },
    { title: "Summarize", instruction: "zebra-summary", type: "analysis" },
  ],
});

/** LLM whose first `failFirst` completions mentioning the analysis step ("zebra-summary") fail. */
const flakyLLM = (failFirst: number) => {
  const base = TestLLMService([
    { match: "planning agent", text: PLAN },
    { match: "GOAL:", text: "SATISFIED: done." },
    { match: "zebra-summary", text: "Summary." },
    { match: "Synthesize", text: "Final answer." },
  ]);
  const calls = { n: 0 };
  const service = {
    ...base,
    complete: (req: Parameters<typeof base.complete>[0]) =>
      JSON.stringify(req).includes("zebra-summary") && calls.n++ < failFirst
        ? Effect.fail(new LLMError({ message: "transient", provider: "test" }))
        : base.complete(req),
  };
  return { layer: Layer.succeed(LLMService, LLMService.of(service)), calls };
};

const TOOLS = Layer.succeed(
  ToolService,
  ToolService.of({
    execute: () => Effect.succeed({ success: true, result: "tool ok" }),
    getTool: (name: string) => Effect.succeed({ name, description: "test", parameters: [] }),
    register: () => Effect.void,
    listTools: () => Effect.succeed([]),
    deregister: () => Effect.void,
  } as unknown as Parameters<typeof ToolService.of>[0]),
);

const run = (llm: Layer.Layer<LLMService>, stepRetries: number) =>
  Effect.runPromise(
    provideTestEnvelope(
      executePlanExecute({
        taskDescription: "Fetch and summarize",
        taskType: "research",
        memoryContext: "",
        availableTools: ["web-search"],
        config: {
          ...defaultReasoningConfig,
          strategies: {
            ...defaultReasoningConfig.strategies,
            planExecute: { ...defaultReasoningConfig.strategies.planExecute, stepRetries },
          },
        },
      }).pipe(Effect.provide(Layer.merge(llm, TOOLS))),
    ),
  );

describe("plan-execute step retries (step-run seam)", () => {
  it("retries a step whose execution throws and recovers within stepRetries", async () => {
    const { layer } = flakyLLM(1);
    const r = await run(layer, 1);
    expect(JSON.stringify(r.steps)).not.toContain("Step failed after");
  }, 30000);

  it("does not retry when stepRetries is 0 — the single failed attempt is recorded", async () => {
    const { layer } = flakyLLM(1);
    const r = await run(layer, 0);
    expect(JSON.stringify(r.steps)).toContain("Step failed after 1 attempts");
  }, 30000);
});
