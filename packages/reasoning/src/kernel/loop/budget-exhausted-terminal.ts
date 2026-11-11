// File: src/kernel/loop/budget-exhausted-terminal.ts
/**
 * Terminal step: a run the Arbitrator's budget pre-guard ended
 * (`terminatedBy === "budget_exceeded"`, from `.withBudget({ tokenLimit |
 * costLimit })`) publishes `BudgetExhausted` with the exhausted budget's kind,
 * limit and spend.
 *
 * Before this step only the `budgetLimit()` killswitch path published the event
 * (`iterate-before-think-seam.ts`); a builder-budget stop surfaced only as
 * `terminatedBy` on the terminal event, so observers had no figures. The
 * figures come from {@link budgetSignalOfState}, the same derivation the
 * pre-guard read, so the event can never disagree with the decision. One event
 * per exhausted dimension (tokens, cost). It runs inside the kernel terminal
 * pipeline, so it fires before the runtime's terminal event.
 */
import { Effect } from "effect";
import { EventBus, emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { KernelState } from "../state/kernel-state.js";
import { budgetSignalOfState, exhaustedBudgets } from "../capabilities/decide/budget-signal.js";

/** Publish `BudgetExhausted` when the run ended on the budget pre-guard. Never alters state. */
export function publishBudgetExhaustedAtTerminal(
  state: KernelState,
  agentId: string,
): Effect.Effect<KernelState, never> {
  return Effect.gen(function* () {
    if (state.meta.terminatedBy !== "budget_exceeded") return state;
    const exhausted = exhaustedBudgets(budgetSignalOfState(state));
    if (exhausted.length === 0) return state;
    const busOpt = yield* Effect.serviceOption(EventBus);
    if (busOpt._tag !== "Some") return state;
    for (const b of exhausted) {
      yield* busOpt.value
        .publish({
          _tag: "BudgetExhausted",
          agentId,
          budgetType: b.budgetType,
          limit: b.limit,
          used: b.used,
          timestamp: Date.now(),
        })
        .pipe(
          Effect.catchAll((err) =>
            emitErrorSwallowed({
              site: "reasoning/src/kernel/loop/budget-exhausted-terminal.ts",
              tag: errorTag(err),
            }),
          ),
        );
    }
    return state;
  });
}
