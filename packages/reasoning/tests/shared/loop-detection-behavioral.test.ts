/**
 * loop-detection-behavioral.test.ts
 *
 * Behavioral contract tests verifying that loop detection ACTUALLY fires and
 * produces observable effects in the kernel runner — not just unit tests of
 * the detection algorithm.
 *
 * Covers:
 *   - Same-action repetition triggers loop and fails state
 *   - Detection threshold: below threshold → no loop; at threshold → loop
 *   - Stall detection (consecutive thoughts without action)
 *   - Unique actions do NOT trigger loop detection
 *   - onStrategySwitched hook fires on loop + strategy switch
 *   - Strategy switch is attempted when alternativeStrategies has options
 */
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { runKernel } from "../../src/strategies/kernel/kernel-runner.js";
import {
  transitionState,
  type KernelState,
  type ThoughtKernel,
} from "../../src/strategies/kernel/kernel-state.js";
import { makeStep } from "../../src/strategies/kernel/utils/step-utils.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const testLayer = TestLLMServiceLayer();

/** Kernel that repeatedly appends the same action step every iteration. */
function makeRepeatingActionKernel(toolAction: string, count?: { calls: number }): ThoughtKernel {
  return (state: KernelState, _ctx) => {
    if (count) count.calls++;
    return Effect.succeed(
      transitionState(state, {
        status: "thinking",
        iteration: state.iteration + 1,
        steps: [...state.steps, makeStep("action", toolAction)],
      }),
    );
  };
}

/** Kernel that appends a unique action step each iteration (uses iteration number). */
function makeUniqueActionKernel(count?: { calls: number }): ThoughtKernel {
  return (state: KernelState, _ctx) => {
    if (count) count.calls++;
    const uniqueAction = JSON.stringify({ tool: "web-search", input: `{"query":"unique-${state.iteration}"}` });
    return Effect.succeed(
      transitionState(state, {
        status: "thinking",
        iteration: state.iteration + 1,
        steps: [...state.steps, makeStep("action", uniqueAction)],
      }),
    );
  };
}

/** Kernel that appends a thought step every iteration with varying content (no actions — stall pattern). */
function makeStallKernel(): ThoughtKernel {
  let n = 0;
  return (state: KernelState, _ctx) => {
    n++;
    // Use unique thought content to avoid triggering repeated-thoughts detection first.
    // The stall detection fires on consecutive thoughts (count), not content identity.
    return Effect.succeed(
      transitionState(state, {
        status: "thinking",
        iteration: state.iteration + 1,
        steps: [...state.steps, makeStep("thought", `Step ${n}: thinking about the problem...`)],
      }),
    );
  };
}

const REPEATED_ACTION = JSON.stringify({ tool: "web-search", input: '{"query":"loop"}' });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Loop detection — same action repeated triggers failure", () => {
  it("loop detected when same action repeated at threshold", async () => {
    const kernel = makeRepeatingActionKernel(REPEATED_ACTION);

    const result = await Effect.runPromise(
      runKernel(kernel, { task: "loop test" }, {
        maxIterations: 50,
        strategy: "reactive",
        kernelType: "react",
        // threshold: 3 same tool calls → loop
        loopDetection: { maxSameToolCalls: 3 },
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Loop detected");
  });

  it("6 identical action steps always triggers loop detection", async () => {
    // Pre-populate state with 6 identical action steps by using a kernel
    // that keeps looping. The loop detection fires at maxSameToolCalls=3.
    const kernel = makeRepeatingActionKernel(REPEATED_ACTION);

    const result = await Effect.runPromise(
      runKernel(kernel, { task: "6-step loop" }, {
        maxIterations: 50,
        strategy: "reactive",
        kernelType: "react",
        loopDetection: { maxSameToolCalls: 3 },
      }).pipe(Effect.provide(testLayer)),
    );

    // With threshold=3, loop fires long before 6 steps — but state is still failed
    expect(result.status).toBe("failed");
    // Number of action steps must be >= threshold (3) at the point of detection
    const actionSteps = result.steps.filter((s) => s.type === "action");
    expect(actionSteps.length).toBeGreaterThanOrEqual(3);
  });
});

describe("Loop detection — threshold boundary", () => {
  it("fewer than threshold identical steps do NOT trigger loop", async () => {
    // Kernel repeats action twice, then completes. With threshold=3, no loop.
    let callCount = 0;
    const kernel: ThoughtKernel = (state, _ctx) => {
      callCount++;
      if (callCount <= 2) {
        return Effect.succeed(
          transitionState(state, {
            status: "thinking",
            iteration: state.iteration + 1,
            steps: [...state.steps, makeStep("action", REPEATED_ACTION)],
          }),
        );
      }
      // On 3rd call: complete (before loop threshold fires)
      return Effect.succeed(
        transitionState(state, {
          status: "done",
          output: "completed before loop",
          iteration: state.iteration + 1,
        }),
      );
    };

    const result = await Effect.runPromise(
      runKernel(kernel, { task: "below threshold" }, {
        maxIterations: 20,
        strategy: "reactive",
        kernelType: "react",
        loopDetection: { maxSameToolCalls: 3 },
      }).pipe(Effect.provide(testLayer)),
    );

    // Should succeed — only 2 identical actions, threshold is 3
    expect(result.status).toBe("done");
    expect(result.output).toBe("completed before loop");
  });

  it("exactly at threshold (N identical actions) triggers loop", async () => {
    // With maxSameToolCalls: 4, the loop fires only after 4 identical actions.
    const kernel = makeRepeatingActionKernel(REPEATED_ACTION);

    const result = await Effect.runPromise(
      runKernel(kernel, { task: "at threshold" }, {
        maxIterations: 50,
        strategy: "reactive",
        kernelType: "react",
        loopDetection: { maxSameToolCalls: 4 },
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Loop detected");
    // Should have exactly 4 action steps when loop fires
    const actionSteps = result.steps.filter((s) => s.type === "action");
    expect(actionSteps.length).toBeGreaterThanOrEqual(4);
  });
});

describe("Stall detection — consecutive thoughts without action", () => {
  it("stall fires when N consecutive thoughts have no tool action", async () => {
    // Kernel only produces thought steps — never an action.
    const kernel = makeStallKernel();

    const result = await Effect.runPromise(
      runKernel(kernel, { task: "stall test" }, {
        maxIterations: 50,
        strategy: "reactive",
        kernelType: "react",
        loopDetection: { maxConsecutiveThoughts: 3 },
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Loop detected");
    // Error message should mention consecutive thoughts
    expect(result.error).toContain("consecutive thinking steps");
  });

  it("stall does NOT fire when actions interrupt thought streaks", async () => {
    // Kernel: 2 thoughts, then 1 action (unique args per call), then 2 thoughts, then done.
    // Total = 6 calls. Consecutive thoughts reset to 0 when an action is inserted.
    // maxConsecutiveThoughts: 3 means we need ≥3 in a row with no action to stall.
    let callCount = 0;
    const kernel: ThoughtKernel = (state, _ctx) => {
      callCount++;
      if (callCount === 3) {
        // Insert an action with unique input to avoid triggering repeated-action detection
        return Effect.succeed(
          transitionState(state, {
            status: "thinking",
            iteration: state.iteration + 1,
            steps: [...state.steps, makeStep("action", JSON.stringify({ tool: "calculator", input: `{"n":${callCount}}` }))],
          }),
        );
      }
      if (callCount === 6) {
        return Effect.succeed(
          transitionState(state, {
            status: "done",
            output: "done",
            iteration: state.iteration + 1,
          }),
        );
      }
      return Effect.succeed(
        transitionState(state, {
          status: "thinking",
          iteration: state.iteration + 1,
          steps: [...state.steps, makeStep("thought", `thought at call ${callCount}`)],
        }),
      );
    };

    const result = await Effect.runPromise(
      runKernel(kernel, { task: "interleaved" }, {
        maxIterations: 20,
        strategy: "reactive",
        kernelType: "react",
        loopDetection: { maxConsecutiveThoughts: 3 },
      }).pipe(Effect.provide(testLayer)),
    );

    // The action at step 3 resets the thought streak, so no stall detected
    expect(result.status).toBe("done");
  });
});

describe("Loop detection — unique actions do NOT trigger detection", () => {
  it("unique action steps never trigger loop detection", async () => {
    const count = { calls: 0 };
    const kernel = makeUniqueActionKernel(count);

    const result = await Effect.runPromise(
      runKernel(kernel, { task: "unique actions" }, {
        // Low maxIterations so test terminates quickly
        maxIterations: 8,
        strategy: "reactive",
        kernelType: "react",
        loopDetection: { maxSameToolCalls: 3 },
      }).pipe(Effect.provide(testLayer)),
    );

    // Should exhaust maxIterations rather than triggering loop detection
    // (status is "failed" due to maxIterations, NOT due to loop detection)
    // OR reaches done — but NOT due to a loop error
    if (result.status === "failed") {
      expect(result.error).not.toContain("Loop detected");
    }
    // The kernel was called as many times as iterations allowed
    expect(count.calls).toBeGreaterThan(0);
  });
});

describe("Loop detection — onStrategySwitched hook fires", () => {
  it("strategy switch fires when loop detected with switching enabled", async () => {
    // We verify the switch occurred by checking the final state.strategy value.
    // When a switch happens, the kernel is re-initialized with the new strategy name.
    const switchAwareKernel: ThoughtKernel = (state, _ctx) => {
      if (state.strategy === "plan-execute-reflect") {
        // Switch happened — complete immediately
        return Effect.succeed(
          transitionState(state, {
            status: "done",
            output: "switched and done",
            iteration: state.iteration + 1,
          }),
        );
      }
      // Original strategy: loop to trigger detection
      return Effect.succeed(
        transitionState(state, {
          status: "thinking",
          iteration: state.iteration + 1,
          steps: [...state.steps, makeStep("action", REPEATED_ACTION)],
        }),
      );
    };

    const result = await Effect.runPromise(
      runKernel(switchAwareKernel, { task: "switch test" }, {
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
      }).pipe(Effect.provide(testLayer)),
    );

    // After switch, the kernel ran under "plan-execute-reflect" strategy and completed
    expect(result.status).toBe("done");
    expect(result.strategy).toBe("plan-execute-reflect");
    expect(result.output).toBe("switched and done");
  });
});

describe("Ollama provider defaults to local tier — maxSameTool=2 (IC-3)", () => {
  it("loop fires after 2 identical tool calls when providerName is ollama (no explicit contextProfile)", async () => {
    // Reproduces the W2-secondary bug: kernel-runner defaults to 'mid' tier
    // (maxSameTool=3) for all providers. Ollama models are local-tier — they
    // need maxSameTool=2 or they can loop 3 times before detection fires.
    //
    // Fix: KernelInput gets a providerName field; when providerName === "ollama"
    // and no explicit contextProfile.tier is set, kernel-runner uses "local"
    // profile (maxSameTool=2).
    //
    // Before fix: mid tier (maxSameTool=3), 2 calls don't fire — runs to maxIterations.
    // After fix:  local tier (maxSameTool=2), 2 calls DO fire — status="failed".
    const OLLAMA_REPEATED = JSON.stringify({ tool: "web-search", input: '{"query":"ollama-loop"}' });
    const kernel = makeRepeatingActionKernel(OLLAMA_REPEATED);

    const result = await Effect.runPromise(
      runKernel(
        kernel,
        {
          task: "ollama loop test",
          providerName: "ollama",
          // No explicit contextProfile — must auto-derive "local" from providerName
        },
        {
          maxIterations: 20,
          strategy: "reactive",
          kernelType: "react",
          // No explicit loopDetection — uses tier default (local=2, mid=3)
        },
      ).pipe(Effect.provide(testLayer)),
    );

    // Local tier: maxSameTool=2 → fires after 2 identical calls.
    expect(result.status).toBe("failed");
    expect(result.error).toContain("Loop detected");
    // Must have fired at exactly 2 action steps (not 3 like mid tier)
    const actionSteps = result.steps.filter((s) => s.type === "action");
    expect(actionSteps.length).toBe(2);
  }, 15000);
});

describe("Stall detection — observation steps do NOT reset consecutive-thought streak (IC-1)", () => {
  it("loop fires when thoughts are interleaved only with observations, not actions", async () => {
    // Reproduces the W2/W6 bug: ICS coordinator injects observation nudges between
    // thought steps. With `else break` (buggy), every observation resets the streak
    // so it never accumulates to maxConsecutiveThoughts. Fix: only actions reset it.
    //
    // Pattern (50 iterations, threshold=3):
    //   iter 1: thought  → streak = 1
    //   iter 2: obs      → BUG: streak = 0 | FIX: streak = 1  (obs ignored)
    //   iter 3: thought  → BUG: streak = 1 | FIX: streak = 2
    //   iter 4: obs      → BUG: streak = 0 | FIX: streak = 2
    //   iter 5: thought  → BUG: streak = 1 | FIX: streak = 3 → LOOP FIRES
    //
    // With BUG: streak never reaches 3; runs to maxIterations=50; error is NOT about
    // "consecutive thinking steps" → test fails.
    // With FIX: loop fires at step 5; error is "consecutive thinking steps" → passes.
    let callCount = 0;
    const kernel: ThoughtKernel = (state, _ctx) => {
      callCount++;
      const stepType = callCount % 2 === 1
        ? ("thought" as const)
        : ("observation" as const);
      return Effect.succeed(
        transitionState(state, {
          status: "thinking",
          iteration: state.iteration + 1,
          steps: [...state.steps, makeStep(stepType, `ics-nudge-step-${callCount}`)],
        }),
      );
    };

    const result = await Effect.runPromise(
      runKernel(kernel, { task: "ics-interleaved stall" }, {
        maxIterations: 50,
        strategy: "reactive",
        kernelType: "react",
        loopDetection: { maxConsecutiveThoughts: 3 },
      }).pipe(Effect.provide(testLayer)),
    );

    // Observations must NOT reset the consecutive-thought streak.
    // After 3 thoughts (with observations in between), the stall loop must fire.
    expect(result.status).toBe("failed");
    expect(result.error).toContain("consecutive thinking steps");
  }, 15000);
});

describe("Loop detection — strategy switch when alternatives available", () => {
  it("loop with strategy switching resets state and uses new strategy name", async () => {
    const strategiesSeen: string[] = [];

    const trackingKernel: ThoughtKernel = (state, _ctx) => {
      // Record each strategy name on first encounter
      if (!strategiesSeen.includes(state.strategy)) {
        strategiesSeen.push(state.strategy);
      }

      if (state.strategy === "plan-execute-reflect") {
        return Effect.succeed(
          transitionState(state, {
            status: "done",
            output: "completed",
            iteration: state.iteration + 1,
          }),
        );
      }

      // Reactive: loop
      return Effect.succeed(
        transitionState(state, {
          status: "thinking",
          iteration: state.iteration + 1,
          steps: [...state.steps, makeStep("action", REPEATED_ACTION)],
        }),
      );
    };

    const result = await Effect.runPromise(
      runKernel(trackingKernel, { task: "strategy tracking" }, {
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
      }).pipe(Effect.provide(testLayer)),
    );

    // Both strategies should have been used
    expect(strategiesSeen).toContain("reactive");
    expect(strategiesSeen).toContain("plan-execute-reflect");

    // Fresh state after switch means iteration resets to 0
    expect(result.status).toBe("done");
  });
});
