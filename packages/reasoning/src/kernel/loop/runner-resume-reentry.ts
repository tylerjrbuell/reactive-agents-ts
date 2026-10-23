/**
 * runner-resume-reentry.ts — durable HITL resume re-entry seams.
 *
 * Decomposed VERBATIM from `runner.ts` (quality program Task 9 / GH #222):
 *   - `ApprovalReentry` + `resolveApprovalReentry` — formerly lines 131-160.
 *   - `runApprovalResumeReentry` — approval-gate re-entry, formerly lines 745-832.
 *   - `runInteractionResumeReentry` — request_user_input re-entry, formerly
 *     lines 834-886.
 *
 * runner.ts delegates to these functions and RE-EXPORTS `resolveApprovalReentry`
 * + `ApprovalReentry` so the stable `kernel/loop/runner.js` import surface is
 * unchanged (zero consumer edits). Bodies are byte-identical to the originals
 * modulo the destructured params (Task 4 rule: explicit deps, live instances).
 */
import { Effect } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import { REQUEST_USER_INPUT_TOOL_NAME } from "@reactive-agents/tools";
import {
  transitionState,
  type KernelState,
  type KernelContext,
  type KernelInput,
  type KernelMessage,
} from "../../kernel/state/kernel-state.js";
import { handleActing } from "../capabilities/act/act.js";
import { makeStep } from "../capabilities/sense/step-utils.js";


/** How a resumed run re-enters at a pending approval gate. */
export interface ApprovalReentry {
  readonly action: "execute" | "observe" | "none";
  readonly call?: { readonly name: string; readonly arguments: unknown };
  readonly observation?: string;
}

/**
 * Map a stored approval gate + the human's decision to a re-entry action. Pure:
 * approved → execute the EXACT stored call (no LLM re-think, so the executed call
 * is the one the human saw — spec §7 determinism); denied → observe the denial so
 * the next think reacts; gateId mismatch → no-op (fall through to normal think).
 */
export function resolveApprovalReentry(
  gate: { readonly gateId: string; readonly toolName: string; readonly args: unknown },
  decision: { readonly gateId: string; readonly status: "approved" | "denied"; readonly reason?: string } | undefined,
): ApprovalReentry {
  if (!decision || decision.gateId !== gate.gateId) return { action: "none" };
  if (decision.status === "approved") {
    return { action: "execute", call: { name: gate.toolName, arguments: gate.args } };
  }
  return {
    action: "observe",
    observation: `Action ${gate.toolName} was denied by a human${
      decision.reason ? `: ${decision.reason}` : ""
    }.`,
  };
}

/**
 * Approval-gate resume re-entry (Phase D) — formerly runner.ts lines 745-832.
 */
export function runApprovalResumeReentry(args: {
  readonly state: KernelState;
  readonly effectiveInput: KernelInput;
  readonly currentContext: KernelContext;
}): Effect.Effect<KernelState, never, LLMService> {
  return Effect.gen(function* () {
    let state = args.state;
    const { effectiveInput, currentContext } = args;

    // ── Durable HITL resume re-entry (Phase D) ───────────────────────────────
    // When resuming a checkpoint that paused at an approval gate, apply the
    // human's stored decision HERE — before the loop — so the gated step is
    // resolved without re-calling the LLM (spec §7 determinism). Approved:
    // execute the exact stored call once via the act capability, with
    // `approvalBypass` set so the gate does not re-pause it. Denied: inject the
    // denial as an LLM-visible message so the next think reacts. No-op on a
    // normal run (both fields undefined → zero cost).
    //
    // The paused checkpoint is a clean terminal state (act.ts terminate on
    // pause: status:"done", terminatedBy:"awaiting-approval", a sentinel
    // output). We MUST reset those terminal fields on resume — exactly as the
    // interaction re-entry directly below does — so the main loop re-runs and
    // synthesizes a real answer instead of returning the pause sentinel. The
    // "execute" branch happened to work without this reset (handleActing sets
    // status back to "acting"/"thinking" as a side effect), but the "observe"
    // (deny) branch does NOT run a tool: without the reset, status stayed
    // "done", the main loop was skipped, and denyRun returned "Run paused —
    // awaiting human approval." as the final answer. Reset unconditionally so
    // both branches re-enter the loop.
    if (state.meta.awaitingApprovalFor && effectiveInput.approvalDecision) {
      const gate = state.meta.awaitingApprovalFor;
      const reentry = resolveApprovalReentry(gate, effectiveInput.approvalDecision);
      if (reentry.action !== "none") {
        state = transitionState(state, {
          status: "thinking",
          output: null,
          meta: {
            ...state.meta,
            awaitingApprovalFor: undefined,
            terminatedBy: undefined,
          },
        });
      }
      if (reentry.action === "execute" && reentry.call) {
        state = transitionState(state, {
          meta: {
            ...state.meta,
            approvalBypass: true,
            pendingNativeToolCalls: [
              {
                id: crypto.randomUUID(),
                name: reentry.call.name,
                arguments: (reentry.call.arguments ?? {}) as Record<string, unknown>,
              },
            ],
          },
        });
        state = yield* handleActing(state, currentContext);
        state = transitionState(state, {
          meta: { ...state.meta, approvalBypass: undefined },
        });
      } else if (reentry.action === "observe" && reentry.observation) {
        // Inject the denial as an LLM-VISIBLE message pair (synthetic assistant
        // tool-call + tool_result), not only a step: prompt assembly
        // (fromKernelState) builds the EventLog from state.messages, NOT steps,
        // so a bare observation step is invisible to the next think and the
        // model would never learn its action was denied. Mirrors the
        // interaction re-entry's tool_result injection. The act gate paused
        // BEFORE assembleConversation ran, so state.messages has no record of
        // the gated call — synthesize the assistant-call + tool_result pair here
        // (keyed on the stored gateId) so the denial renders as that call's
        // result. Keep the observation step too, for the systems-observed
        // record (entropy/metrics/debrief).
        const observation = reentry.observation;
        const assistantCall: KernelMessage = {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: gate.gateId,
              name: gate.toolName,
              arguments: (gate.args ?? {}) as Record<string, unknown>,
            },
          ],
        };
        const toolResult: KernelMessage = {
          role: "tool_result",
          toolCallId: gate.gateId,
          toolName: gate.toolName,
          content: observation,
        };
        state = transitionState(state, {
          messages: [...state.messages, assistantCall, toolResult],
          steps: [...state.steps, makeStep("observation", observation)],
        });
      }
    }
    return state;
  });
}

export function runInteractionResumeReentry(args: {
  readonly state: KernelState;
  readonly effectiveInput: KernelInput;
}): Effect.Effect<KernelState, never, never> {
  return Effect.gen(function* () {
    let state = args.state;
    const { effectiveInput } = args;

    // ── Durable interaction resume re-entry (Task 10) ────────────────────────
    // Mirrors the approval re-entry directly above for the request_user_input
    // rail. When resuming a checkpoint that paused for user interaction, inject
    // the human's stored response HERE — before the loop — as an observation the
    // next think reacts to, then clear `meta.awaitingInteractionFor`. Unlike
    // approvals there is NO execute/skip branch: an interaction response is
    // ALWAYS injected as the pending call's result. The paused checkpoint carries
    // `status:"done"` + a sentinel output (act.ts terminate on pause), so we also
    // reset the terminal fields — status back to "thinking", output/terminatedBy
    // cleared — so the main loop re-runs and synthesizes a fresh answer from the
    // injected response instead of returning the pause sentinel. No-op on a
    // normal run (both fields undefined → zero cost).
    if (state.meta.awaitingInteractionFor && effectiveInput.interactionResponse) {
      const pending = state.meta.awaitingInteractionFor;
      const response = effectiveInput.interactionResponse;
      if (response.interactionId === pending.interactionId) {
        // The act gate paused BEFORE assembleConversation ran, so state.messages
        // has no record of the request_user_input call. Synthesize the
        // assistant-call + tool_result pair here so the prompt-assembly path
        // (fromKernelState builds the EventLog from state.messages, NOT steps)
        // renders the human's answer as the pending call's result. A plain
        // observation step alone would be invisible to the LLM prompt.
        const observation = `The user responded: ${response.valueJson}`;
        const assistantCall: KernelMessage = {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: pending.interactionId,
              name: REQUEST_USER_INPUT_TOOL_NAME,
              arguments: { kind: pending.kind, prompt: pending.prompt },
            },
          ],
        };
        const toolResult: KernelMessage = {
          role: "tool_result",
          toolCallId: pending.interactionId,
          toolName: REQUEST_USER_INPUT_TOOL_NAME,
          content: observation,
        };
        state = transitionState(state, {
          status: "thinking",
          output: null,
          messages: [...state.messages, assistantCall, toolResult],
          steps: [...state.steps, makeStep("observation", observation)],
          meta: {
            ...state.meta,
            awaitingInteractionFor: undefined,
            terminatedBy: undefined,
          },
        });
      }
    }
    return state;
  });
}
