/**
 * react-pass-split.test.ts — Plan 9 S2: `executeReActKernel` is exactly
 * `prepareReActPass` → `runKernel(reactKernel, …)` → `reActResultFromState`.
 *
 * Strategies running a ReAct pass through the substrate (`run.pass`) call the
 * two halves directly, so both are pinned here: the prepared input/options
 * carry the caller's fields, and the composed result equals the fused wrapper.
 */
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import {
  executeReActKernel,
  prepareReActPass,
  reActResultFromState,
  reactKernel,
  type ReActKernelInput,
} from "../../../src/kernel/loop/react-kernel.js";
import { runKernel } from "../../../src/kernel/loop/runner.js";

const input: ReActKernelInput = {
  task: "What is 6 times 7?",
  systemPrompt: "You are precise.",
  requiredTools: ["calc"],
  blockedTools: ["shell-execute"],
  strictToolDependencyChain: true,
  parentStrategy: "plan-execute-reflect",
  taskId: "task-split-1",
  kernelPass: "plan-execute:step-1",
  temperature: 0.2,
};

const layer = () =>
  TestLLMServiceLayer([{ match: "Task:", text: "FINAL ANSWER: The answer is 42." }]);

describe("prepareReActPass — the half before runKernel", () => {
  it("carries the caller's per-pass fields into KernelInput and options", async () => {
    const { kernelInput, options } = await Effect.runPromise(prepareReActPass(input));
    expect(kernelInput.task).toBe(input.task);
    expect(kernelInput.systemPrompt).toBe("You are precise.");
    expect(kernelInput.requiredTools).toEqual(["calc"]);
    expect(kernelInput.blockedTools).toEqual(["shell-execute"]);
    expect(kernelInput.strictToolDependencyChain).toBe(true);
    expect(kernelInput.temperature).toBe(0.2);
    expect(options.maxIterations).toBe(10);
    expect(options.strategy).toBe("plan-execute-reflect");
    expect(options.kernelType).toBe("react");
    expect(options.taskId).toBe("task-split-1");
    expect(options.kernelPass).toBe("plan-execute:step-1");
    expect(options.taskDescription).toBe(input.task);
    expect(options.temperature).toBe(0.2);
  });

  it("defaults the strategy label when no parent strategy is named", async () => {
    const { options } = await Effect.runPromise(prepareReActPass({ task: "t", maxIterations: 3 }));
    expect(options.strategy).toBe("react-kernel");
    expect(options.maxIterations).toBe(3);
  });
});

describe("executeReActKernel ≡ prepare → runKernel → reActResultFromState", () => {
  // No required tools here: the scripted model answers without calling any.
  const runInput: ReActKernelInput = { ...input, requiredTools: [] };

  it("the composed halves produce the fused wrapper's result", async () => {
    const fused = await Effect.runPromise(
      executeReActKernel(runInput).pipe(Effect.provide(layer())),
    );
    const composed = await Effect.runPromise(
      Effect.gen(function* () {
        const { kernelInput, options } = yield* prepareReActPass(runInput);
        const state = yield* runKernel(reactKernel, kernelInput, options);
        return reActResultFromState(state);
      }).pipe(Effect.provide(layer())),
    );

    expect(fused.output).toBe("The answer is 42.");
    expect(composed.output).toBe(fused.output);
    expect(composed.toolsUsed).toEqual(fused.toolsUsed);
    expect(composed.llmCalls).toBe(fused.llmCalls);
    expect(composed.iterations).toBe(fused.iterations);
    expect(composed.terminatedBy).toBe(fused.terminatedBy);
    expect(composed.rawTerminatedBy).toBe(fused.rawTerminatedBy);
    expect(composed.envelope).toEqual(fused.envelope);
  });
});
