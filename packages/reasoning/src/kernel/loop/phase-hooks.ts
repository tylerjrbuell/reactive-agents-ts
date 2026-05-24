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

export type HookAbort = { abort: 'stop' | 'terminate'; reason?: string };

export async function runPhaseHooks(
  pipeline: HarnessPipeline | undefined,
  kind: 'before' | 'after',
  phase: Phase,
  iteration: number,
  state: Readonly<KernelState>,
): Promise<HookAbort | undefined> {
  if (!pipeline) return undefined;
  const hooks = pipeline.collectPhaseHooks(kind, phase);
  for (const hook of hooks) {
    const result = await hook({ phase, iteration, state: asKernelStateLike(state) });
    if (result && typeof result === 'object' && 'abort' in result) {
      return result as HookAbort;
    }
  }
  return undefined;
}

/**
 * Derive the `meta.terminatedBy` value for a killswitch-driven abort.
 *
 * Killswitches return `{ abort, reason }` from their phase hooks where `reason`
 * is the OBSERVABILITY contract — it explains WHY the agent stopped
 * (e.g. `"budget-limit:tokens:1000/512"`, `"max-iterations:5"`,
 * `"timeout-after:30s"`). Prior to this helper, the 4 kernel abort-transition
 * sites (runner bootstrap, runner before-think, act before-act, act after-act)
 * dropped `abort.reason` on the floor and left `state.meta.terminatedBy`
 * undefined — making every killswitch firing silent.
 *
 * The fallback `killswitch:${abort.abort}` is the failure-mode sentinel for the
 * case where a killswitch implementation forgets to set a reason; downstream
 * consumers (event-bus, debrief, observability) can still see that a
 * killswitch fired and which abort verb it used.
 *
 * Killswitch reasons are dynamic strings (e.g. budget templating) and so are
 * intentionally NOT enumerated in `TerminateReason` — they are surfaced as
 * raw strings on `meta.terminatedBy` (typed `string`).
 */
export function killswitchTerminatedBy(abort: HookAbort): string {
  return abort.reason ?? `killswitch:${abort.abort}`;
}
