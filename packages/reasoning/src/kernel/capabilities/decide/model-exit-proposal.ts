/**
 * model-exit-proposal.ts — the model proposes, the exit gate disposes
 * (Plan 9 item 2b, architecture-convergence program post-review item 10).
 *
 * A final answer the model writes in the think stage (the trivial end_turn
 * reply, the resolver's `final_answer`, a substantive answer-shaped thought)
 * is a CLAIM, not an accept. It becomes an `ExitProposal{proposedBy:"model"}`
 * and `kernel/loop/exit-gate.ts` disposes it on deterministic facts:
 * required tools missing from `state.evidence`, unmet delivery conditions,
 * and whether an answer draft exists. Lexical checks in the caller only
 * decide that the text is a draft worth proposing; they never accept.
 *
 *   - nothing outstanding → the Arbitrator owns the terminal verdict, exactly
 *     as before (veto, synthesis-grounding retry, grounded-terminal gate);
 *   - work outstanding → the gate denies the claim and the run continues with
 *     the outstanding list as guidance. A model claim never hands off.
 *
 * On a contract-poor task (no required tools, no delivery conditions) the
 * draft check is all there is, so the lexical signal decides there only.
 */
import { Effect } from "effect";
import { modelSynthesisDeliverable } from "@reactive-agents/core";
import type { KernelInput, KernelState } from "../../state/kernel-state.js";
import { proposeExit } from "../../loop/exit-gate.js";
import type { TerminationIntent } from "./arbitration-types.js";
import { arbitrateAndApply, arbitrationContextFromState } from "./arbitrator.js";

/** The intents a model-written answer carries into the Arbitrator once the gate accepts. */
export type ModelAnswerIntent = Extract<
  TerminationIntent,
  { readonly kind: "agent-final-answer" } | { readonly kind: "fast-path-completed" }
>;

/**
 * Propose the model's answer as an exit. `state` already records this turn
 * (steps, tokens, iteration). Returns the terminal state on accept, or the
 * `thinking` state carrying the gate's guidance on deny.
 */
export function proposeModelExit(
  state: KernelState,
  input: KernelInput,
  intent: ModelAnswerIntent,
): Effect.Effect<KernelState, never, never> {
  const arbitrateNow = (s: KernelState) =>
    arbitrateAndApply(
      s,
      intent,
      arbitrationContextFromState(s, { task: input.task, requiredTools: input.requiredTools }),
    );
  if (arbiterOwnsClaim(state, input)) return Effect.succeed(arbitrateNow(state));
  const viaRegex = intent.kind === "agent-final-answer" && intent.via === "regex";
  return proposeExit({
    state,
    input,
    proposal: {
      proposedBy: "model",
      kind: "model",
      reason: viaRegex ? "final_answer" : "end_turn",
      deliverable: modelSynthesisDeliverable({
        type: "thought",
        content: intent.output,
        iteration: state.iteration,
      }),
    },
    maxIterations: (state.meta.maxIterations as number | undefined) ?? 10,
    taskId: state.taskId,
    accept: (accepted) => Effect.succeed(arbitrateNow(accepted)),
  }).pipe(Effect.map((disposition) => disposition.state));
}

/**
 * Two classes the Arbitrator owns outright, ahead of the gate. Both are
 * deterministic and neither can end in a success the model merely claimed:
 *   - an exceeded budget: always an exit-failure (the budget dominates every
 *     termination signal, Issue #128);
 *   - F1's ungrounded terminal: required tools declared and not one
 *     substantive tool success yet. The grounded-terminal gate redirects once,
 *     then lets the run end as an honest abstention. A gate denial here would
 *     re-deny every turn until the cap and make that abstention unreachable.
 */
function arbiterOwnsClaim(state: KernelState, input: KernelInput): boolean {
  const ctx = arbitrationContextFromState(state, { task: input.task, requiredTools: input.requiredTools });
  if (ctx.budget?.status === "exceeded") return true;
  return ctx.requiredTools.length > 0 && !ctx.evidence.substantive;
}
