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
import { publishReasoningStep } from "../../kernel/utils/service-utils.js";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";

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
      Effect.gen(function* () {
        yield* publishReasoningStep(eventBus, {
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
        });
        // ContextPressure is NOT emitted here anymore — it now rides the
        // observable-llm chokepoint (makeObservableLLM → emitContextPressure),
        // the single layer ALL strategy paths flow through. Per-strategy hooks
        // can't reach eventBus-less plan-execute/reflexion sub-kernels, so this
        // emission was non-uniform; the chokepoint is. See
        // wiki/Planning/Implementation-Plans/2026-06-06-uniform-contextpressure-chokepoint.md
      }),

    onAction: (
      state: KernelState,
      tool: string,
      input: string,
      opts?: {
        readonly callId?: string;
        readonly rationale?: import("@reactive-agents/core").Rationale;
      },
    ): Effect.Effect<void, never> => {
      const effects: Effect.Effect<void, never>[] = [
        publishReasoningStep(eventBus, {
          _tag: "ReasoningStepCompleted",
          taskId: state.taskId,
          strategy: state.strategy,
          step: state.steps.length + 1,
          totalSteps: 0,
          action: JSON.stringify({ tool, input }),
          kernelPass: getKernelPass(state),
        }),
      ];
      // Symmetric to `ToolCallCompleted` emitted at onObservation. Without
      // this `ToolCallStarted` emission the kernel-driven strategies
      // (reactive / adaptive) silently drop tool-selection rationale —
      // execution-engine's debrief subscriber only sees the event from
      // plan-execute + runtime inline-act, so `debrief.rationale[]` lacks
      // all tool entries on reactive runs.
      if (opts?.callId) {
        effects.push(
          publishReasoningStep(eventBus, {
            _tag: "ToolCallStarted",
            taskId: state.taskId,
            toolName: tool,
            callId: opts.callId,
            iteration: state.iteration,
            ...(opts.rationale ? { rationale: opts.rationale } : {}),
          }),
        );
      }
      return Effect.all(effects).pipe(Effect.asVoid);
    },

    onObservation: (state: KernelState, result: string, success: boolean): Effect.Effect<void, never> => {
      const lastStep = state.steps[state.steps.length - 1];
      // Only the action step carries toolUsed — system-injected observations
      // (completion-guard redirects, nudges) have no preceding action step and
      // must not emit a ToolCallCompleted event or they show as "unknown" in metrics.
      const resolvedToolName = lastStep?.metadata?.toolUsed as string | undefined;
      // Replay parity: the recorded ToolCallCompleted must carry the SAME args
      // the model produced, or the replay diff hashes `undefined` against the
      // real arguments and every tool-using golden reads as divergent. Args are
      // model-generated (already paid for in context), so no truncation here —
      // trace size is governed by the retention caps, not per-field clipping.
      const resolvedArgs = (lastStep?.metadata?.toolCall as { arguments?: unknown } | undefined)
        ?.arguments;
      const effects: Effect.Effect<void, never>[] = [
        publishReasoningStep(eventBus, {
          _tag: "ReasoningStepCompleted",
          taskId: state.taskId,
          strategy: state.strategy,
          step: state.steps.length + 1,
          totalSteps: 0,
          observation: result,
          kernelPass: getKernelPass(state),
        }),
      ];
      if (resolvedToolName) {
        effects.push(
          publishReasoningStep(eventBus, {
            _tag: "ToolCallCompleted",
            taskId: state.taskId,
            toolName: resolvedToolName,
            callId: lastStep?.id ?? "",
            durationMs: (lastStep?.metadata?.duration as number | undefined) ?? 0,
            success,
            kernelPass: getKernelPass(state),
            ...(resolvedArgs !== undefined ? { args: resolvedArgs } : {}),
            ...(success ? { result } : { error: result }),
          }),
        );
      } else {
        // System-injected observation (e.g. completion-guard redirect, gate block).
        // No ToolCallCompleted emitted — kept out of metrics — but logged at debug
        // so it remains visible during troubleshooting.
        effects.push(
          Effect.logDebug("[kernel-hooks] system observation — no ToolCallCompleted emitted", {
            taskId: state.taskId,
            lastStepType: lastStep?.type ?? "none",
            lastStepId: lastStep?.id ?? "none",
            kernelPass: getKernelPass(state),
            observationSnippet: result.slice(0, 120),
          }),
        );
      }
      return Effect.all(effects).pipe(Effect.asVoid);
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
            .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/kernel/state/kernel-hooks.ts:197", tag: errorTag(err) })))
        : Effect.void,
  };
}
