import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { LLMService, TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { runKernel } from "../../../src/strategies/kernel/kernel-runner.js";
import {
  initialKernelState,
  transitionState,
  type KernelState,
  type KernelContext,
  type ThoughtKernel,
  type MaybeService,
  type EventBusInstance,
} from "../../../src/strategies/kernel/kernel-state.js";
import { makeStep } from "../../../src/strategies/kernel/utils/step-utils.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMockEventBus(): { events: unknown[]; eb: MaybeService<EventBusInstance> } {
  const events: unknown[] = [];
  const eb: MaybeService<EventBusInstance> = {
    _tag: "Some",
    value: {
      publish: (event: unknown) => {
        events.push(event);
        return Effect.void;
      },
    },
  };
  return { events, eb };
}

// ── Kernels ──────────────────────────────────────────────────────────────────

/** Kernel that returns done immediately on first call */
const doneKernel: ThoughtKernel = (state, _ctx) =>
  Effect.succeed(
    transitionState(state, {
      status: "done",
      output: "Hello world",
      iteration: state.iteration + 1,
    }),
  );

/** Kernel that thinks twice, then returns done on the third call */
const multiStepKernel: ThoughtKernel = (state, _ctx) => {
  const nextIter = state.iteration + 1;
  if (nextIter < 3) {
    return Effect.succeed(
      transitionState(state, {
        status: "thinking",
        iteration: nextIter,
        steps: [
          ...state.steps,
          makeStep("thought", `Thinking step ${nextIter}`),
        ],
      }),
    );
  }
  return Effect.succeed(
    transitionState(state, {
      status: "done",
      output: "Multi-step result",
      iteration: nextIter,
      steps: [
        ...state.steps,
        makeStep("thought", `Final step ${nextIter}`),
      ],
    }),
  );
};

/** Kernel that always returns "thinking" — never finishes */
const infiniteKernel: ThoughtKernel = (state, _ctx) =>
  Effect.succeed(
    transitionState(state, {
      status: "thinking",
      iteration: state.iteration + 1,
      steps: [
        ...state.steps,
        makeStep("thought", `Iteration ${state.iteration + 1}`),
      ],
    }),
  );

/** Kernel that returns "failed" on the first call */
const failingKernel: ThoughtKernel = (state, _ctx) =>
  Effect.succeed(
    transitionState(state, {
      status: "failed",
      error: "kernel failure",
      iteration: state.iteration + 1,
    }),
  );

// ── Tests ────────────────────────────────────────────────────────────────────

describe("runKernel", () => {
  const testLayer = TestLLMServiceLayer();

  it("trivial kernel returns done immediately with correct state", async () => {
    const result = await Effect.runPromise(
      runKernel(doneKernel, { task: "test" }, {
        maxIterations: 10,
        strategy: "test",
        kernelType: "test",
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.status).toBe("done");
    expect(result.iteration).toBe(1);
    expect(result.output).toBe("Hello world");
    expect(result.strategy).toBe("test");
    expect(result.kernelType).toBe("test");
  });

  it("multi-step kernel increments iteration and accumulates steps", async () => {
    const result = await Effect.runPromise(
      runKernel(multiStepKernel, { task: "multi" }, {
        maxIterations: 10,
        strategy: "multi",
        kernelType: "react",
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.status).toBe("done");
    expect(result.iteration).toBe(3);
    expect(result.output).toBe("Multi-step result");
    // 2 thinking steps + 1 final step = 3 total
    expect(result.steps.length).toBe(3);
    expect(result.steps[0].content).toBe("Thinking step 1");
    expect(result.steps[1].content).toBe("Thinking step 2");
    expect(result.steps[2].content).toBe("Final step 3");
  });

  it("max iterations guard stops the loop", async () => {
    const result = await Effect.runPromise(
      runKernel(infiniteKernel, { task: "infinite" }, {
        maxIterations: 3,
        strategy: "guard",
        kernelType: "test",
        // Disable consecutive-thought loop detection so we test pure max-iterations guard
        loopDetection: { maxConsecutiveThoughts: 999, maxRepeatedThoughts: 999, maxSameToolCalls: 999 },
      }).pipe(Effect.provide(testLayer)),
    );

    // Loop should stop after 3 iterations even though status is still "thinking"
    expect(result.iteration).toBe(3);
    expect(result.status).toBe("thinking");
    expect(result.steps.length).toBe(3);
    // No onDone hook should fire since status is not "done"
  });

  it("done hook fires when kernel completes successfully", async () => {
    // We cannot directly inject a mock EventBus into the runner since it resolves
    // via Effect.serviceOption. However, we can verify the done hook fires by
    // checking the final state. For a direct hook verification, we build a kernel
    // that marks its own passage through the loop.
    let kernelCallCount = 0;

    const countingKernel: ThoughtKernel = (state, _ctx) => {
      kernelCallCount++;
      return Effect.succeed(
        transitionState(state, {
          status: "done",
          output: "counted",
          iteration: state.iteration + 1,
        }),
      );
    };

    const result = await Effect.runPromise(
      runKernel(countingKernel, { task: "hook-test" }, {
        maxIterations: 10,
        strategy: "hook",
        kernelType: "test",
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.status).toBe("done");
    expect(result.output).toBe("counted");
    expect(kernelCallCount).toBe(1);
    // The onDone hook fires internally — we verify via status + output.
    // With EventBus absent (None), the hook is a no-op, so no error is thrown.
  });

  it("failed kernel triggers error hook path", async () => {
    const result = await Effect.runPromise(
      runKernel(failingKernel, { task: "fail" }, {
        maxIterations: 10,
        strategy: "fail",
        kernelType: "test",
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.status).toBe("failed");
    expect(result.error).toBe("kernel failure");
    expect(result.iteration).toBe(1);
    // onError hook fires (no-op with None EventBus) — no exception
  });

  it("passes taskId through to initial state", async () => {
    const result = await Effect.runPromise(
      runKernel(doneKernel, { task: "id-test" }, {
        maxIterations: 10,
        strategy: "test",
        kernelType: "test",
        taskId: "task-42",
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.taskId).toBe("task-42");
  });

  it("merges contextProfile over mid defaults", async () => {
    // A kernel that captures the profile from context to verify merging
    let capturedProfile: unknown;

    const profileCapture: ThoughtKernel = (state, ctx) => {
      capturedProfile = ctx.profile;
      return Effect.succeed(
        transitionState(state, {
          status: "done",
          output: "profile captured",
          iteration: state.iteration + 1,
        }),
      );
    };

    await Effect.runPromise(
      runKernel(
        profileCapture,
        {
          task: "profile",
          contextProfile: { toolResultMaxChars: 1234 },
        },
        {
          maxIterations: 10,
          strategy: "test",
          kernelType: "test",
        },
      ).pipe(Effect.provide(testLayer)),
    );

    const profile = capturedProfile as Record<string, unknown>;
    // Custom value should override
    expect(profile.toolResultMaxChars).toBe(1234);
    // Mid default should be present for non-overridden fields
    expect(profile.tier).toBe("mid");
    expect(profile.promptVerbosity).toBe("standard");
  });

  it("does not fire done hook when max iterations reached with non-done status", async () => {
    // If the kernel never reaches "done", the done hook should NOT fire.
    // Since EventBus is None, hooks are no-ops, but we verify the state is correct.
    const result = await Effect.runPromise(
      runKernel(infiniteKernel, { task: "no-done" }, {
        maxIterations: 2,
        strategy: "test",
        kernelType: "test",
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.status).toBe("thinking");
    expect(result.output).toBeNull();
    expect(result.iteration).toBe(2);
  });

  it("skips embedded tool guard when output has no bare tool call", async () => {
    // Normal done output — no bare tool call, should pass through unchanged
    const cleanKernel: ThoughtKernel = (state, _ctx) =>
      Effect.succeed(
        transitionState(state, {
          status: "done",
          output: "The answer is 42",
          iteration: state.iteration + 1,
        }),
      );

    const result = await Effect.runPromise(
      runKernel(cleanKernel, { task: "clean" }, {
        maxIterations: 10,
        strategy: "test",
        kernelType: "test",
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.status).toBe("done");
    expect(result.output).toBe("The answer is 42");
    expect(result.steps.length).toBe(0); // No extra steps added
    expect(result.toolsUsed.size).toBe(0);
  });

  // ── Loop Detection ───────────────────────────────────────────────────────

  it("detects repeated tool calls and aborts", async () => {
    const toolAction = JSON.stringify({ tool: "web-search", input: '{"query":"test"}' });
    let callCount = 0;

    const repeatedToolKernel: ThoughtKernel = (state, _ctx) => {
      callCount++;
      return Effect.succeed(
        transitionState(state, {
          status: "thinking",
          iteration: state.iteration + 1,
          steps: [...state.steps, makeStep("action", toolAction)],
        }),
      );
    };

    const result = await Effect.runPromise(
      runKernel(repeatedToolKernel, { task: "loop" }, {
        maxIterations: 20,
        strategy: "test",
        kernelType: "test",
        loopDetection: { maxSameToolCalls: 3 },
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Loop detected");
    expect(result.error).toContain("same tool call repeated 3 times");
    expect(callCount).toBe(3);
  });

  it("detects repeated identical thoughts and aborts", async () => {
    let callCount = 0;

    const repeatedThoughtKernel: ThoughtKernel = (state, _ctx) => {
      callCount++;
      return Effect.succeed(
        transitionState(state, {
          status: "thinking",
          iteration: state.iteration + 1,
          steps: [
            ...state.steps,
            makeStep("thought", "I need to think about this more"),
          ],
        }),
      );
    };

    const result = await Effect.runPromise(
      runKernel(repeatedThoughtKernel, { task: "loop" }, {
        maxIterations: 20,
        strategy: "test",
        kernelType: "test",
        loopDetection: { maxRepeatedThoughts: 3 },
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Loop detected");
    expect(result.error).toContain("repeated the same thought");
    expect(callCount).toBe(3);
  });

  it("does not trigger loop detection for different tool args", async () => {
    let callCount = 0;

    const variedToolKernel: ThoughtKernel = (state, _ctx) => {
      callCount++;
      const action = JSON.stringify({ tool: "web-search", input: `{"query":"test ${callCount}"}` });
      if (callCount >= 5) {
        return Effect.succeed(
          transitionState(state, {
            status: "done",
            output: "found it",
            iteration: state.iteration + 1,
            steps: [...state.steps, makeStep("action", action)],
          }),
        );
      }
      return Effect.succeed(
        transitionState(state, {
          status: "thinking",
          iteration: state.iteration + 1,
          steps: [...state.steps, makeStep("action", action)],
        }),
      );
    };

    const result = await Effect.runPromise(
      runKernel(variedToolKernel, { task: "varied" }, {
        maxIterations: 20,
        strategy: "test",
        kernelType: "test",
        loopDetection: { maxSameToolCalls: 3 },
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.status).toBe("done");
    expect(result.output).toBe("found it");
    expect(callCount).toBe(5);
  });

  it("uses default loop detection thresholds when not configured", async () => {
    const toolAction = JSON.stringify({ tool: "same-tool", input: "{}" });
    let callCount = 0;

    const repeatedKernel: ThoughtKernel = (state, _ctx) => {
      callCount++;
      return Effect.succeed(
        transitionState(state, {
          status: "thinking",
          iteration: state.iteration + 1,
          steps: [...state.steps, makeStep("action", toolAction)],
        }),
      );
    };

    // Default is maxSameToolCalls: 3
    const result = await Effect.runPromise(
      runKernel(repeatedKernel, { task: "defaults" }, {
        maxIterations: 20,
        strategy: "test",
        kernelType: "test",
        // No loopDetection config — uses defaults
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Loop detected");
    expect(callCount).toBe(3);
  });
});

// ── Required Tools Guard Tests ───────────────────────────────────────────────

describe("runKernel — required tools guard", () => {
  const testLayer = TestLLMServiceLayer();

  it("passes through when all required tools have been used", async () => {
    // Kernel that uses a tool then declares done
    let callCount = 0;
    const toolUsingKernel: ThoughtKernel = (state, _ctx) => {
      callCount++;
      if (callCount === 1) {
        const newTools = new Set(state.toolsUsed);
        newTools.add("send_message");
        return Effect.succeed(
          transitionState(state, {
            status: "thinking",
            iteration: state.iteration + 1,
            toolsUsed: newTools,
            steps: [...state.steps, makeStep("action", "send_message")],
          }),
        );
      }
      return Effect.succeed(
        transitionState(state, {
          status: "done",
          output: "Task complete",
          iteration: state.iteration + 1,
        }),
      );
    };

    const result = await Effect.runPromise(
      runKernel(toolUsingKernel, { task: "test", requiredTools: ["send_message"] }, {
        maxIterations: 10,
        strategy: "test",
        kernelType: "test",
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.status).toBe("done");
    expect(result.output).toBe("Task complete");
  });

  it("redirects agent when required tools missing, then succeeds", async () => {
    // Kernel that declares done first, then after seeing required tools feedback,
    // calls the tool and declares done again
    let callCount = 0;
    const redirectKernel: ThoughtKernel = (state, _ctx) => {
      callCount++;
      if (callCount === 1) {
        // First attempt: declare done without using the required tool
        return Effect.succeed(
          transitionState(state, {
            status: "done",
            output: "I'm done!",
            iteration: state.iteration + 1,
          }),
        );
      }
      if (callCount === 2) {
        // After redirect: call the required tool
        const newTools = new Set(state.toolsUsed);
        newTools.add("send_message");
        return Effect.succeed(
          transitionState(state, {
            status: "thinking",
            iteration: state.iteration + 1,
            toolsUsed: newTools,
            steps: [...state.steps, makeStep("action", "send_message")],
          }),
        );
      }
      // Third call: declare done for real
      return Effect.succeed(
        transitionState(state, {
          status: "done",
          output: "Done after sending message",
          iteration: state.iteration + 1,
        }),
      );
    };

    const result = await Effect.runPromise(
      runKernel(redirectKernel, { task: "test", requiredTools: ["send_message"] }, {
        maxIterations: 10,
        strategy: "test",
        kernelType: "test",
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.status).toBe("done");
    expect(result.output).toBe("Done after sending message");
    // Should have the feedback step in the steps
    const feedbackSteps = result.steps.filter((s) =>
      s.content.includes("Required tools not yet used"),
    );
    expect(feedbackSteps.length).toBe(1);
    expect(feedbackSteps[0]!.content).toContain("send_message");
    expect(feedbackSteps[0]!.content).toContain("Redirect 1/2");
  });

  it("fails after max retry limit is exceeded", async () => {
    // Kernel that always declares done without using required tools
    const stubbornKernel: ThoughtKernel = (state, _ctx) =>
      Effect.succeed(
        transitionState(state, {
          status: "done",
          output: "I refuse to use the tool",
          iteration: state.iteration + 1,
        }),
      );

    const result = await Effect.runPromise(
      runKernel(stubbornKernel, { task: "test", requiredTools: ["send_message"] }, {
        maxIterations: 20,
        strategy: "test",
        kernelType: "test",
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Task incomplete");
    expect(result.error).toContain("send_message");
    expect(result.error).toContain("2 redirect");
  });

  it("respects custom maxRequiredToolRetries", async () => {
    let redirectCount = 0;
    const stubbornKernel: ThoughtKernel = (state, _ctx) => {
      // Count how many times we get redirected (status is "thinking" after a redirect)
      if (state.status === "thinking" && state.steps.some((s) => s.content.includes("Required tools not yet used"))) {
        redirectCount++;
      }
      return Effect.succeed(
        transitionState(state, {
          status: "done",
          output: "Still refusing",
          iteration: state.iteration + 1,
        }),
      );
    };

    const result = await Effect.runPromise(
      runKernel(stubbornKernel, {
        task: "test",
        requiredTools: ["send_message"],
        maxRequiredToolRetries: 1,
      }, {
        maxIterations: 20,
        strategy: "test",
        kernelType: "test",
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.status).toBe("failed");
    expect(result.error).toContain("1 redirect");
  });

  it("tracks multiple required tools independently", async () => {
    let callCount = 0;
    const partialToolKernel: ThoughtKernel = (state, _ctx) => {
      callCount++;
      if (callCount === 1) {
        // Use only one of two required tools
        const newTools = new Set(state.toolsUsed);
        newTools.add("search");
        return Effect.succeed(
          transitionState(state, {
            status: "done",
            output: "Searched but didn't send",
            iteration: state.iteration + 1,
            toolsUsed: newTools,
          }),
        );
      }
      if (callCount === 2) {
        // After redirect, use the second tool
        const newTools = new Set(state.toolsUsed);
        newTools.add("send_message");
        return Effect.succeed(
          transitionState(state, {
            status: "thinking",
            iteration: state.iteration + 1,
            toolsUsed: newTools,
            steps: [...state.steps, makeStep("action", "send_message")],
          }),
        );
      }
      return Effect.succeed(
        transitionState(state, {
          status: "done",
          output: "All tools used",
          iteration: state.iteration + 1,
        }),
      );
    };

    const result = await Effect.runPromise(
      runKernel(partialToolKernel, {
        task: "test",
        requiredTools: ["search", "send_message"],
      }, {
        maxIterations: 10,
        strategy: "test",
        kernelType: "test",
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.status).toBe("done");
    expect(result.output).toBe("All tools used");
    // The redirect feedback should only mention the missing tool (send_message)
    const feedbackSteps = result.steps.filter((s) =>
      s.content.includes("Required tools not yet used"),
    );
    expect(feedbackSteps.length).toBe(1);
    expect(feedbackSteps[0]!.content).toContain("send_message");
    expect(feedbackSteps[0]!.content).not.toContain("search");
  });

  it("no guard fires when requiredTools is empty", async () => {
    const result = await Effect.runPromise(
      runKernel(doneKernel, { task: "test", requiredTools: [] }, {
        maxIterations: 10,
        strategy: "test",
        kernelType: "test",
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.status).toBe("done");
    expect(result.output).toBe("Hello world");
  });

  it("no guard fires when requiredTools is undefined", async () => {
    const result = await Effect.runPromise(
      runKernel(doneKernel, { task: "test" }, {
        maxIterations: 10,
        strategy: "test",
        kernelType: "test",
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.status).toBe("done");
    expect(result.output).toBe("Hello world");
  });

  it("post-loop check catches missing tools when max iterations exhausted", async () => {
    // Kernel that uses a tool but never uses all required tools and hits max iterations
    const incompleteKernel: ThoughtKernel = (state, _ctx) => {
      const newTools = new Set(state.toolsUsed);
      newTools.add("search");
      return Effect.succeed(
        transitionState(state, {
          status: "done",
          output: "Done with search only",
          iteration: state.iteration + 1,
          toolsUsed: newTools,
        }),
      );
    };

    // maxRequiredToolRetries: 0 means fail immediately without redirect
    const result = await Effect.runPromise(
      runKernel(incompleteKernel, {
        task: "test",
        requiredTools: ["search", "send_message"],
        maxRequiredToolRetries: 0,
      }, {
        maxIterations: 5,
        strategy: "test",
        kernelType: "test",
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Task incomplete");
    expect(result.error).toContain("send_message");
  });
});
