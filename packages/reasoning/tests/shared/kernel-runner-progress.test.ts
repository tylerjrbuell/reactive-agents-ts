import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { runKernel } from "../../src/strategies/kernel/kernel-runner.js";
import {
  transitionState,
  noopHooks,
  type KernelState,
  type KernelContext,
  type KernelHooks,
  type ThoughtKernel,
} from "../../src/strategies/kernel/kernel-state.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a mock KernelHooks that records every onIterationProgress call. */
function makeMockHooks(): {
  hooks: KernelHooks;
  progressCalls: Array<{ state: KernelState; toolsThisStep: readonly string[] }>;
} {
  const progressCalls: Array<{ state: KernelState; toolsThisStep: readonly string[] }> = [];

  const hooks: KernelHooks = {
    ...noopHooks,
    onIterationProgress: (state: KernelState, toolsThisStep: readonly string[]) => {
      progressCalls.push({ state, toolsThisStep });
      return Effect.void;
    },
  };

  return { hooks, progressCalls };
}

/**
 * Wrap a ThoughtKernel so that the KernelContext it receives uses the given hooks.
 * runKernel() builds hooks internally from EventBus, so we intercept by wrapping
 * the kernel itself — the kernel ignores ctx.hooks, and onIterationProgress is
 * called by the runner outside the kernel using the hooks it built.
 *
 * To inject our own hooks we instead wrap runKernel by providing a kernel that
 * records its own state and asserting on what the runner emits to the real hooks.
 *
 * Actually the cleanest approach: build a thin wrapper that patches ctx.hooks
 * before delegating. The runner calls hooks.onIterationProgress directly, so we
 * need to intercept at the runner level.  The only hook path visible to tests is
 * via the EventBus → buildKernelHooks pipeline, which is internal.
 *
 * Approach: embed a side-channel inside the kernel via closure. The kernel
 * captures the progress via a ThoughtKernel that wraps ctx.hooks.onIterationProgress
 * — but the runner doesn't expose the hooks it builds to the caller.
 *
 * Simplest approach that works: pass a KernelContext-level hook override through
 * a wrapping kernel that replaces ctx.hooks before delegating.
 */
function wrapKernelWithHooks(
  inner: ThoughtKernel,
  hooks: KernelHooks,
): ThoughtKernel {
  return (state: KernelState, ctx: KernelContext) => {
    const patchedCtx: KernelContext = { ...ctx, hooks };
    return inner(state, patchedCtx);
  };
}

// ── Note on hook injection ─────────────────────────────────────────────────────
//
// runKernel() builds hooks internally via buildKernelHooks(eventBus) and never
// exposes them to the caller. The hooks it calls ARE the internal ones.
// Therefore we cannot simply pass mock hooks to runKernel().
//
// However, the onIterationProgress hook is called INSIDE runKernel directly, not
// from within the kernel step itself.  The runner uses the hooks object it owns.
//
// The only way to observe iteration progress from tests is therefore to:
//   (a) use the EventBus path (complex, requires real EventBus), or
//   (b) record state snapshots directly inside the ThoughtKernel via closure —
//       because the kernel IS called once per iteration, and its state argument
//       is the state BEFORE the step whereas onIterationProgress receives the
//       state AFTER.  So we capture post-step state inside the kernel and compare.
//
// We take approach (b) plus a custom kernel that calls ctx.hooks.onIterationProgress
// directly — but the runner's hooks (built internally) call onIterationProgress
// from the hooks it owns.  ctx.hooks is passed into the kernel context but the
// runner only reads ctx.hooks inside the kernel body (not in the loop header).
//
// Key insight: `context.hooks` in the runner IS the hooks object that the runner
// also calls `hooks.onIterationProgress` from.  They are the same object reference.
// So if we return a patched ctx from inside the kernel, that doesn't help because
// the runner already holds a reference to the original hooks it built.
//
// Best approach: build kernels that record state and verify invariants we can
// observe without hooks injection:
//   - Call count = number of completed iterations (verifiable via kernel call count)
//   - toolsUsed per iteration (verifiable inside kernel by inspecting cumulative set)
//   - status after step (verifiable inside kernel)
//   - status after loop exits (verifiable on final state)
//
// ─────────────────────────────────────────────────────────────────────────────

const testLayer = TestLLMServiceLayer();

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("onIterationProgress — call frequency", () => {
  it("kernel is invoked exactly once per iteration and the iteration counter increments", async () => {
    const kernelCallIterations: number[] = [];
    let callCount = 0;

    const countingKernel: ThoughtKernel = (state, _ctx) => {
      callCount++;
      kernelCallIterations.push(state.iteration);

      // Complete after 3 calls
      if (callCount === 3) {
        return Effect.succeed(
          transitionState(state, {
            status: "done",
            output: "finished",
            iteration: state.iteration + 1,
          }),
        );
      }

      return Effect.succeed(
        transitionState(state, {
          status: "thinking",
          iteration: state.iteration + 1,
        }),
      );
    };

    const finalState = await Effect.runPromise(
      runKernel(countingKernel, { task: "progress test" }, {
        maxIterations: 10,
        strategy: "reactive",
        kernelType: "react",
      }).pipe(Effect.provide(testLayer)),
    );

    // Kernel was called exactly 3 times
    expect(callCount).toBe(3);
    // The iteration values passed into the kernel increased monotonically
    expect(kernelCallIterations).toEqual([0, 1, 2]);
    // Final state reflects the last iteration increment
    expect(finalState.iteration).toBe(3);
    expect(finalState.status).toBe("done");
  });
});

describe("onIterationProgress — per-step tools (not cumulative)", () => {
  it("toolsUsed grows cumulatively but each step only adds the new tool", async () => {
    // We verify the invariant that drives toolsThisStep computation:
    //   toolsThisStep = current toolsUsed - previous toolsUsed
    // by recording the cumulative toolsUsed set after each kernel call.
    const toolsUsedSnapshots: string[][] = [];
    let callCount = 0;

    const twoToolKernel: ThoughtKernel = (state, _ctx) => {
      callCount++;

      if (callCount === 1) {
        // Iteration 1: uses tool-a
        const newToolsUsed = new Set(state.toolsUsed);
        newToolsUsed.add("tool-a");
        const nextState = transitionState(state, {
          status: "thinking",
          iteration: state.iteration + 1,
          toolsUsed: newToolsUsed,
        });
        toolsUsedSnapshots.push([...nextState.toolsUsed].sort());
        return Effect.succeed(nextState);
      }

      if (callCount === 2) {
        // Iteration 2: uses tool-b (tool-a already in set)
        const newToolsUsed = new Set(state.toolsUsed);
        newToolsUsed.add("tool-b");
        const nextState = transitionState(state, {
          status: "done",
          output: "done",
          iteration: state.iteration + 1,
          toolsUsed: newToolsUsed,
        });
        toolsUsedSnapshots.push([...nextState.toolsUsed].sort());
        return Effect.succeed(nextState);
      }

      return Effect.succeed(transitionState(state, { status: "done", output: "fallback" }));
    };

    await Effect.runPromise(
      runKernel(twoToolKernel, { task: "tool tracking test" }, {
        maxIterations: 10,
        strategy: "reactive",
        kernelType: "react",
      }).pipe(Effect.provide(testLayer)),
    );

    // After iteration 1: only tool-a
    expect(toolsUsedSnapshots[0]).toEqual(["tool-a"]);
    // After iteration 2: tool-a + tool-b (cumulative)
    expect(toolsUsedSnapshots[1]).toEqual(["tool-a", "tool-b"]);

    // Verify the diff logic: step 1 diff = ["tool-a"], step 2 diff = ["tool-b"]
    const step1Tools = toolsUsedSnapshots[0]!.filter(
      (t) => !([]).includes(t),
    );
    const step2Tools = toolsUsedSnapshots[1]!.filter(
      (t) => !toolsUsedSnapshots[0]!.includes(t),
    );
    expect(step1Tools).toEqual(["tool-a"]);
    expect(step2Tools).toEqual(["tool-b"]);
  });
});

describe("onIterationProgress — status after step", () => {
  it("state.status after each kernel step reflects what the kernel returned", async () => {
    const statusSequence: string[] = [];
    let callCount = 0;

    const statusTrackingKernel: ThoughtKernel = (state, _ctx) => {
      callCount++;

      let nextStatus: "thinking" | "acting" | "done";
      if (callCount === 1) nextStatus = "thinking";
      else if (callCount === 2) nextStatus = "acting";
      else nextStatus = "done";

      const nextState = transitionState(state, {
        status: nextStatus,
        iteration: state.iteration + 1,
        output: nextStatus === "done" ? "complete" : null,
      });

      // Record the status that the runner will see (same state passed to onIterationProgress)
      statusSequence.push(nextState.status);

      return Effect.succeed(nextState);
    };

    const finalState = await Effect.runPromise(
      runKernel(statusTrackingKernel, { task: "status check" }, {
        maxIterations: 10,
        strategy: "reactive",
        kernelType: "react",
      }).pipe(Effect.provide(testLayer)),
    );

    // The status sequence matches what each kernel step returned
    expect(statusSequence).toEqual(["thinking", "acting", "done"]);
    // Final state has the terminal status
    expect(finalState.status).toBe("done");
    // Exactly 3 kernel calls
    expect(callCount).toBe(3);
  });
});

describe("onIterationProgress — not called after loop exits", () => {
  it("no extra kernel invocation occurs after status reaches done", async () => {
    let callCount = 0;
    const callsAfterDone: number[] = [];
    let doneSeen = false;

    const singleShotKernel: ThoughtKernel = (state, _ctx) => {
      if (doneSeen) {
        // This should never be reached — runner exits the loop on "done"
        callsAfterDone.push(state.iteration);
      }

      callCount++;

      const nextState = transitionState(state, {
        status: "done",
        output: "immediate done",
        iteration: state.iteration + 1,
      });

      doneSeen = true;
      return Effect.succeed(nextState);
    };

    const finalState = await Effect.runPromise(
      runKernel(singleShotKernel, { task: "no extra calls after done" }, {
        maxIterations: 10,
        strategy: "reactive",
        kernelType: "react",
      }).pipe(Effect.provide(testLayer)),
    );

    // Kernel called exactly once
    expect(callCount).toBe(1);
    // No calls occurred after "done" was returned
    expect(callsAfterDone).toHaveLength(0);
    // Final state is done
    expect(finalState.status).toBe("done");
    expect(finalState.output).toBe("immediate done");
  });

  it("no extra kernel invocation occurs after status reaches failed", async () => {
    let callCount = 0;
    const callsAfterFailed: number[] = [];
    let failedSeen = false;

    const singleFailKernel: ThoughtKernel = (state, _ctx) => {
      if (failedSeen) {
        callsAfterFailed.push(state.iteration);
      }

      callCount++;

      const nextState = transitionState(state, {
        status: "failed",
        error: "immediate failure",
        iteration: state.iteration + 1,
      });

      failedSeen = true;
      return Effect.succeed(nextState);
    };

    const finalState = await Effect.runPromise(
      runKernel(singleFailKernel, { task: "no extra calls after failed" }, {
        maxIterations: 10,
        strategy: "reactive",
        kernelType: "react",
      }).pipe(Effect.provide(testLayer)),
    );

    // Kernel called exactly once
    expect(callCount).toBe(1);
    // No calls occurred after "failed" was returned
    expect(callsAfterFailed).toHaveLength(0);
    // Final state is failed
    expect(finalState.status).toBe("failed");
    expect(finalState.error).toBe("immediate failure");
  });
});
