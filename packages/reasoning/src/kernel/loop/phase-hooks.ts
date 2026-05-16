/**
 * phase-hooks.ts — Shared harness phase-hook runner.
 *
 * Single implementation used by both the kernel loop (runner.ts) and the act
 * capability (act.ts). Previously act.ts hand-rolled this loop with
 * `Effect.promise(() => hook())`, which mismodels `PhaseHookFn`'s
 * sync-capable union return as `Promise<void>`. `await hook(...)` is the
 * correct invocation: it unwraps the `Promise<void>` branch and passes sync
 * control objects (`{abort}` / `{skip}`) through untouched.
 *
 * NOTE: `{skip: true}` is intentionally not acted on here — current behavior is
 * abort-only, matching the prior runner.ts implementation. Defining skip
 * semantics is tracked as separate follow-up.
 */
import type { HarnessPipeline, Phase } from "@reactive-agents/core";
import { type KernelState, asKernelStateLike } from "../state/kernel-state.js";

export async function runPhaseHooks(
  pipeline: HarnessPipeline | undefined,
  kind: 'before' | 'after',
  phase: Phase,
  iteration: number,
  state: Readonly<KernelState>,
): Promise<{ abort: 'stop' | 'terminate'; reason?: string } | undefined> {
  if (!pipeline) return undefined;
  const hooks = pipeline.collectPhaseHooks(kind, phase);
  for (const hook of hooks) {
    const result = await hook({ phase, iteration, state: asKernelStateLike(state) });
    if (result && typeof result === 'object' && 'abort' in result) {
      return result as { abort: 'stop' | 'terminate'; reason?: string };
    }
  }
  return undefined;
}
