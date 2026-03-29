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
import type { AgentEvent } from "@reactive-agents/core";
import type { LLMMessage } from "@reactive-agents/llm-provider";
import type { KernelHooks, KernelState, EventBusInstance, MaybeService } from "./kernel-state.js";
import type { SynthesizedContext } from "../../context/synthesis-types.js";
import { publishReasoningStep } from "./service-utils.js";

function llmMessageToSynthesisPayload(m: LLMMessage): { readonly role: string; readonly content: string | null } {
  const role = m.role;
  const c = m.content;
  if (typeof c === "string") return { role, content: c };
  if (c == null) return { role, content: null };
  if (Array.isArray(c)) {
    const text = c
      .map((block) => ("text" in block ? String((block as { text?: string }).text ?? "") : ""))
      .join("")
      .trim();
    return { role, content: text.length > 0 ? text : null };
  }
  return { role, content: null };
}

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
    onThought: (state: KernelState, thought: string, prompt?: { system: string; user: string; messages?: readonly { readonly role: string; readonly content: string }[]; rawResponse?: string }): Effect.Effect<void, never> =>
      publishReasoningStep(eventBus, {
        _tag: "ReasoningStepCompleted",
        taskId: state.taskId,
        strategy: state.strategy,
        step: state.steps.length + 1,
        totalSteps: 0,
        thought,
        kernelPass: getKernelPass(state),
        ...(prompt ? {
          prompt: { system: prompt.system, user: prompt.user },
          ...(prompt.messages ? { messages: prompt.messages } : {}),
          ...(prompt.rawResponse !== undefined ? { rawResponse: prompt.rawResponse } : {}),
        } : {}),
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

    onError: (state: KernelState, error: string): Effect.Effect<void, never> =>
      publishReasoningStep(eventBus, {
        _tag: "ReasoningFailed",
        taskId: state.taskId,
        strategy: state.strategy,
        error,
        iteration: state.iteration,
      }),

    onIterationProgress: (state: KernelState, toolsThisStep: readonly string[]): Effect.Effect<void, never> =>
      publishReasoningStep(eventBus, {
        _tag: "ReasoningIterationProgress",
        taskId: state.taskId,
        iteration: state.iteration,
        maxIterations: (state.meta.maxIterations as number | undefined) ?? 10,
        strategy: state.strategy,
        toolsThisStep,
      }),

    onStrategySwitched: (state: KernelState, from: string, to: string, reason: string): Effect.Effect<void, never> =>
      publishReasoningStep(eventBus, {
        _tag: "StrategySwitched",
        taskId: state.taskId,
        from,
        to,
        reason,
        timestamp: Date.now(),
      }),

    onStrategySwitchEvaluated: (state: KernelState, evaluation: { shouldSwitch: boolean; recommendedStrategy: string; reasoning: string }): Effect.Effect<void, never> =>
      publishReasoningStep(eventBus, {
        _tag: "StrategySwitchEvaluated",
        taskId: state.taskId,
        shouldSwitch: evaluation.shouldSwitch,
        recommendedStrategy: evaluation.recommendedStrategy,
        reasoning: evaluation.reasoning,
        timestamp: Date.now(),
      }),

    onContextSynthesized: (
      synthesized: SynthesizedContext,
      taskId: string,
      agentId: string,
    ): Effect.Effect<void, never> =>
      eventBus._tag === "Some"
        ? eventBus.value
            .publish({
              _tag: "ContextSynthesized",
              taskId,
              agentId,
              iteration: synthesized.signalsSnapshot.iteration,
              synthesisPath: synthesized.synthesisPath,
              synthesisReason: synthesized.synthesisReason,
              taskPhase: synthesized.taskPhase,
              estimatedTokens: synthesized.estimatedTokens,
              messages: synthesized.messages.map(llmMessageToSynthesisPayload),
              signalsSnapshot: {
                entropy: synthesized.signalsSnapshot.entropy,
                trajectoryShape: synthesized.signalsSnapshot.trajectoryShape,
                tier: synthesized.signalsSnapshot.tier,
                requiredTools: synthesized.signalsSnapshot.requiredTools,
                toolsUsed: synthesized.signalsSnapshot.toolsUsed,
                iteration: synthesized.signalsSnapshot.iteration,
                lastErrors: synthesized.signalsSnapshot.lastErrors,
              },
            } as AgentEvent)
            .pipe(Effect.catchAll(() => Effect.void))
        : Effect.void,
  };
}
