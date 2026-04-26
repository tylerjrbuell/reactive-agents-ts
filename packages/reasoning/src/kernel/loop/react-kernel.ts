/**
 * ReAct Kernel — the shared execution primitive for all reasoning strategies.
 *
 * Implements: Think -> Parse Action -> Execute Tool -> Observe -> Repeat
 *
 * This kernel is what makes every strategy "tool-aware". Strategies define
 * their outer control loop (how many kernel calls, when to retry, how to
 * assess quality). The kernel handles all tool interaction.
 *
 * Exports:
 *   - `reactKernel: ThoughtKernel` — single-step transition function
 *   - `executeReActKernel(input)` — backwards-compatible wrapper using `runKernel(reactKernel, ...)`
 *   - `ReActKernelInput` / `ReActKernelResult` — preserved types for all consumers
 */
import { Effect } from "effect";
import type { ReasoningStep } from "../../types/index.js";
import { ExecutionError } from "../../errors/errors.js";
import { LLMService } from "@reactive-agents/llm-provider";
import {
  detectCompletionGaps,
  type FinalAnswerCapture,
} from "@reactive-agents/tools";

// Re-export for test and consumer backward compatibility
export { detectCompletionGaps } from "@reactive-agents/tools";

import { runKernel } from "./runner.js";
import {
  type KernelState,
  type KernelContext,
  type KernelInput,
  type ThoughtKernel,
  type Phase,
} from "../../kernel/state/kernel-state.js";
import { handleThinking } from "../../strategies/kernel/phases/think.js";
import { handleActing } from "../../strategies/kernel/phases/act.js";

// ── Public input / output types ──────────────────────────────────────────────

// Defined in kernel-state to avoid circular imports; re-exported here for backward compatibility
import type { ReActKernelInput, ReActKernelResult } from "../../kernel/state/kernel-state.js";
export type { ReActKernelInput, ReActKernelResult };
import { resolveExecutableToolCapabilities } from "../../strategies/kernel/utils/tool-capabilities.js";

// ── makeKernel / reactKernel ─────────────────────────────────────────────────

/**
 * Creates a ReAct kernel with a configurable phase pipeline.
 *
 * The default pipeline is [handleThinking, handleActing].
 * Strategies and custom kernels may substitute individual phases:
 *
 * @example
 * // Standard kernel (default)
 * const kernel = makeKernel();
 *
 * // Custom kernel with a different thinking phase
 * const kernel = makeKernel({ phases: [myThinkPhase, handleActing] });
 *
 * // Test kernel with a mock thinking phase
 * const kernel = makeKernel({ phases: [mockThink, handleActing] });
 */
export function makeKernel(options?: { phases?: Phase[] }): ThoughtKernel {
  const [thinkPhase, actPhase] = options?.phases ?? [handleThinking, handleActing];
  return (
    state: KernelState,
    context: KernelContext,
  ): Effect.Effect<KernelState, never, LLMService> => {
    if (state.status === "thinking") return thinkPhase!(state, context);
    if (state.status === "acting") return actPhase!(state, context);
    // Any other status (done/failed) is terminal — return state unchanged
    return Effect.succeed(state);
  };
}

/**
 * The standard ReAct ThoughtKernel — a single-step transition function built
 * from the default [handleThinking, handleActing] pipeline.
 *
 * Reads `state.status` to decide what to do:
 * - "thinking": Build context, call LLM, parse response → "acting" or "done"
 * - "acting":   Execute tool from meta.pendingNativeToolCalls → "thinking" or "done"
 */
export const reactKernel: ThoughtKernel = makeKernel();

// ── Backwards-compatible wrapper ─────────────────────────────────────────────

/**
 * Execute the ReAct Think->Act->Observe loop.
 *
 * Works with or without ToolService in context.
 * When ToolService is absent every iteration is pure thought (tool calls
 * produce a "not available" observation rather than real results).
 *
 * This is a backwards-compatible wrapper around `runKernel(reactKernel, ...)`.
 */
export const executeReActKernel = (
  input: ReActKernelInput,
): Effect.Effect<ReActKernelResult, ExecutionError, LLMService> =>
  Effect.gen(function* () {
    const capabilitySnapshot = yield* resolveExecutableToolCapabilities({
      availableToolSchemas: input.availableToolSchemas,
      allToolSchemas: input.allToolSchemas,
      metaTools: input.metaTools,
    });

    // Native FC detection is handled by runKernel (kernel-runner.ts) —
    // it auto-detects provider capabilities and injects the FC flag + resolver.
    // No need to duplicate that logic here.

    const state = yield* runKernel(reactKernel, {
      task: input.task,
      systemPrompt: input.systemPrompt,
      availableToolSchemas: capabilitySnapshot.availableToolSchemas,
      allToolSchemas: capabilitySnapshot.allToolSchemas,
      priorContext: input.priorContext,
      contextProfile: input.contextProfile,
      resultCompression: input.resultCompression,
      temperature: input.temperature,
      agentId: input.agentId,
      sessionId: input.sessionId,
      blockedTools: input.blockedTools,
      requiredTools: input.requiredTools,
      maxRequiredToolRetries: input.maxRequiredToolRetries,
      strictToolDependencyChain: input.strictToolDependencyChain,
      metaTools: input.metaTools,
      synthesisConfig: input.synthesisConfig,
      ...(input.toolCallResolver ? { toolCallResolver: input.toolCallResolver } : {}),
    } as KernelInput, {
      maxIterations: input.maxIterations ?? 10,
      strategy: input.parentStrategy ?? "react-kernel",
      kernelType: "react",
      taskId: input.taskId,
      kernelPass: input.kernelPass,
      modelId: input.modelId,
      taskDescription: input.task,
      temperature: input.temperature,
      exitOnAllToolsCalled: input.exitOnAllToolsCalled,
    });

    // Determine terminatedBy from state — map oracle reasons to canonical types
    const rawTerminatedBy = state.meta.terminatedBy as string | undefined;
    const terminatedBy:
      | "final_answer"
      | "final_answer_tool"
      | "max_iterations"
      | "end_turn"
      | "llm_error" =
      rawTerminatedBy === "llm_error"
        ? "llm_error"
        : rawTerminatedBy === "final_answer_tool"
          ? "final_answer_tool"
          : rawTerminatedBy === "end_turn" || rawTerminatedBy === "llm_end_turn"
            ? "end_turn"
            : rawTerminatedBy === "final_answer_regex"
              ? "final_answer"
              : state.status === "done"
                ? "final_answer"
                : "max_iterations";

    // When failed, surface kernel error; else output / last thought
    const output =
      state.status === "failed" && state.error
        ? state.error
        : state.output
          ?? [...state.steps].filter((s) => s.type === "thought").pop()?.content
          ?? "";

    return {
      output,
      steps: [...state.steps] as ReasoningStep[],
      totalTokens: state.tokens,
      totalCost: state.cost,
      toolsUsed: [...state.toolsUsed],
      iterations: state.iteration,
      terminatedBy,
      finalAnswerCapture: state.meta.finalAnswerCapture as FinalAnswerCapture | undefined,
      llmCalls: state.llmCalls ?? 0,
    };
  });

