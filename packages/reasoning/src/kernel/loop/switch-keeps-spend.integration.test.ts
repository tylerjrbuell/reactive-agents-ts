// Run: bun test packages/reasoning/src/kernel/loop/switch-keeps-spend.integration.test.ts --timeout 20000
//
// A strategy switch keeps the run's accumulated spend (ablation 2026-11-05,
// wiki/Research/Ablations/2026-11-05-strategy-switching-ablation.md: on every
// switched run the reported `tokens` sat far below provider-billed tokens —
// cogito rw-7 run 0: 11,195 vs 20,144).
//
// Cause: `applyStrategySwitch` rebuilds state with `initialKernelState`, which
// zeroes `tokens`, `inputTokens`, `outputTokens`, `cost` and `llmCalls`. Every
// think turn adds its usage to the CURRENT state's totals, so the post-switch
// segment counted from zero and the pre-switch spend vanished from
// `state.tokens` / `state.cost` (and from result metadata `tokensUsed`, which
// reads them).
//
// Oracle: the LLM layer below stamps a fixed usage on every streamed reply and
// counts the replies it served. The kernel's totals must equal that count times
// the fixed usage — exactly, so a double count fails too.
//
// RED-ON-CUT: drop the spend carry in `carryRunScopedSeeds`
// (runner-helpers/strategy-switch.ts) and the totals equal the post-switch
// segment only.

import { describe, it, expect } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { LLMService, TestLLMService, type TestTurn, type StreamEvent } from "@reactive-agents/llm-provider";
import { reactKernel } from "./react-kernel.js";
import { runPass } from "./run-pass.js";
import { succeedingToolLayer } from "../../testing/tool-service-mock.js";
import type { KernelInput } from "../state/kernel-state.js";

const PAD =
  " The petals rest quietly on the morning grass while the season slowly turns overhead.".repeat(30);

const PARAMS = [
  { name: "path", type: "string", required: true },
  { name: "content", type: "string", required: true },
];
const SCHEMAS = [{ name: "file-write", description: "write content to a file", parameters: PARAMS }];

const TASK = "Write out-1.txt containing the word done.";

const write = (path: string): TestTurn => ({ toolCall: { name: "file-write", args: { path, content: "done" } } });
const claim: TestTurn = { text: "The file is written; the task is complete." + PAD };

const IN = 100;
const OUT = 10;
const COST = 0.001;

/** Test LLM whose every streamed reply bills a fixed usage; counts replies served. */
const meteredLLM = (scenario: TestTurn[]) => {
  const served = { streamed: 0 };
  const base = TestLLMService(scenario);
  const stamp = (ev: StreamEvent): StreamEvent => {
    if (ev.type !== "usage") return ev;
    served.streamed += 1;
    return { type: "usage", usage: { inputTokens: IN, outputTokens: OUT, totalTokens: IN + OUT, estimatedCost: COST } };
  };
  const service: typeof LLMService.Service = {
    ...base,
    stream: (request) => Effect.map(base.stream(request), (s) => Stream.map(s, stamp)),
  };
  return { served, layer: Layer.succeed(LLMService, LLMService.of(service)) };
};

const run = (scenario: TestTurn[]) => {
  const llm = meteredLLM(scenario);
  return Effect.runPromise(
    runPass(reactKernel, { task: TASK, availableToolSchemas: SCHEMAS } satisfies KernelInput, {
      maxIterations: 40,
      strategy: "reactive",
      kernelType: "react",
      taskId: "switch-keeps-spend",
      horizonProfile: "long",
      loopDetection: { maxSameToolCalls: 2 },
      strategySwitching: { enabled: true, maxSwitches: 1, fallbackStrategy: "plan-execute-reflect" },
    }).pipe(Effect.provide(Layer.merge(llm.layer, succeedingToolLayer({ written: true }, PARAMS)))),
  ).then((pass) => ({ pass, served: llm.served.streamed }));
};

const switched = (steps: readonly { type: string; content: string }[]): boolean =>
  steps.some((s) => s.type === "harness_signal" && s.content.includes("Strategy switched"));

describe("a strategy switch keeps the run's spend", () => {
  it("totals = pre-switch + post-switch spend, exactly", async () => {
    const { pass, served } = await run([write("./out-1.txt"), write("./out-1.txt"), claim, claim, claim, claim]);
    expect(switched(pass.state.steps)).toBe(true);
    // The pre-switch segment alone made 2 calls; the run made more.
    expect(served).toBeGreaterThan(2);
    expect(pass.state.llmCalls).toBe(served);
    expect(pass.state.inputTokens).toBe(served * IN);
    expect(pass.state.outputTokens).toBe(served * OUT);
    expect(pass.state.tokens).toBe(served * (IN + OUT));
    expect(pass.state.cost).toBeCloseTo(served * COST, 10);
  });

  it("control: no switch, totals match the calls served", async () => {
    const { pass, served } = await run([write("./out-1.txt"), claim, claim]);
    expect(switched(pass.state.steps)).toBe(false);
    expect(pass.state.llmCalls).toBe(served);
    expect(pass.state.tokens).toBe(served * (IN + OUT));
  });
});
