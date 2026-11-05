/**
 * Child spend probe + the ONE child-spend fold.
 *
 * A delegated child runs its own engine, which arms its own run meter
 * (`engine/run-budget-arm.ts`). Its spend reaches the parent only through
 * {@link foldChildMeter}, called by the spawning executor on BOTH exits:
 *
 * - success: the child's result reports its run meter (tokens, cost, in/out,
 *   llmCalls), read with {@link spendOfChildResult};
 * - failure / interruption: there is no result, so the probe's hook captures
 *   the child's live meter by reference and {@link ChildSpendProbe.read}
 *   snapshots it (D-2026-10-29-CHILD-COST).
 *
 * Reading the meter itself (not `ctx.tokensUsed` at phase boundaries) means
 * spend inside a phase that fails mid-way still counts: the observable LLM
 * wrapper feeds the meter per call, before any phase returns.
 */
import { Effect, FiberRef } from "effect";
import type { ResultMetadata } from "@reactive-agents/core";
import {
  CurrentRunBudget,
  addRunSpend,
  type RunBudgetMeter,
  type RunBudgetSpend,
} from "@reactive-agents/reasoning";
import type { LifecycleHook } from "../../types.js";

export interface ChildSpendProbe {
  /** Lifecycle hooks to register on the child engine. They only observe. */
  readonly hooks: ReadonlyArray<LifecycleHook>;
  /** Snapshot of the child's run meter; zero when the hook has not run yet. */
  readonly read: () => RunBudgetSpend;
}

/**
 * Build a probe. The child's meter is armed around its whole run and is one
 * object for that run, so one hook on the first phase (`bootstrap` before,
 * ahead of any LLM call) captures it. The hook runs on the child engine's
 * fiber, inside the child's `armRunBudget` scope, so the ambient meter it
 * reads IS the child's.
 */
export const makeChildSpendProbe = (): ChildSpendProbe => {
  let childMeter: RunBudgetMeter | null = null;
  const hook: LifecycleHook = {
    phase: "bootstrap",
    timing: "before",
    handler: (ctx) =>
      Effect.map(FiberRef.get(CurrentRunBudget), (meter) => {
        if (meter !== null) childMeter = meter;
        return ctx;
      }),
  };
  return { hooks: [hook], read: () => (childMeter === null ? { tokens: 0, cost: 0 } : { ...childMeter }) };
};

/** A successful child's spend, from the run meter its result reports. */
export const spendOfChildResult = (md: Partial<ResultMetadata> | undefined): RunBudgetSpend => ({
  tokens: md?.tokensUsed ?? 0,
  cost: md?.cost ?? 0,
  inputTokens: md?.inputTokens,
  outputTokens: md?.outputTokens,
  llmCalls: md?.llmCalls,
});

/**
 * Fold a child's spend into the parent's ambient run meter, exactly once per
 * child exit. No-op when no meter is armed. Returns the folded spend.
 */
export const foldChildMeter = (spend: RunBudgetSpend): Effect.Effect<RunBudgetSpend> =>
  addRunSpend(spend).pipe(Effect.as(spend));
