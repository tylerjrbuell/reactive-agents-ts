// File: src/strategies/direct.ts
//
// Single-shot LLM call with optional one-iteration tool dispatch. Used for
// chat / streaming / no-reasoning fallback. Replaces the dual "inline LLM-call"
// path that was duplicated inside the engine agent-loop pre-W23 (see
// wiki/Architecture/Design-Specs/2026-05-07-agent-loop-architecture-exploration.md
// §8.1 for the unification rationale).
//
// Implementation: thin wrapper around runKernel(reactKernel, ...) with
// maxIterations capped at 1 (or whatever the caller specifies). The kernel
// handles all the standard concerns — tool dispatch, observation building,
// streaming callbacks, hook firing — but the iteration cap forces a single
// turn, matching chat/streaming UX.
//
// For multi-iteration agent behavior (the typical case), use `reactive` or
// `adaptive` strategies. `direct` is intentionally minimal.
import { Effect } from "effect";
import type { ReasoningResult } from "../types/index.js";
import { ExecutionError, IterationLimitError } from "../errors/errors.js";
import { fenceRecalledMemory } from "./memory-fence.js";
import type { ReasoningConfig } from "../types/config.js";
import { LLMService } from "@reactive-agents/llm-provider";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import type { ContextProfile } from "../context/context-profile.js";
import type { ToolSchema } from "../kernel/capabilities/attend/tool-formatting.js";
import { runKernel } from "../kernel/loop/runner.js";
import { reactKernel } from "../kernel/loop/react-kernel.js";
import { buildStrategyResult } from "../kernel/capabilities/sense/step-utils.js";
import type { KernelInput, KernelMessage } from "../kernel/state/kernel-state.js";
import { resolveCompletionStatus } from "../kernel/state/completion-status.js";
import { resolveExecutableToolCapabilities } from "../kernel/capabilities/act/tool-capabilities.js";
import { makeStrategyEmitLog, emitPhaseEnd } from "../kernel/utils/service-utils.js";

// ── DirectInput ───────────────────────────────────────────────────────────────

export interface DirectInput {
  readonly taskDescription: string;
  readonly taskType: string;
  readonly memoryContext: string;
  /** Tool schemas (optional — direct strategy can call tools but typically
   *  used for chat where tools are absent or minimal). */
  readonly availableToolSchemas?: readonly ToolSchema[];
  readonly availableTools: readonly string[];
  readonly config: ReasoningConfig;
  readonly contextProfile?: Partial<ContextProfile>;
  readonly providerName?: string;
  readonly systemPrompt?: string;
  readonly taskId?: string;
  readonly resultCompression?: ResultCompressionConfig;
  readonly agentId?: string;
  readonly sessionId?: string;
  /** Cap on iterations. Defaults to 1 (true single-turn). Cortex chat /
   *  streaming use cases typically want 1; some "single LLM round + tool
   *  dispatch + final response" UX wants 2. Maximum 3 — anything more should
   *  use reactive strategy. */
  readonly maxIterations?: 1 | 2 | 3;
  readonly initialMessages?: readonly KernelMessage[];
  readonly modelId?: string;
  readonly taskCategory?: string;
  readonly temperature?: number;
  readonly environmentContext?: Readonly<Record<string, string>>;
  /** Pre-resolved model calibration — drives steering channel selection,
   *  Layer 1 builder length pruning, oracle nudge aggression. Critical for
   *  small-model sub-agents per architecture exploration §10. */
  readonly calibration?: import("@reactive-agents/llm-provider").ModelCalibration;
  readonly harnessPipeline?: import("@reactive-agents/core").HarnessPipeline;
  /** Budget limits (HS-128 / Audit G-A). Threaded to KernelInput.budgetLimits. */
  readonly budgetLimits?: import("../kernel/capabilities/decide/arbitrator.js").BudgetLimits;
}

// ── executeDirect ─────────────────────────────────────────────────────────────

/**
 * Direct strategy — single-shot LLM call (or 1-3 capped iterations) via the
 * shared kernel runner. Replaces the inline LLM-call path that was duplicated
 * inside the engine agent-loop.
 *
 * Behavior:
 * - Builds a minimal `KernelInput` with no advanced features (no synthesis,
 *   no observation summary, no required-tool gate, no strategy switching).
 * - Delegates to `runKernel(reactKernel, ...)` with `maxIterations` capped
 *   at 1 by default.
 * - Returns a `ReasoningResult` with `strategy: "direct"`.
 *
 * When to use:
 * - Cortex chat / runStream — one user message → one assistant response
 * - No-reasoning fallback — basic LLM call without harness orchestration
 * - Small-model sub-agents that need a tight single-turn loop
 *
 * When NOT to use:
 * - Multi-step reasoning (use `reactive`)
 * - Plan-then-execute flows (use `plan-execute-reflect`)
 * - Strategy adaptation (use `adaptive`)
 */
export const executeDirect = (
  input: DirectInput,
): Effect.Effect<
  ReasoningResult,
  ExecutionError | IterationLimitError,
  LLMService
> =>
  Effect.gen(function* () {
    const start = Date.now();

    const emitLog = makeStrategyEmitLog("reasoning/src/strategies/direct.ts:emitLog");

    yield* emitLog({ _tag: "phase_started", phase: "direct:kernel", timestamp: new Date() });

    // Cap iterations at 1 by default. The maximum allowed is 3; anything
    // larger should use a multi-iteration strategy.
    const requestedMax = input.maxIterations ?? 1;
    const maxIter = Math.min(Math.max(requestedMax, 1), 3);

    // Map memoryContext into priorContext for the kernel, fenced as untrusted
    // data so stored/recalled content cannot act as injected instructions (F3).
    const priorContext = input.memoryContext?.trim()
      ? fenceRecalledMemory(input.memoryContext)
      : undefined;

    // Resolve tool schemas — prefer full schemas, fall back to name-only stubs
    const toolSchemas: readonly ToolSchema[] | undefined =
      input.availableToolSchemas && input.availableToolSchemas.length > 0
        ? input.availableToolSchemas
        : input.availableTools.length > 0
          ? input.availableTools.map((name) => ({
              name,
              description: "",
              parameters: [],
            }))
          : undefined;

    const capabilitySnapshot = yield* resolveExecutableToolCapabilities({
      availableToolSchemas: toolSchemas,
      allToolSchemas: undefined,
      metaTools: undefined,
    });

    const kernelInput: KernelInput = {
      task: input.taskDescription,
      systemPrompt: input.systemPrompt,
      availableToolSchemas: capabilitySnapshot.availableToolSchemas,
      allToolSchemas: capabilitySnapshot.allToolSchemas,
      priorContext,
      contextProfile: input.contextProfile,
      providerName: input.providerName,
      resultCompression: input.resultCompression,
      temperature:
        input.temperature ??
        input.contextProfile?.temperature ??
        input.config.strategies.reactive.temperature,
      agentId: input.agentId,
      sessionId: input.sessionId,
      // Direct strategy intentionally omits: requiredTools, requiredToolQuantities,
      // relevantTools, maxCallsPerTool, maxRequiredToolRetries, briefResolvedSkills,
      // synthesisConfig, observationSummary. These are multi-iteration concerns.
      environmentContext: input.environmentContext,
      // toolElaboration / nextMovesPlanning omitted — single-turn doesn't need them
      initialMessages: input.initialMessages,
      modelId: input.modelId,
      calibration: input.calibration,
      harnessPipeline: input.harnessPipeline,
      budgetLimits: input.budgetLimits,
    };

    const state = yield* runKernel(reactKernel, kernelInput, {
      maxIterations: maxIter,
      strategy: "direct",
      kernelType: "react",
      taskId: input.taskId ?? "direct",
      kernelPass: "direct:main",
      taskDescription: input.taskDescription,
      modelId: input.modelId,
      taskCategory: input.taskCategory,
      temperature: kernelInput.temperature,
      // No strategySwitching — direct is by definition not a switching strategy
    });

    const output = state.output ?? null;

    yield* emitPhaseEnd({
      emitLog,
      phase: "direct:kernel",
      startedAt: start,
      status: state.status === "failed" ? "error" : "success",
    });

    yield* emitLog({
      _tag: "completion",
      success: resolveCompletionStatus(state) === "completed",
      summary: `Direct strategy completed (${maxIter} iter cap)`,
      timestamp: new Date(),
    });

    return buildStrategyResult({
      strategy: "direct",
      steps: state.steps,
      output,
      // H5: an unverified ship is `partial`, never `completed`.
      status: resolveCompletionStatus(state),
      start,
      totalTokens: state.tokens ?? 0,
      totalCost: 0,
    });
  });
