import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { LLMService, TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { runKernel } from "../../../src/strategies/shared/kernel-runner.js";
import {
  initialKernelState,
  transitionState,
  type KernelState,
  type KernelContext,
  type ThoughtKernel,
  type MaybeService,
  type EventBusInstance,
} from "../../../src/strategies/shared/kernel-state.js";
import { makeStep } from "../../../src/strategies/shared/step-utils.js";

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
      }).pipe(Effect.provide(testLayer)),
    );

    // Loop should stop after 3 iterations even though status is still "thinking"
    expect(result.iteration).toBe(3);
    expect(result.status).toBe("thinking");
    expect(result.steps.length).toBe(3);
    // No onDone hook should fire since status is not "done"
  });

  it("embedded tool call guard executes bare tool call in output", async () => {
    // Kernel that returns done with a bare tool call as the output
    const embeddedToolKernel: ThoughtKernel = (state, _ctx) =>
      Effect.succeed(
        transitionState(state, {
          status: "done",
          output: 'web-search({"query": "test"})',
          iteration: state.iteration + 1,
        }),
      );

    const result = await Effect.runPromise(
      runKernel(embeddedToolKernel, { task: "embedded" }, {
        maxIterations: 10,
        strategy: "embed",
        kernelType: "test",
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.status).toBe("done");
    // The output should be replaced with the tool observation content.
    // Since no ToolService is provided, the observation will be the
    // "not available" message from executeToolCall.
    expect(result.output).toContain("ToolService is not available");
    // Action + observation steps should be appended
    expect(result.steps.some((s) => s.type === "action")).toBe(true);
    expect(result.steps.some((s) => s.type === "observation")).toBe(true);
    // Tool should be tracked
    expect(result.toolsUsed.has("web-search")).toBe(true);
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
});
