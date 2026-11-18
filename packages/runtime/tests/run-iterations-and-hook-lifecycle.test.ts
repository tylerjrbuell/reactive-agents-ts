// Run: bun test packages/runtime/tests/run-iterations-and-hook-lifecycle.test.ts --timeout 20000
//
// Pins two run-reporting contracts (2026-11-18 extra-iterations diagnosis,
// wiki/Research/Harness-Reports/2026-11-18-extra-iterations/README.md):
//
//   1. `result.metadata.iterations` is the kernel's real turn count
//      (`reasoningResult.metadata.kernelIterations`), not the reasoning step
//      count. Steps (thought, action, observation) stay on `stepsCount`.
//   2. A hook registered with `.withHook()` fires once per phase occurrence:
//      engine phases (bootstrap, complete) once, in before-then-after order;
//      kernel phases (act) once per tool turn, with no synthetic post-kernel
//      act/observe fire on top.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { ReactiveAgents } from "../src/builder.js";
import type { LifecyclePhase, HookTiming } from "../src/types.js";

const echoTool = {
  definition: {
    name: "echo-tool",
    description: "Echo the input back",
    parameters: [
      { name: "input", type: "string" as const, description: "Input", required: true },
    ],
    riskLevel: "low" as const,
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function" as const,
  },
  handler: (args: Record<string, unknown>) => Effect.succeed(`echoed: ${String(args.input)}`),
};

/** Two tool turns, then the answer: three kernel turns. */
const twoToolTurns = [
  { toolCall: { name: "echo-tool", args: { input: "one" } } },
  { toolCall: { name: "echo-tool", args: { input: "two" } } },
  { text: "FINAL ANSWER: done" },
];

const builderFor = (name: string) =>
  ReactiveAgents.create()
    .withName(name)
    .withTestScenario(twoToolTurns)
    .withTools({ tools: [echoTool] })
    .withReasoning()
    .withMaxIterations(6);

const PHASES: readonly LifecyclePhase[] = [
  "bootstrap", "guardrail", "cost-route", "strategy-select", "think", "act",
  "observe", "verify", "memory-flush", "cost-track", "audit", "complete",
];

describe("run iterations are kernel turns", () => {
  it("a 2-tool-turn run reports iterations 3 and keeps stepsCount as the step count", async () => {
    const agent = await builderFor("iterations-pin").build();
    try {
      const r = await agent.run("echo twice");
      expect(r.success).toBe(true);
      expect(r.metadata.iterations).toBe(3);
      // Steps count every thought/action/observation, so they exceed turns.
      expect(r.metadata.stepsCount).toBeGreaterThan(3);
    } finally {
      await agent.dispose();
    }
  }, 30000);
});

describe("withMinIterations counts kernel turns", () => {
  it("a 2-turn first pass under a floor of 3 runs one continuation, not three", async () => {
    const agent = await ReactiveAgents.create()
      .withName("min-iterations-turns-pin")
      .withTestScenario([
        { toolCall: { name: "echo-tool", args: { input: "one" } } },
        { text: "FINAL ANSWER: first-pass" },
        { text: "FINAL ANSWER: second-pass" },
        { text: "FINAL ANSWER: third-pass" },
        { text: "FINAL ANSWER: fourth-pass" },
      ])
      .withTools({ tools: [echoTool] })
      .withReasoning({ defaultStrategy: "reactive" })
      .withRequiredTools({ adaptive: false })
      .withMinIterations(3)
      .withMaxIterations(6)
      .build();
    try {
      const r = await agent.run("echo once");
      // 2 turns (tool, answer) + 1 continuation turn = 3: the floor is met.
      expect(r.metadata.iterations).toBe(3);
      expect(String(r.output)).toContain("second-pass");
    } finally {
      await agent.dispose();
    }
  }, 30000);
});

describe("withHook fires once per phase occurrence", () => {
  it("bootstrap 1, act-before 2, complete before then after once each", async () => {
    const order: string[] = [];
    let b = builderFor("hook-lifecycle-pin");
    for (const phase of PHASES) {
      for (const timing of ["before", "after"] as const satisfies readonly HookTiming[]) {
        b = b.withHook({ phase, timing, handler: () => { order.push(`${phase}:${timing}`); } });
      }
    }
    const agent = await b.build();
    try {
      const r = await agent.run("echo twice");
      expect(r.success).toBe(true);
    } finally {
      await agent.dispose();
    }
    const count = (k: string) => order.filter((e) => e === k).length;
    expect(count("bootstrap:before")).toBe(1);
    expect(count("bootstrap:after")).toBe(1);
    expect(count("act:before")).toBe(2);
    expect(count("act:after")).toBe(2);
    expect(count("observe:before")).toBe(2);
    expect(count("observe:after")).toBe(2);
    expect(count("complete:before")).toBe(1);
    expect(count("complete:after")).toBe(1);
    expect(order.indexOf("complete:before")).toBeLessThan(order.indexOf("complete:after"));
  }, 30000);
});
