// File: src/engine/run-budget-arm.ts
//
// Issue #232 Gap 2 — arm ONE run-scoped spend meter around the WHOLE run.
//
// `ReasoningService.execute` used to create a meter per execution, so the meter
// was per-pass, not per-run. Auxiliary passes that call `execute` WITHOUT
// `budgetLimits` (the verification THINK retry in `verification-think-retry.ts`,
// the post-think continuation hooks) therefore armed NO meter and were
// unbudgeted — a run could exceed its cap by a full auxiliary pass.
//
// The runtime's `ExecutionEngine.execute` is the true once-per-run boundary
// (`agent.run()` → one `execute(task)`; a delegated child runs its OWN engine,
// arms its OWN meter here, and its reported spend folds into the parent's meter
// via `sub-agent-executor.ts` (W5.4) — child calls never feed the parent's
// meter directly, so nothing is counted twice), so the meter is armed HERE.
// Every LLM call the run makes — the main reasoning pass AND every auxiliary
// pass, planner, synthesis, classifier, quality gate, structured-output call —
// flows through the observable wrapper and feeds this one accumulator, and the
// kernel runner seeds `state.meta.runBudgetLimits` from the ambient limits so
// each kernel enforces the run limit even when the pass supplies no
// `budgetLimits`.
//
// Reported-spend truth (2026-11-05): the meter is armed on EVERY run, budget or
// not, because it is the ONE source of the run's reported spend
// (`settleRunSpend` copies it onto ctx before cost-track / completion / result
// assembly). Before, `tokensUsed` summed what each reasoning pass reported about
// itself, which missed every call outside a pass's own tally (ablation: 9,985
// reported vs 18,639 billed on a no-switch rw-7 run). Without `.withBudget()`
// the meter carries NO limits, so no budget decision changes: the Arbitrator and
// `isBudgetExhausted` compute no budget signal without limits.
// `runBudgetSpend` on the result still rides only when a budget was declared
// (`budgetedRunMeter`).

import { Effect, FiberRef } from "effect";
import {
  CurrentRunBudget,
  makeRunBudgetMeter,
  withRunBudgetMeter,
  type RunBudgetMeter,
} from "@reactive-agents/reasoning";
import type { ExecutionContext } from "../types.js";

/** Structural mirror of the runtime's `BudgetLimits` (see `builder.ts`). */
export interface RunBudgetArmLimits {
  readonly tokenLimit?: number;
  readonly costLimit?: number;
  readonly warningRatio?: number;
}

/**
 * `true` while the current run declared a budget (`.withBudget()`). Set by
 * {@link armRunBudget} alongside the meter; a delegated child's engine re-arms
 * it for its own run, so it never leaks a parent's budget flag into a child.
 */
const RunBudgetDeclared = FiberRef.unsafeMake<boolean>(false);

/**
 * Wrap a run's `execute` with a fresh ambient run-scoped spend meter. Always
 * arms the meter (it is the run's reported-spend source); attaches `budgetLimits`
 * only when declared, so an un-budgeted run gets accounting with no budget rule.
 *
 * `armRunBudget` is called ONCE at engine construction, but the returned function
 * runs once per RUN (`execute(task)`), so the meter is created inside the
 * returned function — one fresh meter per run, never shared across runs.
 */
export const armRunBudget = <T, A, E, R>(
  execute: (task: T) => Effect.Effect<A, E, R>,
  budgetLimits: RunBudgetArmLimits | undefined,
): ((task: T) => Effect.Effect<A, E, R>) =>
  (task: T) =>
    withRunBudgetMeter(execute(task), makeRunBudgetMeter(), budgetLimits).pipe(
      Effect.locally(RunBudgetDeclared, budgetLimits !== undefined),
    );

/**
 * Copy the run meter's live total onto `ctx` as the run's reported spend.
 *
 * The ONE place `ctx.tokensUsed` / `ctx.cost` become the run's real LLM spend:
 * every call the observable wrapper saw (kernel turns, planner, synthesis,
 * classifier, quality gate, structured output) plus every delegated child's
 * folded spend. Called once after the last in-run LLM work (verify, quality
 * gate, memory flush) and before cost-track, completion logs and result
 * assembly, so every downstream reader sees the same number. No-op when no
 * meter is armed (an engine driven outside `armRunBudget`).
 */
export const settleRunSpend = <C extends Pick<ExecutionContext, "tokensUsed" | "cost">>(
  ctx: C,
): Effect.Effect<C> =>
  Effect.map(FiberRef.get(CurrentRunBudget), (meter) =>
    meter === null ? ctx : { ...ctx, tokensUsed: meter.tokens, cost: meter.cost },
  );

/**
 * The run meter, exposed only when the run declared a budget; `null` otherwise
 * so `metadata.runBudgetSpend` stays absent on un-budgeted runs
 * (wire-or-delete honesty). The engine passes the ambient meter it read.
 */
export const budgetedRunMeter = (meter: RunBudgetMeter | null): Effect.Effect<RunBudgetMeter | null> =>
  Effect.map(FiberRef.get(RunBudgetDeclared), (declared) => (declared ? meter : null));
