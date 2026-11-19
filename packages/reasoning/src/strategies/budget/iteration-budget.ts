// File: src/strategies/budget/iteration-budget.ts
/**
 * Iteration budget for strategies that run several kernel passes (reflexion's
 * generate + improve passes, plan-execute's step kernels).
 *
 * The run has ONE iteration budget: the configured `maxIterations`
 * (`config.strategies.reactive.maxIterations`, the canonical store for the
 * run budget on every strategy). A multi-pass strategy hands each kernel pass
 * a SHARE of what is left of it, instead of a fixed cap that ignores the
 * user's budget (reflexion used `kernelMaxIterations ?? 3`, so a run with
 * `maxIterations: 20` stopped after 3; trace 01M7447E9X95FGRB3H2RW81EWY).
 * A per-pass override (`kernelMaxIterations`, `stepKernelMaxIterations`) still
 * wins when the user set one.
 *
 * Pure functions, no services.
 */
import type { KernelRunOptions } from "../../kernel/state/kernel-state.js";

/** A strategy's iteration budget: the run's, plus an optional explicit per-pass cap. */
export interface IterationBudget {
  /** The run's configured iteration budget. */
  readonly run: number;
  /** Explicit per-pass cap; when set it is every pass's budget. */
  readonly perPass?: number;
  /** Smallest share a pass gets (default {@link MIN_PASS_ITERATIONS}). */
  readonly floor?: number;
}

/**
 * The smallest useful kernel pass: one think + act round, then one think to
 * answer. A 1-iteration pass hits its cap right after its first think call, so
 * a tool it called never executes (and an approval gate on it never pauses).
 */
export const MIN_PASS_ITERATIONS = 2;

/** How a pass's share is weighed against the passes that may follow it. */
export interface PassShareOptions {
  /**
   * The pass does the run's tool work and later passes only refine its answer
   * (reflexion's generate pass before its improve passes). A lead pass draws
   * half of what is left, `ceil(remaining / 2)`, when that beats the even share.
   */
  readonly lead?: boolean;
}

/**
 * The iterations the next kernel pass may use: `perPass` when set, else an
 * even share of the run budget still left, `ceil(remaining / passesLeft)`,
 * never below `floor`. `passesLeft` counts this pass and every pass that may
 * follow it. A `lead` pass draws `ceil(remaining / 2)` instead when larger
 * (trace 01M7T3GGGZTYN79G1T0JSW4G5V: an even quarter of 16 left reflexion's
 * generate pass 4 iterations, spent on bookkeeping and two tool calls before
 * any answer). The passes after it split what it left evenly. Recomputed
 * before each pass, the shares add up to the run budget unless the floor
 * lifts a share (a budget smaller than passes x floor).
 */
export function passIterationShare(
  budget: IterationBudget,
  spent: number,
  passesLeft: number,
  options: PassShareOptions = {},
): number {
  if (budget.perPass !== undefined) return budget.perPass;
  const remaining = Math.max(0, budget.run - spent);
  const even = Math.ceil(remaining / Math.max(1, passesLeft));
  const share = options.lead === true ? Math.max(even, Math.ceil(remaining / 2)) : even;
  return Math.max(budget.floor ?? MIN_PASS_ITERATIONS, share);
}

/**
 * A pass's run options carrying the run's iteration budget as
 * `meta.runMaxIterations`, never below the pass's own cap. Run-sized guards
 * (the repetition backstop) read it, so a small pass share (direct's 3, a
 * reflexion pass's 4) does not cap distinct, informative calls of one tool at
 * 3 (QA N1, 2026-11-19). Without a budget the options pass through unchanged:
 * a single-pass run's own cap is its budget.
 *
 * `spent` is what earlier passes of the run used; the pass carries what is
 * left as `meta.runIterationsLeft`. A pass that stops on its own cap with run
 * budget still left runs the tool batch of its last think instead of dropping
 * it (`kernel/loop/pending-batch.ts`; trace 01M7T84BKRW64TD0HQA6E8GHSP).
 */
export function withRunBudget(
  options: KernelRunOptions,
  budget: IterationBudget | undefined,
  spent = 0,
): KernelRunOptions {
  if (budget === undefined) return options;
  return {
    ...options,
    meta: {
      ...options.meta,
      runMaxIterations: Math.max(budget.run, options.maxIterations),
      runIterationsLeft: Math.max(0, budget.run - spent),
    },
  };
}

/** The iterations one finished kernel pass used: its loop counter or its LLM calls, whichever is higher. */
export function passIterationsUsed(state: { readonly iteration: number; readonly llmCalls?: number }): number {
  return Math.max(state.iteration, state.llmCalls ?? 0);
}
