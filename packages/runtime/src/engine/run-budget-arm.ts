// File: src/engine/run-budget-arm.ts
//
// Issue #232 Gap 2 — arm ONE run-scoped budget meter around the WHOLE run.
//
// `ReasoningService.execute` used to create a meter per execution, so the meter
// was per-pass, not per-run. Auxiliary passes that call `execute` WITHOUT
// `budgetLimits` (the verification THINK retry in `verification-think-retry.ts`,
// the post-think continuation hooks) therefore armed NO meter and were
// unbudgeted — a run could exceed its cap by a full auxiliary pass.
//
// The runtime's `ExecutionEngine.execute` is the true once-per-run boundary
// (`agent.run()` → one `execute(task)`; sub-agents get their own), so the meter
// is armed HERE. Every LLM call the run makes — the main reasoning pass AND
// every auxiliary pass — flows through the observable wrapper and feeds this
// one accumulator, and the kernel runner seeds `state.meta.runBudgetLimits`
// from the ambient limits so each kernel enforces the run limit even when the
// pass supplies no `budgetLimits`.
//
// Gated on `budgetLimits` so a run without `.withBudget()` stays byte-identical
// (no meter, no FiberRef mutation). Extracted from `execution-engine.ts` (already
// past its size bar, #221) so the arming rule is unit-testable in isolation.

import { Effect } from "effect";
import { makeRunBudgetMeter, withRunBudgetMeter } from "@reactive-agents/reasoning";

/** Structural mirror of the runtime's `BudgetLimits` (see `builder.ts`). */
export interface RunBudgetArmLimits {
  readonly tokenLimit?: number;
  readonly costLimit?: number;
  readonly warningRatio?: number;
}

/**
 * Wrap a run's `execute` with an ambient run-scoped budget meter when limits are
 * declared. Returns `execute` unchanged when `budgetLimits` is absent, so an
 * unbudgeted run adds no FiberRef and no wrapper frame.
 *
 * `armRunBudget` is called ONCE at engine construction, but the returned function
 * runs once per RUN (`execute(task)`), so the meter is created inside the
 * returned function — one fresh meter per run, never shared across runs.
 */
export const armRunBudget = <T, A, E, R>(
  execute: (task: T) => Effect.Effect<A, E, R>,
  budgetLimits: RunBudgetArmLimits | undefined,
): ((task: T) => Effect.Effect<A, E, R>) => {
  if (!budgetLimits) return execute;
  return (task: T) =>
    withRunBudgetMeter(execute(task), makeRunBudgetMeter(), budgetLimits);
};
