/**
 * Think phase — the standard thinking handler (the resolver's `thinking` arm
 * when no strike guard or exit proposal took the turn). Moved verbatim out of
 * `dispatch-think-response.ts` (LOC-pinned shell) so the unavailable-tool hint
 * could join its guidance without growing the shell.
 *
 * The turn continues: the thought is recorded, and the next request's
 * `Guidance:` block carries the required-tools nudge (when tools are missing)
 * and the unavailable-tool hint (when the model named a tool off its surface).
 * Both ride the ONE guidance channel; nothing is written to `messages`.
 */
import type { ProviderAdapter } from "@reactive-agents/llm-provider";
import type { ContextProfile } from "../../../context/context-profile.js";
import { transitionState, type KernelInput, type KernelState } from "../../state/kernel-state.js";
import { guidanceOf, textSignal } from "../../state/guidance-channel.js";
import { makeStep } from "../sense/step-utils.js";
import { makeObservationResult } from "../../utils/observation-helpers.js";
import { guardDiminishingReturns } from "./think-guards.js";
import { countEmptyNudges, UNRESOLVED_STEP_META, type UnresolvedTurn } from "./unresolved-tool-call.js";

/** Everything the standard thinking handler reads from the dispatch stage. */
export interface ContinueThinkingParams {
  readonly state: KernelState;
  readonly input: KernelInput;
  readonly profile: ContextProfile;
  readonly adapter: ProviderAdapter;
  readonly turn: UnresolvedTurn;
  readonly thinkingContent: string;
  /** The reply was tool-call-shaped but unresolved (step is tagged for strike accounting). */
  readonly shaped: boolean;
  readonly reqTools: readonly string[];
  readonly missingReq: readonly string[];
  /** The unavailable-tool hint (`unavailable-tool-hint.ts`), when the model named an off-surface tool. */
  readonly unavailableHint: string | undefined;
}

/** The continuing state for a `thinking` turn (or the diminishing-returns redirect). */
export function continueThinking(p: ContinueThinkingParams): KernelState {
  const { state, input, profile, adapter, thinkingContent, shaped, reqTools, missingReq } = p;
  const { newSteps, newTokens, newInputTokens, newOutputTokens, newCost } = p.turn;
  // Note: Even if all required tools are met, we continue the loop to
  // allow the model to call final-answer explicitly. The act phase will
  // accept final-answer once all required tools are satisfied.
  const consecutiveEmpty = !thinkingContent ? countEmptyNudges(newSteps) : 0;

  let thinkingSteps = [...newSteps];
  if (thinkingContent) {
    thinkingSteps = [...thinkingSteps, makeStep("thought", thinkingContent, shaped ? UNRESOLVED_STEP_META : undefined)];
  }

  let nudgeMessage: string | undefined;
  if (missingReq.length > 0) {
    const quantities = input.requiredToolQuantities ?? {};
    const successCounts = state.evidence.successfulCounts;
    const missingWithProgress = missingReq.map((t) => {
      const needed = quantities[t];
      if (!needed || needed <= 1) return t;
      const actual = successCounts[t] ?? 0;
      return `${t} (${actual}/${needed} calls done)`;
    });
    const isStuck = consecutiveEmpty >= 2;
    const defaultNudge = isStuck
      ? `⚠️ ACTION REQUIRED: You have not made progress. You MUST call: ${missingWithProgress.join(", ")} RIGHT NOW. Stop waiting and use the tool immediately.`
      : `Continue working on the task. You still need to call: ${missingWithProgress.join(", ")}. Use the available tools to complete the task.`;

    const lastObsForHint = state.steps.filter((s) => s.type === "observation").pop();
    const lastActionForHint = state.steps.filter((s) => s.type === "action").pop();
    const lastToolNameForHint = (lastActionForHint?.metadata?.toolCall as { name?: string } | undefined)?.name;
    const adapterNudge = adapter.continuationHint?.({
      toolsUsed: state.toolsUsed,
      requiredTools: reqTools,
      missingTools: missingReq,
      iteration: state.iteration,
      maxIterations: (state.meta.maxIterations as number) ?? 10,
      lastToolName: lastToolNameForHint,
      lastToolResultPreview: lastObsForHint?.content?.slice(0, 200),
    });

    nudgeMessage = adapterNudge ?? defaultNudge;

    // Layer 1: Novelty signal — strengthen nudge when recent observations add little new info.
    // Extracted to think-guards.guardDiminishingReturns. When the guard fires it returns the
    // full thinking-branch redirect state; when it passes through (novelty high, <3 real obs,
    // or empty observations) we continue with the default/adapter nudge below.
    const diminishingRedirect = guardDiminishingReturns(
      state,
      input,
      profile,
      newTokens,
      newCost,
      {
        thinkingContent,
        thinkingSteps,
        missingReq,
        adapterOrDefaultNudge: nudgeMessage,
      },
    );
    if (diminishingRedirect) return diminishingRedirect;

    thinkingSteps = [...thinkingSteps, makeStep("observation", nudgeMessage, {
      observationResult: makeObservationResult("system", true, nudgeMessage),
    })];
  }

  // Route nudge through pendingGuidance instead of injecting a synthetic USER
  // message into the conversation thread. Rendered in the Guidance: section of
  // the next system prompt. Keeps the FC thread clean. The unavailable-tool
  // hint rides its own kind: it explains why the last call did nothing.
  const signals = [
    ...(nudgeMessage ? [{ kind: "requiredToolsPending" as const, tools: missingReq }] : []),
    ...textSignal("toolUnavailable", p.unavailableHint),
    ...textSignal("errorRecovery", nudgeMessage),
  ];
  return transitionState(state, {
    steps: thinkingSteps,
    tokens: newTokens,
    inputTokens: newInputTokens,
    outputTokens: newOutputTokens,
    cost: newCost,
    iteration: state.iteration + 1,
    priorThought: thinkingContent || state.priorThought,
    pendingGuidance: signals.length > 0 ? guidanceOf(signals) : undefined,
  });
}
