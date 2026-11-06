/**
 * iterate-before-think-seam.ts — 'before think' phase-hook dispatch +
 * killswitch abort handling, decomposed VERBATIM from iterate-pass.ts
 * (quality program Task 9 / GH #222; formerly lines 815-859).
 *
 * The abort branch is a harness-authority exit proposal the exit gate accepts,
 * returned as `exit` for the turn runner (Plan 9 Phase 4). BudgetExhausted
 * publish (D-1 amendment) is preserved byte-identically; the P1-mission-2B
 * dynamic-terminatedBy transition (status/terminatedBy via transitionState,
 * output ONLY through commitDeliverable on the "done" branch) now runs in the
 * gate's `killswitch` end (`exit-gate.ts`).
 */
import { Effect } from "effect";
import type { KernelInput } from "../state/kernel-state.js";
import { runPhaseHooks, killswitchTerminatedBy } from "./phase-hooks.js";
import { publishReasoningStep } from "../utils/service-utils.js";
import { proposeHarnessExit, type ExitDisposition } from "./exit-gate.js";
import { type KernelState } from "../../kernel/state/kernel-state.js";

/** Fire the 'before think' hooks and propose a killswitch exit if one lands. */
export function runBeforeThinkHooks(args: {
  state: KernelState;
  readonly effectiveInput: KernelInput;
  readonly eventBus: Parameters<typeof publishReasoningStep>[0];
  readonly dispatchesThink: boolean;
}): Effect.Effect<{ state: KernelState; exit: ExitDisposition | null }, never, never> {
  return Effect.gen(function* () {
    const state = args.state;
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
        // TerminateReason), so it can't route through terminate(): the gate's
        // `killswitch` end sets status + terminatedBy and, only on "done",
        // commits the current output through commitDeliverable.
        const exit = proposeHarnessExit(state, {
          proposedBy: "harness",
          end: {
            via: "killswitch",
            terminatedBy: killswitchTerminatedBy(beforeThinkAbort),
            aborted: beforeThinkAbort.abort === 'terminate',
          },
        });
        return { state: exit.state, exit };
      }
    return { state, exit: null };
  });
}
