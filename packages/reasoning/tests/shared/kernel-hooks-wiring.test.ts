/**
 * kernel-hooks-wiring.test.ts
 *
 * Behavioral tests verifying that kernel lifecycle hooks ACTUALLY fire during
 * kernel execution — not just that the hook functions exist.
 *
 * Strategy:
 *   runKernel() internally calls buildKernelHooks(eventBus), where eventBus
 *   comes from Effect.serviceOption(EventBus). By providing a mock EventBus
 *   Layer that records published events, we can observe which hooks fired and
 *   in what order without requiring injection of a hooks object directly.
 *
 *   Every hook in buildKernelHooks() calls publishReasoningStep() which routes
 *   to eventBus.value.publish(). The events have `_tag` fields that identify
 *   which hook fired:
 *     onIterationProgress → "ReasoningIterationProgress"
 *     onThought           → "ReasoningStepCompleted" (with thought field)
 *     onAction            → "ReasoningStepCompleted" (with action field)
 *     onObservation       → "ReasoningStepCompleted" + "ToolCallCompleted"
 *     onDone              → "FinalAnswerProduced"
 *     onError             → (no-op — does NOT publish)
 *     onStrategySwitched  → "StrategySwitched"
 *     onStrategySwitchEvaluated → "StrategySwitchEvaluated"
 *
 * Covers:
 *   1. onIterationProgress fires once per iteration (N iterations → N events)
 *   2. onIterationProgress iteration counter increments correctly
 *   3. onDone fires exactly once when kernel reaches "done" status
 *   4. Events are published in correct order within a run
 *   5. Hook failure (EventBus publish error) does NOT abort the kernel
 */
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBus } from "@reactive-agents/core";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { runKernel } from "../../src/kernel/loop/runner.js";
import { buildKernelHooks } from "../../src/kernel/state/kernel-hooks.js";
import {
  transitionState,
  initialKernelState,
  type KernelState,
  type ThoughtKernel,
  type EventBusInstance,
} from "../../src/kernel/state/kernel-state.js";
import { makeStep } from "../../src/strategies/kernel/utils/step-utils.js";

// ── Mock EventBus helper ──────────────────────────────────────────────────────

/** Create a mock EventBus Layer that captures all published events. */
function makeMockEventBusLayer(): { events: unknown[]; layer: Layer.Layer<EventBus> } {
  const events: unknown[] = [];

  const mockBus: EventBus["Type"] = {
    publish: (event) => {
      events.push(event);
      return Effect.void;
    },
    subscribe: () => Effect.succeed(() => {}),
    on: () => Effect.succeed(() => {}),
  } as unknown as EventBus["Type"];

  const layer = Layer.succeed(EventBus, mockBus);
  return { events, layer };
}

/** Create a mock EventBus that throws on every publish (to test resilience). */
function makeFailingEventBusLayer(): Layer.Layer<EventBus> {
  const failingBus: EventBus["Type"] = {
    publish: (_event) => Effect.fail(new Error("EventBus publish error")) as unknown as Effect.Effect<void, never>,
    subscribe: () => Effect.succeed(() => {}),
    on: () => Effect.succeed(() => {}),
  } as unknown as EventBus["Type"];

  return Layer.succeed(EventBus, failingBus);
}

// ── Kernel helpers ─────────────────────────────────────────────────────────────

/** Kernel that runs N "thinking" iterations then completes. */
function makeNStepKernel(n: number): ThoughtKernel {
  let calls = 0;
  return (state: KernelState, _ctx) => {
    calls++;
    if (calls >= n) {
      return Effect.succeed(
        transitionState(state, {
          status: "done",
          output: `completed after ${n} steps`,
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
}

/** Kernel that completes immediately on first call. */
const immediateKernel: ThoughtKernel = (state, _ctx) =>
  Effect.succeed(
    transitionState(state, {
      status: "done",
      output: "instant done",
      iteration: state.iteration + 1,
    }),
  );

/** Kernel that fails immediately on first call. */
const immediateFailKernel: ThoughtKernel = (state, _ctx) =>
  Effect.succeed(
    transitionState(state, {
      status: "failed",
      error: "deliberate failure",
      iteration: state.iteration + 1,
    }),
  );

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("onIterationProgress — fires once per iteration", () => {
  it("onIterationProgress publishes one event per kernel iteration", async () => {
    const { events, layer } = makeMockEventBusLayer();

    const kernel = makeNStepKernel(4); // 4 kernel calls

    await Effect.runPromise(
      runKernel(kernel, { task: "progress count" }, {
        maxIterations: 10,
        strategy: "reactive",
        kernelType: "react",
      }).pipe(
        Effect.provide(Layer.merge(TestLLMServiceLayer(), layer)),
      ),
    );

    const progressEvents = events.filter(
      (e) => (e as Record<string, unknown>)._tag === "ReasoningIterationProgress",
    );

    // One "ReasoningIterationProgress" event per iteration (4 total)
    expect(progressEvents.length).toBe(4);
  });

  it("single-iteration kernel fires onIterationProgress exactly once", async () => {
    const { events, layer } = makeMockEventBusLayer();

    await Effect.runPromise(
      runKernel(immediateKernel, { task: "single step" }, {
        maxIterations: 10,
        strategy: "reactive",
        kernelType: "react",
      }).pipe(
        Effect.provide(Layer.merge(TestLLMServiceLayer(), layer)),
      ),
    );

    const progressEvents = events.filter(
      (e) => (e as Record<string, unknown>)._tag === "ReasoningIterationProgress",
    );

    expect(progressEvents.length).toBe(1);
  });
});

describe("onIterationProgress — iteration counter", () => {
  it("iteration field in progress events increments from 1 upwards", async () => {
    const { events, layer } = makeMockEventBusLayer();

    const kernel = makeNStepKernel(3); // 3 calls: thinking, thinking, done

    await Effect.runPromise(
      runKernel(kernel, { task: "iteration counter" }, {
        maxIterations: 10,
        strategy: "reactive",
        kernelType: "react",
      }).pipe(
        Effect.provide(Layer.merge(TestLLMServiceLayer(), layer)),
      ),
    );

    const progressEvents = events
      .filter((e) => (e as Record<string, unknown>)._tag === "ReasoningIterationProgress")
      .map((e) => (e as Record<string, unknown>).iteration as number);

    // Iterations should be 1, 2, 3 (state.iteration after each kernel call)
    expect(progressEvents.length).toBe(3);
    // Each value should be strictly greater than the previous
    for (let i = 1; i < progressEvents.length; i++) {
      expect(progressEvents[i]!).toBeGreaterThan(progressEvents[i - 1]!);
    }
    // First progress event: iteration = 1 (initial is 0, kernel increments to 1)
    expect(progressEvents[0]).toBe(1);
  });
});

describe("onDone — fires when kernel completes", () => {
  it("onDone publishes FinalAnswerProduced when status reaches done", async () => {
    const { events, layer } = makeMockEventBusLayer();

    await Effect.runPromise(
      runKernel(immediateKernel, { task: "done test" }, {
        maxIterations: 10,
        strategy: "reactive",
        kernelType: "react",
      }).pipe(
        Effect.provide(Layer.merge(TestLLMServiceLayer(), layer)),
      ),
    );

    const doneEvents = events.filter(
      (e) => (e as Record<string, unknown>)._tag === "FinalAnswerProduced",
    );

    expect(doneEvents.length).toBe(1);
    const doneEvent = doneEvents[0] as Record<string, unknown>;
    expect(doneEvent.answer).toBe("instant done");
    expect(doneEvent.strategy).toBe("reactive");
  });

  it("onDone does NOT fire when kernel reaches failed status", async () => {
    const { events, layer } = makeMockEventBusLayer();

    await Effect.runPromise(
      runKernel(immediateFailKernel, { task: "fail test" }, {
        maxIterations: 10,
        strategy: "reactive",
        kernelType: "react",
      }).pipe(
        Effect.provide(Layer.merge(TestLLMServiceLayer(), layer)),
      ),
    );

    const doneEvents = events.filter(
      (e) => (e as Record<string, unknown>)._tag === "FinalAnswerProduced",
    );

    // FinalAnswerProduced should NOT fire for a failed run
    expect(doneEvents.length).toBe(0);

    // onError publishes ReasoningFailed when the kernel fails
    const errorEvents = events.filter(
      (e) => (e as Record<string, unknown>)._tag === "ReasoningFailed",
    );
    expect(errorEvents.length).toBe(1);
    const errorEvent = errorEvents[0] as Record<string, unknown>;
    expect(typeof errorEvent.error).toBe("string");
    expect(errorEvent.strategy).toBe("reactive");
  });
});

describe("Events are published in correct order", () => {
  it("ReasoningIterationProgress events come before FinalAnswerProduced", async () => {
    const { events, layer } = makeMockEventBusLayer();

    await Effect.runPromise(
      runKernel(makeNStepKernel(2), { task: "ordering" }, {
        maxIterations: 10,
        strategy: "reactive",
        kernelType: "react",
      }).pipe(
        Effect.provide(Layer.merge(TestLLMServiceLayer(), layer)),
      ),
    );

    const tags = events.map((e) => (e as Record<string, unknown>)._tag as string);
    const firstFinalIdx = tags.indexOf("FinalAnswerProduced");
    const lastProgressIdx = tags.lastIndexOf("ReasoningIterationProgress");

    // There should be at least one progress event and one done event
    expect(firstFinalIdx).toBeGreaterThan(-1);
    expect(lastProgressIdx).toBeGreaterThan(-1);

    // All progress events must come BEFORE the FinalAnswerProduced event
    expect(lastProgressIdx).toBeLessThan(firstFinalIdx);
  });
});

describe("Hook failure does NOT abort the kernel", () => {
  it("kernel completes successfully even when EventBus publish throws", async () => {
    // The failing EventBus publish() returns Effect.fail(...).
    // publishReasoningStep() wraps with Effect.catchAll(() => Effect.void),
    // so hook errors should be silently swallowed.
    const failingLayer = makeFailingEventBusLayer();

    const result = await Effect.runPromise(
      runKernel(immediateKernel, { task: "resilience test" }, {
        maxIterations: 10,
        strategy: "reactive",
        kernelType: "react",
      }).pipe(
        Effect.provide(Layer.merge(TestLLMServiceLayer(), failingLayer)),
      ),
    );

    // Kernel should complete despite EventBus failures
    expect(result.status).toBe("done");
    expect(result.output).toBe("instant done");
  });

  it("multiple iterations complete when hooks throw on every call", async () => {
    const failingLayer = makeFailingEventBusLayer();

    const result = await Effect.runPromise(
      runKernel(makeNStepKernel(3), { task: "multi-iter resilience" }, {
        maxIterations: 10,
        strategy: "reactive",
        kernelType: "react",
      }).pipe(
        Effect.provide(Layer.merge(TestLLMServiceLayer(), failingLayer)),
      ),
    );

    expect(result.status).toBe("done");
    expect(result.iteration).toBe(3);
  });
});

describe("onStrategySwitched hook fires on strategy switch", () => {
  it("StrategySwitched event is published when loop triggers a switch", async () => {
    const { events, layer } = makeMockEventBusLayer();

    const LOOP_ACTION = JSON.stringify({ tool: "search", input: '{"q":"loop"}' });

    const switchKernel: ThoughtKernel = (state, _ctx) => {
      if (state.strategy !== "reactive") {
        return Effect.succeed(
          transitionState(state, {
            status: "done",
            output: "done after switch",
            iteration: state.iteration + 1,
          }),
        );
      }
      return Effect.succeed(
        transitionState(state, {
          status: "thinking",
          iteration: state.iteration + 1,
          steps: [...state.steps, makeStep("action", LOOP_ACTION)],
        }),
      );
    };

    await Effect.runPromise(
      runKernel(switchKernel, { task: "switch event test" }, {
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
      }).pipe(
        Effect.provide(Layer.merge(TestLLMServiceLayer(), layer)),
      ),
    );

    const switchEvents = events.filter(
      (e) => (e as Record<string, unknown>)._tag === "StrategySwitched",
    );

    // StrategySwitched should have been published once
    expect(switchEvents.length).toBe(1);

    const switchEvent = switchEvents[0] as Record<string, unknown>;
    expect(switchEvent.from).toBe("reactive");
    expect(switchEvent.to).toBe("plan-execute-reflect");
  });
});

// ─── System observation filtering ─────────────────────────────────────────────

describe("kernel-hooks — system observations do not emit ToolCallCompleted", () => {
  function makeMockBus(): { events: unknown[]; bus: EventBusInstance } {
    const events: unknown[] = [];
    const bus: EventBusInstance = {
      publish: (event: unknown) => { events.push(event); return Effect.void; },
      subscribe: () => Effect.succeed(() => {}),
      on: () => Effect.succeed(() => {}),
    } as unknown as EventBusInstance;
    return { events, bus };
  }

  it("skips ToolCallCompleted when lastStep has no toolUsed (system observation)", async () => {
    const { events, bus } = makeMockBus();
    const hooks = buildKernelHooks({ _tag: "Some", value: bus });

    // State where lastStep is a thought step — no toolUsed metadata
    const state = initialKernelState({
      taskId: "test-task",
      taskDescription: "test",
      strategy: "reactive",
      maxIterations: 10,
    });
    const stateWithThought = transitionState(state, {
      steps: [
        {
          id: "step-1",
          type: "thought" as const,
          content: "I need to do something.",
          metadata: {}, // no toolUsed
        },
      ],
    });

    await Effect.runPromise(
      hooks.onObservation(
        stateWithThought,
        "⚠️ Not done yet — complete required actions before finishing.",
        false,
      ),
    );

    const toolCallEvents = events.filter(
      (e) => (e as Record<string, unknown>)._tag === "ToolCallCompleted",
    );
    expect(toolCallEvents).toHaveLength(0);
  });

  it("emits ToolCallCompleted with correct toolName when lastStep has toolUsed", async () => {
    const { events, bus } = makeMockBus();
    const hooks = buildKernelHooks({ _tag: "Some", value: bus });

    const state = initialKernelState({
      taskId: "test-task",
      taskDescription: "test",
      strategy: "reactive",
      maxIterations: 10,
    });
    const stateWithAction = transitionState(state, {
      steps: [
        {
          id: "action-1",
          type: "action" as const,
          content: "web-search({query: 'test'})",
          metadata: { toolUsed: "web-search", duration: 312 },
        },
      ],
    });

    await Effect.runPromise(
      hooks.onObservation(stateWithAction, "Search returned 10 results.", true),
    );

    const toolCallEvents = events.filter(
      (e) => (e as Record<string, unknown>)._tag === "ToolCallCompleted",
    );
    expect(toolCallEvents).toHaveLength(1);

    const ev = toolCallEvents[0] as Record<string, unknown>;
    expect(ev.toolName).toBe("web-search");
    expect(ev.durationMs).toBe(312);
    expect(ev.success).toBe(true);
  });

  it("emits ReasoningStepCompleted for system observations even when ToolCallCompleted is skipped", async () => {
    const { events, bus } = makeMockBus();
    const hooks = buildKernelHooks({ _tag: "Some", value: bus });

    const state = initialKernelState({
      taskId: "test-task",
      taskDescription: "test",
      strategy: "reactive",
      maxIterations: 10,
    });

    await Effect.runPromise(
      hooks.onObservation(state, "System redirect message.", false),
    );

    const reasoningEvents = events.filter(
      (e) => (e as Record<string, unknown>)._tag === "ReasoningStepCompleted",
    );
    // ReasoningStepCompleted still fires — observability not lost
    expect(reasoningEvents.length).toBeGreaterThanOrEqual(1);
  });
});
