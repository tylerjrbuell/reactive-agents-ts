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
import type { RequirementBasis } from "../contract/requirement-basis.js";
import { missingRequired } from "../capabilities/verify/requirement-state.js";
import { executedOutcomes } from "./runner-helpers/tool-health.js";

/**
 * Failed executed calls, with no success, before a required tool counts as
 * always-erroring. A permanent error class (ENOENT, 404, not found) needs one
 * (zoo-live 2026-11-18: gemma declines after a single ENOENT).
 */
export const MIN_FAILED_CALLS = 2;

/** The decline the gate resolves to an abstention. */
export interface HonestDecline {
  /** The model's own words (becomes the run's output). */
  readonly text: string;
  /** The required tools that never succeeded. */
  readonly missing: readonly string[];
}

/**
 * True when thought `at` made calls that no act phase ran: its batch is still
 * pending and no action step follows it. A guard ending the run drops such a
 * batch (`pending_batch` "dropped"), so the turn's prose is the model's last
 * word, not narration of results to come (ab-trap-5 gemma4: decline + a third
 * file-read in one turn, 3 of 5 runs).
 */
function callsDropped(state: KernelState, at: number): boolean {
  if ((state.meta.pendingNativeToolCalls?.length ?? 0) === 0) return false;
  return !state.steps.slice(at + 1).some((s) => s.type === "action");
}

/** The model's latest tool-free text (or a turn whose calls were dropped) with no successful tool result after it. */
function latestTextAfterEvidence(state: KernelState): string | undefined {
  const shaped = unresolvedThoughtSet(state.steps);
  for (let i = state.steps.length - 1; i >= 0; i--) {
    const step: ReasoningStep = state.steps[i]!;
    if (step.type === "observation" && step.metadata?.observationResult?.success === true) return undefined;
    if (step.type !== "thought" || shaped.has(step)) continue;
    if ((step.metadata?.assistantTurn?.callIds.length ?? 0) > 0 && !callsDropped(state, i)) continue;
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
  basis?: readonly RequirementBasis[],
): HonestDecline | undefined {
  return inspectDecline(state, input, outstanding, basis).decline;
}

/** What the decline check saw, recorded on the `exit_gate` event so one traced run explains a handoff. */
export interface DeclineCheck {
  /** Required tools the run never got a result from (undefined-> none missing / still viable). */
  readonly missingTools: readonly string[];
  /** The model's latest text after the last successful result, or null. */
  readonly textAfterEvidence: string | null;
  /** First clause that rejected the decline; "none" when it settled. */
  readonly rejectedBy: "none" | "no-outstanding" | "no-missing-required" | "tool-viable" | "blocking-outstanding" | "no-text" | "not-a-decline";
}

/**
 * {@link honestDeclineOf} plus the inputs it judged. A heuristic-basis item
 * (answer-shape narration, an inferred action) never blocks when the model's own
 * decline text exists after the evidence; declared and evidence items still do.
 */
export function inspectDecline(
  state: KernelState,
  input: KernelInput,
  outstanding: readonly string[],
  basis?: readonly RequirementBasis[],
): { readonly decline: HonestDecline | undefined; readonly check: DeclineCheck } {
  // Raw missing list: a permanently failed tool is exactly the decline case
  // (effectiveMissingRequired drops it, which read as "tool-viable": ab-trap-5 aoa run4).
  const rawMissing = missingRequired(state.evidence, input.requiredTools ?? [], input.requiredToolQuantities);
  const missing = neverSucceededAmong(state, rawMissing);
  const text = latestTextAfterEvidence(state);
  const seen = { missingTools: missing ?? [], textAfterEvidence: text ?? null };
  const reject = (rejectedBy: DeclineCheck["rejectedBy"]) => ({ decline: undefined, check: { ...seen, rejectedBy } });
  if (rawMissing.length === 0) return reject("no-missing-required");
  if (missing === undefined) return reject("tool-viable");
  if (outstanding.length === 0) return reject("no-outstanding");
  if (text === undefined) return reject("no-text");
  const blocks = (item: string, i: number): boolean =>
    !missing.some((tool) => item.includes(`\`${tool}\``)) && basis?.[i] !== "heuristic";
  if (outstanding.some(blocks)) return reject("blocking-outstanding");
  if (!looksLikeHonestDecline(text)) return reject("not-a-decline");
  return { decline: { text, missing }, check: { ...seen, rejectedBy: "none" } };
}

/**
 * The missing required tools when EVERY one was called at least
 * {@link MIN_FAILED_CALLS} times and never succeeded (the input is genuinely
 * unavailable); undefined when nothing is missing or any tool is still viable.
 */
function neverSucceededAmong(state: KernelState, missing: readonly string[]): readonly string[] | undefined {
  if (missing.length === 0) return undefined;
  const outcomes = executedOutcomes(state.steps);
  for (const tool of missing) {
    const mine = outcomes.filter((o) => o.toolName === tool);
    if (mine.some((o) => o.success)) return undefined;
    // A permanent error class (ENOENT, 404, not found) is final after one call.
    const needed = mine.length >= 1 && failedWithPermanentError(state, tool) ? 1 : MIN_FAILED_CALLS;
    if (mine.length < needed) return undefined;
  }
  return missing;
}

/** Error text that no retry can change: the input is not there. */
const PERMANENT_ERROR = /\bENOENT\b|no such file|not found|does not exist|\b404\b/i;

/** True when EVERY failed executed result of `tool` carries a permanent error. */
function failedWithPermanentError(state: KernelState, tool: string): boolean {
  let seen = false;
  for (const step of state.steps) {
    if (step.type !== "observation") continue;
    const result = step.metadata?.observationResult;
    if (result?.toolName !== tool || result.success !== false) continue;
    if (!PERMANENT_ERROR.test(step.content)) return false;
    seen = true;
  }
  return seen;
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
