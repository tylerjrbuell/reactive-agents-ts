// Run: bun test packages/reasoning/src/kernel/loop/switch-keeps-contract.integration.test.ts --timeout 20000
//
// A strategy switch keeps the run contract (Plan 9 Phase 1 H3 defect 1, cogito
// h3-todo-heavy, trace 01M6MX71YZJ8X5B5EXGPBCQC85).
//
// The live run wrote out-1.txt, repeated a call, the loop detector switched
// strategy, and the switched kernel claimed done. The exit gate saw
// `outstanding: []` and the terminal recorded verified/done with out-2..6
// unproduced. Cause: `applyStrategySwitch` reinitialized the kernel state with
// `initialKernelState`, which drops the run-scoped seeds the runner set once
// before the loop (`meta.runContract`, `meta.postConditions`, the budget meter).
// With no delivery conditions the gates had nothing to refuse.
//
// `horizonProfile: "long"` raises the stall threshold so the loop detector, not
// the stall guard, ends the first strategy (the live shape).
//
// RED-ON-CUT: delete the `carryRunScopedSeeds` call in
// runner-helpers/strategy-switch.ts and the first test goes red (the switched
// run ships done/accepted with ./out-2.txt and ./out-3.txt never written).

import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer, type TestTurn } from "@reactive-agents/llm-provider";
import { reactKernel } from "./react-kernel.js";
import { runPass } from "./run-pass.js";
import { succeedingToolLayer } from "../../testing/tool-service-mock.js";
import type { KernelInput } from "../state/kernel-state.js";
import { resolveCompletionStatus } from "../state/completion-status.js";

const PAD =
  " The petals rest quietly on the morning grass while the season slowly turns overhead.".repeat(30);

const PARAMS = [
  { name: "path", type: "string", required: true },
  { name: "content", type: "string", required: true },
];
const SCHEMAS = [{ name: "file-write", description: "write content to a file", parameters: PARAMS }];

const TASK = "Write out-1.txt, out-2.txt and out-3.txt, each containing the word done.";

const write = (path: string): TestTurn => ({ toolCall: { name: "file-write", args: { path, content: "done" } } });
const claim: TestTurn = { text: "All three files are written; the task is complete." + PAD };

const run = (scenario: TestTurn[]) =>
  Effect.runPromise(
    runPass(reactKernel, { task: TASK, availableToolSchemas: SCHEMAS } satisfies KernelInput, {
      maxIterations: 40,
      strategy: "reactive",
      kernelType: "react",
      taskId: "switch-keeps-contract",
      horizonProfile: "long",
      loopDetection: { maxSameToolCalls: 2 },
      strategySwitching: { enabled: true, maxSwitches: 1, fallbackStrategy: "plan-execute-reflect" },
    }).pipe(Effect.provide(Layer.merge(TestLLMServiceLayer(scenario), succeedingToolLayer({ written: true }, PARAMS)))),
  );

const switched = (steps: readonly { type: string; content: string }[]): boolean =>
  steps.some((s) => s.type === "harness_signal" && s.content.includes("Strategy switched"));

describe("a strategy switch keeps the run contract", () => {
  it("1 of 3 files, loop switch, done claims: refused, the missing files are named", async () => {
    const pass = await run([write("./out-1.txt"), write("./out-1.txt"), claim, claim, claim, claim, claim, claim]);
    expect(switched(pass.state.steps)).toBe(true);
    expect(pass.state.meta.runContract).toBeDefined();
    expect(resolveCompletionStatus(pass.state)).not.toBe("completed");
    expect(pass.state.meta.deliverableDecision?.accepted).not.toBe(true);
    const named = (path: string) =>
      (pass.state.error ?? "").includes(path) ||
      pass.state.steps.some((s) => s.type === "harness_signal" && s.content.includes(path));
    expect(named("./out-2.txt")).toBe(true);
    expect(named("./out-3.txt")).toBe(true);
  });

  it("control: all files written, loop switch, done claim: completed and accepted", async () => {
    const pass = await run([
      write("./out-1.txt"),
      write("./out-2.txt"),
      write("./out-3.txt"),
      write("./out-3.txt"),
      claim,
      claim,
      claim,
    ]);
    expect(switched(pass.state.steps)).toBe(true);
    expect(resolveCompletionStatus(pass.state)).toBe("completed");
    expect(pass.state.meta.deliverableDecision?.accepted).toBe(true);
  });
});
