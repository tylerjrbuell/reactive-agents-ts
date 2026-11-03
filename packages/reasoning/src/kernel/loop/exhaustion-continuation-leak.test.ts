// Run: bun test packages/reasoning/src/kernel/loop/exhaustion-continuation-leak.test.ts --timeout 20000
//
// Live QA finding (2026-09-09, mastra-vs-ra bench, frontier tier / claude-haiku-4-5,
// task f1-web-search-error, 5/5 deterministic):
//
//   RA shipped `"I'll make one more attempt with a different search query:"` as the
//   user-visible final answer. Mastra on the same model/task shipped an honest
//   failure statement and passed.
//
// Mechanism: every tool call failed, so `countDeliverableCandidates` is 0 (failed
// observations carry `success: false` and are ineligible). That makes runner.ts
// §8.5 and §8.8 no-ops. §8.7 then fills `state.output` from the last thought with
// NO content-shape check, so a *continuation announcement* — a sentence whose whole
// meaning is "I am about to do more work" — becomes the deliverable at
// max_iterations.
//
// Contract: a run that exhausts its iteration budget must never ship a continuation
// announcement as its answer.

import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { failingToolLayer } from "../../testing/tool-service-mock.js";
import { reactKernel } from "./react-kernel.js";
import { runPass } from "./run-pass.js";
import type { KernelInput } from "../state/kernel-state.js";

const WS_SCHEMA = {
  name: "bench_web_search",
  description: "search the web",
  parameters: [{ name: "query", type: "string", required: true }],
};

const CONTINUATION = "I'll make one more attempt with a different search query:";

const scenario = [
  {
    toolCall: { name: "bench_web_search", args: { query: "bitcoin price" } },
    text: "I'll search for the current Bitcoin price:",
  },
  {
    toolCall: { name: "bench_web_search", args: { query: "BTC USD live" } },
    text: "Let me try again with a different query:",
  },
  { text: CONTINUATION },
];

const input: KernelInput = {
  task:
    "Use the bench_web_search tool to find the current Bitcoin price. If you receive an error " +
    "after 2 attempts, stop trying the tool and state that you cannot fetch the live price.",
  availableToolSchemas: [WS_SCHEMA],
  allToolSchemas: [WS_SCHEMA],
};

describe("iteration-budget exhaustion must not ship a continuation announcement", () => {
  it("all tool calls fail, budget exhausts → output is not the trailing 'let me try again' thought", async () => {
    const result = await Effect.runPromise(
      runPass(reactKernel, input, {
        maxIterations: 4,
        strategy: "reactive",
        kernelType: "react",
        taskId: "exhaustion-continuation-leak",
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            TestLLMServiceLayer(scenario),
            failingToolLayer("Rate limit exceeded — please retry in 60s"),
          ),
        ),
      ),
    );

    const output = (result.output ?? "").trim();
    expect(output).not.toBe(CONTINUATION);
    expect(output.endsWith(":")).toBe(false);
    expect(/\b(one more attempt|let me try again|let me search)\b/i.test(output)).toBe(false);
  });
});
