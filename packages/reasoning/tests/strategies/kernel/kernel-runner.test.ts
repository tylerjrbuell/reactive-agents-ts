import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { LLMService, TestLLMService, TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { runKernel } from "../../../src/strategies/kernel/kernel-runner.js";
import {
  initialKernelState,
  transitionState,
  type KernelState,
  type KernelContext,
  type ThoughtKernel,
  type MaybeService,
  type EventBusInstance,
} from "../../../src/kernel/state/kernel-state.js";
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
    expect(profile.toolSchemaDetail).toBe("full");
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

  it("detects repeated identical thoughts and stops gracefully", async () => {
    const REPEATED_THOUGHT = "I need to think about this more";
    let callCount = 0;

    const repeatedThoughtKernel: ThoughtKernel = (state, _ctx) => {
      callCount++;
      return Effect.succeed(
        transitionState(state, {
          status: "thinking",
          iteration: state.iteration + 1,
          steps: [
            ...state.steps,
            makeStep("thought", REPEATED_THOUGHT),
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

    // Loop detected — stops after threshold, delivers last thought gracefully
    expect(result.status).toBe("done");
    expect(result.output).toContain(REPEATED_THOUGHT);
    expect(result.meta?.terminatedBy).toBe("loop_graceful");
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
            steps: [
              ...state.steps,
              makeStep("action", "send_message"),
              makeStep("observation", "sent message", {
                observationResult: {
                  success: true,
                  toolName: "send_message",
                  displayText: "sent message",
                  category: "action",
                  resultKind: "info",
                  preserveOnCompaction: false,
                } as any,
              }),
            ],
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
    expect((result.meta.executionLane as string) ?? "").toBe("synthesize");
    expect((result.meta.missingRequiredTools as readonly string[] | undefined) ?? []).toEqual([]);
  });

  it("tracks gather lane metadata when required tools remain missing", async () => {
    const noProgressKernel: ThoughtKernel = (state, _ctx) =>
      Effect.succeed(
        transitionState(state, {
          status: "thinking",
          iteration: state.iteration + 1,
          tokens: state.tokens + 100,
          steps: [...state.steps, makeStep("thought", "still gathering")],
        }),
      );

    const result = await Effect.runPromise(
      runKernel(noProgressKernel, {
        task: "must use web-search",
        requiredTools: ["web-search"],
      }, {
        maxIterations: 4,
        strategy: "test",
        kernelType: "test",
        loopDetection: { maxConsecutiveThoughts: 999, maxRepeatedThoughts: 999, maxSameToolCalls: 999 },
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.status).toBe("failed");
    expect((result.meta.executionLane as string) ?? "").toBe("gather");
    expect((result.meta.missingRequiredTools as readonly string[] | undefined) ?? []).toEqual(["web-search"]);
  });

  it("treats delegated child tool success as satisfying parent required tools", async () => {
    let callCount = 0;
    const delegatedKernel: ThoughtKernel = (state, _ctx) => {
      callCount++;
      if (callCount === 1) {
        const tools = new Set(state.toolsUsed);
        tools.add("spawn-agent");
        return Effect.succeed(
          transitionState(state, {
            status: "thinking",
            iteration: state.iteration + 1,
            toolsUsed: tools,
            steps: [
              ...state.steps,
              makeStep("action", "spawn-agent"),
              makeStep("observation", '✓ Sub-agent "researcher":\nXRP price is $1.33', {
                observationResult: {
                  success: true,
                  toolName: "spawn-agent",
                  displayText: '✓ Sub-agent "researcher": XRP price is $1.33',
                  category: "agent-delegate",
                  resultKind: "data",
                  preserveOnCompaction: false,
                  delegatedToolsUsed: ["web-search"],
                } as any,
              }),
            ],
          }),
        );
      }

      return Effect.succeed(
        transitionState(state, {
          status: "done",
          output: "Delegated search complete",
          iteration: state.iteration + 1,
        }),
      );
    };

    const result = await Effect.runPromise(
      runKernel(delegatedKernel, { task: "test", requiredTools: ["web-search"] }, {
        maxIterations: 10,
        strategy: "test",
        kernelType: "test",
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.status).toBe("done");
    expect(result.output).toBe("Delegated search complete");
    expect(result.steps.some((s) => s.content.includes("Required tools not yet used"))).toBe(false);
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
            steps: [
              ...state.steps,
              makeStep("action", "send_message"),
              makeStep("observation", "sent message", {
                observationResult: {
                  success: true,
                  toolName: "send_message",
                  displayText: "sent message",
                  category: "action",
                  resultKind: "info",
                  preserveOnCompaction: false,
                } as any,
              }),
            ],
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
            steps: [
              ...state.steps,
              makeStep("action", "search"),
              makeStep("observation", "search results", {
                observationResult: {
                  success: true,
                  toolName: "search",
                  displayText: "search results",
                  category: "lookup",
                  resultKind: "info",
                  preserveOnCompaction: false,
                } as any,
              }),
            ],
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
            steps: [
              ...state.steps,
              makeStep("action", "send_message"),
              makeStep("observation", "sent message", {
                observationResult: {
                  success: true,
                  toolName: "send_message",
                  displayText: "sent message",
                  category: "action",
                  resultKind: "info",
                  preserveOnCompaction: false,
                } as any,
              }),
            ],
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

  it("fails fast when required tools are not available", async () => {
    let callCount = 0;
    const neverCalledKernel: ThoughtKernel = (state, _ctx) => {
      callCount++;
      return Effect.succeed(state);
    };

    const result = await Effect.runPromise(
      runKernel(neverCalledKernel, {
        task: "test",
        requiredTools: ["shell-execute"],
        availableToolSchemas: [
          {
            name: "web-search",
            description: "search web",
            parameters: [],
          },
        ],
      }, {
        maxIterations: 5,
        strategy: "test",
        kernelType: "test",
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.status).toBe("failed");
    expect(result.error).toContain("missing_required_tool");
    expect(result.error).toContain("shell-execute");
    expect(callCount).toBe(0);
  });

  it("does not trigger low-delta early exit while required tools are still missing", async () => {
    let callCount = 0;
    const lowDeltaKernel: ThoughtKernel = (state, _ctx) => {
      callCount++;
      return Effect.succeed(
        transitionState(state, {
          status: "thinking",
          iteration: state.iteration + 1,
          tokens: state.tokens + 100,
          steps: [...state.steps, makeStep("thought", `low-delta-${callCount}`)],
        }),
      );
    };

    const result = await Effect.runPromise(
      runKernel(lowDeltaKernel, {
        task: "must call web-search first",
        requiredTools: ["web-search"],
      }, {
        maxIterations: 5,
        strategy: "test",
        kernelType: "test",
        loopDetection: { maxConsecutiveThoughts: 999, maxRepeatedThoughts: 999, maxSameToolCalls: 999 },
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.status).toBe("failed");
    expect(callCount).toBe(5);
    expect(result.error).toContain("terminatedBy=max_iterations");
    expect(result.error).not.toContain("low_delta_guard");
  });

  it("fails instead of delivering harness output when required tools were not called", async () => {
    const stalledKernel: ThoughtKernel = (state, _ctx) => {
      const nextIter = state.iteration + 1;
      if (nextIter === 1) {
        const tools = new Set(state.toolsUsed);
        tools.add("web-search");
        return Effect.succeed(
          transitionState(state, {
            status: "thinking",
            iteration: nextIter,
            toolsUsed: tools,
            steps: [
              ...state.steps,
              makeStep("action", "web-search"),
              makeStep("observation", "artifact-data"),
            ],
          }),
        );
      }
      return Effect.succeed(
        transitionState(state, {
          status: "thinking",
          iteration: nextIter,
          steps: [...state.steps, makeStep("thought", "stall")],
        }),
      );
    };

    const result = await Effect.runPromise(
      runKernel(stalledKernel, {
        task: "test",
        requiredTools: ["shell-execute"],
        availableToolSchemas: [
          { name: "web-search", description: "", parameters: [] },
          { name: "shell-execute", description: "", parameters: [] },
        ],
      }, {
        maxIterations: 6,
        strategy: "test",
        kernelType: "test",
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.status).toBe("failed");
    expect(result.error).toContain("missing_required_tool");
    expect(result.error).toContain("terminatedBy=max_iterations");
  });

  it("nudges alternate tool paths before harness deliverable after a failed tool path", async () => {
    let callCount = 0;
    const recoveryKernel: ThoughtKernel = (state, _ctx) => {
      callCount++;
      const nextIter = state.iteration + 1;

      if (callCount === 1) {
        const tools = new Set(state.toolsUsed);
        tools.add("shell-execute");
        return Effect.succeed(
          transitionState(state, {
            status: "thinking",
            iteration: nextIter,
            toolsUsed: tools,
            steps: [
              ...state.steps,
              makeStep("action", "shell-execute"),
              makeStep("observation", "[Tool error: auth required]", {
                observationResult: {
                  success: false,
                  toolName: "shell-execute",
                  displayText: "[Tool error: auth required]",
                  category: "error",
                  resultKind: "error",
                  preserveOnCompaction: true,
                },
              }),
            ],
          }),
        );
      }

      if (callCount === 2 || callCount === 3) {
        return Effect.succeed(
          transitionState(state, {
            status: "thinking",
            iteration: nextIter,
            steps: [...state.steps, makeStep("thought", "stalled")],
          }),
        );
      }

      if (callCount === 4 && typeof state.pendingGuidance?.errorRecovery === "string" && state.pendingGuidance.errorRecovery.includes("alternate path")) {
        const tools = new Set(state.toolsUsed);
        tools.add("http-get");
        return Effect.succeed(
          transitionState(state, {
            status: "thinking",
            iteration: nextIter,
            toolsUsed: tools,
            steps: [
              ...state.steps,
              makeStep("action", "http-get"),
              makeStep("observation", "fetched commit data", {
                observationResult: {
                  success: true,
                  toolName: "http-get",
                  displayText: "fetched commit data",
                  category: "lookup",
                  resultKind: "info",
                  preserveOnCompaction: false,
                },
              }),
            ],
          }),
        );
      }

      return Effect.succeed(
        transitionState(state, {
          status: "done",
          output: "Recovered via alternate path",
          iteration: nextIter,
        }),
      );
    };

    const result = await Effect.runPromise(
      runKernel(recoveryKernel, {
        task: "get commit data and summarize",
        availableToolSchemas: [
          { name: "shell-execute", description: "shell", parameters: [] },
          { name: "http-get", description: "http", parameters: [] },
        ],
      }, {
        maxIterations: 10,
        strategy: "test",
        kernelType: "test",
        loopDetection: { maxConsecutiveThoughts: 999, maxRepeatedThoughts: 999, maxSameToolCalls: 999 },
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.status).toBe("done");
    expect(result.output).toBe("Recovered via alternate path");
    expect(result.meta.terminatedBy).not.toBe("harness_deliverable");
    expect(result.toolsUsed.has("http-get")).toBe(true);
    const recoveryNudge = result.steps.find((s) => s.content.includes("Recovery required:"));
    expect(recoveryNudge).toBeDefined();
  });

  it("does not inject oracle final-answer nudge while required quota is still missing", async () => {
    let callCount = 0;
    const pulseReadyKernel: ThoughtKernel = (state, _ctx) => {
      callCount++;
      const nextIteration = state.iteration + 1;
      if (callCount === 1) {
        return Effect.succeed(
          transitionState(state, {
            status: "thinking",
            iteration: nextIteration,
            steps: [
              ...state.steps,
              makeStep("observation", JSON.stringify({ readyToAnswer: true }), {
                observationResult: {
                  success: true,
                  toolName: "pulse",
                  displayText: "readyToAnswer=true",
                  category: "meta",
                  resultKind: "info",
                  preserveOnCompaction: false,
                } as any,
              }),
            ],
          }),
        );
      }

      return Effect.succeed(
        transitionState(state, {
          status: "done",
          output: "premature completion",
          iteration: nextIteration,
        }),
      );
    };

    const result = await Effect.runPromise(
      runKernel(pulseReadyKernel, {
        task: "test",
        requiredTools: ["web-search"],
        requiredToolQuantities: { "web-search": 1 },
        maxRequiredToolRetries: 0,
        availableToolSchemas: [
          { name: "web-search", description: "search web", parameters: [] },
          { name: "pulse", description: "meta introspection", parameters: [] },
        ],
      }, {
        maxIterations: 5,
        strategy: "test",
        kernelType: "test",
        loopDetection: { maxConsecutiveThoughts: 999, maxRepeatedThoughts: 999, maxSameToolCalls: 999 },
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.status).toBe("failed");
    expect(result.error).toContain("web-search");
    expect(result.pendingGuidance?.oracleGuidance ?? "").not.toContain("Call `final-answer` now");
    expect(result.readyToAnswerNudgeCount ?? 0).toBe(0);
  });
});

describe("runKernel — tool classification lifecycle", () => {
  it("does not reclassify tools during execution after initial classification", async () => {
    let structuredCalls = 0;
    const baseService = TestLLMService([
      {
        json: {
          required: [{ name: "web-search", minCalls: 1 }],
          relevant: ["web-search", "recall"],
        },
      },
    ]);
    const countingService: typeof LLMService.Service = {
      ...baseService,
      completeStructured: <A>(request: {
        readonly messages: readonly { readonly role: "system" | "user" | "assistant"; readonly content: string }[];
        readonly systemPrompt?: string;
        readonly outputSchema: unknown;
        readonly maxTokens?: number;
        readonly temperature?: number;
        readonly maxParseRetries?: number;
      }) => {
        structuredCalls++;
        return baseService.completeStructured(request as never) as never;
      },
    };
    const classificationLayer = Layer.succeed(LLMService, LLMService.of(countingService));

    const stalledKernel: ThoughtKernel = (state, _ctx) => {
      const nextIteration = state.iteration + 1;
      if (nextIteration < 4) {
        return Effect.succeed(
          transitionState(state, {
            status: "thinking",
            iteration: nextIteration,
            steps: [...state.steps, makeStep("thought", `No progress iteration ${nextIteration}`)],
          }),
        );
      }
      return Effect.succeed(
        transitionState(state, {
          status: "done",
          output: "Completed without reclassification",
          iteration: nextIteration,
        }),
      );
    };

    const result = await Effect.runPromise(
      runKernel(stalledKernel, {
        task: "finish task with initial tool map only",
        relevantTools: ["web-search"],
        availableToolSchemas: [
          { name: "web-search", description: "Searches the web", parameters: [] },
          { name: "http-get", description: "Fetches a URL", parameters: [] },
          { name: "file-write", description: "Writes a file", parameters: [] },
          { name: "shell-execute", description: "Runs shell commands", parameters: [] },
        ],
      }, {
        maxIterations: 8,
        strategy: "test",
        kernelType: "test",
        loopDetection: { maxConsecutiveThoughts: 999, maxRepeatedThoughts: 999, maxSameToolCalls: 999 },
      }).pipe(Effect.provide(classificationLayer)),
    );

    expect(result.status).toBe("done");
    expect(structuredCalls).toBe(0);
  });
});

describe("llmCalls ceiling — maxIterations as hard LLM-call cap", () => {
  it("does not exceed maxIterations llm calls even when ICS-style continue paths skip iteration increments", async () => {
    // Simulates ICS re-entrancy: every other kernel call increments llmCalls
    // but NOT iteration (as if a stall-detection 'continue' fired). Without
    // the llmCalls guard in the while condition, the loop runs until
    // state.iteration >= maxIterations — which takes 2x more LLM calls.
    const maxIter = 3;
    const icsReentrantKernel: ThoughtKernel = (state, _ctx) => {
      const newLlmCalls = (state.llmCalls ?? 0) + 1;
      // Even-numbered calls skip the iteration increment (ICS re-entrancy)
      const skipIteration = newLlmCalls % 2 === 0;
      return Effect.succeed(
        transitionState(state, {
          status: "thinking",
          llmCalls: newLlmCalls,
          iteration: skipIteration ? state.iteration : state.iteration + 1,
          steps: [
            ...state.steps,
            makeStep("thought", `LLM call ${newLlmCalls} (iter ${state.iteration})`),
          ],
        }),
      );
    };

    const result = await Effect.runPromise(
      runKernel(icsReentrantKernel, { task: "test" }, {
        maxIterations: maxIter,
        strategy: "test",
        kernelType: "test",
        // Disable loop detection so it can't interfere
        loopDetection: { maxConsecutiveThoughts: 999, maxRepeatedThoughts: 999, maxSameToolCalls: 999 },
      }).pipe(Effect.provide(TestLLMServiceLayer())),
    );

    // RED: without llmCalls guard, the loop runs until iteration=3,
    // requiring 5 llmCalls (iterations: 0→1, skip, 1→2, skip, 2→3).
    // With the fix: exits when llmCalls >= maxIterations, so llmCalls ≤ 3.
    expect(result.llmCalls ?? 0).toBeLessThanOrEqual(maxIter);
  });
});

describe("loop detector graceful degradation — no artifacts path", () => {
  it("delivers last thought as output instead of failing when loop fires with no tool artifacts", async () => {
    // A kernel that emits the same thought content on every call — triggers
    // maxConsecutiveThoughts loop detection. Without the graceful-degradation
    // fix, the runner sets status="failed" and error contains "Loop detected".
    const STUCK_THOUGHT = "I am stuck thinking the same thing over and over";
    const repeatedThoughtKernel: ThoughtKernel = (state, _ctx) =>
      Effect.succeed(
        transitionState(state, {
          status: "thinking",
          llmCalls: (state.llmCalls ?? 0) + 1,
          iteration: state.iteration + 1,
          steps: [...state.steps, makeStep("thought", STUCK_THOUGHT)],
        }),
      );

    const result = await Effect.runPromise(
      runKernel(repeatedThoughtKernel, { task: "test" }, {
        maxIterations: 20,
        strategy: "test",
        kernelType: "test",
        loopDetection: { maxConsecutiveThoughts: 3, maxRepeatedThoughts: 3, maxSameToolCalls: 999 },
      }).pipe(Effect.provide(TestLLMServiceLayer())),
    );

    // RED: without fix, status="failed" and error/output contains "Loop detected"
    expect(result.status).not.toBe("failed");
    expect(result.output).not.toMatch(/Loop detected/i);
    expect(result.output).toContain(STUCK_THOUGHT);
  });
});

describe("non-authoritative termination — harness deliverable promotion", () => {
  // When the model ends its turn without calling final-answer (e.g. a short
  // apology or echoed tool error) but useful tool observations are already in
  // state.steps, the harness should replace state.output with the assembled
  // deliverable and re-mark terminatedBy as "harness_deliverable".
  it("swaps state.output for assembled artifacts when model ends turn without final-answer", async () => {
    const GARBAGE_END_TURN = "Sorry, I could not continue.";
    const ARTIFACT_PAYLOAD = "[web-search result] Top story: TypeScript 6.0 released";

    const endTurnKernel: ThoughtKernel = (state, _ctx) => {
      if (state.iteration === 0) {
        // First pass: emit a successful tool observation → deliverable artifact
        return Effect.succeed(
          transitionState(state, {
            status: "thinking",
            iteration: 1,
            toolsUsed: new Set([...state.toolsUsed, "web-search"]),
            steps: [
              ...state.steps,
              makeStep("action", `web-search({"query":"typescript"})`, {
                toolCall: { id: "tc-1", name: "web-search", arguments: {} },
              }),
              makeStep("observation", ARTIFACT_PAYLOAD, {
                toolCallId: "tc-1",
                observationResult: {
                  success: true,
                  toolName: "web-search",
                  displayText: ARTIFACT_PAYLOAD,
                  category: "retrieval",
                  resultKind: "data",
                  preserveOnCompaction: true,
                } as any,
              }),
            ],
          }),
        );
      }
      // Second pass: model ends turn with no final-answer, emits a weak reply
      return Effect.succeed(
        transitionState(state, {
          status: "done",
          output: GARBAGE_END_TURN,
          iteration: state.iteration + 1,
          meta: { ...state.meta, terminatedBy: "end_turn" },
        }),
      );
    };

    const result = await Effect.runPromise(
      runKernel(endTurnKernel, {
        task: "summarize TypeScript news",
        availableToolSchemas: [
          { name: "web-search", description: "search", parameters: [] },
        ],
      }, {
        maxIterations: 5,
        strategy: "test",
        kernelType: "test",
      }).pipe(Effect.provide(TestLLMServiceLayer())),
    );

    expect(result.status).toBe("done");
    expect(result.meta.terminatedBy).toBe("harness_deliverable");
    expect(result.meta.previousTerminatedBy).toBe("end_turn");
    expect(result.output).toContain(ARTIFACT_PAYLOAD);
    expect(result.output).not.toBe(GARBAGE_END_TURN);
  });

  it("leaves output untouched when terminatedBy is final_answer", async () => {
    const FINAL = "A proper synthesized answer.";
    const finalAnswerKernel: ThoughtKernel = (state, _ctx) => {
      if (state.iteration === 0) {
        return Effect.succeed(
          transitionState(state, {
            status: "thinking",
            iteration: 1,
            toolsUsed: new Set([...state.toolsUsed, "web-search"]),
            steps: [
              ...state.steps,
              makeStep("action", `web-search({"query":"x"})`, {
                toolCall: { id: "tc-1", name: "web-search", arguments: {} },
              }),
              makeStep("observation", "raw artifact data", {
                toolCallId: "tc-1",
                observationResult: {
                  success: true,
                  toolName: "web-search",
                  displayText: "raw artifact data",
                  category: "retrieval",
                  resultKind: "data",
                  preserveOnCompaction: true,
                } as any,
              }),
            ],
          }),
        );
      }
      return Effect.succeed(
        transitionState(state, {
          status: "done",
          output: FINAL,
          iteration: state.iteration + 1,
          meta: { ...state.meta, terminatedBy: "final_answer" },
        }),
      );
    };

    const result = await Effect.runPromise(
      runKernel(finalAnswerKernel, { task: "test" }, {
        maxIterations: 5,
        strategy: "test",
        kernelType: "test",
      }).pipe(Effect.provide(TestLLMServiceLayer())),
    );

    expect(result.status).toBe("done");
    expect(result.output).toBe(FINAL);
    expect(result.meta.terminatedBy).toBe("final_answer");
    expect(result.meta.previousTerminatedBy).toBeUndefined();
  });
});
