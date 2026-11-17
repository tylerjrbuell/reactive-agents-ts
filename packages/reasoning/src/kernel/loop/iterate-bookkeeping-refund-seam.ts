// File: src/kernel/loop/iterate-bookkeeping-refund-seam.ts
//
// Bookkeeping refund (execute-phase iteration efficiency). Cortex trace
// 01M7JHP80MHNZ35EVPS42JBD7T (gpt-4.1, "Execute the plan.", maxIterations 10):
// six of nine iterations called only `todo` (re-adding seeded steps, marking
// them), three made one real call each, and the run hit the cap with no answer.
//
// On a run SEEDED with a plan checklist (`input.initialAdvisory`), an act round
// whose tool calls were all `todo` did no task work, so it does not count
// against the budget: the loop bound (`iteration < max && llmCalls < max`, read
// live from the carrier's options) is raised by one. BOUNDED: at most half of
// the original budget is ever refunded, so a todo loop cannot run forever (the
// loop detector still applies). Each refund is a `harness_signal` step carrying
// a `bookkeeping-refund` intervention (the record the cap counts, receipt
// visible) plus a `bookkeeping_refund` guard-fired event.
//
// A plan-sized raise (plan-budget.ts) keeps this cap on the ORIGINAL configured
// budget and keeps raise plus refunds under the plan hard cap.
//
// Plan posture with `planRecon` on: a round of recon calls (plus at most `todo`)
// is refunded the same bounded way ({@link isReconRound}); recon gathers facts
// for the plan and is itself capped (policy/plan-recon.ts).
//
// Without a seed, in plan posture without recon, or in a round that made any
// other call: returns undefined and nothing changes (byte-identical).
// Pure decision, deterministic, NO LLM, NO fs.

import { Effect } from "effect";
import { authorityOf } from "../capabilities/decide/authority.js";
import { makeStep } from "../capabilities/sense/step-utils.js";
import { isPlanPosture } from "../policy/run-posture.js";
import { planReconOn, reconEligibleSchemas } from "../policy/plan-recon.js";
import {
  transitionState,
  type KernelInput,
  type KernelRunOptions,
  type KernelState,
} from "../state/kernel-state.js";
import { emitGuardFired } from "../utils/diagnostics.js";

/** Intervention actor of a refund step; the cap counts steps by it. */
export const BOOKKEEPING_REFUND_ACTOR = "bookkeeping-refund";
/** The guard name of the refund's trace event. */
export const BOOKKEEPING_REFUND_GUARD = "bookkeeping_refund";
/** Tools whose rounds are bookkeeping, not task work. */
const BOOKKEEPING_TOOLS: ReadonlySet<string> = new Set(["todo"]);

/** Refunds issued so far in this run (derived from the step record: no state field). */
export const bookkeepingRefundsIssued = (state: KernelState): number =>
  state.steps.filter((s) => s.metadata?.intervention?.actor === BOOKKEEPING_REFUND_ACTOR).length;

/**
 * Most refunds a run may earn: half of the ORIGINAL budget. `currentMax` is the
 * carrier's (already raised) bound, so the original is `currentMax - issued`,
 * unless the plan budget raised it first (then `configured` is the original).
 */
export const bookkeepingRefundCap = (currentMax: number, issued: number, configured?: number): number =>
  Math.floor((configured ?? currentMax - issued) / 2);

/** True when the round's calls (at least one) were all bookkeeping. */
export const isBookkeepingRound = (toolsThisStep: readonly string[]): boolean =>
  toolsThisStep.length > 0 && toolsThisStep.every((t) => BOOKKEEPING_TOOLS.has(t));

/**
 * A plan-posture round (recon on) of recon calls, with at most `todo` beside
 * them: it gathered facts for the plan, no step of the budget. At least one
 * call must be a recon tool, so a todo-only plan round counts as it always did.
 */
export const isReconRound = (toolsThisStep: readonly string[], reconTools: ReadonlySet<string>): boolean =>
  toolsThisStep.some((t) => reconTools.has(t)) && toolsThisStep.every((t) => BOOKKEEPING_TOOLS.has(t) || reconTools.has(t));

/**
 * The refund for the act round that just ended, or undefined when it does not
 * apply: not a seeded execute run, the pass spent no iteration (a think pass),
 * the round made a real call, the run is over, or the refund cap is reached.
 * Returns the state carrying the record and the options with the bound raised.
 */
export function proposeBookkeepingRefund(args: {
  readonly state: KernelState;
  readonly input: KernelInput;
  readonly options: KernelRunOptions;
  readonly toolsThisStep: readonly string[];
  readonly iterationAtPassStart: number;
}): { readonly state: KernelState; readonly options: KernelRunOptions } | undefined {
  const { state, input, options } = args;
  if (input.harness?.bookkeepingRefund === false) return undefined;
  const planRecon = planReconOn(input);
  if (isPlanPosture(input) ? !planRecon : (input.initialAdvisory?.length ?? 0) === 0) return undefined;
  if (state.status === "done" || state.status === "failed") return undefined;
  const reconTools = new Set(reconEligibleSchemas(input).map((t) => t.name));
  const refundable = planRecon ? isReconRound(args.toolsThisStep, reconTools) : isBookkeepingRound(args.toolsThisStep);
  if (state.iteration <= args.iterationAtPassStart || !refundable) return undefined;
  const issued = bookkeepingRefundsIssued(state);
  const cap = bookkeepingRefundCap(options.maxIterations, issued, options.configuredMaxIterations);
  if (issued >= cap) return undefined;
  // A plan-raised bound plus refunds never passes the plan budget's hard cap (plan-budget.ts).
  if (options.planBudgetHardCap !== undefined && options.maxIterations + 1 > options.planBudgetHardCap) return undefined;
  const step = makeStep("harness_signal", `bookkeeping round refunded: ${args.toolsThisStep.join(", ")} only (${issued + 1}/${cap})`, {
    intervention: {
      actor: BOOKKEEPING_REFUND_ACTOR,
      authorityClass: authorityOf(BOOKKEEPING_REFUND_ACTOR),
      evidence: `iteration ${state.iteration} called only ${[...new Set(args.toolsThisStep)].join(", ")}`,
      whatChanged: planRecon
        ? "bookkeeping-refund: the plan recon round did not count against maxIterations"
        : "bookkeeping-refund: the todo-only round did not count against maxIterations",
      iter: state.iteration,
    },
  });
  return {
    state: transitionState(state, {
      steps: [...state.steps, step],
      meta: { ...state.meta, maxIterations: options.maxIterations + 1 }, // progress events read meta
    }),
    options: { ...options, maxIterations: options.maxIterations + 1 },
  };
}

/** Trace the refund (the step record already carries it). */
export const emitBookkeepingRefund = (
  state: KernelState,
  options: KernelRunOptions,
  toolsThisStep: readonly string[],
): Effect.Effect<void, never> =>
  emitGuardFired({
    taskId: options.taskId ?? state.taskId,
    iteration: state.iteration,
    guard: BOOKKEEPING_REFUND_GUARD,
    outcome: "pass",
    reason: "todo-only round did not count against the iteration budget",
    metadata: { tools: toolsThisStep, maxIterations: options.maxIterations, refunds: bookkeepingRefundsIssued(state) },
  });
