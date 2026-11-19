/**
 * exit-gate.ts — propose/dispose for every guard, cap and early-stop exit
 * (Plan 8 queue item 3; OSS gaps G1 "a cap or guard exit hands off, never
 * bare-fails" and G2 "propose/dispose").
 *
 * No guard terminates a run on its own authority. A guard (stall, low-delta,
 * loop resolution, oracle force, dispatcher early-stop, strategy-switch
 * exhaustion, the iteration cap) builds an {@link ExitProposal} and hands it
 * here. The gate disposes:
 *
 *   1. `accept`    — nothing is outstanding: terminate with the proposer's
 *                    deliverable, exactly as the guard used to.
 *   2. `deny-once` — something is outstanding, the guard is a SOFT heuristic,
 *                    the run has not been denied before and at least one more
 *                    iteration fits under the cap: keep the run going with
 *                    typed guidance naming what is outstanding.
 *                    The nudge needs no handoff material: a run that has
 *                    written nothing yet is exactly the run a "write the
 *                    final answer" nudge can still rescue. When every
 *                    outstanding item is answer-shaped (no tool work left)
 *                    the denial is an ANSWER TURN (`answerTurnAt`): the next
 *                    think call ships with no tools (`reason/answer-turn.ts`).
 *   3. `handoff`   — anything else (a second soft exit, the cap) on a run WITH
 *                    material (validated tool evidence or a model draft). The
 *                    harness never writes the answer (owner decision
 *                    2026-11-10; the handoff synthesis that used to is
 *                    deleted). When the MODEL wrote a draft (and no required
 *                    tool is missing) the run ends `partial`: the draft plus
 *                    the `Unfinished:` list ({@link unfinishedBlock}), with a
 *                    refused decision. Otherwise it ends `failed`, naming what
 *                    is outstanding, and the gathered evidence rides the
 *                    result RAW (`unfinishedEvidence`). The reconciled
 *                    `terminalOutcome.outstanding` lists the items in both
 *                    cases. With NO
 *                    material the exit stands as `accept` (the guard's own
 *                    honest failure).
 *
 * The cap stays a hard bound: deny-once needs an iteration below the cap, and a
 * `cap` proposal is never denied. "Outstanding" is deterministic (no LLM): a
 * required tool not yet called, an unmet delivery condition, or an answer that
 * does not exist, is only raw tool output, is narration around a tool call, or
 * predates tool results that arrived after it (the stale-text shape).
 *
 * The MODEL proposes too (Plan 9 item 2b): a final answer the model writes in
 * the think stage is a `proposedBy: "model"` proposal (`decide/model-exit-proposal.ts`).
 * It is not a stop, so it never hands off and never spends the guards' one
 * deny-once nudge: with work outstanding it is denied (`deny`: the run
 * continues with the outstanding list as guidance) every time it is proposed,
 * and the iteration cap bounds it.
 *
 * Every disposition is recorded twice: a `harness_signal` step carrying typed
 * `metadata.exitGate`, and an `exit_gate` guard-fired event. The proposing
 * guard's own guard-fired event is emitted here too, after the decision, so its
 * outcome is the gate's (`terminate` only for a run end, `block` for a denial).
 *
 * The HARNESS proposes too (Plan 9 Phase 4): the turn's own hard ends (a stop
 * request, a killswitch, the zero-evidence stand-down, the pace terminal, a
 * control-plane abstain, the protocol terminal, the required-tools quota) are
 * {@link HarnessExitProposal}s. The harness-authority rule accepts them as
 * they always ended the run, so the turn operations end a run only through
 * this module (pinned in `tests/kernel/loop/turn-operations.test.ts`).
 */
import { Effect } from "effect";
import { deliverableToContent, modelSynthesisDeliverable, type Deliverable } from "@reactive-agents/core";
import type { ReasoningStep } from "../../types/index.js";
import {
  transitionState,
  type KernelInput,
  type KernelRunOptions,
  type KernelState,
} from "../state/kernel-state.js";
import { contributeGuidance } from "../state/guidance-channel.js";
import { gateHistory } from "../state/resume-epoch.js";
import { makeStep } from "../capabilities/sense/step-utils.js";
import { authorityOf } from "../capabilities/decide/authority.js";
import { deliverableTextOf } from "../capabilities/reason/assistant-turn.js";
import { unresolvedThoughtSet } from "../capabilities/reflect/unresolved-steps.js";
import { detectContinuationIntent } from "../capabilities/verify/quality-utils.js";
import { verifyDelivery } from "../capabilities/verify/delivery-authority.js";
import { emitGuardFired } from "../utils/diagnostics.js";
import { terminate, type TerminateOptions, type TerminateReason } from "./terminate.js";
import { missingRequiredToolsForInput } from "./runner-helpers/state-queries.js";
import { inspectDecline, type DeclineCheck } from "./honest-decline-exit.js";
import { basisOfOutstanding, classifyContractOutstanding } from "./contract-outstanding.js";
import { unavailableRequiredTools, unavailableToolItem } from "./runner-helpers/tool-health.js";
import {
  assembleDeliverable,
  collectValidatedObservations,
  commitDeliverable,
  getDeliverableObservationContent,
  MIN_MODEL_SYNTHESIS_LENGTH,
  passthroughOutputDeliverable,
} from "./runner-helpers/deliverable.js";
import { todoWrapUpAwaitingReply } from "../capabilities/decide/todo-wrap-up.js";
import { deliverableEvidenceVerified, type DeliverableDecision } from "./runner-helpers/deliverable-decision.js";

/** The guard that proposed an exit. */
export type ExitProposer =
  | "stall_deliverable"
  | "required_tool_quota"
  | "low_delta_guard"
  | "loop_resolution"
  | "oracle_forced"
  | "dispatcher_early_stop"
  | "switching_exhausted"
  | "max_iterations"
  /** The model wrote a final answer (Plan 9 item 2b). */
  | "model";

/**
 * How the gate disposed of a proposal. `deny-once` is a guard's one nudge per
 * run; `deny` is a model proposal denied while work is outstanding (repeatable).
 */
export type ExitGateDecision = "accept" | "deny-once" | "deny" | "handoff";

/** True for both denials: the run continues with the outstanding list as guidance. */
export const isExitDenial = (decision: ExitGateDecision): boolean =>
  decision === "deny-once" || decision === "deny";

/** A guard's request to end the run. The gate, not the guard, decides. */
export interface ExitProposal {
  /** `model` = the model's own final answer: denied while anything is outstanding, never handed off. */
  readonly proposedBy: ExitProposer;
  /** `soft` = heuristic guard (may be denied once); `cap` = hard bound (never denied). */
  readonly kind: "soft" | "cap";
  /** The terminatedBy reason the run ends with if the gate lets it end. */
  readonly reason: TerminateReason;
  /** The deliverable the guard would ship. */
  readonly deliverable: Deliverable;
  readonly extraMeta?: Partial<KernelState["meta"]>;
  /**
   * The guard's own honest failure, used when the gate lets the exit stand on
   * a run with NOTHING to hand off (no validated tool evidence, no model draft)
   * after the run's one nudge was spent (or a `cap` proposal, or no room for
   * another iteration): a synthesis with no material would only invent an
   * answer, so the failure stands. `stampReason` also records `reason`
   * as `terminatedBy` on the failed state.
   */
  readonly failure?: { readonly error: string; readonly stampReason?: boolean };
  /** The guard's own diagnostic (e.g. the loop-detector message), kept on the gate step. */
  readonly detail?: string;
  /** Unfinished items only the guard knows (e.g. an enumeration requirement); merged into the gate's outstanding list. */
  readonly outstanding?: readonly string[];
  /**
   * The proposing guard's own `guard-fired` record (its reason + evidence).
   * The gate emits it AFTER deciding, with an outcome read from the decision
   * ({@link proposerOutcome}): a guard never claims `terminate` for an exit the
   * gate then denied. Traces before 2026-11-06 carry a pre-gate `terminate`
   * from these sites; readers resolve both through the paired `exit_gate` event.
   */
  readonly guardEvent?: ProposerGuardEvent;
}

/** A proposing guard's `guard-fired` record, minus the outcome (the gate's decision supplies it). */
export interface ProposerGuardEvent {
  /** The event's guard name (equal to `proposedBy` at every kernel site). */
  readonly guard: string;
  readonly reason: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * The outcome a proposing guard's event carries: `terminate` only when the run
 * ended (accept / handoff), `block` when the gate denied the exit.
 */
export const proposerOutcome = (decision: ExitGateDecision): "terminate" | "block" =>
  isExitDenial(decision) ? "block" : "terminate";

/**
 * The controller's early stop as a proposal origin: a SOFT guard (one deny-once
 * nudge, then handoff). The runner's dispatcher early-stop and the oracle's
 * `controller_early_stop` verdict both propose with it.
 */
export const DISPATCHER_EARLY_STOP: Pick<ExitProposal, "proposedBy" | "kind" | "reason"> = {
  proposedBy: "dispatcher_early_stop",
  kind: "soft",
  reason: "dispatcher-early-stop",
};

/** The typed record the gate writes onto its harness_signal step. */
export type ExitGateRecord = NonNullable<NonNullable<ReasoningStep["metadata"]>["exitGate"]>;

declare const gateDisposed: unique symbol;

/**
 * Result of {@link proposeExit} / {@link proposeHarnessExit}: the decision and
 * the next state. Branded: only this module mints one, so a turn operation can
 * end the run only by handing back a disposition the gate produced (the turn
 * runner in `turn-operations.ts` maps it to the pass signal; pinned).
 */
export interface ExitDisposition {
  readonly decision: ExitGateDecision;
  readonly state: KernelState;
  readonly [gateDisposed]: true;
}

const disposed = (decision: ExitGateDecision, state: KernelState): ExitDisposition =>
  ({ decision, state }) as ExitDisposition;

/**
 * How a harness-authority exit ends the run — the same terminal transition the
 * harness site applied itself before Plan 9 Phase 4.
 *   - `terminate`  — through `terminate()` (its post-condition gate included);
 *   - `fail`       — `status:"failed"` with an error (the output is nulled);
 *   - `killswitch` — a hook abort: its terminatedBy is the hook's own string,
 *                    not a `TerminateReason`, so it cannot go through
 *                    `terminate()`. `aborted` (a `terminate` abort) fails the
 *                    run; otherwise the run ends done with the current output.
 */
export type HarnessExitEnd =
  | { readonly via: "terminate"; readonly options: TerminateOptions }
  | { readonly via: "fail"; readonly error: string }
  | { readonly via: "killswitch"; readonly terminatedBy: string; readonly aborted: boolean };

/**
 * An exit the HARNESS proposes on its own authority: a run-control stop or
 * terminate request, a killswitch abort, the zero-evidence stand-down, the
 * pace terminal synthesis, a control-plane abstain, the protocol terminal and
 * the required-tools quota. The gate's harness-authority rule accepts it
 * outright, exactly as these sites ended the run before (no outstanding check,
 * no record, never denied or handed off). A deny-once policy for harness exits
 * is a later, lift-gated item.
 */
export interface HarnessExitProposal {
  readonly proposedBy: "harness";
  readonly end: HarnessExitEnd;
}

/** Dispose a harness-authority exit: always `accept`, applying its terminal transition. */
export function proposeHarnessExit(state: KernelState, proposal: HarnessExitProposal): ExitDisposition {
  const { end } = proposal;
  if (end.via === "terminate") return disposed("accept", terminate(state, end.options));
  if (end.via === "fail") {
    return disposed("accept", transitionState(state, { status: "failed", error: end.error }));
  }
  // No output key on the transition: the "failed" branch nulls the output, and
  // the "done" branch routes it through the single writer commitDeliverable.
  const ended = transitionState(state, {
    status: end.aborted ? "failed" : "done",
    meta: { ...state.meta, terminatedBy: end.terminatedBy },
  });
  return disposed(
    "accept",
    end.aborted ? ended : commitDeliverable(ended, passthroughOutputDeliverable(ended.output)),
  );
}

const NO_ANSWER = "write the final answer to the task (no answer has been written yet)";
const RAW_ONLY = "write the final answer from the gathered tool results (only raw tool output exists so far)";
const NEXT_STEP = "write the final answer (the last text announced a next step instead of answering)";
const CALL_NARRATION = "write the final answer (the last text was narration around a tool call, not an answer)";

/** Tool names of validated observations at step index > `after`. */
function evidenceAfter(state: KernelState, after: number): readonly string[] {
  const names: string[] = [];
  for (let i = after + 1; i < state.steps.length; i++) {
    const step = state.steps[i]!;
    if (getDeliverableObservationContent(state, step) === null) continue;
    const name = step.metadata?.observationResult?.toolName ?? "a tool";
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** Why the proposed deliverable is not yet an answer, or undefined when it is one. */
function answerGap(state: KernelState, d: Deliverable): string | undefined {
  if (d.source === "sentinel") return NO_ANSWER;
  const text = deliverableToContent(d).trim();
  if (text.length === 0) return NO_ANSWER;
  if (d.source === "tool_artifact" || (d.source === "harness_synthesis" && d.synthesized === undefined)) {
    return RAW_ONLY;
  }
  if (detectContinuationIntent(text).isContinuation) return NEXT_STEP;
  if (d.source !== "model_synthesis") return undefined;
  let at = -1;
  for (let i = state.steps.length - 1; i >= 0; i--) {
    const s = state.steps[i]!;
    if (s.type === "thought" && deliverableTextOf(s).trim() === text) {
      at = i;
      break;
    }
  }
  if (at < 0) return undefined; // committed by an earlier path; cannot place it in the record
  if ((state.steps[at]!.metadata?.assistantTurn?.callIds.length ?? 0) > 0) return CALL_NARRATION;
  const later = evidenceAfter(state, at);
  return later.length > 0
    ? `write the final answer using the results from ${later.join(", ")} (they arrived after the current answer text was written)`
    : undefined;
}

/**
 * The contract part of {@link outstandingItems}: the BLOCKING items (declared or
 * evidence basis) - required tools not yet called, delivery conditions `output`
 * does not meet, an action the answer claims that nothing backs. Heuristic-basis
 * items are advisory and live in `classifyContractOutstanding(...).advisory`.
 * No answer-shape item, so a mid-run reader (the duplicate-call note) names the
 * work, not the answer text.
 */
export function contractOutstanding(
  state: KernelState,
  input: KernelInput,
  output: string,
): readonly string[] {
  return classifyContractOutstanding(state, input, output).blocking.map((b) => b.text);
}

/**
 * Deterministic list of what is still unfinished if the run ended now with `d`.
 * Empty = the deliverable decision passes and the exit may be accepted.
 */
export function outstandingItems(
  state: KernelState,
  input: KernelInput,
  d: Deliverable,
): readonly string[] {
  const out = contractOutstanding(state, input, deliverableToContent(d));
  // A verified declared artifact IS the answer (the file landed): the shape of
  // the accompanying text is then not an outstanding item.
  if (!deliverableEvidenceVerified(state.ledger)) {
    const gap = answerGap(state, d);
    if (gap !== undefined && !out.includes(gap)) return [...out, gap];
  }
  return out;
}

/**
 * True once the gate has denied a GUARD exit in this run (deny-once is per run).
 * A denied model proposal is recorded as `deny` and does not count: the model
 * claiming done early must not spend the nudge a later stall or loop guard is owed.
 */
export function exitDeniedBefore(steps: readonly ReasoningStep[]): boolean {
  return steps.some((s) => s.metadata?.exitGate?.gateDecision === "deny-once");
}

/** Reason prefix on a re-denial the write-coverage progress rule granted (traces count these). */
export const PROGRESS_DENIAL_REASON = "progress_since_last_denial";

/** Satisfied write-coverage targets, or undefined when the `writeCoverage` contract is not active. */
export function writeTargetsSatisfied(state: KernelState): { readonly met: number; readonly total: number } | undefined {
  const conditions = (state.meta.runContract?.requirements ?? []).flatMap((r) =>
    r.kind === "write-coverage" && r.spec.condition !== undefined ? [r.spec.condition] : [],
  );
  if (conditions.length === 0) return undefined;
  const { unmet } = verifyDelivery(conditions, { steps: state.steps, output: "", ledger: state.ledger });
  return { met: conditions.length - unmet.length, total: conditions.length };
}

/** Progress-policy inputs for {@link disposeExit}; undefined when write coverage is off. */
function writeProgressArgs(state: KernelState) {
  const writes = writeTargetsSatisfied(state);
  if (writes === undefined) return undefined;
  const denials = state.steps.flatMap((s) =>
    s.metadata?.exitGate?.gateDecision === "deny-once" ? [s.metadata.exitGate] : [],
  );
  const last = denials[denials.length - 1];
  return {
    writeProgress: last?.writesSatisfied !== undefined && writes.met > last.writesSatisfied,
    denialsSoFar: denials.length,
    maxDenials: writes.total + 1,
    met: writes.met,
  };
}

/** The most recent gate record in the step record, if any. */
export function lastExitGateRecord(steps: readonly ReasoningStep[]): ExitGateRecord | undefined {
  for (let i = steps.length - 1; i >= 0; i--) {
    const record = steps[i]!.metadata?.exitGate;
    if (record !== undefined) return record;
  }
  return undefined;
}

/**
 * True once the budget's answer turn (a `max_iterations` deny-once with
 * `answerTurnAt`, budget-answer-turn.ts) has been made and the loop bound
 * allows no further think call: only the iteration cap may end the run now.
 */
export function budgetAnswerTurnTaken(state: KernelState, maxIterations: number): boolean {
  const record = lastExitGateRecord(gateHistory(state.steps, maxIterations)); // a spent cap's reservation is not this budget's (resume)
  const llmCalls = state.llmCalls ?? 0;
  return (
    record?.proposedBy === "max_iterations" &&
    record.gateDecision === "deny-once" &&
    record.answerTurnAt !== undefined &&
    llmCalls > record.answerTurnAt &&
    (llmCalls >= maxIterations || state.iteration >= maxIterations)
  );
}

/** Per-observation cap on the evidence attached to an unfinished run. */
const EVIDENCE_CHARS = 6000;

/** One piece of tool evidence an unfinished run hands back, raw (never written up as an answer). */
export interface UnfinishedEvidence {
  readonly toolName: string;
  readonly content: string;
}

/**
 * The validated tool evidence of a run the gate ended as a `handoff` (failed,
 * unfinished), or undefined for every other run. Derived from the step record
 * at relay time (`kernelTerminalMetadata` → `extensions.unfinishedEvidence`):
 * no kernel-state copy.
 */
export function unfinishedEvidence(state: KernelState): readonly UnfinishedEvidence[] | undefined {
  if (state.status !== "failed" || lastExitGateRecord(state.steps)?.gateDecision !== "handoff") return undefined;
  const evidence = collectValidatedObservations(state).map((o) => ({
    toolName: o.toolName,
    content: o.content.slice(0, EVIDENCE_CHARS),
  }));
  return evidence.length > 0 ? evidence : undefined;
}

/** Marker line opening the deterministic unfinished list. */
export const UNFINISHED_HEADER = "Unfinished:";

/**
 * The harness-owned unfinished list a handoff appends to the model's own
 * answer (the kernel exit gate here, the strategy delivery gate in
 * `strategy-exit-gate.ts`): {@link UNFINISHED_HEADER} then one `- item` line
 * per outstanding item. Pure.
 */
export function unfinishedBlock(outstanding: readonly string[]): string {
  return `${UNFINISHED_HEADER}\n${outstanding.map((o) => `- ${o}`).join("\n")}`;
}

/**
 * A thought's text when it is a model draft: not a shaped reply, at least
 * {@link MIN_MODEL_SYNTHESIS_LENGTH} long, and not a promise to act.
 */
function draftTextOf(step: ReasoningStep, shaped: ReadonlySet<ReasoningStep>): string | undefined {
  if (step.type !== "thought" || shaped.has(step)) return undefined;
  const text = deliverableTextOf(step).trim();
  return text.length >= MIN_MODEL_SYNTHESIS_LENGTH && !detectContinuationIntent(text).isContinuation
    ? text
    : undefined;
}

/**
 * Material the run gathered: validated tool evidence, or a model-authored
 * draft substantial enough to be an answer candidate (the same
 * {@link MIN_MODEL_SYNTHESIS_LENGTH} bar deliverable assembly uses) that is
 * not a promise to act. Gates `handoff` only — the deny-once nudge does not
 * need material (it asks the model to write the answer it has not written).
 */
export function hasHandoffMaterial(state: KernelState): boolean {
  if (state.steps.some((s) => getDeliverableObservationContent(state, s) !== null)) return true;
  const shaped = unresolvedThoughtSet(state.steps); // shaped replies are never drafts
  return state.steps.some((s) => draftTextOf(s, shaped) !== undefined);
}

/**
 * The model's current draft answer: the most recent draft thought that did not
 * also call a tool (narration around a call is not an answer). Undefined when
 * the model never wrote one, or when validated tool results arrived after it
 * (the stale-text shape {@link answerGap} names): a draft written before the
 * evidence it should use is never shipped (exact-value run2 shape).
 */
export function latestModelDraft(state: KernelState): string | undefined {
  const shaped = unresolvedThoughtSet(state.steps);
  for (let i = state.steps.length - 1; i >= 0; i--) {
    const step = state.steps[i]!;
    if ((step.metadata?.assistantTurn?.callIds.length ?? 0) > 0) continue;
    const text = draftTextOf(step, shaped);
    if (text !== undefined) return evidenceAfter(state, i).length === 0 ? text : undefined;
  }
  return undefined;
}

/**
 * The deliverable decision a draft handoff records: refused (`accepted:false`,
 * so the run reads `partial`, never success) and carrying the gate's record,
 * whose `outstanding` list the reconciled terminal outcome reports.
 */
function handoffDecision(proposal: ExitProposal, outstanding: readonly string[]): DeliverableDecision {
  return {
    chosen: "model-final",
    accepted: false,
    why: `exit-gate handoff: the model's draft ships as a partial (${outstanding.length} item(s) unfinished)`,
    verdictSummary: `unfinished: ${outstanding.join("; ")}`,
    rejected: [],
    exitGate: { proposedBy: proposal.proposedBy, gateDecision: "handoff", outstanding, handoffSynthesis: false },
  };
}

/**
 * The pure disposition rule. `deniedBefore` makes deny-once once per run; the
 * iteration test keeps deny-once strictly under the cap (a denied run needs one
 * more iteration to act on the guidance). Order matters: the nudge is checked
 * BEFORE material, because a soft guard firing before the model wrote anything
 * (live repro 2026-11-03: a loop stop on "what is 17×23" with no answer yet)
 * is the case one "write the final answer" turn rescues. Once the nudge is
 * spent (or for a `cap`, or with no room) the run ends unfinished either way:
 * `handoff` hands back the material it gathered, `accept` stands as the
 * guard's own failure when there is none.
 */
export function disposeExit(args: {
  /** Absent for a strategy's own exit claim (`strategy-exit-gate.ts`), which has no kernel proposer. */
  readonly proposedBy?: ExitProposer;
  readonly kind: ExitProposal["kind"];
  readonly outstanding: readonly string[];
  readonly hasMaterial: boolean;
  readonly deniedBefore: boolean;
  readonly iteration: number;
  readonly llmCalls: number;
  readonly maxIterations: number;
  /**
   * Write-coverage progress policy (flag `writeCoverage`; absent = off, so the
   * rule is exactly deny-once-then-handoff). `writeProgress`: a write target
   * was satisfied since the previous denial; `denialsSoFar` / `maxDenials`
   * bound the re-denials (targets + 1).
   */
  readonly writeProgress?: boolean;
  readonly denialsSoFar?: number;
  readonly maxDenials?: number;
  /**
   * Every outstanding item is answer-shaped, so a denial would be an answer
   * turn (no tools, so no act and no iteration spent after the think call).
   */
  readonly answerOnly?: boolean;
  /**
   * Everything outstanding is a required tool the run declared unavailable:
   * no denial or nudge can make the work land, so the exit ends (handoff with
   * material, otherwise the guard's own failure stands).
   */
  readonly unmeetableOnly?: boolean;
  /**
   * `harness.budgetAnswerTurn` (default on, owner 2026-11-19). Only when true
   * may an answer-only denial take the run's last think call at iteration
   * `maxIterations - 1`, or follow an earlier denial (once per run, see
   * `answerTurnGiven`); absent, a soft guard there gets no extra turn.
   */
  readonly budgetAnswerTurn?: boolean;
  /** An answer turn (a record with `answerTurnAt`) was already granted this run. */
  readonly answerTurnGiven?: boolean;
}): ExitGateDecision {
  if (args.outstanding.length === 0) return "accept";
  if (args.unmeetableOnly === true) return args.hasMaterial ? "handoff" : "accept";
  // The model's answer is not a stop: deny it while work is outstanding (the cap bounds the run).
  if (args.proposedBy === "model") return "deny";
  // One more think fits while `llmCalls < maxIterations` (the runner's own loop
  // bound; a guard runs after this turn's call was counted). Run
  // 01M73FK911EPZWMJAGSFZ7FPNB: `< maxIterations - 1` saw no room at llmCalls 9
  // of 10, so a plateau went to handoff without its one synthesis turn.
  // An answer turn never acts, so on a run with material to answer from it
  // also fits at iteration `maxIterations - 1` (budget-answer-turn.ts: the
  // run's last think call is the answer). Opt-in with the budget answer turn.
  const answerTurnFits = args.budgetAnswerTurn === true && args.answerOnly === true && args.hasMaterial;
  const roomForOneMore =
    args.iteration < args.maxIterations - (answerTurnFits ? 0 : 1) && args.llmCalls < args.maxIterations;
  if (args.kind === "soft" && !args.deniedBefore && roomForOneMore) return "deny-once";
  // A guard stop after an earlier denial still gets one answer turn when only
  // the answer is missing (trace 01M7TERZAVP2RS489WEBJ3HY7H ended answerless).
  if (args.kind === "soft" && answerTurnFits && args.answerTurnGiven !== true && roomForOneMore) return "deny-once";
  if (
    args.kind === "soft" && args.deniedBefore && roomForOneMore && args.writeProgress === true &&
    args.maxDenials !== undefined && (args.denialsSoFar ?? 0) < args.maxDenials
  ) {
    return "deny-once";
  }
  if (!args.hasMaterial) return "accept";
  return "handoff";
}

/** The text a gate record renders: the step content, and (minus its marker) a denial's guidance. */
export function gateContent(record: ExitGateRecord): string {
  return isExitDenial(record.gateDecision)
      ? `⚠️ Not finished yet. Still outstanding:\n${record.outstanding.map((o) => `- ${o}`).join("\n")}\n` +
        (record.answerTurnAt !== undefined
          ? "Tools are not available on this turn: write the answer now, using the tool results you already have. "
          : "Do these now, using the tool results you already have. ") +
        "Do not describe a next step or ask for permission." +
        // Heuristic-basis items advise, never block: the model may act on them or say plainly why not.
        (record.advisory !== undefined && record.advisory.length > 0
          ? `\nAlso consider (not required): ${record.advisory.join("; ")}`
          : "")
      : record.gateDecision === "handoff"
        ? `exit gate: ${record.proposedBy} stopped the run with ${record.outstanding.length} item(s) unfinished; the model's draft ships as a partial, or the run fails with its evidence attached. Unfinished: ${record.outstanding.join("; ")}`
        : `exit gate: accepted ${record.proposedBy} exit`;
}

/** The harness_signal step a denial / handoff appends (typed `exitGate` + intervention). */
export function gateStep(record: ExitGateRecord, iteration: number, detail?: string): ReasoningStep {
  const body = gateContent(record);
  const content = detail !== undefined ? `${body}\n(${record.proposedBy}: ${detail})` : body;
  return makeStep("harness_signal", content, {
    exitGate: record,
    intervention: {
      actor: "exit-gate",
      authorityClass: authorityOf("exit-gate"),
      evidence: `${record.proposedBy} proposed ${record.reason}; outstanding: ${record.outstanding.join("; ")}`.slice(0, 200),
      whatChanged:
        record.gateDecision === "deny-once"
          ? "exit-gate: denied the exit once and named the outstanding items"
          : record.gateDecision === "deny"
            ? "exit-gate: denied the model's final answer and named the outstanding items"
            : "exit-gate: ended the run unfinished (model draft as partial, or failed with evidence attached)",
      iter: iteration,
    },
  });
}

const OUTCOME: Record<ExitGateDecision, "pass" | "block" | "terminate"> = {
  accept: "pass",
  "deny-once": "block",
  deny: "block",
  handoff: "terminate",
};

/** The `exit_gate` guard-fired event for one gate record. */
export function emitDisposition(taskId: string, state: KernelState, record: ExitGateRecord, declineCheck?: DeclineCheck) {
  return emitGuardFired({
    taskId,
    iteration: state.iteration,
    guard: "exit_gate",
    outcome: OUTCOME[record.gateDecision],
    reason: record.reason,
    metadata: {
      proposedBy: record.proposedBy,
      gateDecision: record.gateDecision,
      outstanding: record.outstanding,
      // Basis of each outstanding item (declared | evidence | heuristic) and the
      // heuristic items that only advised: a zero-token audit query.
      outstandingBasis: record.outstandingBasis ?? [],
      advisory: record.advisory ?? [],
      // What the honest-decline check saw (guard proposals only): explains a handoff.
      ...(declineCheck === undefined ? {} : { declineCheck }),
      handoffSynthesis: false,
    },
  });
}

/** An accepted exit's terminal transition (the proposal's reason, deliverable and meta). */
function endOnProposal(state: KernelState, p: Pick<ExitProposal, "reason" | "deliverable" | "extraMeta">): KernelState {
  return terminate(state, {
    reason: p.reason,
    deliverable: p.deliverable,
    ...(p.extraMeta ? { extraMeta: p.extraMeta } : {}),
  });
}

/**
 * Hand a guard's exit proposal to the gate. Callers act on the decision:
 * `accept`/`handoff` → the state is terminal (break); `deny-once` / `deny` →
 * the state is `thinking` with guidance (continue the loop).
 */
export function proposeExit(args: {
  readonly state: KernelState;
  readonly proposal: ExitProposal;
  readonly input: KernelInput;
  readonly maxIterations: number;
  readonly taskId: string;
  /**
   * How an ACCEPTED exit finalizes. Default: `terminate()` with the proposal.
   * The dispatcher early-stop passes the Arbitrator here, so the verdict
   * oracle keeps owning that exit's terminal verdict once the gate lets it end.
   */
  readonly accept?: (state: KernelState) => Effect.Effect<KernelState, never, never>;
}): Effect.Effect<ExitDisposition, never, never> {
  return Effect.gen(function* () {
    const { proposal } = args;
    let state = args.state;
    if (proposal.kind === "soft" && proposal.proposedBy !== "model" && budgetAnswerTurnTaken(state, args.maxIterations)) {
      // The budget reserved this run's last think call as the answer turn
      // (budget-answer-turn.ts) and it has been made: the iteration cap ends
      // the run (`proposeCapExit`, the model's draft handed off), not a soft
      // guard firing in the same pass under its own reason.
      yield* emitGuardFired({
        taskId: args.taskId,
        iteration: state.iteration,
        guard: "exit_gate",
        outcome: "block",
        reason: proposal.reason,
        metadata: { proposedBy: proposal.proposedBy, gateDecision: "deferred-to-cap", outstanding: [], handoffSynthesis: false },
      });
      return disposed("deny", transitionState(state, {
        status: "thinking",
        error: null,
        meta: { ...state.meta, terminatedBy: undefined },
      }));
    }
    if (
      proposal.kind === "soft" &&
      proposal.proposedBy !== "model" &&
      args.input.harness?.todoWrapUp === true &&
      todoWrapUpAwaitingReply(state.steps)
    ) {
      // The todo wrap-up turn (todo-wrap-up.ts) is owed its reply: a guard firing
      // now would hand off the answer the model already wrote. Defer one pass.
      yield* emitGuardFired({
        taskId: args.taskId,
        iteration: state.iteration,
        guard: "exit_gate",
        outcome: "block",
        reason: proposal.reason,
        metadata: { proposedBy: proposal.proposedBy, gateDecision: "deferred-to-todo-wrap-up", outstanding: [], handoffSynthesis: false },
      });
      return disposed("deny", transitionState(state, {
        status: "thinking",
        error: null,
        meta: { ...state.meta, terminatedBy: undefined },
      }));
    }
    // A passthrough of an empty `state.output` (low-delta, early-stop, switch
    // exhaustion) is judged by the answer the run would actually ship: the
    // assembled candidate (§8.7/§8.8 fill the empty output from it post-loop).
    const judged =
      proposal.deliverable.source === "model_synthesis" &&
      deliverableToContent(proposal.deliverable).trim().length === 0
        ? assembleDeliverable(state)
        : proposal.deliverable;
    // A required tool the run gave up on (tool-health.ts: a streak of failures,
    // still unmet) cannot be "called now": its plain "call the `tool` tool"
    // item is REPLACED by the unavailable line, so every exit's result says why
    // the requirement went unmet, and an exit left with only such lines is not
    // denied for work that cannot land (`unmeetableOnly`).
    const unavailable = unavailableRequiredTools(state, args.input);
    const replaced = new Set(unavailable.map((b) => `call the \`${b.toolName}\` tool`));
    const unavailableLines = unavailable.map(unavailableToolItem);
    const outstanding = [
      ...outstandingItems(state, args.input, judged).filter((item) => !replaced.has(item)),
      ...unavailableLines,
      ...(proposal.outstanding ?? []),
    ];
    const classified = classifyContractOutstanding(state, args.input, deliverableToContent(judged));
    const outstandingBasis = basisOfOutstanding(outstanding, classified, unavailableLines);
    const unmeetableOnly = unavailableLines.length > 0 && outstanding.every((item) => unavailableLines.includes(item));
    // A guard stopping a run whose model honestly declined over an input that
    // always errored: an abstention with the model's text, not a failure.
    const inspected = proposal.proposedBy === "model" ? undefined : inspectDecline(state, args.input, outstanding, outstandingBasis);
    const decline = inspected?.decline;
    if (decline !== undefined) {
      const record: ExitGateRecord = { proposedBy: proposal.proposedBy, gateDecision: "accept", reason: "honest_decline", outstanding };
      if (proposal.guardEvent !== undefined) {
        yield* emitGuardFired({ taskId: args.taskId, iteration: state.iteration, ...proposal.guardEvent, outcome: "terminate" });
      }
      yield* emitDisposition(args.taskId, state, record, inspected?.check);
      return disposed("accept", endOnProposal(state, {
        reason: "abstained",
        deliverable: modelSynthesisDeliverable({ type: "thought", content: decline.text, iteration: state.iteration }),
        extraMeta: { ...(proposal.extraMeta ?? {}), terminalSite: "honest-decline", abstention: { reason: decline.text, missing: decline.missing } },
      }));
    }
    const progress = writeProgressArgs(state);
    // Only the answer is missing (no required tool, no unmet delivery
    // condition): a denial is an answer turn, and the next think call withholds tools.
    const answerOnly = classified.blocking.length === 0;
    const history = gateHistory(state.steps, args.maxIterations); // a spent cap's reservation does not count (resume)
    const decision = disposeExit({
      ...(progress === undefined
        ? {}
        : { writeProgress: progress.writeProgress, denialsSoFar: progress.denialsSoFar, maxDenials: progress.maxDenials }),
      proposedBy: proposal.proposedBy,
      kind: proposal.kind,
      outstanding,
      hasMaterial: hasHandoffMaterial(state),
      deniedBefore: exitDeniedBefore(history),
      iteration: state.iteration,
      llmCalls: state.llmCalls ?? 0,
      maxIterations: args.maxIterations,
      answerOnly,
      unmeetableOnly,
      budgetAnswerTurn: args.input.harness?.budgetAnswerTurn === true,
      answerTurnGiven: history.some((s) => s.metadata?.exitGate?.answerTurnAt !== undefined),
    });
    const progressDenial = decision === "deny-once" && exitDeniedBefore(history) && progress?.writeProgress === true;
    const answerTurn = decision === "deny-once" && answerOnly;
    const record: ExitGateRecord = {
      proposedBy: proposal.proposedBy,
      gateDecision: decision,
      reason: progressDenial ? `${PROGRESS_DENIAL_REASON}:${proposal.reason}` : proposal.reason,
      outstanding,
      outstandingBasis,
      ...(classified.advisory.length > 0 ? { advisory: classified.advisory } : {}),
      ...(progress === undefined ? {} : { writesSatisfied: progress.met }),
      ...(answerTurn ? { answerTurnAt: state.llmCalls ?? 0 } : {}),
    };
    if (proposal.guardEvent !== undefined) {
      yield* emitGuardFired({
        taskId: args.taskId,
        iteration: state.iteration,
        ...proposal.guardEvent,
        outcome: proposerOutcome(decision),
      });
    }
    yield* emitDisposition(args.taskId, state, record, inspected?.check);
    // Denials / handoff are interventions and land on the step record; an
    // accept changes nothing about the run, so it is recorded on the event only.
    if (decision !== "accept") {
      state = transitionState(state, {
        steps: [...state.steps, gateStep(record, state.iteration, proposal.detail)],
      });
    }
    if (isExitDenial(decision)) {
      const hint = gateContent(record).replace(/^⚠️ /, "");
      state = transitionState(state, {
        status: "thinking",
        pendingGuidance: contributeGuidance(state.pendingGuidance, [{ kind: "qualityGateHint", text: hint }]),
        error: null,
        meta: { ...state.meta, terminatedBy: undefined },
      });
      return disposed(decision, state);
    }
    if (decision === "accept" && proposal.failure !== undefined && outstanding.length > 0) {
      // Nothing to hand off: the guard's own honest failure stands, now naming
      // what was outstanding (never a bare loop/quota message alone).
      state = transitionState(state, {
        status: "failed",
        error: `${proposal.failure.error}\nOutstanding: ${outstanding.join("; ")}`,
        ...(proposal.failure.stampReason === true || proposal.extraMeta !== undefined
          ? {
              meta: {
                ...state.meta,
                ...(proposal.extraMeta ?? {}),
                ...(proposal.failure.stampReason === true ? { terminatedBy: proposal.reason } : {}),
              },
            }
          : {}),
      });
      return disposed(decision, state);
    }
    if (decision === "accept" && args.accept !== undefined) {
      return disposed(decision, yield* args.accept(state));
    }
    if (decision === "accept") return disposed(decision, endOnProposal(state, proposal));
    // Handoff: the run ends unfinished. The harness never writes the answer
    // (owner decision 2026-11-10). When the MODEL wrote one, its draft ships
    // as a labelled partial: the draft plus the deterministic `Unfinished:`
    // list, with a refused decision so it never reads as success. A required
    // tool never called stays a hard failure (the post-loop
    // missing_required_tool law), as does a run with no draft: it fails
    // naming what is outstanding, and the gathered evidence rides the result
    // raw (`unfinishedEvidence`).
    const draft = latestModelDraft(state);
    const draftHandoff = draft !== undefined && missingRequiredToolsForInput(state, args.input).length === 0;
    if (draftHandoff) {
      // terminate() passes a handoff decision through its post-condition gate;
      // terminatedBy is then restamped like the failed branch's.
      const shipped = terminate(state, {
        reason: proposal.reason,
        deliverable: modelSynthesisDeliverable({
          type: "thought",
          content: `${draft}\n\n${unfinishedBlock(outstanding)}`,
          iteration: state.iteration,
        }),
        extraMeta: { ...(proposal.extraMeta ?? {}), deliverableDecision: handoffDecision(proposal, outstanding) },
      });
      return disposed(
        decision,
        transitionState(shipped, { meta: { ...shipped.meta, terminatedBy: unfinishedReason(proposal) } }),
      );
    }
    state = transitionState(state, {
      status: "failed",
      error:
        `${proposal.failure?.error ?? `The run stopped (${proposal.proposedBy}) before the model wrote a final answer.`}\n` +
        `Outstanding: ${outstanding.join("; ")}\n` +
        "The gathered tool evidence is attached unanswered (metadata.extensions.unfinishedEvidence).",
      meta: { ...state.meta, ...(proposal.extraMeta ?? {}), terminatedBy: unfinishedReason(proposal) },
    });
    return disposed(decision, state);
  });
}

/**
 * The terminatedBy of an unfinished run: the proposal's reason, except the
 * `harness_*` reasons, which claim a harness-written answer that no longer
 * exists. Those name the proposing guard instead (e.g. `stall_deliverable`).
 */
function unfinishedReason(proposal: ExitProposal): string {
  return proposal.reason === "harness_deliverable" || proposal.reason === "harness_synthesis"
    ? proposal.proposedBy
    : proposal.reason;
}

/**
 * Shorthand for a SOFT guard proposal from the iteration driver (low-delta,
 * oracle force, strategy-switch exhaustion). Same disposition as
 * {@link proposeExit}; `deny-once` maps to the driver's "continue".
 */
export function proposeGuardExit(
  state: KernelState,
  proposedBy: ExitProposer,
  reason: TerminateReason,
  deliverable: Deliverable,
  input: KernelInput,
  options: KernelRunOptions,
  failure?: ExitProposal["failure"],
  guardEvent?: ProposerGuardEvent,
): Effect.Effect<ExitDisposition, never, never> {
  return proposeExit({
    state,
    proposal: {
      proposedBy, kind: "soft", reason, deliverable,
      ...(failure ? { failure } : {}),
      ...(guardEvent ? { guardEvent } : {}),
    },
    input,
    maxIterations: options.maxIterations,
    taskId: options.taskId ?? state.taskId,
  });
}

/**
 * The model's reply to the budget's answer turn as a final-answer deliverable,
 * or undefined. Applies only once that turn was made and the cap is reached
 * ({@link budgetAnswerTurnTaken}), to a thought written AFTER the reservation
 * (the turn's own reply, not an earlier thought) that calls no tool, and only
 * when nothing is outstanding with it as the answer. No draft-length bar: the
 * harness asked for the answer, so a short one ("873 ms") is still the answer;
 * {@link outstandingItems} and the terminal verify gate judge it. Pure.
 */
function answerTurnReplyExit(state: KernelState, input: KernelInput, maxIterations: number): Deliverable | undefined {
  if (!budgetAnswerTurnTaken(state, maxIterations)) return undefined;
  let reservedAt = -1;
  for (let i = state.steps.length - 1; i >= 0 && reservedAt < 0; i--) {
    if (state.steps[i]!.metadata?.exitGate !== undefined) reservedAt = i;
  }
  const shaped = unresolvedThoughtSet(state.steps);
  for (let i = state.steps.length - 1; i > reservedAt; i--) {
    const step = state.steps[i]!;
    if (step.type !== "thought" || shaped.has(step) || (step.metadata?.assistantTurn?.callIds.length ?? 0) > 0) continue;
    const text = deliverableTextOf(step).trim();
    if (text.length === 0) continue;
    if (evidenceAfter(state, i).length > 0) return undefined;
    const d = modelSynthesisDeliverable({ type: "thought", content: text, iteration: state.iteration });
    return outstandingItems(state, input, d).length === 0 ? d : undefined;
  }
  return undefined;
}

/**
 * The iteration cap as a proposal. Called once after the loop: when the loop
 * exited on the iteration / LLM-call cap with a non-terminal status, the cap
 * proposes `max_iterations`. Nothing outstanding → the existing cap outcome is
 * kept untouched (decision `accept`, recorded on the event only). Otherwise →
 * `handoff` (a cap is never denied).
 */
export function proposeCapExit(args: {
  readonly state: KernelState;
  readonly currentInput: KernelInput;
  readonly currentOptions: KernelRunOptions;
}): Effect.Effect<KernelState, never, never> {
  return Effect.gen(function* () {
    const { state, currentInput, currentOptions } = args;
    const max = currentOptions.maxIterations;
    const capped = state.iteration >= max || (state.llmCalls ?? 0) >= max;
    if (state.status === "done" || state.status === "failed" || !capped) return state;
    const deliverable =
      typeof state.output === "string" && state.output.trim().length > 0
        ? passthroughOutputDeliverable(state.output)
        : assembleDeliverable(state);
    const proposal: ExitProposal = {
      proposedBy: "max_iterations",
      kind: "cap",
      reason: "max_iterations",
      deliverable,
      extraMeta: { terminalSite: "iteration-cap" },
    };
    const taskId = currentOptions.taskId ?? state.taskId;
    const reply = answerTurnReplyExit(state, currentInput, max);
    if (reply !== undefined) {
      // The budget's answer turn was the model's final answer and nothing is
      // outstanding: it ends as one, not as the cap's partial handoff
      // (ablation 2026-11-10 defect 1: 26/26 verified answers read partial).
      // Proposed as the model's own exit, so the gate records and accepts it.
      const answered = yield* proposeExit({
        state,
        proposal: { proposedBy: "model", kind: "soft", reason: "final_answer", deliverable: reply },
        input: currentInput,
        maxIterations: max,
        taskId,
      });
      return answered.state;
    }
    if (outstandingItems(state, currentInput, deliverable).length === 0 || !hasHandoffMaterial(state)) {
      yield* emitDisposition(taskId, state, {
        proposedBy: "max_iterations",
        gateDecision: "accept",
        reason: "max_iterations",
        outstanding: [],
      });
      return state;
    }
    const disposed = yield* proposeExit({ state, proposal, input: currentInput, maxIterations: max, taskId });
    return disposed.state;
  });
}
