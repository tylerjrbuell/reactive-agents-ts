// File: src/strategies/budget/run-budget-spend.ts
/**
 * Issue #234 — resolve a strategy's local cumulative spend against the shared
 * run-scoped meter.
 *
 * WHY THIS EXISTS (and why the per-strategy gates are NOT deleted):
 * The run-scoped meter (#231) feeds the Arbitrator, but the Arbitrator only runs
 * at KERNEL iteration boundaries. A strategy's DIRECT LLM calls between kernels
 * (plan generation, reflection, quality gate, synthesis) never enter the
 * Arbitrator, so the kernel guard cannot bound them. The strategy-level gates
 * are therefore the direct-call enforcement complement, not duplication — they
 * must remain.
 *
 * What this helper removes is the DUPLICATED ACCOUNTING: a strategy tracks its
 * own `totalTokens`/`totalCost`, which can drift from the true run spend (a
 * sub-kernel's reported tokens, a metered structured call). Reading the shared
 * meter and maxing it over the local figure gives both enforcement sites ONE
 * accounting source, so the strategy gate and the Arbitrator agree on the
 * boundary.
 *
 * Pure of services: reads the ambient `CurrentRunBudget` FiberRef (null when no
 * meter is armed, e.g. a direct strategy invocation) and falls back to the
 * caller's local spend.
 */
import { Effect, FiberRef } from "effect";
import { CurrentRunBudget } from "../../kernel/run-budget.js";
import type { BudgetSpend } from "./remaining-budget.js";

/**
 * The strategy's spend, resolved against the run meter when one is armed.
 *
 * `Math.max` (never the meter alone) guarantees a metered run can never report
 * LESS spend than the strategy already recorded — an unmetered path (a provider
 * that reports no usage) leaves the local figure ahead.
 */
export const resolveRunSpend = (local: BudgetSpend): Effect.Effect<BudgetSpend> =>
  Effect.gen(function* () {
    const meter = yield* FiberRef.get(CurrentRunBudget);
    if (!meter) return local;
    return {
      tokens: Math.max(meter.tokens, local.tokens),
      cost: Math.max(meter.cost, local.cost),
    };
  });
