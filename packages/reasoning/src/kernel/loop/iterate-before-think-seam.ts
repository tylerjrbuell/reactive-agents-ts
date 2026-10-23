/**
 * iterate-before-think-seam.ts — 'before think' phase-hook dispatch +
 * killswitch abort handling, decomposed VERBATIM from iterate-pass.ts
 * (quality program Task 9 / GH #222; formerly lines 815-859).
 *
 * The abort branch's `return "break"` adapts to a returned `aborted: true`
 * flag the driver honors (control-flow-only deviation). BudgetExhausted
 * publish (D-1 amendment) + the P1-mission-2B dynamic-terminatedBy transition
 * discipline (status/terminatedBy via transitionState, output ONLY through
 * commitDeliverable on the "done" branch) are preserved byte-identically.
 */
import { Effect } from "effect";
import type { KernelInput } from "../state/kernel-state.js";
import { runPhaseHooks, killswitchTerminatedBy } from "./phase-hooks.js";
import { publishReasoningStep } from "../utils/service-utils.js";
import {
  commitDeliverable,
  passthroughOutputDeliverable,
} from "./runner-helpers/deliverable.js";
import { transitionState, type KernelState } from "../../kernel/state/kernel-state.js";

/** Fire the 'before think' hooks and apply a killswitch abort if one lands. */
export function runBeforeThinkHooks(args: {
  state: KernelState;
  readonly effectiveInput: KernelInput;
  readonly eventBus: Parameters<typeof publishReasoningStep>[0];
  readonly dispatchesThink: boolean;
}): Effect.Effect<{ state: KernelState; aborted: boolean }, never, never> {
  return Effect.gen(function* () {
    let state = args.state;
    const { effectiveInput, eventBus, dispatchesThink } = args;

      // 'before think' hooks — may abort iteration
      const beforeThinkAbort = dispatchesThink
        ? yield* Effect.promise(() =>
            runPhaseHooks(effectiveInput.harnessPipeline, 'before', 'think', state.iteration, state)
          )
        : undefined;
      if (beforeThinkAbort) {
        // D-1 amendment (2026-08-27 dead-signal-wiring plan, Task 3
        // narrowed): `before('think')` is the ONE runtime site that consumes
        // a killswitch abort carrying budget `meta` (currently only
        // `budgetLimit()`, packages/compose/src/killswitches/budget-limit.ts)
        // — `act.ts`'s before/after('act')/('observe') aborts never see this
        // killswitch. Publish before the state transition below so the event
        // fires even on the abort path; real figures only (never fabricated),
        // straight from the killswitch's own computation.
        if (beforeThinkAbort.meta) {
          const meta = beforeThinkAbort.meta;
          yield* publishReasoningStep(eventBus, {
            _tag: "BudgetExhausted",
            agentId: effectiveInput.agentId ?? "reasoning-agent",
            budgetType: meta.budgetType,
            limit: meta.limit,
            used: meta.used,
            timestamp: Date.now(),
          });
        }
        // P1 mission 2B: killswitch abort carries a DYNAMIC terminatedBy (not a
        // TerminateReason), so it can't route through terminate(). Set
        // status + terminatedBy via transitionState (NO output key), then —
        // only on the successful "done" branch — route the output string
        // through the single writer commitDeliverable. The "failed" branch
        // drops the key so the transitionState invariant nulls the output.
        const aborted = beforeThinkAbort.abort === 'terminate';
        state = transitionState(state, {
          status: aborted ? 'failed' : 'done',
          meta: {
            ...state.meta,
            terminatedBy: killswitchTerminatedBy(beforeThinkAbort),
          },
        });
        if (!aborted) {
          state = commitDeliverable(state, passthroughOutputDeliverable(state.output));
        }
        return { state, aborted: true };
      }
    return { state, aborted: false };
  });
}
