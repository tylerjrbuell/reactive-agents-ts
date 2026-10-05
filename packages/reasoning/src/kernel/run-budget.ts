/**
 * run-budget.ts — run-scoped LLM spend meter (Issue #231 / DEBT D-2026-10-05-P).
 *
 * Problem: the Arbitrator's pre-intent budget guard reads `state.tokens` /
 * `state.cost`, but `initialKernelState` resets both to 0 at every kernel start.
 * Multi-kernel strategies (plan-execute-reflect, reflexion, tree-of-thought,
 * blueprint) that also make DIRECT LLM calls outside the kernel loop therefore
 * hand each kernel a fresh budget pool, and their direct calls are never
 * counted at all — a live `.withBudget({ tokenLimit: 20_000 })` run reached
 * 25,675 tokens without halting.
 *
 * Fix: the observable LLM wrapper (`observable-llm.ts`) is the ONE chokepoint
 * every call path flows through (kernel think turns AND direct plan/reflexion/
 * ToT/blueprint calls, across all providers). It feeds this meter. The meter is
 * created ONCE per agent RUN and stored by reference on `state.meta.runBudgetMeter`
 * by the kernel runner, so the pure `arbitrationContextFromState` can read the
 * run's true cumulative spend instead of a per-kernel reset value.
 *
 * ── Why a plain mutable object, not an Effect `Ref` ──────────────────────────
 * `arbitrationContextFromState` is a PURE SYNCHRONOUS function (arbitrate() is
 * synchronous by design — see the BudgetSignal doc-block in arbitrator.ts). It
 * cannot `yield*` an Effect `Ref.get`. A plain mutable accumulator is readable
 * synchronously. Numeric `+=` is atomic in single-threaded JS, and every LLM
 * call for a run executes on the run's fiber tree, so no lock is required.
 *
 * The ambient `CurrentRunBudget` FiberRef carries the meter to call sites;
 * `Effect.locally` scopes it to the run's fiber subtree (child fibers inherit
 * it at fork time), mirroring `CurrentRunContext` in `@reactive-agents/core`.
 */
import { Effect, FiberRef } from "effect";

/** A single call's spend contribution, as reported by the provider. */
export interface RunBudgetSpend {
  readonly tokens: number;
  readonly cost: number;
}

/**
 * Mutable per-run accumulator. Deliberately a plain object: the Arbitrator's
 * `arbitrationContextFromState` is pure+sync and must read live spend without
 * an Effect. Fields are mutated in place by {@link addRunSpend}.
 */
export interface RunBudgetMeter {
  tokens: number;
  cost: number;
}

/**
 * Structural run-scoped budget limits. Mirrors the Arbitrator's `BudgetLimits`
 * but declared here to avoid an import cycle (run-budget.ts is imported by
 * kernel-state.ts and the runner; the arbitrator imports both). These are the
 * ORIGINAL run-scoped limits, NOT the per-kernel REDUCED limits a multi-kernel
 * strategy hands to a sub-kernel (see `withSpentBudget` in
 * `strategies/budget/remaining-budget.ts`).
 */
export interface RunBudgetLimits {
  readonly tokenLimit?: number;
  readonly costLimit?: number;
  readonly warningRatio?: number;
}

/**
 * Ambient run-scoped meter. `null` when no run has armed budgeting (e.g. a bare
 * kernel unit test, or a run with no `.withBudget()`); {@link addRunSpend} then
 * no-ops, so unmetered callers are byte-identical to before.
 */
export const CurrentRunBudget = FiberRef.unsafeMake<RunBudgetMeter | null>(null);

/**
 * Ambient run-scoped ORIGINAL budget limits, set alongside the meter by
 * {@link withRunBudgetMeter}. `null` when unarmed. The kernel runner seeds this
 * onto `state.meta.runBudgetLimits` so the Arbitrator compares run-total spend
 * against the RUN limit — never against a per-kernel reduced limit.
 */
export const CurrentRunBudgetLimits = FiberRef.unsafeMake<RunBudgetLimits | null>(null);

/** Create a fresh zeroed meter. One per agent RUN. */
export const makeRunBudgetMeter = (): RunBudgetMeter => ({ tokens: 0, cost: 0 });

/**
 * Add one LLM call's spend to the ambient run meter. No-op when no meter is
 * armed. Never fails.
 */
export const addRunSpend = (spend: RunBudgetSpend): Effect.Effect<void> =>
  Effect.gen(function* () {
    const meter = yield* FiberRef.get(CurrentRunBudget);
    if (meter) {
      meter.tokens += spend.tokens;
      meter.cost += spend.cost;
    }
  });

/**
 * Run `effect` with `meter` as the ambient run budget. The meter object is
 * shared by reference with every LLM call in the fiber subtree; it is mutated
 * in place, so the caller retains a live view of run spend after completion.
 *
 * `limits` are the ORIGINAL run-scoped budget limits (optional; defaults to
 * `null` = unarmed). They are carried on {@link CurrentRunBudgetLimits} so the
 * kernel runner can seed `state.meta.runBudgetLimits`, letting the Arbitrator
 * compare run-total spend against the run limit even when a strategy handed a
 * sub-kernel a REDUCED per-kernel limit.
 */
export const withRunBudgetMeter = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  meter: RunBudgetMeter,
  limits?: RunBudgetLimits,
): Effect.Effect<A, E, R> =>
  effect.pipe(
    Effect.locally(CurrentRunBudget, meter),
    Effect.locally(CurrentRunBudgetLimits, limits ?? null),
  );
