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
 *   3. `handoff`   — anything else (a second soft exit, the cap): terminate
 *                    with `handoff: true`. The terminal gate then runs ONE
 *                    handoff synthesis (`handoff-synthesis.ts`) that writes the
 *                    best answer from the evidence and lists what is unfinished.
 *
 * The cap stays a hard bound: deny-once needs an iteration below the cap, and a
 * `cap` proposal is never denied. "Outstanding" is deterministic (no LLM): a
 * required tool not yet called, an unmet delivery condition, or an answer that
 * does not exist, is only raw tool output, is narration around a tool call, or
 * predates tool results that arrived after it (the stale-text shape).
 *
 * Every disposition is recorded twice: a `harness_signal` step carrying typed
 * `metadata.exitGate`, and an `exit_gate` guard-fired event.
 */
import { Effect } from "effect";
import { deliverableToContent, type Deliverable } from "@reactive-agents/core";
import type { ReasoningStep } from "../../types/index.js";
import {
  transitionState,
  type KernelInput,
  type KernelRunOptions,
  type KernelState,
} from "../state/kernel-state.js";
import { makeStep } from "../capabilities/sense/step-utils.js";
import { authorityOf } from "../capabilities/decide/authority.js";
import { deliverableTextOf } from "../capabilities/reason/assistant-turn.js";
import { unresolvedThoughtSet } from "../capabilities/reflect/unresolved-steps.js";
import { detectContinuationIntent } from "../capabilities/verify/quality-utils.js";
import { verifyDelivery } from "../capabilities/verify/delivery-authority.js";
import { describeUnmet } from "../capabilities/verify/post-conditions.js";
import { deliveryConditions } from "../contract/declared-deliverables.js";
import { emitGuardFired } from "../utils/diagnostics.js";
import { terminate, type TerminateReason } from "./terminate.js";
import { missingRequiredToolsForInput } from "./runner-helpers/state-queries.js";
import {
  assembleDeliverable,
  getDeliverableObservationContent,
  MIN_MODEL_SYNTHESIS_LENGTH,
  passthroughOutputDeliverable,
} from "./runner-helpers/deliverable.js";
import { deliverableEvidenceVerified } from "./runner-helpers/deliverable-decision.js";

/** The guard that proposed an exit. */
export type ExitProposer =
  | "stall_deliverable"
  | "required_tool_quota"
  | "low_delta_guard"
  | "loop_resolution"
  | "oracle_forced"
  | "dispatcher_early_stop"
  | "switching_exhausted"
  | "max_iterations";

/** How the gate disposed of a proposal. */
export type ExitGateDecision = "accept" | "deny-once" | "handoff";

/** A guard's request to end the run. The gate, not the guard, decides. */
export interface ExitProposal {
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
   * a run with NOTHING to hand off (no validated tool evidence, no model draft):
   * neither a nudge nor a synthesis can improve on it, and a synthesis with no
   * material would only invent an answer. `stampReason` also records `reason`
   * as `terminatedBy` on the failed state.
   */
  readonly failure?: { readonly error: string; readonly stampReason?: boolean };
  /** The guard's own diagnostic (e.g. the loop-detector message), kept on the gate step. */
  readonly detail?: string;
}

/** The typed record the gate writes onto its harness_signal step. */
export type ExitGateRecord = NonNullable<NonNullable<ReasoningStep["metadata"]>["exitGate"]>;

/** Result of {@link proposeExit}: the decision and the next state. */
export interface ExitDisposition {
  readonly decision: ExitGateDecision;
  readonly state: KernelState;
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

/** `describeUnmet` phrases a list as one sentence; the gate lists items one by one. */
const itemOf = (sentence: string): string =>
  sentence.replace(/^You still must:\s*/, "").replace(/\.$/, "");

/**
 * Deterministic list of what is still unfinished if the run ended now with `d`.
 * Empty = the deliverable decision passes and the exit may be accepted.
 */
export function outstandingItems(
  state: KernelState,
  input: KernelInput,
  d: Deliverable,
): readonly string[] {
  const out: string[] = [];
  const add = (item: string) => {
    if (item.length > 0 && !out.includes(item)) out.push(item);
  };
  for (const tool of missingRequiredToolsForInput(state.steps, input, state.ledger)) {
    add(`call the \`${tool}\` tool`);
  }
  const conditions = deliveryConditions(state.meta) ?? [];
  if (conditions.length > 0) {
    const { unmet } = verifyDelivery(conditions, {
      steps: state.steps,
      output: deliverableToContent(d),
      ledger: state.ledger,
    });
    for (const c of unmet) add(itemOf(describeUnmet([c])));
  }
  // A verified declared artifact IS the answer (the file landed): the shape of
  // the accompanying text is then not an outstanding item.
  if (!deliverableEvidenceVerified(state.ledger)) {
    const gap = answerGap(state, d);
    if (gap !== undefined) add(gap);
  }
  return out;
}

/** True once the gate has denied an exit in this run (deny-once is per run). */
export function exitDeniedBefore(steps: readonly ReasoningStep[]): boolean {
  return steps.some((s) => s.metadata?.exitGate?.gateDecision === "deny-once");
}

/** The most recent gate record in the step record, if any. */
export function lastExitGateRecord(steps: readonly ReasoningStep[]): ExitGateRecord | undefined {
  for (let i = steps.length - 1; i >= 0; i--) {
    const record = steps[i]!.metadata?.exitGate;
    if (record !== undefined) return record;
  }
  return undefined;
}

/** A finished run whose last gate decision was `handoff` and whose synthesis has not run yet. */
export function pendingHandoff(state: KernelState): ExitGateRecord | undefined {
  if (state.status !== "done" || state.meta.deliverableDecision !== undefined) return undefined;
  const record = lastExitGateRecord(state.steps);
  return record?.gateDecision === "handoff" ? record : undefined;
}

/**
 * Material a handoff (or a nudge) could work from: validated tool evidence, or
 * a model-authored draft substantial enough to be an answer candidate (the
 * same {@link MIN_MODEL_SYNTHESIS_LENGTH} bar deliverable assembly uses) that
 * is not a promise to act.
 */
export function hasHandoffMaterial(state: KernelState): boolean {
  if (state.steps.some((s) => getDeliverableObservationContent(state, s) !== null)) return true;
  const shaped = unresolvedThoughtSet(state.steps); // shaped replies are never drafts
  return state.steps.some((s) => {
    if (s.type !== "thought" || shaped.has(s)) return false;
    const text = deliverableTextOf(s).trim();
    return text.length >= MIN_MODEL_SYNTHESIS_LENGTH && !detectContinuationIntent(text).isContinuation;
  });
}

/**
 * The pure disposition rule. `deniedBefore` makes deny-once once per run; the
 * iteration test keeps deny-once strictly under the cap (a denied run needs one
 * more iteration to act on the guidance). With no material, the exit stands as
 * proposed (`accept`): there is nothing to nudge toward or synthesize from.
 */
export function disposeExit(args: {
  readonly kind: ExitProposal["kind"];
  readonly outstanding: readonly string[];
  readonly hasMaterial: boolean;
  readonly deniedBefore: boolean;
  readonly iteration: number;
  readonly llmCalls: number;
  readonly maxIterations: number;
}): ExitGateDecision {
  if (args.outstanding.length === 0 || !args.hasMaterial) return "accept";
  const roomForOneMore =
    args.iteration < args.maxIterations - 1 && args.llmCalls < args.maxIterations - 1;
  if (args.kind === "soft" && !args.deniedBefore && roomForOneMore) return "deny-once";
  return "handoff";
}

function gateContent(record: ExitGateRecord): string {
  return record.gateDecision === "deny-once"
      ? `⚠️ Not finished yet. Still outstanding:\n${record.outstanding.map((o) => `- ${o}`).join("\n")}\n` +
        "Do these now, using the tool results you already have. Do not describe a next step or ask for permission."
      : record.gateDecision === "handoff"
        ? `exit gate: ${record.proposedBy} stopped the run with ${record.outstanding.length} item(s) unfinished; handoff synthesis scheduled. Unfinished: ${record.outstanding.join("; ")}`
        : `exit gate: accepted ${record.proposedBy} exit`;
}

/** The harness_signal step a deny-once / handoff appends (typed `exitGate` + intervention). */
function gateStep(record: ExitGateRecord, iteration: number, detail?: string): ReasoningStep {
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
          : "exit-gate: ended the run as a handoff (one synthesis lists what is unfinished)",
      iter: iteration,
    },
  });
}

const OUTCOME: Record<ExitGateDecision, "pass" | "block" | "terminate"> = {
  accept: "pass",
  "deny-once": "block",
  handoff: "terminate",
};

function emitDisposition(taskId: string, state: KernelState, record: ExitGateRecord) {
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
      handoffSynthesis: false,
    },
  });
}

/**
 * Hand a guard's exit proposal to the gate. Callers act on the decision:
 * `accept`/`handoff` → the state is terminal (break); `deny-once` → the state
 * is `thinking` with guidance (continue the loop).
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
    // A passthrough of an empty `state.output` (low-delta, early-stop, switch
    // exhaustion) is judged by the answer the run would actually ship: the
    // assembled candidate (§8.7/§8.8 fill the empty output from it post-loop).
    const judged =
      proposal.deliverable.source === "model_synthesis" &&
      deliverableToContent(proposal.deliverable).trim().length === 0
        ? assembleDeliverable(state)
        : proposal.deliverable;
    const outstanding = outstandingItems(state, args.input, judged);
    const decision = disposeExit({
      kind: proposal.kind,
      outstanding,
      hasMaterial: hasHandoffMaterial(state),
      deniedBefore: exitDeniedBefore(state.steps),
      iteration: state.iteration,
      llmCalls: state.llmCalls ?? 0,
      maxIterations: args.maxIterations,
    });
    const record: ExitGateRecord = {
      proposedBy: proposal.proposedBy,
      gateDecision: decision,
      reason: proposal.reason,
      outstanding,
    };
    yield* emitDisposition(args.taskId, state, record);
    // deny-once / handoff are interventions and land on the step record; an
    // accept changes nothing about the run, so it is recorded on the event only.
    if (decision !== "accept") {
      state = transitionState(state, {
        steps: [...state.steps, gateStep(record, state.iteration, proposal.detail)],
      });
    }
    if (decision === "deny-once") {
      const hint = gateContent(record).replace(/^⚠️ /, "");
      state = transitionState(state, {
        status: "thinking",
        pendingGuidance: { ...(state.pendingGuidance ?? {}), qualityGateHint: hint },
        error: null,
        meta: { ...state.meta, terminatedBy: undefined },
      });
      return { decision, state };
    }
    if (decision === "accept" && proposal.failure !== undefined && outstanding.length > 0) {
      // Nothing to hand off: the guard's own honest failure stands, now naming
      // what was outstanding (never a bare loop/quota message alone).
      state = transitionState(state, {
        status: "failed",
        error: `${proposal.failure.error}\nOutstanding: ${outstanding.join("; ")}`,
        ...(proposal.failure.stampReason === true
          ? { meta: { ...state.meta, terminatedBy: proposal.reason } }
          : {}),
      });
      return { decision, state };
    }
    if (decision === "accept" && args.accept !== undefined) {
      return { decision, state: yield* args.accept(state) };
    }
    if (decision === "accept") {
      state = terminate(state, {
        reason: proposal.reason,
        deliverable: proposal.deliverable,
        ...(proposal.extraMeta ? { extraMeta: proposal.extraMeta } : {}),
      });
      return { decision, state };
    }
    // Handoff. The HARNESS delivers the answer, so the run ends
    // `harness_deliverable` (the cap keeps `max_iterations`, the signal callers
    // read for a cap); the proposer's own reason rides `previousTerminatedBy`
    // and `exitGate.proposedBy`. The placeholder deliverable is the judged
    // candidate (never an empty passthrough) — the handoff synthesis replaces it.
    state = terminate(state, {
      reason: proposal.proposedBy === "max_iterations" ? "max_iterations" : "harness_deliverable",
      deliverable: judged,
      extraMeta: { ...(proposal.extraMeta ?? {}), previousTerminatedBy: proposal.reason },
      handoff: true,
    });
    return { decision, state };
  });
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
): Effect.Effect<ExitDisposition, never, never> {
  return proposeExit({
    state,
    proposal: { proposedBy, kind: "soft", reason, deliverable, ...(failure ? { failure } : {}) },
    input,
    maxIterations: options.maxIterations,
    taskId: options.taskId ?? state.taskId,
  });
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
