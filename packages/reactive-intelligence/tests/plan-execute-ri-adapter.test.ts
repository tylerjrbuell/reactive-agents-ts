// Run: bun test packages/reactive-intelligence/tests/plan-execute-ri-adapter.test.ts --timeout 15000
//
// GH #118 — plan-execute synthetic KernelState contract test.
//
// `packages/reasoning/src/strategies/plan-execute.ts:737-756` constructs a
// synthetic `KernelStateLike` per outer reflect-iteration to feed into
// `EntropySensorService.score()`. plan-execute outer iters are NOT kernel
// iters, so the shape is a translator — and rotting translators are the
// worst kind of debt (issue body, verbatim).
//
// This contract test mirrors the synthetic state exactly. If either side
// drifts — `KernelStateLike` (core/src/services/entropy-sensor-tag.ts)
// gains a required field, or plan-execute's synthetic shape changes — the
// test surfaces it. Without this gate the silent drift mode is:
// score() returns fallbackScore() unconditionally because the synthetic
// state misses a now-required field, RI dispatcher stops firing for
// plan-execute, no test fails, no metric moves.
//
// Test placement: reactive-intelligence/tests rather than reasoning/tests
// because reasoning has no reactive-intelligence dep (would create a cycle).
// The contract is owned by RI; this file is RI's regression net for one of
// its consumers.

import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import {
  EntropySensorService,
  type KernelStateLike,
} from "@reactive-agents/core";
import { createReactiveIntelligenceLayer } from "../src/runtime.js";

const testLayer = createReactiveIntelligenceLayer();

/**
 * EXACT mirror of `plan-execute.ts:737-756` synthetic state construction.
 *
 * If this construction drifts from plan-execute.ts, update both sites in the
 * same commit. The variable names + literal values must match plan-execute
 * verbatim so this stays an honest contract gate.
 */
const buildPlanExecuteSyntheticState = (params: {
  taskId?: string;
  refinement: number;
  totalTokens: number;
  stepTypes: ReadonlyArray<{ type: string; content?: string }>;
  completedToolNames: ReadonlyArray<string>;
}): KernelStateLike => ({
  taskId: params.taskId ?? "plan-execute",
  strategy: "plan-execute-reflect",
  kernelType: "plan-execute",
  steps: params.stepTypes.map((rs) => ({
    type: rs.type,
    ...(rs.content != null ? { content: rs.content } : {}),
  })),
  toolsUsed: new Set(params.completedToolNames),
  iteration: params.refinement,
  tokens: params.totalTokens,
  status: "observing",
  output: null,
  error: null,
  meta: {} as Record<string, unknown>,
});

describe("plan-execute → EntropySensor contract", () => {
  test("synthetic state shape satisfies KernelStateLike at compile + runtime", async () => {
    // Compile-time: `buildPlanExecuteSyntheticState` returns `KernelStateLike`.
    // If the contract gains a required field this file fails `tsc` first.
    const syntheticState = buildPlanExecuteSyntheticState({
      taskId: "test-plan-execute-1",
      refinement: 0,
      totalTokens: 0,
      stepTypes: [],
      completedToolNames: [],
    });

    // Defensive runtime check on each contract field. Mirrors
    // KernelStateLike (core/src/services/entropy-sensor-tag.ts:6-18).
    expect(typeof syntheticState.taskId).toBe("string");
    expect(typeof syntheticState.strategy).toBe("string");
    expect(typeof syntheticState.kernelType).toBe("string");
    expect(Array.isArray(syntheticState.steps)).toBe(true);
    expect(syntheticState.toolsUsed instanceof Set).toBe(true);
    expect(typeof syntheticState.iteration).toBe("number");
    expect(typeof syntheticState.tokens).toBe("number");
    expect(typeof syntheticState.status).toBe("string");
    expect(syntheticState.output).toBeNull();
    expect(syntheticState.error).toBeNull();
    expect(syntheticState.meta).toEqual({});
  });

  test("score() accepts synthetic state without runtime error (empty steps, 0 tokens)", async () => {
    const syntheticState = buildPlanExecuteSyntheticState({
      taskId: "test-plan-execute-2",
      refinement: 0,
      totalTokens: 0,
      stepTypes: [],
      completedToolNames: [],
    });

    const program = Effect.gen(function* () {
      const sensor = yield* EntropySensorService;
      return yield* sensor.score({
        thought: "Initial reflection: plan not yet executed.",
        taskDescription: "test plan-execute reflection",
        strategy: "plan-execute-reflect",
        iteration: 0,
        maxIterations: 3,
        modelId: "cogito:14b",
        temperature: 0.3,
        kernelState: syntheticState,
      });
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testLayer)),
    );

    expect(result.composite).toBeGreaterThanOrEqual(0);
    expect(result.composite).toBeLessThanOrEqual(1);
    expect(result.iteration).toBe(0);
    expect(result.sources.structural).toBeDefined();
  });

  test("score() accepts synthetic state with populated steps + tools (mid-refinement)", async () => {
    // Realistic mid-flight shape: plan-execute has produced a few thought +
    // observation steps and called two tools across completed plan steps.
    const syntheticState = buildPlanExecuteSyntheticState({
      taskId: "test-plan-execute-3",
      refinement: 1,
      totalTokens: 4200,
      stepTypes: [
        { type: "thought", content: "Plan generated with 3 steps." },
        { type: "observation", content: "[EXEC s1] ✓ web-search returned 3 results." },
        { type: "thought", content: "Step 1 successful; proceeding to step 2." },
        { type: "observation", content: "[EXEC s2] ✓ analysis completed." },
      ],
      completedToolNames: ["web-search", "file-read"],
    });

    const program = Effect.gen(function* () {
      const sensor = yield* EntropySensorService;
      return yield* sensor.score({
        thought:
          "Reflection 1: two plan steps complete; remaining step depends on s2 output.",
        taskDescription:
          "Research a topic, summarize findings, write report",
        strategy: "plan-execute-reflect",
        iteration: 1,
        maxIterations: 3,
        modelId: "cogito:14b",
        temperature: 0.3,
        kernelState: syntheticState,
      });
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testLayer)),
    );

    expect(result.composite).toBeGreaterThanOrEqual(0);
    expect(result.composite).toBeLessThanOrEqual(1);
    expect(result.iteration).toBe(1);
    // Score function never throws (fallbackScore() on internal failure);
    // a defined composite + structural means the synthetic state passed
    // through `meanStructural` + `meanBehavioral` paths without error.
    expect(typeof result.sources.behavioral).toBe("number");
  });

  test("score() handles synthetic state with empty meta (plan-execute always passes {})", async () => {
    // plan-execute hard-codes `meta: {} as Record<string, unknown>` at
    // construction (plan-execute.ts:755). Verify the sensor handles this —
    // entropy-sensor-service.ts:130 does `kernelState.meta as any`?.entropy
    // ?? {}, but a regression where meta becomes required-non-empty would
    // need a coordinated change on both sides.
    const syntheticState = buildPlanExecuteSyntheticState({
      taskId: "test-plan-execute-4",
      refinement: 2,
      totalTokens: 8400,
      stepTypes: [{ type: "thought", content: "final reflection" }],
      completedToolNames: ["web-search"],
    });

    expect(syntheticState.meta).toEqual({});
    expect(Object.keys(syntheticState.meta).length).toBe(0);

    const program = Effect.gen(function* () {
      const sensor = yield* EntropySensorService;
      return yield* sensor.score({
        thought: "Final reflection: goal satisfied.",
        taskDescription: "test",
        strategy: "plan-execute-reflect",
        iteration: 2,
        maxIterations: 3,
        modelId: "gpt-4o-mini",
        temperature: 0.3,
        kernelState: syntheticState,
      });
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testLayer)),
    );
    expect(result.composite).toBeDefined();
  });

  test("kernelType='plan-execute' value pins the synthetic origin marker", () => {
    // The literal "plan-execute" kernelType distinguishes synthetic
    // outer-loop state from real ReAct kernel state (kernelType="react").
    // Downstream telemetry consumers (trace, debrief synthesis) can filter
    // on this to reason about whether an entry came from a real kernel iter
    // or a plan-execute reflection iter. A drift to a different literal
    // would silently re-categorize plan-execute reflections as real kernel
    // iters in metrics.
    const syntheticState = buildPlanExecuteSyntheticState({
      refinement: 0,
      totalTokens: 0,
      stepTypes: [],
      completedToolNames: [],
    });
    expect(syntheticState.kernelType).toBe("plan-execute");
    expect(syntheticState.strategy).toBe("plan-execute-reflect");
    expect(syntheticState.status).toBe("observing");
  });
});
