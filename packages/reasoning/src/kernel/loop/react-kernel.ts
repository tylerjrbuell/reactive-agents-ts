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
import { handleThinking } from "../../kernel/capabilities/reason/think.js";
import { handleActing } from "../../kernel/capabilities/act/act.js";

// ── Public input / output types ──────────────────────────────────────────────

// Defined in kernel-state to avoid circular imports; re-exported here for backward compatibility
import type { ReActKernelInput, ReActKernelResult } from "../../kernel/state/kernel-state.js";
export type { ReActKernelInput, ReActKernelResult };
import { resolveExecutableToolCapabilities } from "../../kernel/capabilities/act/tool-capabilities.js";
import { buildKernelInput } from "../../kernel/state/build-kernel-input.js";

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

/**
 * Derive the canonical `terminatedBy` + raw open-string channel from a kernel
 * state's `meta.terminatedBy` + `status` pair.
 *
 * Returns BOTH:
 *   - `terminatedBy`: the closed 5-value enum used by `ReActKernelResult.terminatedBy`
 *   - `rawTerminatedBy?`: the raw `state.meta.terminatedBy` string, preserved
 *     so dynamic killswitch reasons (e.g. `"budget-limit:tokens:1/0"`) survive
 *     the narrowing for downstream observability.
 *
 * `rawTerminatedBy` is OMITTED (not set to `undefined`) when the source is
 * absent, so spread-based consumers don't pollute their result with
 * `{ rawTerminatedBy: undefined }`.
 *
 * Narrowing to `"final_answer"` is WHITELIST-gated (DEFECT 3, 2026-05-31):
 * only genuine model-answer reasons — `final_answer`, `final_answer_regex`,
 * `content_stable`, `entropy_converged` — map to `"final_answer"`. Any other
 * `status === "done"` (harness/give-up reasons such as
 * `controller_early_stop:*`, `low_delta_guard`, `oracle_forced`,
 * `harness_deliverable`, `loop_graceful`, killswitch cut-offs, etc.) narrows
 * to `"end_turn"`, NOT `"final_answer"`. The old catch-all `done → final_answer`
 * was a codified lie: it forced `deriveGoalAchieved` to return `true` on FAILED
 * runs (the observed `success:false` + `goalAchieved:true` incoherence).
 * `end_turn` yields an honest `goalAchieved` null ("unknown") instead of the lie.
 * A whitelist miss under-claims (honest, loud); a blacklist miss would
 * over-claim (silent lie) — so whitelist is the chosen error-asymmetry.
 *
 * Pure / synchronous / no Effect — exported for unit testability.
 */
export function deriveTerminatedBy(state: { meta: { terminatedBy?: unknown }; status: KernelState["status"] }): {
  terminatedBy: "final_answer" | "final_answer_tool" | "max_iterations" | "end_turn" | "llm_error" | "abstained";
  rawTerminatedBy?: string;
} {
  const rawTerminatedBy =
    typeof state.meta.terminatedBy === "string" ? state.meta.terminatedBy : undefined;
  const terminatedBy:
    | "final_answer"
    | "final_answer_tool"
    | "max_iterations"
    | "end_turn"
    | "llm_error"
    | "abstained" =
    rawTerminatedBy === "llm_error"
      ? "llm_error"
      : rawTerminatedBy === "final_answer_tool"
        ? "final_answer_tool"
        : rawTerminatedBy === "abstained"
          ? "abstained"
          : rawTerminatedBy === "end_turn" || rawTerminatedBy === "llm_end_turn"
            ? "end_turn"
            : rawTerminatedBy === "final_answer" ||
                rawTerminatedBy === "final_answer_regex" ||
                rawTerminatedBy === "content_stable" ||
                rawTerminatedBy === "entropy_converged"
              ? "final_answer"
              : state.status === "done"
                ? "end_turn"
                : "max_iterations";
  return rawTerminatedBy !== undefined
    ? { terminatedBy, rawTerminatedBy }
    : { terminatedBy };
}

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

    // FM-I (GH #195), Layer-3: assemble the inner KernelInput through the
    // canonical `buildKernelInput(crossCutting, perPass)` builder rather than a
    // hand-written literal. The builder's bundles are `Pick<KernelInput, …>`, so
    // a dropped cross-cutting field becomes a COMPILE error instead of a silent
    // runtime gap. This is what closes the plan-execute-per-step path: the
    // run-wide cross-cutting fields — `harnessPipeline`, `budgetLimits`,
    // `calibration`, `auditRationale` — now flow through unconditionally (the
    // old literal forwarded none of them, killing `.withHarness()` hooks,
    // killswitches, and model calibration on every per-step ReAct pass).
    //
    // Behaviour-preservation: `availableToolSchemas` / `allToolSchemas` come
    // from `capabilitySnapshot` (POST-resolve), NOT raw input, so they stay
    // per-pass. `verifier` is deliberately ABSENT — per-step passes must not
    // gain a terminal §9.0 gate. `blockedTools`, `strictToolDependencyChain`,
    // and `toolCallResolver` are not part of the cross-cutting/per-pass Picks;
    // they are spread AFTER the builder (no drop risk, same pattern reflexion
    // uses for `blockedTools`).
    const state = yield* runKernel(reactKernel, {
      ...buildKernelInput(
        {
          resultCompression: input.resultCompression,
          providerName: input.providerName,
          agentId: input.agentId,
          sessionId: input.sessionId,
          requiredTools: input.requiredTools,
          // Forward classifier-relevant tools so the kernel's lazy-disclosure prune
          // (required+relevant+used+discovered+meta) keeps MCP/user tools visible.
          // Without this, plan-execute's per-step ReAct kernel pruned every non-meta
          // tool — see reflexion / spot-test GitHub-MCP regression.
          relevantTools: input.relevantTools,
          maxRequiredToolRetries: input.maxRequiredToolRetries,
          metaTools: input.metaTools,
          synthesisConfig: input.synthesisConfig,
          environmentContext: input.environmentContext,
          modelId: input.modelId,
          auditRationale: input.auditRationale,
          calibration: input.calibration,
          harnessPipeline: input.harnessPipeline,
          budgetLimits: input.budgetLimits,
          grounding: input.grounding,
          fabricationGuard: input.fabricationGuard,
          stallPolicy: input.stallPolicy,
        },
        {
          task: input.task,
          systemPrompt: input.systemPrompt,
          availableToolSchemas: capabilitySnapshot.availableToolSchemas,
          allToolSchemas: capabilitySnapshot.allToolSchemas,
          priorContext: input.priorContext,
          contextProfile: input.contextProfile,
          temperature: input.temperature,
        },
      ),
      blockedTools: input.blockedTools,
      strictToolDependencyChain: input.strictToolDependencyChain,
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

    // Determine terminatedBy from state — map oracle reasons to canonical types.
    // `rawTerminatedBy` preserves the raw open string (e.g. "budget-limit:tokens:1/0")
    // so dynamic killswitch reasons survive narrowing for downstream observability.
    const { terminatedBy, rawTerminatedBy } = deriveTerminatedBy(state);

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
      ...(rawTerminatedBy !== undefined ? { rawTerminatedBy } : {}),
      finalAnswerCapture: state.meta.finalAnswerCapture as FinalAnswerCapture | undefined,
      ...(state.meta.abstention !== undefined ? { abstention: state.meta.abstention } : {}),
      llmCalls: state.llmCalls ?? 0,
    };
  });

