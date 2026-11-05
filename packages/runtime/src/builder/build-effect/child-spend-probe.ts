/**
 * Child spend probe + the ONE child-spend fold.
 *
 * A delegated child runs its own engine, which arms its own run meter
 * (`engine/run-budget-arm.ts`). Its spend reaches the parent only through
 * {@link foldChildMeter}, called by the spawning executor on BOTH exits:
 *
 * - success: the child's result reports its run meter (tokens, cost, in/out,
 *   llmCalls), read with {@link spendOfChildResult};
 * - failure / interruption: there is no result, so the probe's hooks capture
 *   the child's live meter by reference and {@link ChildSpendProbe.read}
 *   snapshots it (D-2026-10-29-CHILD-COST).
 *
 * Reading the meter itself (not `ctx.tokensUsed` at phase boundaries) means
 * spend inside a phase that fails mid-way still counts: the observable LLM
 * wrapper feeds the meter per call, before any phase returns.
 */
import { Effect, FiberRef } from "effect";
import {
  CurrentRunBudget,
  addRunSpend,
  type RunBudgetMeter,
  type RunBudgetSpend,
} from "@reactive-agents/reasoning";
import type { LifecycleHook, LifecyclePhase } from "../../types.js";

/** The full spend a child folds into its parent's meter. */
export interface ChildSpend {
  readonly tokens: number;
  readonly cost: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly llmCalls: number;
}

const ZERO_SPEND: ChildSpend = { tokens: 0, cost: 0, inputTokens: 0, outputTokens: 0, llmCalls: 0 };

export interface ChildSpendProbe {
  /** Lifecycle hooks to register on the child engine. They only observe. */
  readonly hooks: ReadonlyArray<LifecycleHook>;
  /** Snapshot of the child's run meter; zero when no hook has run yet. */
  readonly read: () => ChildSpend;
}

const PHASES: ReadonlyArray<LifecyclePhase> = [
  "bootstrap", "guardrail", "cost-route", "strategy-select", "think", "act",
  "observe", "verify", "memory-flush", "cost-track", "audit", "complete",
];

/** Snapshot a meter into a {@link ChildSpend} (absent split fields read 0). */
const snapshot = (meter: RunBudgetMeter): ChildSpend => ({
  tokens: meter.tokens,
  cost: meter.cost,
  inputTokens: meter.inputTokens ?? 0,
  outputTokens: meter.outputTokens ?? 0,
  llmCalls: meter.llmCalls ?? 0,
});

/**
 * Build a probe. Every hook runs on the child engine's fiber, inside the
 * child's `armRunBudget` scope, so the ambient meter it reads IS the child's.
 */
export const makeChildSpendProbe = (): ChildSpendProbe => {
  let childMeter: RunBudgetMeter | null = null;
  const hooks: LifecycleHook[] = PHASES.flatMap((phase) =>
    (["before", "after", "on-error"] as const).map((timing) => ({
      phase,
      timing,
      handler: (ctx: Parameters<LifecycleHook["handler"]>[0]) =>
        Effect.map(FiberRef.get(CurrentRunBudget), (meter) => {
          if (meter !== null) childMeter = meter;
          return ctx;
        }),
    })),
  );
  return { hooks, read: () => (childMeter === null ? ZERO_SPEND : snapshot(childMeter)) };
};

/** Structural view of the child result metadata fields the fold reads. */
export interface ChildResultSpendFields {
  readonly tokensUsed?: number;
  readonly cost?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly llmCalls?: number;
}

/** A successful child's spend, from the run meter its result reports. */
export const spendOfChildResult = (md: ChildResultSpendFields | undefined): ChildSpend => ({
  tokens: typeof md?.tokensUsed === "number" ? md.tokensUsed : 0,
  cost: typeof md?.cost === "number" ? md.cost : 0,
  inputTokens: md?.inputTokens ?? 0,
  outputTokens: md?.outputTokens ?? 0,
  llmCalls: md?.llmCalls ?? 0,
});

/**
 * Fold a child's spend into the parent's ambient run meter, exactly once per
 * child exit. No-op when no meter is armed. Returns the folded spend.
 */
export const foldChildMeter = (spend: ChildSpend): Effect.Effect<ChildSpend> =>
  addRunSpend(spend satisfies RunBudgetSpend).pipe(Effect.as(spend));
