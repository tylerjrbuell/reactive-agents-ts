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
 * it at fork time).
 */
import { Effect, FiberRef } from "effect";
import { addKnown, contributedHalf } from "./utils/known-count.js";

/**
 * A single call's spend contribution, as reported by the provider.
 *
 * `tokens` and `cost` drive budget decisions. `inputTokens`, `outputTokens`
 * and `llmCalls` are accounting-only (reported on the run result, never read
 * by a budget guard). `llmCalls` defaults to 0 when omitted. An omitted half
 * on a spend with tokens means the provider did not split its count: it makes
 * the meter's half unknown (see `addKnown`), never adds a 0. A zero-token
 * spend has nothing to split and leaves the halves as they are.
 */
export interface RunBudgetSpend extends TokenSpend {
  readonly llmCalls?: number;
}

/**
 * The token spend of one or more LLM exchanges, without a call count. Every
 * result a direct LLM call produces (critique, synthesis, plan patch) carries
 * these fields, so its caller accounts the provider's split, not just the total.
 */
export interface TokenSpend {
  readonly tokens: number;
  readonly cost: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

/** Spend of no LLM work. */
export const NO_TOKEN_SPEND: TokenSpend = { tokens: 0, cost: 0 };

/** The usage fields {@link usageSpend} reads (TokenUsage, or a partial stand-in). */
export interface UsageLike {
  readonly totalTokens?: number;
  readonly estimatedCost?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

/**
 * One LLM response's spend from its reported usage. A half the provider did
 * not report stays absent (unknown), never 0. Missing usage is no spend.
 */
export const usageSpend = (usage: UsageLike | undefined): TokenSpend => ({
  tokens: usage?.totalTokens ?? 0,
  cost: usage?.estimatedCost ?? 0,
  ...(usage?.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
  ...(usage?.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
});

/**
 * Sum two spends. Totals add; a half stays known only while both sides knew
 * it (`addKnown` / `contributedHalf`), so a zero-token side never unknowns it.
 */
export const addTokenSpend = (a: TokenSpend, b: TokenSpend): TokenSpend => {
  const inputTokens = addKnown(contributedHalf(a.inputTokens, a.tokens), contributedHalf(b.inputTokens, b.tokens));
  const outputTokens = addKnown(contributedHalf(a.outputTokens, a.tokens), contributedHalf(b.outputTokens, b.tokens));
  return {
    tokens: a.tokens + b.tokens,
    cost: a.cost + b.cost,
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
  };
};

/** Only the {@link TokenSpend} fields of a result that carries them (drops content etc.). */
export const tokenSpendOf = (r: TokenSpend): TokenSpend => ({
  tokens: r.tokens,
  cost: r.cost,
  ...(r.inputTokens !== undefined ? { inputTokens: r.inputTokens } : {}),
  ...(r.outputTokens !== undefined ? { outputTokens: r.outputTokens } : {}),
});

/**
 * Mutable per-run accumulator. Deliberately a plain object: the Arbitrator's
 * `arbitrationContextFromState` is pure+sync and must read live spend without
 * an Effect. Fields are mutated in place by {@link addRunSpend}.
 *
 * `tokens` / `cost` are the budget-decision totals. `inputTokens`,
 * `outputTokens` and `llmCalls` are accounting-only, so the run result can
 * report them from the same source as `tokens`. They are optional so meters
 * built as literals (sub-agent roll-ups, tests) stay valid; a meter from
 * {@link makeRunBudgetMeter} starts them at 0. A half becomes `undefined`
 * (unknown) once any call left it unreported, and stays unknown for the run.
 */
export interface RunBudgetMeter {
  tokens: number;
  cost: number;
  inputTokens?: number;
  outputTokens?: number;
  llmCalls?: number;
  /**
   * Set by {@link settleRunMeter} once the run's spend is reported. A settled
   * meter ignores further spend, so work after settlement (the forked debrief
   * synthesis) cannot change a total already copied onto the result.
   */
  settled?: boolean;
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
export const makeRunBudgetMeter = (): RunBudgetMeter => ({
  tokens: 0,
  cost: 0,
  inputTokens: 0,
  outputTokens: 0,
  llmCalls: 0,
});

/**
 * Add one call's spend to `meter` in place. Synchronous, for call sites that
 * hold a captured meter reference (the stream finalizer, which may run on a
 * different fiber than the one that armed the meter). No-op once the meter is
 * settled ({@link settleRunMeter}).
 */
export const applyRunSpend = (meter: RunBudgetMeter, spend: RunBudgetSpend): void => {
  if (meter.settled === true) return;
  meter.tokens += spend.tokens;
  meter.cost += spend.cost;
  meter.inputTokens = addKnown(meter.inputTokens, contributedHalf(spend.inputTokens, spend.tokens));
  meter.outputTokens = addKnown(meter.outputTokens, contributedHalf(spend.outputTokens, spend.tokens));
  meter.llmCalls = (meter.llmCalls ?? 0) + (spend.llmCalls ?? 0);
};

/**
 * Mark `meter` settled: the run's spend has been reported, so every later
 * {@link applyRunSpend} / {@link addRunSpend} on it is a no-op. Call once, at
 * the point the run copies the meter's total onto its result. Idempotent.
 */
export const settleRunMeter = (meter: RunBudgetMeter): void => {
  meter.settled = true;
};

/** Whether {@link settleRunMeter} has been called on `meter`. */
export const isRunMeterSettled = (meter: RunBudgetMeter): boolean => meter.settled === true;

/**
 * Add one LLM call's spend to the ambient run meter. No-op when no meter is
 * armed or the meter is settled. Never fails.
 */
export const addRunSpend = (spend: RunBudgetSpend): Effect.Effect<void> =>
  Effect.gen(function* () {
    const meter = yield* FiberRef.get(CurrentRunBudget);
    if (meter) applyRunSpend(meter, spend);
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
