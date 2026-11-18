// File: src/kernel/loop/honest-decline-exit.ts
/**
 * An honest decline is not a failure (measurement overhaul Phase 0 item 0.4).
 *
 * ab-trap-5: the model wrote "I cannot determine the total because ./ledger.json
 * could not be found" while `file-read` (a required tool) errored on every call.
 * A guard (the dispatcher early-stop) then proposed the exit, the gate saw the
 * required tool still outstanding, and the run ended `status=failure` with "stopped
 * before the model wrote a final answer" although the model HAD written one, and
 * it was the true one.
 *
 * One deterministic rule, in the shared exit gate (never per strategy): a guard's
 * exit proposal resolves to an ABSTENTION carrying the model's own text when
 *   - everything outstanding is a required tool,
 *   - each such tool was called at least {@link MIN_FAILED_CALLS} times and NEVER
 *     succeeded this run (the input is genuinely unavailable), and
 *   - the model's latest text, written after the last successful tool result,
 *     declines because the input is missing and carries no figure of its own
 *     (`looksLikeHonestDecline`).
 * A tool that has not failed, or a text that is a partial answer, falls through
 * to the existing disposition untouched. The model's own final-answer exit is not
 * routed here (it has its own denial path).
 */
import type { ReasoningStep } from "../../types/index.js";
import type { KernelInput, KernelState } from "../state/kernel-state.js";
import { deliverableTextOf } from "../capabilities/reason/assistant-turn.js";
import { unresolvedThoughtSet } from "../capabilities/reflect/unresolved-steps.js";
import { looksLikeHonestDecline } from "../capabilities/decide/abstention-detection.js";
import { missingRequiredToolsForInput } from "./runner-helpers/state-queries.js";
import { missingRequired } from "../capabilities/verify/requirement-state.js";
import { executedOutcomes } from "./runner-helpers/tool-health.js";

/** Failed executed calls, with no success, before a required tool counts as always-erroring. */
export const MIN_FAILED_CALLS = 2;

/** The decline the gate resolves to an abstention. */
export interface HonestDecline {
  /** The model's own words (becomes the run's output). */
  readonly text: string;
  /** The required tools that never succeeded. */
  readonly missing: readonly string[];
}

/** The model's latest tool-free text with no successful tool result after it. */
function latestTextAfterEvidence(state: KernelState): string | undefined {
  const shaped = unresolvedThoughtSet(state.steps);
  for (let i = state.steps.length - 1; i >= 0; i--) {
    const step: ReasoningStep = state.steps[i]!;
    if (step.type === "observation" && step.metadata?.observationResult?.success === true) return undefined;
    if (step.type !== "thought" || shaped.has(step)) continue;
    if ((step.metadata?.assistantTurn?.callIds.length ?? 0) > 0) continue;
    const text = deliverableTextOf(step).trim();
    if (text.length > 0) return text;
  }
  return undefined;
}

/**
 * The honest decline a guard's exit resolves to, or undefined (the existing
 * disposition applies). Pure. `outstanding` is the gate's computed list.
 */
export function honestDeclineOf(
  state: KernelState,
  input: KernelInput,
  outstanding: readonly string[],
): HonestDecline | undefined {
  const missing = neverSucceededRequired(state, input);
  if (missing === undefined || outstanding.length === 0) return undefined;
  // Everything outstanding must be one of the missing required tools.
  if (!outstanding.every((item) => missing.some((tool) => item.includes(`\`${tool}\``)))) return undefined;
  const text = latestTextAfterEvidence(state);
  return text !== undefined && looksLikeHonestDecline(text) ? { text, missing } : undefined;
}

/**
 * The missing required tools when EVERY one was called at least
 * {@link MIN_FAILED_CALLS} times and never succeeded (the input is genuinely
 * unavailable); undefined when nothing is missing or any tool is still viable.
 */
function neverSucceededRequired(state: KernelState, input: KernelInput): readonly string[] | undefined {
  return neverSucceededAmong(state, missingRequiredToolsForInput(state, input));
}

function neverSucceededAmong(state: KernelState, missing: readonly string[]): readonly string[] | undefined {
  if (missing.length === 0) return undefined;
  const outcomes = executedOutcomes(state.steps);
  for (const tool of missing) {
    const mine = outcomes.filter((o) => o.toolName === tool);
    if (mine.length < MIN_FAILED_CALLS || mine.some((o) => o.success)) return undefined;
  }
  return missing;
}

/**
 * True when the tool work still listed as `outstanding` (raw tool names, as
 * act-or-answer lists it) is only required tools that never succeeded AND the
 * model has declined because of it: forcing another call of those tools would
 * only bury the honest decline (shape zoo honest-decline: act-or-answer
 * turned an abstention into 11 turns of re-reads). `text` is the model's
 * reply this turn when the caller holds it; default is its latest tool-free
 * text. Same conditions as {@link honestDeclineOf}; pure.
 */
export function declineSettlesOutstanding(
  state: KernelState,
  input: KernelInput,
  outstanding: readonly string[],
  text?: string,
): boolean {
  // Raw missing list: a tool marked permanently failed is exactly the case here
  // (effectiveMissingRequired drops it, but its delivery condition stays listed).
  const missing = neverSucceededAmong(
    state,
    missingRequired(state.evidence, input.requiredTools ?? [], input.requiredToolQuantities),
  );
  if (missing === undefined || outstanding.length === 0) return false;
  if (!outstanding.every((item) => missing.includes(item))) return false;
  const said = text?.trim() ? text : latestTextAfterEvidence(state);
  return said !== undefined && looksLikeHonestDecline(said);
}
