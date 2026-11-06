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
import { proposeExit, type ExitGateDecision, type ExitProposal } from "../../loop/exit-gate.js";
import type { TerminateReason } from "../../loop/terminate.js";
import type { TerminationIntent } from "./arbitration-types.js";
import { arbitrateAndApply, arbitrationContextFromState } from "./arbitrator.js";

/** The intents a model-written answer carries into the Arbitrator once the gate accepts. */
export type ModelAnswerIntent = Extract<
  TerminationIntent,
  | { readonly kind: "agent-final-answer" }
  | { readonly kind: "fast-path-completed" }
  | { readonly kind: "oracle-decision" }
>;

/** The gate's decision on a model proposal and the next state. `arbiter` = the Arbitrator owned it outright. */
export interface ModelExitDisposition {
  readonly decision: ExitGateDecision | "arbiter";
  readonly state: KernelState;
}

/**
 * Propose the model's answer as an exit. `state` already records this turn
 * (steps, tokens, iteration). Returns the terminal state on accept, or the
 * `thinking` state carrying the gate's guidance on deny.
 */
export function proposeModelExit(
  state: KernelState,
  input: KernelInput,
  intent: ModelAnswerIntent,
  extraMeta?: Record<string, unknown>,
): Effect.Effect<KernelState, never, never> {
  return disposeModelExit(state, input, intent, extraMeta).pipe(Effect.map((d) => d.state));
}

/** {@link proposeModelExit}, keeping the gate's decision (the act phase answers a denied tool call). */
export function disposeModelExit(
  state: KernelState,
  input: KernelInput,
  intent: ModelAnswerIntent,
  extraMeta?: Record<string, unknown>,
): Effect.Effect<ModelExitDisposition, never, never> {
  const arbitrateNow = (s: KernelState) =>
    arbitrateAndApply(
      s,
      intent,
      arbitrationContextFromState(s, { task: input.task, requiredTools: input.requiredTools }),
      extraMeta,
    );
  if (arbiterOwnsClaim(state, input, intent)) {
    return Effect.succeed({ decision: "arbiter", state: arbitrateNow(state) });
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
    accept: (accepted) => Effect.succeed(arbitrateNow(accepted)),
  });
}

/**
 * Who proposes the exit. The oracle's `controller_early_stop` verdict is the
 * harness controller's decision, not the model's: it is a SOFT guard proposal
 * (one deny-once nudge, then handoff), the same as the runner's own dispatcher
 * early-stop (`loop/iterate-early-stop-seam.ts`). Every other intent is the
 * model's claim (denied with `deny` while work is outstanding).
 */
function proposalOrigin(
  intent: ModelAnswerIntent,
): Pick<ExitProposal, "proposedBy" | "kind" | "reason"> {
  if (intent.kind === "oracle-decision" && (intent.decision.reason ?? "").startsWith("controller_early_stop")) {
    return { proposedBy: "dispatcher_early_stop", kind: "soft", reason: "dispatcher-early-stop" };
  }
  return { proposedBy: "model", kind: "model", reason: proposalReason(intent) };
}

/** The terminatedBy the claim would end with; the gate record and event carry it. */
function proposalReason(intent: ModelAnswerIntent): TerminateReason {
  if (intent.kind === "fast-path-completed") return "end_turn";
  if (intent.kind === "agent-final-answer") {
    return intent.via === "tool" ? "final_answer_tool" : intent.via === "regex" ? "final_answer" : "end_turn";
  }
  const reason = intent.decision.reason ?? "";
  if (reason === "final_answer_regex" || reason === "content_stable") return reason;
  return reason.startsWith("entropy_converged") ? "entropy_converged" : "llm_end_turn";
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
function arbiterOwnsClaim(state: KernelState, input: KernelInput, intent: ModelAnswerIntent): boolean {
  if (intent.kind === "oracle-decision" && intent.decision.action !== "exit") return true;  const ctx = arbitrationContextFromState(state, { task: input.task, requiredTools: input.requiredTools });
  if (ctx.budget?.status === "exceeded") return true;
  return ctx.requiredTools.length > 0 && !ctx.evidence.substantive;
}
