// File: tests/kernel/loop/resume-state-seam.test.ts
/**
 * Durable-execution resume seam (v0.12.0 track 1, Phase C — design spec
 * wiki/Architecture/Design-Specs/2026-06-10-durable-execution.md §2.3):
 *
 * `KernelInput.resumeState?: KernelState` lets the runner reconstruct a running
 * kernel FROM a fully-restored checkpoint state instead of building a fresh
 * iteration-0 state. When present it is used VERBATIM as the base state —
 * preserving iteration / steps / scratchpad / toolsUsed / meta / tokens so the
 * run continues mid-stream rather than restarting. Phase B persists the codec-
 * serialized state every iteration; this is the read-side that re-materializes it.
 *
 * Invariants under test:
 *   1. A restored state (built via the kernel codec serialize→deserialize
 *      round-trip) seeded onto `input.resumeState` continues the run from the
 *      restored iteration — NOT a fresh iteration-0 start. With a final-answer
 *      TestLLM a fresh run ends at iteration 1; a resumed run from iteration 2
 *      therefore ends at iteration >= 2, which discriminates the two paths.
 *   2. The restored steps survive into the result (no fresh-state wipe).
 *   3. The default path (no resumeState) is unchanged — a fresh run from
 *      iteration 0 still ends at iteration 1.
 */
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { runKernel } from "../../../src/kernel/loop/runner.js";
import { reactKernel } from "../../../src/kernel/loop/react-kernel.js";
import {
  initialKernelState,
  transitionState,
  type KernelInput,
  type KernelRunOptions,
  type KernelState,
} from "../../../src/kernel/state/kernel-state.js";
import {
  serializeKernelState,
  deserializeKernelState,
} from "../../../src/kernel/state/kernel-codec.js";
import type { ReasoningStep } from "../../../src/types/index.js";

const RUN_OPTIONS: KernelRunOptions = {
  maxIterations: 6,
  strategy: "react",
  kernelType: "react",
  taskId: "resume-seam",
  taskDescription: "Continue the prior work and finish.",
};

const llmLayer = TestLLMServiceLayer([
  { match: ".*", text: "FINAL ANSWER: resumed and finished" },
]);

/** Build a restored KernelState sitting at iteration N with >=1 prior step. */
const buildRestoredState = (iteration: number): KernelState => {
  const base = initialKernelState(RUN_OPTIONS);
  const priorStep = {
    id: "restored-step-1",
    type: "thought",
    content: "PRIOR-WORK: a thought recorded before the crash",
    timestamp: new Date(),
  } as ReasoningStep;
  const seeded = transitionState(base, {
    iteration,
    status: "thinking",
    steps: [priorStep],
    tokens: 1234,
    llmCalls: iteration,
  });
  // Round-trip through the durable codec — exactly what Phase C resume does.
  return deserializeKernelState(serializeKernelState(seeded));
};

const runWith = (input: KernelInput) =>
  Effect.runPromise(
    runKernel(reactKernel, input, RUN_OPTIONS).pipe(Effect.provide(llmLayer)),
  );

describe("resume seam — KernelInput.resumeState continues from a restored state", () => {
  it("seeds the kernel from the restored state (iteration + steps preserved)", async () => {
    const restored = buildRestoredState(2);
    expect(restored.iteration).toBe(2);

    const state = await runWith({
      task: "Continue the prior work and finish.",
      resumeState: restored,
    });

    // Continuation: a fresh final-answer run ends at iteration 1; resuming from
    // iteration 2 means the final iteration is >= 2 (never a fresh 0/1 start).
    expect(state.iteration).toBeGreaterThanOrEqual(2);

    // The restored prior step survived into the run's step record.
    const contents = state.steps.map((s) => s.content);
    expect(contents.some((c) => c.includes("PRIOR-WORK"))).toBe(true);
  });

  it("default path (no resumeState) starts fresh from iteration 0", async () => {
    const state = await runWith({
      task: "Just answer directly.",
    });
    // Fresh start + final-answer TestLLM ⇒ ends at iteration 1, no prior step.
    expect(state.iteration).toBe(1);
    expect(state.steps.some((s) => s.content.includes("PRIOR-WORK"))).toBe(false);
  });
});
