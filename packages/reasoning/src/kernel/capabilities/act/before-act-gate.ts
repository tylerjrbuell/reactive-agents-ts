/**
 * before-act-gate.ts — the one place the act phase fires `before act` hooks.
 *
 * Fires the hooks once per pending tool call, in dispatch order, before ANY
 * call of the round executes. This is the boundary every act path (serial,
 * parallel batch, meta-tool) passes through, so a killswitch on `before act`
 * (`requireApprovalFor`-class) can stop every call, including a parallel
 * batch. Earlier the batch path fired these hooks only after its calls had run
 * (2026-11-18 extra-iterations diagnosis), and each serial call fired them
 * twice.
 *
 * During a hook, `state.meta.pendingToolCalls` and
 * `state.meta.pendingNativeToolCalls` both hold exactly the one call about to
 * run, with its healed name and arguments (so a misspelled tool name cannot
 * slip past a deny list). The stash is scoped to the hook call and never
 * persisted.
 */
import { Effect } from "effect";
import type { HarnessPipeline } from "@reactive-agents/core";
import type { ToolCallSpec } from "@reactive-agents/tools";
import type { KernelState } from "../../state/kernel-state.js";
import { runPhaseHooks, type HookAbort } from "../../loop/phase-hooks.js";

/**
 * Run `before act` hooks for each call. Returns the first abort, or
 * `undefined` when every call may run.
 *
 * @param pipeline - the run's harness pipeline (no pipeline: no hooks).
 * @param state - the kernel state at act entry.
 * @param calls - the round's calls, already healed, in dispatch order.
 */
export function runBeforeActHooks(
  pipeline: HarnessPipeline | undefined,
  state: KernelState,
  calls: readonly ToolCallSpec[],
): Effect.Effect<HookAbort | undefined> {
  return Effect.promise(async () => {
    for (const call of calls) {
      const scoped: KernelState = {
        ...state,
        meta: { ...state.meta, pendingToolCalls: [call], pendingNativeToolCalls: [call] },
      };
      const abort = await runPhaseHooks(pipeline, "before", "act", state.iteration, scoped);
      if (abort) return abort;
    }
    return undefined;
  });
}
