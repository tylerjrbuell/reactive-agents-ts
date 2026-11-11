// Run: bun test packages/runtime/tests/seam-thought-iteration.test.ts --timeout 20000
//
// ThoughtEmitted.iteration is the KERNEL ITERATION of the turn that produced
// the thought, never the step index (engine/strategy-neutral-stream.ts).
//
// Defect (2026-11-10, Cortex duplicated chat steps): the projection filled
// `iteration` from `ReasoningStepCompleted.step` (steps.length + 1, counting
// thought/action/observation steps), so a 3-turn run streamed thoughts at
// iterations 1, 4, 7 while every other event (TokenUsage, ToolCallStarted,
// ExitGateDecision) said 0, 1, 2. UIs grouping by iteration split one turn
// into several.
//
// Pins:
//   T1 — the bus event's own `iteration` wins when the emitter stamps it.
//   T2 — otherwise the run's iteration cursor (its last LLM call) is used.
//   T3 — `step` is never read as the iteration.
//   T4 — end to end: a 3-turn kernel run streams thoughts at 0, 1, 2, each
//        equal to the iteration of the LLM call that produced it.
//
// Red-on-cut: restore `iteration: typeof event.step === "number" ? event.step : 0`
// in toThoughtStreamEvent; T2-T4 fail.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { ReactiveAgents } from "../src/builder.js";
import { makeThoughtProjection } from "../src/engine/strategy-neutral-stream.js";

const lookup = {
  definition: {
    name: "lookup",
    description: "Look a value up",
    parameters: [{ name: "input", type: "string" as const, description: "Input", required: true }],
    riskLevel: "low" as const,
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function" as const,
  },
  handler: (args: Record<string, unknown>) => Effect.succeed(`value for ${String(args.input)}`),
};

describe("ThoughtEmitted.iteration is the kernel iteration (unit)", () => {
  it("T1 the event's own iteration wins", () => {
    const p = makeThoughtProjection();
    p.observeLlmCall({ taskId: "t1", iteration: 5 });
    expect(p.project({ taskId: "t1", step: 9, iteration: 2, thought: "x", producedBy: "kernel" })).toEqual({
      _tag: "ThoughtEmitted",
      content: "x",
      iteration: 2,
    });
  });

  it("T2/T3 without an event iteration, the run's last LLM-call iteration is used, never step", () => {
    const p = makeThoughtProjection();
    p.observeLlmCall({ taskId: "t1", iteration: 3 });
    p.observeLlmCall({ taskId: "child", iteration: 7 });
    expect(p.project({ taskId: "t1", step: 10, thought: "y", producedBy: "kernel" })).toEqual({
      _tag: "ThoughtEmitted",
      content: "y",
      iteration: 3,
    });
    expect(p.project({ taskId: "child", step: 1, thought: "z", producedBy: "kernel" })).toMatchObject({ iteration: 7 });
  });

  it("T3 a run with no observed LLM call reports iteration 0, not the step", () => {
    const p = makeThoughtProjection();
    expect(p.project({ taskId: "t1", step: 4, thought: "w", producedBy: "kernel" })).toMatchObject({ iteration: 0 });
  });
});

describe("ThoughtEmitted.iteration is the kernel iteration (end to end)", () => {
  it("T4 a 3-turn run streams thoughts at the iterations of their LLM calls", async () => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([
        { text: "I will look up a first.", toolCall: { name: "lookup", args: { input: "a" } } },
        { text: "Now b.", toolCall: { name: "lookup", args: { input: "b" } } },
        { text: "FINAL ANSWER: a and b are known." },
      ])
      .withTools({ tools: [lookup] })
      .withReasoning()
      .build();
    const thoughtIterations: number[] = [];
    const llmIterationBeforeThought: (number | undefined)[] = [];
    let lastLlmIteration: number | undefined;
    try {
      for await (const e of agent.runStream("look up a then b", { density: "full" })) {
        if (e._tag === "TokenUsage") lastLlmIteration = e.iteration;
        if (e._tag === "ThoughtEmitted") {
          thoughtIterations.push(e.iteration);
          llmIterationBeforeThought.push(lastLlmIteration);
        }
      }
    } finally {
      await agent.dispose();
    }
    expect(thoughtIterations).toEqual([0, 1, 2]);
    expect(llmIterationBeforeThought).toEqual([0, 1, 2]);
  }, 20000);
});
