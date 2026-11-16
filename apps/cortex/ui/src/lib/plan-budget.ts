// apps/cortex/ui/src/lib/plan-budget.ts
/**
 * The framework's plan-sized iteration budget, read for display. A run seeded with a plan gets
 * `maxIterations` raised for it (reasoning `kernel/loop/plan-budget.ts`) and the raise is
 * announced as a `GuardFiredEmitted` event for guard `plan_budget_raised` with metadata
 * `{ configured, steps, effective, hardCap }`. `ReasoningIterationProgress.maxIterations` still
 * carries the configured bound, so a progress readout must take the larger of the two. Cortex only
 * reads the signal; the budget's rule is the framework's. Pure.
 */

/** The guard name the framework fires when it raises the budget. */
export const PLAN_BUDGET_GUARD = "plan_budget_raised";

const positive = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);

/** The raised iteration bound a `plan_budget_raised` guard event announces; `undefined` for any other event. */
export function planBudgetEffective(type: string, payload: Readonly<Record<string, unknown>>): number | undefined {
  if (type !== "GuardFiredEmitted" || payload.guard !== PLAN_BUDGET_GUARD) return undefined;
  const meta = payload.metadata;
  return meta !== null && typeof meta === "object" ? positive((meta as { effective?: unknown }).effective) : undefined;
}

/**
 * The bound a progress readout (`N / max`) divides by: the larger of what the progress event
 * reported (the configured bound) and the plan-raised bound. `0` when neither is known.
 */
export function effectiveBound(reported: number | undefined, raised: number | undefined): number {
  return Math.max(positive(reported) ?? 0, positive(raised) ?? 0);
}

/** One-line feed title for the budget raise (the guard's own reason), else `undefined`. */
export function planBudgetTitle(trace: { readonly guard?: string; readonly reason?: string }): string | undefined {
  return trace.guard === PLAN_BUDGET_GUARD && typeof trace.reason === "string" && trace.reason !== "" ? trace.reason : undefined;
}
