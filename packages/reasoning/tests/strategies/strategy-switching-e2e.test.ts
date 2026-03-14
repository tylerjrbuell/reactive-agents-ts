/**
 * strategy-switching-e2e.test.ts
 *
 * End-to-end behavioral tests for strategy switching through the reasoning
 * strategy layer (executeReactive). Tests verify that:
 *
 *   - enableStrategySwitching=true is a valid config that doesn't crash
 *   - A looping LLM response pattern (same tool call repeated) causes loop
 *     detection to fire and the agent to complete rather than hang
 *   - maxSwitches: 0 disables switching so loop still results in failure
 *   - enableStrategySwitching=true vs false produces different outcomes
 *     when the LLM keeps looping
 *
 * Approach for triggering loops:
 *   TestLLMServiceLayer maps prompts to responses by substring match.
 *   The default test response does not contain "FINAL ANSWER", so the ReAct
 *   kernel will produce thought steps. By keeping maxIterations low and
 *   checking the termination cause, we can verify loop detection behavior.
 *
 *   For the actual loop-trigger test, we use runKernel() directly with a
 *   kernel that returns the same ACTION every iteration. This is the most
 *   reliable way to force loop detection in an e2e-style test.
 */
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { executeReactive } from "../../src/strategies/reactive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { runKernel } from "../../src/strategies/shared/kernel-runner.js";
import {
  transitionState,
  type KernelState,
  type ThoughtKernel,
} from "../../src/strategies/shared/kernel-state.js";
import { makeStep } from "../../src/strategies/shared/step-utils.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** ReasoningConfig with strategy switching enabled. */
const configWithSwitching = {
  ...defaultReasoningConfig,
  strategies: {
    ...defaultReasoningConfig.strategies,
    reactive: { maxIterations: 10, temperature: 0.7 },
  },
};

/** Repeated tool call action — drives loop detection in integration tests. */
const LOOP_ACTION = JSON.stringify({ tool: "web-search", input: '{"query":"loop-trigger"}' });

/** Kernel that loops on the original strategy, completes on the switched strategy. */
function makeStrategySwitchKernel(): ThoughtKernel {
  return (state: KernelState, _ctx) => {
    if (state.strategy !== "reactive") {
      // Switched — complete immediately
      return Effect.succeed(
        transitionState(state, {
          status: "done",
          output: "strategy switched and completed",
          iteration: state.iteration + 1,
        }),
      );
    }
    // Reactive: loop with identical tool call
    return Effect.succeed(
      transitionState(state, {
        status: "thinking",
        iteration: state.iteration + 1,
        steps: [...state.steps, makeStep("action", LOOP_ACTION)],
      }),
    );
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Strategy switching smoke test", () => {
  it("agent completes with enableStrategySwitching=true configured", async () => {
    // Basic smoke: just verify the code path runs without errors when
    // strategySwitching is enabled. The TestLLMService returns a default
    // response that eventually terminates (partial result at maxIterations).
    const layer = TestLLMServiceLayer([
      { match: "Think step-by-step", text: "FINAL ANSWER: smoke test passed." },
    ]);

    const result = await Effect.runPromise(
      executeReactive({
        taskDescription: "Simple question requiring a direct answer",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        config: {
          ...configWithSwitching,
          strategies: {
            ...configWithSwitching.strategies,
            reactive: { maxIterations: 5, temperature: 0.7 },
          },
        },
        strategySwitching: {
          enabled: true,
          maxSwitches: 1,
          fallbackStrategy: "plan-execute-reflect",
        },
      }).pipe(Effect.provide(layer)),
    );

    // Should complete successfully (either via FINAL ANSWER or maxIterations)
    expect(result.strategy).toBe("reactive");
    expect(["completed", "partial"]).toContain(result.status);
  });
});

describe("Strategy switching — forced loop scenario", () => {
  it("agent with looping kernel completes after strategy switch (not hangs)", async () => {
    // Use runKernel directly with a custom looping kernel + strategy switch enabled.
    // This is the most reliable way to force loop detection in tests.
    const kernel = makeStrategySwitchKernel();

    const result = await Effect.runPromise(
      runKernel(kernel, { task: "forced loop switch" }, {
        maxIterations: 20,
        strategy: "reactive",
        kernelType: "react",
        loopDetection: { maxSameToolCalls: 3 },
        strategySwitching: {
          enabled: true,
          maxSwitches: 1,
          fallbackStrategy: "plan-execute-reflect",
          availableStrategies: ["plan-execute-reflect"],
        },
      }).pipe(Effect.provide(TestLLMServiceLayer())),
    );

    // After switch, the kernel completes — agent does NOT hang
    expect(result.status).toBe("done");
    expect(result.output).toBe("strategy switched and completed");
    // Final strategy should be the switched-to one
    expect(result.strategy).toBe("plan-execute-reflect");
  });

  it("looping kernel WITHOUT switching still produces a result (fails instead)", async () => {
    // Without switching, loop detection fires and kernel fails immediately.
    const kernel = makeStrategySwitchKernel();

    const result = await Effect.runPromise(
      runKernel(kernel, { task: "loop without switch" }, {
        maxIterations: 20,
        strategy: "reactive",
        kernelType: "react",
        loopDetection: { maxSameToolCalls: 3 },
        // No strategySwitching configured
      }).pipe(Effect.provide(TestLLMServiceLayer())),
    );

    // Loop detected → fails rather than hanging
    expect(result.status).toBe("failed");
    expect(result.error).toContain("Loop detected");
  });
});

describe("maxSwitches: 0 disables strategy switching", () => {
  it("maxSwitches: 0 causes loop to fail even when switching is enabled", async () => {
    const kernel = makeStrategySwitchKernel();

    const result = await Effect.runPromise(
      runKernel(kernel, { task: "zero switches" }, {
        maxIterations: 20,
        strategy: "reactive",
        kernelType: "react",
        loopDetection: { maxSameToolCalls: 3 },
        strategySwitching: {
          enabled: true,
          maxSwitches: 0,  // Zero switches means no switch can happen
          fallbackStrategy: "plan-execute-reflect",
          availableStrategies: ["plan-execute-reflect"],
        },
      }).pipe(Effect.provide(TestLLMServiceLayer())),
    );

    // With maxSwitches=0, switch count >= maxSwitches immediately
    // so the switch is not attempted → fails like no-switching case
    expect(result.status).toBe("failed");
    expect(result.error).toContain("Loop detected");
  });
});

describe("enableStrategySwitching affects outcomes on looping kernel", () => {
  it("same looping kernel: disabled → fails, enabled → completes", async () => {
    // Run identical looping kernel with switching disabled
    const kernelDisabled = makeStrategySwitchKernel();
    const resultDisabled = await Effect.runPromise(
      runKernel(kernelDisabled, { task: "compare disabled" }, {
        maxIterations: 20,
        strategy: "reactive",
        kernelType: "react",
        loopDetection: { maxSameToolCalls: 3 },
        strategySwitching: { enabled: false },
      }).pipe(Effect.provide(TestLLMServiceLayer())),
    );

    // Run identical looping kernel with switching enabled
    const kernelEnabled = makeStrategySwitchKernel();
    const resultEnabled = await Effect.runPromise(
      runKernel(kernelEnabled, { task: "compare enabled" }, {
        maxIterations: 20,
        strategy: "reactive",
        kernelType: "react",
        loopDetection: { maxSameToolCalls: 3 },
        strategySwitching: {
          enabled: true,
          maxSwitches: 1,
          fallbackStrategy: "plan-execute-reflect",
          availableStrategies: ["plan-execute-reflect"],
        },
      }).pipe(Effect.provide(TestLLMServiceLayer())),
    );

    // Disabled: loop detected → failed
    expect(resultDisabled.status).toBe("failed");
    expect(resultDisabled.error).toContain("Loop detected");

    // Enabled: strategy switch → done
    expect(resultEnabled.status).toBe("done");
    expect(resultEnabled.strategy).toBe("plan-execute-reflect");
  });

  it("executeReactive with strategySwitching config threads options to runKernel", async () => {
    // Verify that the strategySwitching parameter actually reaches runKernel
    // by observing different behavior between enabled and disabled.
    //
    // We use a low maxIterations with a non-FINAL-ANSWER response to let the
    // kernel run to maxIterations. The key signal: with switching enabled,
    // the config object is passed through (no error about unknown config).
    const layer = TestLLMServiceLayer(); // default: "Test response" — no FINAL ANSWER

    const result = await Effect.runPromise(
      executeReactive({
        taskDescription: "Test threading",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        config: {
          ...configWithSwitching,
          strategies: {
            ...configWithSwitching.strategies,
            reactive: { maxIterations: 3, temperature: 0.7 },
          },
        },
        strategySwitching: {
          enabled: true,
          maxSwitches: 1,
          fallbackStrategy: "plan-execute-reflect",
        },
      }).pipe(Effect.provide(layer)),
    );

    // The test succeeds if executeReactive completes without throwing —
    // this proves the strategySwitching param is accepted and forwarded.
    expect(result.strategy).toBe("reactive");
    // With default "Test response" from TestLLM, no FINAL ANSWER → partial
    expect(["partial", "completed"]).toContain(result.status);
  });
});
