/**
 * Think phase — unresolved-tool-call strike guard (F2,
 * wiki/Research/Harness-Reports/2026-10-29-text-tool-call-root-cause.md).
 *
 * The tool-call resolver returns `{ _tag: "thinking", reason: "unresolved-tool-call" }`
 * when a reply was tool-call-shaped but could not be resolved (hint already in
 * the content). Re-offering the same tools keeps small models emitting JSON
 * text (measured: 7/11 recover with tools offered, 11/11 with tools withheld).
 *
 *   strike 1  — standard thinking handler (hint reprompt); step is tagged.
 *   strike 2  — plain-text instruction; the NEXT think call withholds tools.
 *   strike 3  — the withheld-tools call STILL came back tool-call-shaped:
 *               terminate honestly via terminate.ts, never the raw JSON.
 *
 * The strike count is DERIVED from `state.steps` (consecutive tagged thought
 * steps; any action or untagged thought resets it) — no kernel-state field, so
 * a counter reset on a real tool call / answer needs no extra write path.
 *
 * Strategy switches reinitialize `steps`, so the derived count alone restarted
 * at zero (R6, Plan 8 K3). The leaving strategy's count rides the `handoff`
 * ledger entry (`protocolStrikes`) and is honored here until a tool call
 * SUCCEEDS after the switch — see {@link unresolvedStrikesOf}.
 */
import { Effect } from "effect";
import { detectToolCallShape } from "@reactive-agents/tools";
import { deliverableToContent, sentinelDeliverable } from "@reactive-agents/core";
import { emitHarnessSignalInjected } from "../../utils/diagnostics.js";
import { terminate } from "../../loop/terminate.js";
import { transitionState, type KernelState } from "../../state/kernel-state.js";
import { entriesOfKind, type RunLedger } from "../../ledger/run-ledger.js";
import { makeStep } from "../sense/step-utils.js";
import { looksLikeHarnessInternalText } from "../verify/harness-internal-text.js";
import { deliverableTextOf, hasNoDeliverableText } from "./assistant-turn.js";
import {
  UNRESOLVED_TOOL_CALL_TAG,
  countUnresolvedSinceSuccess,
  hasUnresolvedThoughts,
  unresolvedThoughtSet,
  trailingUnresolvedRun,
} from "../reflect/unresolved-steps.js";
import type { ReasoningStep } from "../../../types/index.js";

export { UNRESOLVED_TOOL_CALL_TAG };

/**
 * True when `text` looks like a (failed or healable) tool call. Used to keep
 * shaped replies off the trivial-exit fast path so the resolver/strike guard
 * sees them (shared detector — no regex copy).
 */
export const isToolCallShaped = (text: string, tools: readonly { readonly name: string }[]): boolean =>
  detectToolCallShape(text, tools.map((t) => t.name)).shaped;

/** Strikes after which the next think call is made with tools withheld. */
export const TOOLS_WITHHELD_AFTER = 2;

/** Step metadata marking a thought as a shaped-but-unresolved tool-call reply. */
export const UNRESOLVED_STEP_META: ReasoningStep["metadata"] = {
  frameworkInstrumentation: UNRESOLVED_TOOL_CALL_TAG,
};

/** Cause detail of the honest terminal deliverable. */
const UNRESOLVED_CAUSE =
  "the model could not produce a valid tool call (its replies were tool-call text that could not be executed)";
/** Honest sentinel deliverable for a `tool_call_unresolved` terminal (guard + loop-resolution). */
export const UNRESOLVED_DELIVERABLE = sentinelDeliverable("no_substantive_output", UNRESOLVED_CAUSE);
const PLAIN_TEXT_INSTRUCTION =
  "Your last replies were tool-call text that could not be executed. Do NOT call a tool or write JSON. " +
  "Answer the task now in plain prose.";

/** Consecutive tagged shaped-reply thoughts at the tail of `steps`. */
export function countConsecutiveUnresolved(steps: readonly ReasoningStep[]): number {
  return trailingUnresolvedRun(steps).filter(
    (s) => s.metadata?.frameworkInstrumentation === UNRESOLVED_TOOL_CALL_TAG,
  ).length;
}

/**
 * Strike count: consecutive shaped replies OR the per-run total since the last
 * successful tool call, whichever is larger (native failures between shaped
 * replies must not defeat the guard).
 */
export function unresolvedStrikes(steps: readonly ReasoningStep[]): number {
  return Math.max(countConsecutiveUnresolved(steps), countUnresolvedSinceSuccess(steps));
}

/**
 * Protocol strikes carried across a strategy switch: the latest `handoff`
 * entry's `protocolStrikes`, honored only while no tool call has SUCCEEDED
 * since that handoff (a success is real progress and clears the debt, exactly
 * as it clears the steps-derived total).
 */
export function carriedProtocolStrikes(ledger: RunLedger | undefined): number {
  const handoffs = entriesOfKind(ledger, "handoff");
  const last = handoffs[handoffs.length - 1];
  if (last === undefined || last.protocolStrikes === undefined) return 0;
  const progressed = entriesOfKind(ledger, "tool-result").some((e) => e.seq > last.seq && e.success);
  return progressed ? 0 : last.protocolStrikes;
}

/**
 * THE strike count for a run state: the steps-derived count or the count
 * carried across a strategy switch, whichever is larger (no double counting
 * when the switch also carried the trailing shaped steps).
 */
export function unresolvedStrikesOf(state: KernelState): number {
  return Math.max(unresolvedStrikes(state.steps), carriedProtocolStrikes(state.ledger));
}

/** True when the next think call must ship with NO tools. */
export function shouldWithholdTools(state: KernelState): boolean {
  return unresolvedStrikesOf(state) >= TOOLS_WITHHELD_AFTER;
}

const emit = (
  state: KernelState,
  kind: "shape-reprompt" | "tools-withheld" | "terminated",
  strike: number,
  content: string,
) =>
  emitHarnessSignalInjected({
    taskId: state.taskId,
    iteration: state.iteration,
    signalKind: kind === "terminated" ? "block" : "redirect",
    origin: "unresolved-tool-call-guard",
    content,
    metadata: { kind, strike },
  });

/** Trace event for the tools-withheld think call (emitted by think.ts). */
export const emitToolsWithheld = (state: KernelState) =>
  emit(state, "tools-withheld", unresolvedStrikesOf(state), "think call made with tools withheld");

/** The per-turn accounting fields the dispatcher carries into a transition. */
export interface UnresolvedTurn {
  readonly newSteps: readonly ReasoningStep[]
  readonly newTokens: number
  readonly newInputTokens: number
  readonly newOutputTokens: number
  readonly newCost: number
}

/**
 * Account one shaped reply. Strike 1 returns `null` (standard thinking handler
 * continues); strike 2 returns the plain-text-instruction state; strike 3
 * returns the honestly terminated state.
 */
export function guardUnresolvedToolCall(state: KernelState, turn: UnresolvedTurn, content: string) {
  return Effect.gen(function* () {
    const strike = unresolvedStrikesOf(state) + 1;
    yield* emit(state, "shape-reprompt", strike, `shaped reply, strike ${strike}`);
    if (strike < TOOLS_WITHHELD_AFTER) return null;
    const stepped = transitionState(state, {
      steps: [...turn.newSteps, makeStep("thought", content, UNRESOLVED_STEP_META)],
      tokens: turn.newTokens,
      inputTokens: turn.newInputTokens,
      outputTokens: turn.newOutputTokens,
      cost: turn.newCost,
      iteration: state.iteration + 1,
    });
    if (strike === TOOLS_WITHHELD_AFTER) {
      return transitionState(stepped, { pendingGuidance: { errorRecovery: PLAIN_TEXT_INSTRUCTION } });
    }
    yield* emit(state, "terminated", strike, "tool-call-shaped reply persisted with tools withheld");
    return terminate(stepped, {
      reason: "tool_call_unresolved",
      deliverable: UNRESOLVED_DELIVERABLE,
    });
  });
}

/** Consecutive empty-content "Continue working" nudges at the tail (moved verbatim from the dispatcher). */
export function countEmptyNudges(newSteps: readonly ReasoningStep[]): number {
  return newSteps.reduceRight((count, s) => {
    if (count === -1) return -1;
    if (s.type === "observation" && s.content.startsWith("Continue working")) return count + 1;
    if (s.type === "thought" || s.type === "action") return -1;
    return count;
  }, 0);
}

/**
 * Honest user-facing text for a `tool_call_unresolved` terminal. A failed
 * terminal nulls `state.output`, so the pass-output fallback would otherwise
 * resurrect the raw tool-call JSON from the last thought.
 */
export const UNRESOLVED_TOOL_CALL_OUTPUT = deliverableToContent(UNRESOLVED_DELIVERABLE);

/** Outcome of the shared last-thought fallback chooser. */
export type FallbackThought =
  | { readonly kind: "prose"; readonly content: string }
  | { readonly kind: "unresolved" };

/**
 * THE last-thought fallback chooser (boundary fix, 2026-10-29). Every site that
 * would ship "the last thought" as output goes through here: shaped-reply
 * artifacts (tagged thoughts + twins, incl. the resolver hint text) are never
 * delivered. `unresolved` = only shaped artifacts exist -> caller terminates
 * honestly (`tool_call_unresolved` + UNRESOLVED_DELIVERABLE). `undefined` = no
 * usable thought at all.
 */
export function chooseFallbackThought(
  steps: readonly ReasoningStep[],
  opts: {
    readonly walkBackPastEmpty?: boolean;
    /** Strikes were carried across a strategy switch (no shaped steps may remain in `steps`). */
    readonly carriedUnresolved?: boolean;
  } = {},
): FallbackThought | undefined {
  const shaped = unresolvedThoughtSet(steps);
  let sawProse = false;
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i]!;
    if (s.type !== "thought" || shaped.has(s) || hasNoDeliverableText(s) || looksLikeHarnessInternalText(s.content)) continue;
    sawProse = true;
    const text = deliverableTextOf(s); // the deliverable view: consumed call spans removed
    if (text.trim().length > 0) return { kind: "prose", content: text };
    if (!opts.walkBackPastEmpty) break;
  }
  return !sawProse && (hasUnresolvedThoughts(steps) || opts.carriedUnresolved === true)
    ? { kind: "unresolved" }
    : undefined;
}
