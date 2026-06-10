// File: tests/kernel/loop/durable-checkpoint-seam.test.ts
/**
 * Durable-execution seam (v0.12.0 track 1, design spec
 * wiki/Architecture/Design-Specs/2026-06-10-durable-execution.md):
 *
 * The kernel must invoke `runController.onCheckpoint?.(state, iteration)` at
 * the existing iteration-boundary checkpoint site in iterate-pass.ts, so a
 * runtime-side durable controller can persist state every-N iterations.
 *
 * Invariants under test:
 *   1. A RunControllerLike with onCheckpoint set receives (state, iteration)
 *      at each iteration boundary when run through the real kernel loop.
 *   2. The state argument is structurally a KernelStateLike snapshot whose
 *      iteration matches the iteration argument.
 *   3. An onCheckpoint observer that THROWS must never kill the loop — the
 *      run still completes (R11 triple-surface precedent: warn, don't crash).
 *   4. A controller WITHOUT onCheckpoint (the default in-process controller)
 *      keeps working unchanged — zero-cost when absent.
 */
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { RunControllerRef, type RunControllerLike } from "@reactive-agents/core";
import type { KernelStateLike } from "@reactive-agents/core";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { ReasoningService } from "../../../src/services/reasoning-service.js";
import { createReasoningLayer } from "../../../src/runtime.js";
import { defaultReasoningConfig } from "../../../src/types/config.js";

const llmLayer = TestLLMServiceLayer([
  { match: ".*", text: "FINAL ANSWER: durable checkpoint seam verified" },
]);

const reasoningLayer = createReasoningLayer({
  ...defaultReasoningConfig,
  adaptive: { enabled: false, learning: false },
  strategies: {
    ...defaultReasoningConfig.strategies,
    reactive: { ...defaultReasoningConfig.strategies.reactive, maxIterations: 3 },
  },
});

const testLayer = Layer.provide(reasoningLayer, llmLayer);

const runTask = (controller: RunControllerLike) => {
  const program = Effect.gen(function* () {
    const reasoning = yield* ReasoningService;
    return yield* reasoning.execute({
      taskDescription: "Say hello and finish.",
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      strategy: "react",
    });
  });
  return Effect.runPromise(
    program.pipe(
      Effect.locally(RunControllerRef, controller),
      Effect.provide(testLayer),
    ) as Effect.Effect<{ output: string | null }, never, never>,
  );
};

describe("durable-checkpoint seam — onCheckpoint at iteration boundary", () => {
  it("invokes onCheckpoint(state, iteration) at each iteration boundary", async () => {
    const calls: Array<{ iteration: number; stateIteration: number; status: string }> = [];
    const controller: RunControllerLike = {
      checkpoint: () => Promise.resolve(undefined),
      onCheckpoint: (state: Readonly<KernelStateLike>, iteration: number) => {
        calls.push({
          iteration,
          stateIteration: state.iteration,
          status: state.status,
        });
      },
    };

    const result = await runTask(controller);
    expect(result.output ?? "").not.toBe("");

    // At least the first iteration boundary must have fired the observer.
    expect(calls.length).toBeGreaterThanOrEqual(1);
    for (const call of calls) {
      // iteration argument mirrors the state's own counter at the boundary.
      expect(call.iteration).toBe(call.stateIteration);
      expect(typeof call.status).toBe("string");
    }
    // Iterations observed are non-decreasing (boundary order preserved).
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i]!.iteration).toBeGreaterThanOrEqual(calls[i - 1]!.iteration);
    }
  });

  it("passes a structurally complete KernelStateLike snapshot", async () => {
    let snapshot: Readonly<KernelStateLike> | null = null;
    const controller: RunControllerLike = {
      checkpoint: () => Promise.resolve(undefined),
      onCheckpoint: (state) => {
        if (snapshot === null) snapshot = state;
      },
    };

    await runTask(controller);
    expect(snapshot).not.toBeNull();
    const s = snapshot as unknown as KernelStateLike;
    expect(typeof s.taskId).toBe("string");
    expect(typeof s.strategy).toBe("string");
    expect(typeof s.kernelType).toBe("string");
    expect(Array.isArray(s.steps)).toBe(true);
    expect(s.toolsUsed instanceof Set).toBe(true);
    expect(typeof s.iteration).toBe("number");
    expect(typeof s.tokens).toBe("number");
    expect(typeof s.status).toBe("string");
    expect(typeof s.meta).toBe("object");
  });

  it("a throwing onCheckpoint observer never kills the loop", async () => {
    let threw = 0;
    const controller: RunControllerLike = {
      checkpoint: () => Promise.resolve(undefined),
      onCheckpoint: () => {
        threw++;
        throw new Error("durable store unavailable (synthetic)");
      },
    };

    const result = await runTask(controller);
    expect(threw).toBeGreaterThanOrEqual(1);
    // Run completed despite the observer throwing every iteration.
    expect(result.output ?? "").not.toBe("");
  });

  it("controller without onCheckpoint still works (zero-cost when absent)", async () => {
    const controller: RunControllerLike = {
      checkpoint: () => Promise.resolve(undefined),
    };
    const result = await runTask(controller);
    expect(result.output ?? "").not.toBe("");
  });
});
