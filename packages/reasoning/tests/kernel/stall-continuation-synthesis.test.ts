// Run: bun test packages/reasoning/tests/kernel/stall-continuation-synthesis.test.ts --timeout 15000
/**
 * gemma4:e4b trace — stall_deliverable shipped the model's MID-THOUGHT text
 * ("I will now process this data… I will now update the todo list and provide
 * the final answer.") as the delivered output, status success.
 *
 * Law: a harness_synthesis/stall terminal must never deliver continuation-
 * intent text. The deliverable falls back to the gathered tool evidence,
 * which the existing §9 output-quality gate renders through its 0-tools
 * synthesis call; a synthesis that is itself continuation-intent is dropped
 * (de-scaffold floor), never committed.
 */
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { runKernel } from "../../src/kernel/loop/runner.js";
import { transitionState, type ThoughtKernel } from "../../src/kernel/state/kernel-state.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { detectContinuationIntent } from "../../src/kernel/capabilities/verify/quality-utils.js";
import { assembleDeliverable } from "../../src/kernel/loop/runner-helpers/deliverable.js";
import { deliverableToContent } from "@reactive-agents/core";

const CONTINUATION =
  "The crypto prices have been successfully retrieved. I will now process this data and format it into a markdown table… I will now update the todo list and provide the final answer.";
const PRICES = "BTC: 67000 USD, ETH: 3500 USD, XRP: 0.52 USD";

const observe = (tool: string, content: string) =>
  makeStep("observation", content, { observationResult: { success: true, toolName: tool } } as never);

/** todo-add twice, one crypto-price result, then continuation thoughts forever. */
const traceKernel: ThoughtKernel = (state) => {
  const i = state.iteration;
  const used = new Set(state.toolsUsed);
  let steps = [...state.steps];
  if (i < 2) {
    used.add("todo");
    steps = [...steps, makeStep("thought", "add a todo"), observe("todo", "todo added: fetch prices")];
  } else if (i === 2) {
    used.add("crypto-price");
    steps = [...steps, makeStep("thought", "fetch prices"), observe("crypto-price", PRICES)];
  } else {
    steps = [...steps, makeStep("thought", CONTINUATION)];
  }
  return Effect.succeed(
    transitionState(state, { status: "thinking", iteration: i + 1, steps, toolsUsed: used } as never),
  );
};

const schemas = [
  { name: "todo", description: "todo list", parameters: {} },
  { name: "crypto-price", description: "prices", parameters: {} },
];
const INPUT = {
  task: "Fetch the crypto prices and give me a markdown table",
  availableToolSchemas: schemas,
  allToolSchemas: schemas,
} as never;

const run = (llmText: string) =>
  Effect.runPromise(
    runKernel(traceKernel, INPUT, { maxIterations: 8, strategy: "test", kernelType: "test" } as never).pipe(
      Effect.provide(TestLLMServiceLayer([{ text: llmText }])),
    ),
  );

describe("assembleDeliverable never picks a continuation-intent thought", () => {
  it("falls back to the validated tool observation (the evidence), not the promise", async () => {
    const state = await Effect.runPromise(
      Effect.gen(function* () {
        let s = yield* traceKernel(
          { iteration: 0, steps: [], toolsUsed: new Set<string>(), meta: {}, scratchpad: new Map() } as never,
          {} as never,
        );
        s = yield* traceKernel(s, {} as never);
        s = yield* traceKernel(s, {} as never);
        s = yield* traceKernel(s, {} as never);
        return s;
      }),
    );
    const d = assembleDeliverable(state);
    expect(d.source).not.toBe("model_synthesis");
    expect(deliverableToContent(d)).toContain("BTC: 67000");
    expect(detectContinuationIntent(deliverableToContent(d)).isContinuation).toBe(false);
  });
});

describe("stall terminal on the trace shape", () => {
  it("synthesizes a real deliverable from the gathered evidence (tools withheld)", async () => {
    const state = await run("| coin | price |\n|---|---|\n| BTC | 67000 |\n| ETH | 3500 |");
    expect(state.output).toContain("| BTC | 67000 |");
    expect(state.output).not.toContain("I will now");
  });

  it("a synthesis that is itself continuation-intent is dropped — never delivered", async () => {
    const state = await run("I will now compile the table of prices and present it.");
    expect(state.output ?? "").not.toContain("I will now");
    expect(detectContinuationIntent(state.output ?? "").isContinuation).toBe(false);
  });
});
