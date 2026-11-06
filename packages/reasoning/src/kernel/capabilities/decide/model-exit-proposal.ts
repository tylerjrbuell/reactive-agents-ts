/**
 * model-exit-proposal.ts — the model proposes, the exit gate disposes
 * (Plan 9 item 2b, architecture-convergence program post-review item 10).
 *
 * A final answer the model writes is a CLAIM, not an accept: the trivial
 * end_turn reply, the resolver's `final_answer`, a substantive answer-shaped
 * thought (think dispatch), the final-answer TOOL (act), and the termination
 * oracle's exit verdict on the model's text (think termination stage). Each
 * becomes an `ExitProposal{proposedBy:"model"}` and `kernel/loop/exit-gate.ts`
 * disposes it on deterministic facts: required tools missing from
 * `state.evidence`, unmet delivery conditions, and whether an answer draft
 * exists. Lexical checks in the caller only decide that the text is a draft
 * worth proposing; they never accept.
 *
 *   - nothing outstanding → the Arbitrator owns the terminal verdict, exactly
 *     as before (veto, synthesis-grounding retry, grounded-terminal gate);
 *   - work outstanding → the gate denies the claim (`deny`) and the run
 *     continues with the outstanding list as guidance. A model claim never
 *     hands off.
 *
 * On a contract-poor task (no required tools, no delivery conditions) the
 * draft check is all there is, so the lexical signal decides there only.
 *
 * One oracle exit is not the model's: `controller_early_stop` is a harness
 * controller decision and goes to the gate as a soft guard proposal (see
 * `proposalOrigin`).
 */
import { Effect } from "effect";
import { modelSynthesisDeliverable } from "@reactive-agents/core";
import type { KernelInput, KernelState } from "../../state/kernel-state.js";
import { DISPATCHER_EARLY_STOP, proposeExit, type ExitGateDecision, type ExitProposal } from "../../loop/exit-gate.js";
import { isTemplatedTerminateReason } from "../../loop/terminate-reason.js";
import type { ArbitrationContext } from "./arbitration-types.js";
import { arbitrateAndApply, arbitrationContextFromState } from "./arbitrator.js";
import { terminatedByOfIntent, type ModelAnswerIntent } from "./intent-terminated-by.js";

/** The gate's decision on a model proposal and the next state. `arbiter` = the Arbitrator owned it outright. */
export interface ModelExitDisposition {
  readonly decision: ExitGateDecision | "arbiter";
  readonly state: KernelState;
}

/**
 * Propose the model's answer as an exit. `state` already records this turn
 * (steps, tokens, iteration). The state is terminal on accept, or `thinking`
 * with the gate's guidance on deny; the decision lets the act phase answer a
 * denied final-answer tool call.
 */
export function disposeModelExit(
  state: KernelState,
  input: KernelInput,
  intent: ModelAnswerIntent,
  extraMeta?: Record<string, unknown>,
): Effect.Effect<ModelExitDisposition, never, never> {
  const contextOf = (s: KernelState) =>
    arbitrationContextFromState(s, { task: input.task, requiredTools: input.requiredTools });
  const ctx = contextOf(state);
  if (arbiterOwnsClaim(ctx, intent)) {
    return Effect.succeed({ decision: "arbiter", state: arbitrateAndApply(state, intent, ctx, extraMeta) });
  }
  return proposeExit({
    state,
    input,
    proposal: {
      ...proposalOrigin(intent),
      deliverable: modelSynthesisDeliverable({
        type: "thought",
        content: intent.output,
        iteration: state.iteration,
      }),
    },
    maxIterations: (state.meta.maxIterations as number | undefined) ?? 10,
    taskId: state.taskId,
    accept: (accepted) => Effect.succeed(arbitrateAndApply(accepted, intent, contextOf(accepted), extraMeta)),
  });
}

/**
 * Who proposes the exit, and the reason the gate records: the terminatedBy the
 * Arbitrator would end the run with ({@link terminatedByOfIntent}). The oracle's
 * `controller_early_stop:` verdict (a templated reason) is the harness
 * controller's decision, not the model's: it is a SOFT guard proposal (one
 * deny-once nudge, then handoff), the same as the runner's own dispatcher
 * early-stop (`loop/iterate-early-stop-seam.ts`). Every other intent is the
 * model's claim (denied with `deny` while work is outstanding).
 */
function proposalOrigin(
  intent: ModelAnswerIntent,
): Pick<ExitProposal, "proposedBy" | "kind" | "reason"> {
  const reason = terminatedByOfIntent(intent);
  if (isTemplatedTerminateReason(reason)) return DISPATCHER_EARLY_STOP;
  return { proposedBy: "model", kind: "soft", reason };
}

/**
 * Classes the Arbitrator owns outright, ahead of the gate. All are
 * deterministic and none can end in a success the model merely claimed:
 *   - an oracle verdict that is not an exit (the veto's `fail`): a failure,
 *     not a claim;
 *   - an exceeded budget: always an exit-failure (the budget dominates every
 *     termination signal, Issue #128);
 *   - F1's ungrounded terminal: required tools declared and not one
 *     substantive tool success yet. The grounded-terminal gate redirects once,
 *     then lets the run end as an honest abstention. A gate denial here would
 *     re-deny every turn until the cap and make that abstention unreachable.
 */
function arbiterOwnsClaim(ctx: ArbitrationContext, intent: ModelAnswerIntent): boolean {
  if (intent.kind === "oracle-decision" && intent.decision.action !== "exit") return true;
  if (ctx.budget?.status === "exceeded") return true;
  return ctx.requiredTools.length > 0 && !ctx.evidence.substantive;
}
