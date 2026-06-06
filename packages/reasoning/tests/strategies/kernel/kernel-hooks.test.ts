import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { buildKernelHooks } from "../../../src/kernel/state/kernel-hooks.js";
import {
  initialKernelState,
  transitionState,
  type MaybeService,
  type EventBusInstance,
  type KernelState,
} from "../../../src/kernel/state/kernel-state.js";
import type { StepId } from "../../../src/types/step.js";

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

function baseState(): KernelState {
  return initialKernelState({
    maxIterations: 10,
    strategy: "test",
    kernelType: "react",
    taskId: "task-1",
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("buildKernelHooks", () => {
  // ── EventBus None ────────────────────────────────────────────────────────

  describe("with EventBus None", () => {
    const noneEB: MaybeService<EventBusInstance> = { _tag: "None" };
    const hooks = buildKernelHooks(noneEB);

    it("onThought returns without error", async () => {
      await Effect.runPromise(hooks.onThought(baseState(), "thinking hard"));
    });

    it("onAction returns without error", async () => {
      await Effect.runPromise(hooks.onAction(baseState(), "web-search", '{"query":"test"}'));
    });

    it("onObservation returns without error", async () => {
      await Effect.runPromise(hooks.onObservation(baseState(), "search results here", true));
    });

    it("onDone returns without error", async () => {
      await Effect.runPromise(hooks.onDone(baseState()));
    });

    it("onError returns without error", async () => {
      await Effect.runPromise(hooks.onError(baseState(), "something went wrong"));
    });
  });

  // ── EventBus Some ────────────────────────────────────────────────────────

  describe("with mock EventBus", () => {
    it("onThought publishes ReasoningStepCompleted with thought field", async () => {
      const { events, eb } = makeMockEventBus();
      const hooks = buildKernelHooks(eb);
      const state = baseState();

      await Effect.runPromise(hooks.onThought(state, "I should search the web"));

      expect(events).toHaveLength(1);
      const event = events[0] as Record<string, unknown>;
      expect(event._tag).toBe("ReasoningStepCompleted");
      expect(event.taskId).toBe("task-1");
      expect(event.strategy).toBe("test");
      expect(event.thought).toBe("I should search the web");
      expect(event.step).toBe(1); // steps.length (0) + 1
      expect(event.totalSteps).toBe(0);
      expect(event.kernelPass).toBe("test:main");
    });

    it("onThought uses meta.kernelPass when set", async () => {
      const { events, eb } = makeMockEventBus();
      const hooks = buildKernelHooks(eb);
      const state = transitionState(baseState(), {
        meta: { kernelPass: "reflexion:trial-2" },
      });

      await Effect.runPromise(hooks.onThought(state, "reflective thought"));

      const event = events[0] as Record<string, unknown>;
      expect(event.kernelPass).toBe("reflexion:trial-2");
    });

    it("onAction publishes ReasoningStepCompleted with action field", async () => {
      const { events, eb } = makeMockEventBus();
      const hooks = buildKernelHooks(eb);
      const state = baseState();

      await Effect.runPromise(hooks.onAction(state, "web-search", '{"query":"effect-ts"}'));

      expect(events).toHaveLength(1);
      const event = events[0] as Record<string, unknown>;
      expect(event._tag).toBe("ReasoningStepCompleted");
      expect(event.taskId).toBe("task-1");
      expect(event.strategy).toBe("test");
      expect(event.action).toBe(JSON.stringify({ tool: "web-search", input: '{"query":"effect-ts"}' }));
      expect(event.kernelPass).toBe("test:main");
    });

    it("onAction also publishes ToolCallStarted (with rationale) when callId given", async () => {
      const { events, eb } = makeMockEventBus();
      const hooks = buildKernelHooks(eb);
      const state = baseState();
      const rationale = { why: "need fresh price data", confidence: 0.85 } as const;

      await Effect.runPromise(
        hooks.onAction(state, "web-search", '{"query":"effect-ts"}', {
          callId: "tc-42",
          rationale,
        }),
      );

      // Both events fire: ReasoningStepCompleted (existing) + ToolCallStarted (new).
      // Without ToolCallStarted, kernel-driven strategies (reactive/adaptive)
      // silently drop tool-selection rationale from debrief.rationale[].
      expect(events).toHaveLength(2);
      const tcs = events.find((e) => (e as { _tag: string })._tag === "ToolCallStarted") as Record<string, unknown> | undefined;
      expect(tcs).toBeDefined();
      expect(tcs!.taskId).toBe("task-1");
      expect(tcs!.toolName).toBe("web-search");
      expect(tcs!.callId).toBe("tc-42");
      expect(tcs!.rationale).toEqual(rationale);
    });

    it("onAction without callId does NOT emit ToolCallStarted (back-compat)", async () => {
      const { events, eb } = makeMockEventBus();
      const hooks = buildKernelHooks(eb);
      const state = baseState();

      await Effect.runPromise(hooks.onAction(state, "web-search", '{"query":"x"}'));

      expect(events).toHaveLength(1);
      expect((events[0] as { _tag: string })._tag).toBe("ReasoningStepCompleted");
    });

    it("onObservation publishes ReasoningStepCompleted AND ToolCallCompleted", async () => {
      const { events, eb } = makeMockEventBus();
      const hooks = buildKernelHooks(eb);

      // Add an action step with toolUsed metadata (set by react-kernel handleActing)
      const state = transitionState(baseState(), {
        steps: [
          {
            id: "step-001" as StepId,
            type: "action" as const,
            content: JSON.stringify({ tool: "web-search", input: '{"query":"test"}' }),
            timestamp: new Date(),
            metadata: { toolUsed: "web-search", duration: 150 },
          },
        ],
      });

      await Effect.runPromise(hooks.onObservation(state, "Found 3 results", true));

      expect(events).toHaveLength(2);

      const reasoningEvent = events[0] as Record<string, unknown>;
      expect(reasoningEvent._tag).toBe("ReasoningStepCompleted");
      expect(reasoningEvent.observation).toBe("Found 3 results");
      expect(reasoningEvent.taskId).toBe("task-1");
      expect(reasoningEvent.step).toBe(2); // steps has 1 action, so +1 = 2

      const toolEvent = events[1] as Record<string, unknown>;
      expect(toolEvent._tag).toBe("ToolCallCompleted");
      expect(toolEvent.toolName).toBe("web-search");
      expect(toolEvent.callId).toBe("step-001");
      expect(toolEvent.durationMs).toBe(150);
      expect(toolEvent.success).toBe(true);
    });

    it("onObservation extracts toolName from last step content", async () => {
      const { events, eb } = makeMockEventBus();
      const hooks = buildKernelHooks(eb);

      const state = transitionState(baseState(), {
        steps: [
          {
            id: "step-002" as StepId,
            type: "action" as const,
            content: JSON.stringify({ tool: "file-write", input: '{"path":"out.txt"}' }),
            timestamp: new Date(),
            metadata: { toolUsed: "file-write" },
          },
        ],
      });

      await Effect.runPromise(hooks.onObservation(state, "Written successfully", true));

      const toolEvent = events[1] as Record<string, unknown>;
      expect(toolEvent.toolName).toBe("file-write");
      expect(toolEvent.durationMs).toBe(0); // no duration metadata
    });

    it("onObservation publishes ToolCallCompleted with success: false for failed tools", async () => {
      const { events, eb } = makeMockEventBus();
      const hooks = buildKernelHooks(eb);

      const state = transitionState(baseState(), {
        steps: [
          {
            id: "step-003" as StepId,
            type: "action" as const,
            content: JSON.stringify({ tool: "draft-writer", input: '{"title":"test"}' }),
            timestamp: new Date(),
            metadata: { toolUsed: "draft-writer", duration: 100 },
          },
        ],
      });

      await Effect.runPromise(hooks.onObservation(state, "[Tool error: Missing required parameter \"type\"]", false));

      expect(events).toHaveLength(2);

      const reasoningEvent = events[0] as Record<string, unknown>;
      expect(reasoningEvent._tag).toBe("ReasoningStepCompleted");
      expect(reasoningEvent.observation).toBe("[Tool error: Missing required parameter \"type\"]");

      const toolEvent = events[1] as Record<string, unknown>;
      expect(toolEvent._tag).toBe("ToolCallCompleted");
      expect(toolEvent.toolName).toBe("draft-writer");
      expect(toolEvent.callId).toBe("step-003");
      expect(toolEvent.durationMs).toBe(100);
      expect(toolEvent.success).toBe(false); // ✅ Now correctly reflects failure
    });

    it("onObservation handles empty steps gracefully — no ToolCallCompleted for system observations", async () => {
      const { events, eb } = makeMockEventBus();
      const hooks = buildKernelHooks(eb);

      // No steps — system observation: only ReasoningStepCompleted fires,
      // no ToolCallCompleted (avoids "unknown" tool name in metrics).
      await Effect.runPromise(hooks.onObservation(baseState(), "orphan observation", false));

      expect(events).toHaveLength(1);
      const stepEvent = events[0] as Record<string, unknown>;
      expect(stepEvent._tag).toBe("ReasoningStepCompleted");
      expect(stepEvent.observation).toBe("orphan observation");
    });

    it("onDone publishes FinalAnswerProduced", async () => {
      const { events, eb } = makeMockEventBus();
      const hooks = buildKernelHooks(eb);
      const state = transitionState(baseState(), {
        output: "The answer is 42",
        iteration: 3,
        tokens: 1500,
      });

      await Effect.runPromise(hooks.onDone(state));

      expect(events).toHaveLength(1);
      const event = events[0] as Record<string, unknown>;
      expect(event._tag).toBe("FinalAnswerProduced");
      expect(event.answer).toBe("The answer is 42");
      expect(event.iteration).toBe(3);
      expect(event.totalTokens).toBe(1500);
      expect(event.taskId).toBe("task-1");
      expect(event.strategy).toBe("test");
    });

    it("onDone defaults answer to empty string when output is null", async () => {
      const { events, eb } = makeMockEventBus();
      const hooks = buildKernelHooks(eb);
      const state = baseState(); // output is null

      await Effect.runPromise(hooks.onDone(state));

      const event = events[0] as Record<string, unknown>;
      expect(event.answer).toBe("");
    });

    it("onError publishes ReasoningFailed event", async () => {
      const { events, eb } = makeMockEventBus();
      const hooks = buildKernelHooks(eb);

      await Effect.runPromise(hooks.onError(baseState(), "something broke"));

      expect(events).toHaveLength(1);
      const event = events[0] as Record<string, unknown>;
      expect(event._tag).toBe("ReasoningFailed");
      expect(event.error).toBe("something broke");
      expect(event.strategy).toBe("test");
    });

    // ── onIterationProgress + ContextPressure ──────────────────────────────
    // The kernel path must emit ContextPressure (Cortex's context-window gauge
    // denominator) — without it the gauge falls back to "no ctx window data".

    it("onIterationProgress emits ReasoningIterationProgress only when no context tokens recorded", async () => {
      const { events, eb } = makeMockEventBus();
      const hooks = buildKernelHooks(eb);
      // Fresh state: meta has no lastContextTokens/lastContextWindow yet.
      await Effect.runPromise(hooks.onIterationProgress(baseState(), ["calculator"]));
      expect(events).toHaveLength(1);
      expect((events[0] as Record<string, unknown>)._tag).toBe("ReasoningIterationProgress");
    });

    it("onIterationProgress also emits ContextPressure once context tokens + window are known", async () => {
      const { events, eb } = makeMockEventBus();
      const hooks = buildKernelHooks(eb);
      const state = transitionState(baseState(), {
        meta: { ...baseState().meta, lastContextTokens: 2304, lastContextWindow: 32_768 },
      });

      await Effect.runPromise(hooks.onIterationProgress(state, ["calculator"]));

      expect(events).toHaveLength(2);
      const cp = events.find(
        (e) => (e as Record<string, unknown>)._tag === "ContextPressure",
      ) as Record<string, unknown> | undefined;
      expect(cp).toBeDefined();
      expect(cp!.taskId).toBe("task-1");
      expect(cp!.tokensUsed).toBe(2304);
      expect(cp!.tokensAvailable).toBe(30_464); // 32768 - 2304
      expect(cp!.utilizationPct).toBeCloseTo(7.03, 1);
      expect(cp!.level).toBe("low");
    });

    it("ContextPressure level escalates with utilization", async () => {
      const { events, eb } = makeMockEventBus();
      const hooks = buildKernelHooks(eb);
      const state = transitionState(baseState(), {
        meta: { ...baseState().meta, lastContextTokens: 7800, lastContextWindow: 8192 },
      });
      await Effect.runPromise(hooks.onIterationProgress(state, []));
      const cp = events.find(
        (e) => (e as Record<string, unknown>)._tag === "ContextPressure",
      ) as Record<string, unknown>;
      expect(cp.level).toBe("critical"); // ~95%
    });
  });
});
