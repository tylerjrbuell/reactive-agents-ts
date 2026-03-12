/**
 * shared/kernel-hooks.ts — Centralized EventBus wiring for all kernels.
 *
 * Replaces the ~20 scattered `if (eb._tag === "Some") { yield* eb.value.publish(...) }`
 * calls across strategy files with a single `buildKernelHooks()` factory that returns
 * a KernelHooks instance wired to the EventBus via `publishReasoningStep`.
 *
 * This is the **single source of truth** for kernel lifecycle events — every kernel
 * uses these hooks instead of publishing events directly. This prevents double-counting
 * in MetricsCollector and ensures consistent event shapes across all strategies.
 */
import { Effect } from "effect";
import type { KernelHooks, KernelState, EventBusInstance, MaybeService } from "./kernel-state.js";
import { publishReasoningStep } from "./service-utils.js";

/** Extract kernelPass from state meta with fallback to strategy:main. */
function getKernelPass(state: KernelState): string {
  return (state.meta.kernelPass as string | undefined) ?? `${state.strategy}:main`;
}

/**
 * Build KernelHooks wired to an EventBus instance (or no-op if EventBus is None).
 *
 * Each hook publishes the appropriate event(s) via `publishReasoningStep`, which
 * handles the None case internally and swallows publish errors.
 */
export function buildKernelHooks(eventBus: MaybeService<EventBusInstance>): KernelHooks {
  return {
    onThought: (state: KernelState, thought: string): Effect.Effect<void, never> =>
      publishReasoningStep(eventBus, {
        _tag: "ReasoningStepCompleted",
        taskId: state.taskId,
        strategy: state.strategy,
        step: state.steps.length + 1,
        totalSteps: 0,
        thought,
        kernelPass: getKernelPass(state),
      }),

    onAction: (state: KernelState, tool: string, input: string): Effect.Effect<void, never> =>
      publishReasoningStep(eventBus, {
        _tag: "ReasoningStepCompleted",
        taskId: state.taskId,
        strategy: state.strategy,
        step: state.steps.length + 1,
        totalSteps: 0,
        action: JSON.stringify({ tool, input }),
        kernelPass: getKernelPass(state),
      }),

    onObservation: (state: KernelState, result: string, success: boolean): Effect.Effect<void, never> => {
      const lastStep = state.steps[state.steps.length - 1];
      return Effect.all([
        publishReasoningStep(eventBus, {
          _tag: "ReasoningStepCompleted",
          taskId: state.taskId,
          strategy: state.strategy,
          step: state.steps.length + 1,
          totalSteps: 0,
          observation: result,
          kernelPass: getKernelPass(state),
        }),
        publishReasoningStep(eventBus, {
          _tag: "ToolCallCompleted",
          taskId: state.taskId,
          toolName: (lastStep?.metadata?.toolUsed as string) ?? "unknown",
          callId: lastStep?.id ?? "unknown",
          durationMs: (lastStep?.metadata?.duration as number | undefined) ?? 0,
          success,
          kernelPass: getKernelPass(state),
        }),
      ]).pipe(Effect.asVoid);
    },

    onDone: (state: KernelState): Effect.Effect<void, never> =>
      publishReasoningStep(eventBus, {
        _tag: "FinalAnswerProduced",
        taskId: state.taskId,
        strategy: state.strategy,
        answer: state.output ?? "",
        iteration: state.iteration,
        totalTokens: state.tokens,
        kernelPass: getKernelPass(state),
      }),

    onError: (_state: KernelState, _error: string): Effect.Effect<void, never> => Effect.void,

    onIterationProgress: (_state: KernelState, _toolsThisStep: readonly string[]): Effect.Effect<void, never> => Effect.void,

    onStrategySwitched: (_state: KernelState, _from: string, _to: string, _reason: string): Effect.Effect<void, never> => Effect.void,
  };
}
