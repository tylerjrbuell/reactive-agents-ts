// File: src/kernel/loop/run-pass.ts
/**
 * Shared pass execution primitive — kernel-invoke + ergonomic harvest.
 *
 * Canonical home for "run one kernel pass and derive the conventional pass
 * record (output, tokens, cost, steps, messages, hadToolCalls)." Strategies
 * compose passes (reflexion: generate + N improves; reactive: 1 pass; ToT:
 * 1 skipExec + N branch execs; etc.) — each pass repeats the same harvest
 * recipe today, and each strategy reinvents it differently. This primitive
 * stops that reinvention.
 *
 * Why this lives in kernel/loop/:
 *   - `runKernel` is the universal execution loop; `runPass` is the universal
 *     harvest. Co-located is natural.
 *   - The output-fallback rule (`state.output ?? lastThought ?? null`) and
 *     the `hadToolCalls` invariant are kernel-semantics, not strategy-specific.
 *   - Cost / token passthrough is normalized (some sites used `state.tokens ??
 *     0`, others used `state.tokens` directly — drift potential).
 *
 * Strategy-specific concerns stay in the caller:
 *   - Cost accumulation into the strategy's running total (`totalTokens +=
 *     pass.tokens`) — primitives can't own running total because strategies
 *     also accumulate from critique / synthesis / patch passes.
 *   - Emit_log + step push (different event tags / observation formats)
 *   - currentResponse / lastKernelSteps / runningMessages bookkeeping
 *
 * Spec: wiki/Architecture/Design-Specs/2026-05-24-strategy-composability-design.md
 */
import { Effect } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import { runKernel } from "./runner.js";
import type {
  KernelInput,
  KernelRunOptions,
  KernelState,
  KernelMessage,
  ThoughtKernel,
} from "../state/kernel-state.js";
import type { ReasoningStep } from "../../types/index.js";

/**
 * Conventional pass record — what every strategy harvests from a kernel
 * invocation. All fields derive from `state` deterministically; the primitive
 * owns the derivation rules so they cannot drift across strategies.
 */
export interface PassResult {
  /** Raw kernel terminal state — full access for strategies needing unusual fields. */
  readonly state: KernelState;
  /**
   * User-facing output for this pass, resolved via the canonical fallback chain:
   *   1. `state.output` if non-null
   *   2. Last `thought`-typed step content if present
   *   3. `null` (no usable output produced)
   */
  readonly output: string | null;
  /** Token total for this pass (normalized from possibly-undefined kernel field). */
  readonly tokens: number;
  /** Cumulative input/prompt tokens for this pass. */
  readonly inputTokens: number;
  /** Cumulative output/completion tokens for this pass. */
  readonly outputTokens: number;
  /** USD cost for this pass (normalized). */
  readonly cost: number;
  /** Steps produced by this pass, in execution order. */
  readonly steps: readonly ReasoningStep[];
  /** Conversation thread (assistant + tool_result + user messages) at pass end. */
  readonly messages: readonly KernelMessage[];
  /** True if this pass executed at least one tool/action. */
  readonly hadToolCalls: boolean;
}

/**
 * Resolve the canonical pass output for a kernel state. Exported for unit
 * testing and for callers that already have a `KernelState` in hand and want
 * to apply the same rule without re-running the kernel.
 */
export function resolvePassOutput(state: KernelState): string | null {
  if (state.output != null && state.output !== "") return state.output;
  for (let i = state.steps.length - 1; i >= 0; i--) {
    const s = state.steps[i];
    if (s?.type === "thought" && typeof s.content === "string" && s.content.length > 0) {
      return s.content;
    }
  }
  return null;
}

/** True if any step in the array is an `action` (tool-call) step. */
export function stepsHadToolCalls(steps: readonly ReasoningStep[]): boolean {
  for (const s of steps) {
    if (s?.type === "action") return true;
  }
  return false;
}

/**
 * Run one kernel pass and harvest the conventional PassResult.
 *
 * Drop-in replacement for `runKernel(...)` followed by 4-6 lines of harvest
 * boilerplate. Caller still owns cost accumulation into the strategy's
 * running total (`totalTokens += pass.tokens`), emit_log, and step push —
 * those vary per strategy by design.
 */
export function runPass(
  kernel: ThoughtKernel,
  input: KernelInput,
  options: KernelRunOptions,
): Effect.Effect<PassResult, never, LLMService> {
  return Effect.gen(function* () {
    const state = yield* runKernel(kernel, input, options);
    const steps = state.steps;
    return {
      state,
      output: resolvePassOutput(state),
      tokens: state.tokens ?? 0,
      inputTokens: state.inputTokens ?? 0,
      outputTokens: state.outputTokens ?? 0,
      cost: state.cost ?? 0,
      steps,
      messages: state.messages,
      hadToolCalls: stepsHadToolCalls(steps),
    };
  });
}
