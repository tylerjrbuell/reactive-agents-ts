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
  settleRunMeter,
  withRunBudgetMeter,
  type RunBudgetMeter,
} from "@reactive-agents/reasoning";
import type { ExecutionContext } from "../types.js";
import { rootContext } from "@reactive-agents/core";
import { ensureRunScope } from "@reactive-agents/core/internal/run-scope";

/** Structural mirror of the runtime's `BudgetLimits` (see `builder.ts`). */
export interface RunBudgetArmLimits {
  readonly tokenLimit?: number;
  readonly costLimit?: number;
  readonly warningRatio?: number;
}

/**
 * Wrap a run's `execute` with a fresh ambient run-scoped spend meter. Always
 * arms the meter (it is the run's reported-spend source); attaches `budgetLimits`
 * only when declared, so an un-budgeted run gets accounting with no budget rule.
 *
 * `armRunBudget` is called ONCE at engine construction, but the returned function
 * runs once per RUN (`execute(task)`), so the meter is created inside the
 * returned function — one fresh meter per run, never shared across runs.
 */
export const armRunBudget = <T extends { readonly id: unknown; readonly agentId?: unknown }, A, E, R>(
  execute: (task: T) => Effect.Effect<A, E, R>,
  budgetLimits: RunBudgetArmLimits | undefined,
): ((task: T) => Effect.Effect<A, E, R>) =>
  (task: T) =>
    withRunBudgetMeter(execute(task), makeRunBudgetMeter(), budgetLimits).pipe(
      // An engine driven directly (tests, embedders) still runs inside its own
      // run scope; inside a runtime run (startRun) or a sub-agent's child
      // scope this changes nothing.
      ensureRunScope(() => rootContext(String(task.id), String(task.agentId ?? "agent"))),
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
 *
 * Also settles the meter (`settleRunMeter`): spend after this point (the
 * forked debrief synthesis, any post-settle call) is ignored by the meter, so
 * the total copied here and `runBudgetSpend` read later cannot diverge. The
 * meter owns the "no spend after settle" rule; callers need no detach.
 */
export const settleRunSpend = <C extends Pick<ExecutionContext, "tokensUsed" | "cost" | "metadata">>(
  ctx: C,
): Effect.Effect<C> =>
  Effect.map(FiberRef.get(CurrentRunBudget), (meter) => {
    if (meter === null) return ctx;
    settleRunMeter(meter);
    return {
      ...ctx,
      tokensUsed: meter.tokens,
      cost: meter.cost,
      metadata: { ...ctx.metadata, [SETTLED_SPLIT_KEY]: splitOf(meter) },
    };
  });

/**
 * The run meter's accounting-only fields, settled alongside `tokensUsed`/`cost`
 * so the result reports the prompt/completion split and the call count from
 * the SAME source as the total (they cannot disagree with it).
 */
export interface SettledRunSplit {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly llmCalls: number;
}

/** ctx.metadata key `settleRunSpend` writes and {@link readSettledRunSplit} reads. */
const SETTLED_SPLIT_KEY = "settledRunSplit";

const splitOf = (meter: RunBudgetMeter): SettledRunSplit => ({
  inputTokens: meter.inputTokens ?? 0,
  outputTokens: meter.outputTokens ?? 0,
  llmCalls: meter.llmCalls ?? 0,
});

const isSettledRunSplit = (v: unknown): v is SettledRunSplit =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as Record<string, unknown>)["inputTokens"] === "number" &&
  typeof (v as Record<string, unknown>)["outputTokens"] === "number" &&
  typeof (v as Record<string, unknown>)["llmCalls"] === "number";

/** The split `settleRunSpend` recorded; `undefined` when no meter was settled. */
export const readSettledRunSplit = (
  metadata: Readonly<Record<string, unknown>>,
): SettledRunSplit | undefined => {
  const v = metadata[SETTLED_SPLIT_KEY];
  return isSettledRunSplit(v) ? v : undefined;
};

/**
 * The run meter, exposed only when the run declared a budget; `null` otherwise
 * so `metadata.runBudgetSpend` stays absent on un-budgeted runs
 * (wire-or-delete honesty). The engine passes the ambient meter it read and
 * whether its own config declared a budget (`config.budgetLimits !== undefined`,
 * the same value it handed {@link armRunBudget}). A delegated child runs its own
 * engine with its own config, so a parent's budget flag never reaches a child.
 * Pure: the flag is engine config, known once at construction, not run state.
 */
export const budgetedRunMeter = (meter: RunBudgetMeter | null, declared: boolean): RunBudgetMeter | null =>
  declared ? meter : null;
