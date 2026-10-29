/**
 * Child spend probe — recovers a delegated child's spend when the child's
 * engine run FAILS (error channel / interruption) and so yields no
 * `TaskResult` to read `metadata.tokensUsed` from.
 *
 * D-2026-10-29-CHILD-COST: the parent's run meter used to fold a child's spend
 * only from a returned result; a crashed child's spend was dropped. The probe
 * registers lifecycle hooks on the child engine that record the child's
 * cumulative `ctx.tokensUsed` / `ctx.cost` after every phase (and at error).
 * The fold then happens at the SAME boundary as successes (the spawning
 * executor, into the ambient run-scoped meter).
 *
 * Known floor: spend inside a phase that itself fails (e.g. the `think` loop
 * erroring mid-iteration) only reaches the context when the phase returns, so
 * it is not recoverable here — the probe reports spend through the last
 * completed phase boundary.
 */
import type { LifecycleHook, LifecyclePhase } from "../../types.js";

/** Minimal meter shape (structurally `RunBudgetMeter` from reasoning). */
export interface SpendMeter {
  tokens: number;
  cost: number;
}

export interface ChildSpendProbe {
  /** Lifecycle hooks to register on the child engine. */
  readonly hooks: ReadonlyArray<LifecycleHook>;
  /** Highest cumulative spend observed so far. */
  readonly read: () => { readonly tokens: number; readonly cost: number };
}

const PHASES: ReadonlyArray<LifecyclePhase> = [
  "bootstrap", "guardrail", "cost-route", "strategy-select", "think", "act",
  "observe", "verify", "memory-flush", "cost-track", "audit", "complete",
];

/** Build a probe; hooks only observe (they return nothing). */
export const makeChildSpendProbe = (): ChildSpendProbe => {
  let tokens = 0;
  let cost = 0;
  const record = (ctx: { readonly tokensUsed: number; readonly cost: number }): void => {
    if (typeof ctx.tokensUsed === "number" && ctx.tokensUsed > tokens) tokens = ctx.tokensUsed;
    if (typeof ctx.cost === "number" && ctx.cost > cost) cost = ctx.cost;
  };
  const hooks: LifecycleHook[] = PHASES.flatMap((phase) =>
    (["after", "on-error"] as const).map((timing) => ({
      phase,
      timing,
      handler: (ctx: Parameters<LifecycleHook["handler"]>[0]) => {
        record(ctx);
      },
    })),
  );
  return { hooks, read: () => ({ tokens, cost }) };
};

/**
 * Fold a FAILED child's probed spend into the parent's ambient run meter.
 * No-op when no meter is armed (byte-identical to an unbudgeted run).
 */
export const foldFailedChildSpend = (
  meter: SpendMeter | null,
  probe: ChildSpendProbe,
): { readonly tokens: number; readonly cost: number } => {
  const spent = probe.read();
  if (meter !== null) {
    meter.tokens += spent.tokens;
    meter.cost += spent.cost;
  }
  return spent;
};
