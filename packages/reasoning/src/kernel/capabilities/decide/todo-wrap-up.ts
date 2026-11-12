/**
 * todo-wrap-up.ts — one bounded turn to reconcile open todo rows before the
 * model's final answer is accepted.
 *
 * The model's answer is written but its todo list still shows open rows: the
 * run reads as unfinished and hides missed steps. At the shared model-exit
 * point (`model-exit-proposal.ts`, never per strategy) the harness hands back
 * ONE guidance line naming the open rows and runs one more turn. It never
 * checks a row for the model (that would be dishonest) and never blocks twice:
 * the second finish attempt always proceeds. A run with no todo rows, or all
 * rows closed, is untouched. Deterministic (golden rule 5): no LLM, no clock.
 *
 * Ruling V5 rejected a terminal reminder as a verify-retry. This is not one:
 * it asks for no re-verification of the answer, only for the model's own
 * bookkeeping, and it is capped at one turn per run (owner decision 2026-11-11).
 *
 * The once-per-run record is a `harness_signal` step with a `todo-wrap-up`
 * intervention (receipt-visible, like the exit gate's denials); the signal
 * ledger is re-pinned by think.ts each pass, so it cannot carry this.
 */
import { contributeGuidance } from "../../state/guidance-channel.js";
import { transitionState, type KernelState } from "../../state/kernel-state.js";
import { ownItems } from "../reflect/checklist-reminder.js";
import { makeStep } from "../sense/step-utils.js";
import { authorityOf } from "./authority.js";

/** Intervention actor of the wrap-up step; the once-per-run cap counts steps by it. */
export const TODO_WRAP_UP_ACTOR = "todo-wrap-up";
const MAX_LISTED = 5;

/** The guidance line for the open rows (exported for pins). */
export function todoWrapUpText(open: readonly { readonly id: string; readonly title: string }[]): string {
  const listed = open.slice(0, MAX_LISTED).map((i) => `[${i.id}] ${i.title}`);
  if (open.length > MAX_LISTED) listed.push(`+${open.length - MAX_LISTED} more`);
  return (
    `${open.length} to-do item${open.length === 1 ? " is" : "s are"} still open: ${listed.join(", ")}. ` +
    "Mark finished ones done, remove ones no longer needed, or finish them, then give your final answer."
  );
}

/** True once the wrap-up turn was issued in this run. */
export const todoWrapUpIssued = (state: KernelState): boolean =>
  state.steps.some((s) => s.metadata?.intervention?.actor === TODO_WRAP_UP_ACTOR);

/**
 * True while the wrap-up turn is still owed its reply: the nudge was issued and
 * the model has written no thought since. A soft guard (low token delta,
 * stall...) firing in that window would hand off the answer the model already
 * wrote, turning a finish into a partial; the exit gate defers it instead
 * (`proposeExit`), exactly as it defers to the budget answer turn.
 */
export function todoWrapUpAwaitingReply(steps: KernelState["steps"]): boolean {
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i]!;
    if (s.metadata?.intervention?.actor === TODO_WRAP_UP_ACTOR) return true;
    if (s.type === "thought") return false;
  }
  return false;
}

/**
 * The wrap-up turn, or undefined when it does not apply: no open own rows,
 * the nudge was already issued this run, or no room for one more think
 * (iteration / call budget spent). Returns a `thinking` state carrying the
 * guidance; the caller treats it as a denied exit.
 */
export function stepTodoWrapUp(state: KernelState, maxIterations: number): KernelState | undefined {
  const open = ownItems(state.ledger).filter((i) => i.status === "pending" || i.status === "in_progress");
  if (open.length === 0 || todoWrapUpIssued(state)) return undefined;
  if (state.iteration >= maxIterations - 1 || (state.llmCalls ?? 0) >= maxIterations) return undefined;
  const text = todoWrapUpText(open);
  const step = makeStep("harness_signal", text, {
    intervention: {
      actor: TODO_WRAP_UP_ACTOR,
      authorityClass: authorityOf(TODO_WRAP_UP_ACTOR),
      evidence: `${open.length} todo row(s) open at the model's final answer`,
      whatChanged: "todo-wrap-up: held the final answer for one turn to reconcile open todo rows",
      iter: state.iteration,
    },
  });
  return transitionState(state, {
    status: "thinking",
    error: null,
    steps: [...state.steps, step],
    meta: { ...state.meta, terminatedBy: undefined },
    pendingGuidance: contributeGuidance(state.pendingGuidance, [{ kind: "checklistReminder", text }]),
  });
}
