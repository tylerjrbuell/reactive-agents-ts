// File: src/kernel/loop/terminal-pipeline.ts
/**
 * The kernel terminal pipeline — the ONE entry that turns a finished loop into
 * the run's final state (Plan 9 Phase 2, one completion authority; AGENTS.md
 * pitfall 12).
 *
 * Every post-loop decision or rewrite of `state.output` / `state.status` is a
 * named, ordered step below. `runKernel()` calls `runKernelTerminalPipeline`
 * once and owns nothing else after the main loop; new terminal behavior (e.g. an
 * acceptance check) is a new step in {@link KERNEL_TERMINAL_STEPS}, never a new
 * call in the runner or a strategy.
 *
 * Where the rest of the terminal path sits, in order:
 *   1. In-loop, before the loop can end: the budget-band forced synthesis
 *      (`runner-helpers/pace-terminal.ts`, `budget_terminal`) and the model
 *      exit proposals (`decide/model-exit-proposal.ts` → `exit-gate.ts`). The
 *      provider adapter's `qualityCheck` is also in-loop (a pre-exit prompt the
 *      think guard injects, `reason/think-guards.ts`), not a terminal step.
 *   2. This pipeline (kernel state → final kernel state).
 *   3. The strategy result mint `finalizeStrategyResult`
 *      (`sense/finalize-result.ts`), reached through the strategy-run
 *      substrate: fabrication guard, abstention synthesis, give-up gate,
 *      contract-coverage and delegation caps, the `TerminalOutcome`, and the
 *      strategy-owned `terminal_decision` record.
 * Every deliverable render on that path goes through `runTerminalSynthesis`
 * (`terminal-synthesis.ts`).
 *
 * Step order is behavior: the fences are read ONCE at entry (before the
 * `complete` hooks and the cap proposal), exactly as the runner did inline.
 */
import { Effect } from "effect";
import type { LogEvent } from "@reactive-agents/observability";
import type { LLMService } from "@reactive-agents/llm-provider";
import type { TaskIntent } from "../capabilities/comprehend/task-intent.js";
import type { Verifier } from "../capabilities/verify/verifier.js";
import type { KernelInput, KernelRunOptions, KernelState } from "../state/kernel-state.js";
import { runPhaseHooks } from "./phase-hooks.js";
import { proposeCapExit } from "./exit-gate.js";
import {
  applyRequiredToolsFinalCheck,
  applyNonFinalAnswerDeliverable,
  applyOutputOwnershipCluster,
} from "./runner-post-loop-deliverable.js";
import { runTerminalVerifierGate } from "./runner-terminal-verify-gate.js";
import { runOutputQualityGate } from "./runner-output-quality-gate.js";
import { emitTerminalDecision } from "./runner-helpers/terminal-decision.js";

/**
 * Terminal kinds the answer-shaping steps must leave alone, read once at entry.
 *
 * - `isAwaitingApproval` / `isAwaitingInteraction`: a durable pause is a clean
 *   terminal (sentinel output + resume descriptor); verifying or synthesizing
 *   it would mangle the pause (e.g. the gated tool looks "required but uncalled").
 * - `isAbstained`: an honest decline; nothing to verify or synthesize.
 * - `isBudgetTerminal`: `budget_terminal` already ran its forced synthesis;
 *   re-verifying could null the partial answer (audit 05-#1) and
 *   re-synthesizing would double the spend.
 */
export interface TerminalFences {
  readonly isAwaitingApproval: boolean;
  readonly isAwaitingInteraction: boolean;
  readonly isAbstained: boolean;
  readonly isBudgetTerminal: boolean;
}

/** Read the {@link TerminalFences} off a finished loop's state. Pure. */
export function terminalFences(state: KernelState): TerminalFences {
  const by = state.meta.terminatedBy;
  return {
    isAwaitingApproval: by === "awaiting-approval",
    isAwaitingInteraction: by === "awaiting-interaction",
    isAbstained: by === "abstained",
    isBudgetTerminal: by === "budget_terminal",
  };
}

/** Everything the terminal steps read besides the state itself. */
export interface TerminalPipelineContext {
  readonly verifier: Verifier;
  /** The run's input as resolved at run start (verifier context, hooks). */
  readonly effectiveInput: KernelInput;
  /** The input of the pass that ended the loop (a strategy switch may change it). */
  readonly currentInput: KernelInput;
  readonly currentOptions: KernelRunOptions;
  readonly taskIntent: TaskIntent;
  readonly requiredTools: readonly string[];
  readonly emitLog: (event: LogEvent) => Effect.Effect<void, never>;
  readonly fences: TerminalFences;
}

/** The ordered step names — the pipeline's public shape (pinned). */
export const KERNEL_TERMINAL_STEPS = [
  "complete-hooks",
  "cap-exit-proposal",
  "required-tools",
  "non-final-answer-deliverable",
  "output-ownership",
  "verify-gate",
  "quality-gate",
  "terminal-decision",
] as const;

export type KernelTerminalStepName = (typeof KERNEL_TERMINAL_STEPS)[number];

type TerminalStep = (
  state: KernelState,
  ctx: TerminalPipelineContext,
) => Effect.Effect<KernelState, never, LLMService>;

/** Step implementations, keyed by name; run in {@link KERNEL_TERMINAL_STEPS} order. */
const STEPS: { readonly [K in KernelTerminalStepName]: TerminalStep } = {
  // `complete` phase hooks fire once after the loop exits normally.
  "complete-hooks": (state, ctx) =>
    Effect.promise(() =>
      runPhaseHooks(ctx.effectiveInput.harnessPipeline, "after", "complete", state.iteration, state),
    ).pipe(Effect.as(state)),
  // §7.9 iteration cap → exit-gate proposal (Plan 8 item 3; see exit-gate.ts).
  "cap-exit-proposal": (state, ctx) =>
    proposeCapExit({ state, currentInput: ctx.currentInput, currentOptions: ctx.currentOptions }),
  // §8 missing required-tool quotas fail deterministically.
  "required-tools": (state, ctx) =>
    Effect.succeed(
      applyRequiredToolsFinalCheck({
        state,
        currentInput: ctx.currentInput,
        currentOptions: ctx.currentOptions,
        requiredTools: ctx.requiredTools,
        ...ctx.fences,
      }),
    ),
  // §8.5 non-authoritative termination → harness deliverable.
  "non-final-answer-deliverable": (state) => Effect.succeed(applyNonFinalAnswerDeliverable({ state })),
  // §8.7 output ownership consolidation + §8.8 empty-output fallback.
  "output-ownership": (state) => applyOutputOwnershipCluster({ state }),
  // §9.0 terminal verifier gate (D1 grounding / D2 scaffold-leak repairs, handoff).
  "verify-gate": (state, ctx) =>
    runTerminalVerifierGate({
      state,
      verifier: ctx.verifier,
      effectiveInput: ctx.effectiveInput,
      taskIntent: ctx.taskIntent,
      currentOptions: ctx.currentOptions,
      emitLog: ctx.emitLog,
      ...ctx.fences,
    }),
  // §9 output quality gate (format/harness-source synthesis, de-scaffold floor).
  "quality-gate": (state, ctx) =>
    runOutputQualityGate({
      state,
      effectiveInput: ctx.effectiveInput,
      taskIntent: ctx.taskIntent,
      emitLog: ctx.emitLog,
      ...ctx.fences,
    }),
  // Observe the already-decided terminal decision (emit-only; no control flow).
  "terminal-decision": (state, ctx) =>
    emitTerminalDecision({ state, taskId: ctx.currentOptions.taskId ?? state.taskId }),
};

/**
 * Run the kernel terminal pipeline over a finished loop's state. The fences
 * are derived here, once, before any step runs.
 */
export function runKernelTerminalPipeline(
  state: KernelState,
  ctx: Omit<TerminalPipelineContext, "fences">,
): Effect.Effect<KernelState, never, LLMService> {
  const full: TerminalPipelineContext = { ...ctx, fences: terminalFences(state) };
  return Effect.reduce(KERNEL_TERMINAL_STEPS, state, (s, name) => STEPS[name](s, full));
}
