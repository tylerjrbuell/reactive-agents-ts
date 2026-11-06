/**
 * deliverable-decision.ts — typed provenance + gate decision record for the
 * ONE terminal/deliverable boundary (H3, failure-mode census cluster A).
 *
 * Every deliverable is written by `commitDeliverable` (stamps
 * `meta.deliverableProvenance`) and every `done` run with output passes the
 * terminal verify gate (`runner-terminal-verify-gate.ts`), which CONSUMES the
 * verifier verdict through {@link finalizeDeliverableDecision}: it writes the
 * terminal ledger verdict (so `answer` is satisfied only on an accepted
 * deliverable), records the rejected-candidate list, and stamps
 * `meta.deliverableDecision`. Leaf module: depends only on core + ledger types.
 */
import type { Deliverable } from "@reactive-agents/core";
import { transitionState, type KernelState } from "../../state/kernel-state.js";
import type { VerificationResult } from "../../capabilities/verify/verifier.js";
import { entriesOfKind, type RunLedger } from "../../ledger/run-ledger.js";
import { recordTerminalVerdict } from "../../ledger/emit.js";
import { deriveTerminalAuthority } from "../../state/terminal-authority.js";
import { deciderVerdictSummary, kernelReconciledStatus } from "../../state/terminal-outcome.js";
import { guardEvidence } from "../../utils/guard-evidence.js";
import type { ExitGateDecision } from "../exit-gate.js";

/** Typed deliverable provenance, in the vocabulary of the core 4-source type. */
export type DeliverableProvenance = "model-final" | "synthesized" | "tool-artifact" | "sentinel";

/** A candidate the gate refused to deliver as the answer, with the reason. */
export interface RejectedCandidate {
  readonly provenance: DeliverableProvenance;
  readonly reason: string;
  /** First 200 chars of the refused text (the output itself is nulled on failure). */
  readonly excerpt: string;
}

/** What the terminal gate decided about the deliverable, and why. */
export interface DeliverableDecision {
  /** Provenance of the delivered answer (even if shipped as a labeled partial), or "none" when nothing was delivered. */
  readonly chosen: DeliverableProvenance | "none";
  readonly accepted: boolean;
  readonly why: string;
  readonly verdictSummary: string;
  readonly rejected: readonly RejectedCandidate[];
  /**
   * The verifier's own verdict, kept SEPARATE from the gate's decision: a
   * `verified:false` verifier next to `accepted:true` means the decision
   * overrode the verifier (`why` names the reason), not that the run lied.
   * Absent on decisions minted before this field existed.
   */
  readonly verifier?: { readonly verified: boolean; readonly failedChecks: readonly string[] };
  /**
   * The exit gate's record when a guard / cap proposal ended the run
   * (`exit-gate.ts`): which guard proposed, what the gate decided, and whether a
   * handoff synthesis produced the delivered output. Absent when the run ended
   * without a gated proposal (model end_turn, final-answer, arbitrator verdict).
   */
  readonly exitGate?: {
    readonly proposedBy: string;
    readonly gateDecision: ExitGateDecision;
    readonly outstanding: readonly string[];
    readonly handoffSynthesis: boolean;
  };
}

/** Map a core {@link Deliverable} source onto the typed provenance vocabulary. */
export function provenanceOf(d: Deliverable): DeliverableProvenance {
  switch (d.source) {
    case "model_synthesis":
      return "model-final";
    case "harness_synthesis":
      return d.synthesized !== undefined ? "synthesized" : "tool-artifact";
    case "tool_artifact":
      return "tool-artifact";
    default:
      return "sentinel";
  }
}

/**
 * Deterministic deliverable evidence: the run DECLARED at least one
 * `artifact-produced` requirement (a concrete file the task demanded) and the
 * ledger's latest own-pass status for EVERY such requirement is `satisfied`
 * (the artifact verifiably landed). Without a declared artifact there is no
 * deliverable evidence — a research summary assembled from tool output has
 * nothing but the harness's say-so (the `stall_deliverable` shape).
 */
export function deliverableEvidenceVerified(ledger: RunLedger | undefined): boolean {
  const entries = entriesOfKind(ledger, "requirement").filter((e) => e.pass === undefined);
  const artifactIds = new Set(
    entries.filter((e) => e.requirementKind === "artifact-produced").map((e) => e.requirementId),
  );
  if (artifactIds.size === 0) return false;
  const latest = new Map<string, string>();
  for (const e of entries) if (artifactIds.has(e.requirementId)) latest.set(e.requirementId, e.status);
  return [...latest.values()].every((status) => status === "satisfied");
}

/** `check-name: reason` of the first failed check, or the verdict summary. */
export function failedCheckReason(verdict: VerificationResult): string {
  const c = verdict.checks.find((x) => !x.passed);
  return c ? `${c.name}${c.reason ? `: ${c.reason}` : ""}` : verdict.summary;
}

/** Build a rejected-candidate record from the current state + failed check. */
export function rejectedCandidate(
  state: KernelState,
  reason: string,
): RejectedCandidate {
  return {
    provenance: state.meta.deliverableProvenance ?? "model-final",
    reason,
    excerpt: (state.output ?? "").slice(0, 200),
  };
}

/**
 * Consume the terminal verdict. Pure: returns the next state.
 *
 * - writes the terminal ledger verdict (skipped when an accepted terminal
 *   verdict is already recorded, e.g. by the arbitrator) — the sole
 *   satisfaction writer for the `answer` requirement;
 * - stamps `meta.deliverableDecision`.
 */
export function finalizeDeliverableDecision(
  state: KernelState,
  args: {
    readonly accepted: boolean;
    readonly verdictSummary: string;
    readonly why: string;
    readonly rejected: readonly RejectedCandidate[];
    readonly finalRejected?: RejectedCandidate;
    readonly verifier?: DeliverableDecision["verifier"];
    readonly exitGate?: DeliverableDecision["exitGate"];
  },
): KernelState {
  const alreadyAccepted = entriesOfKind(state.ledger, "verdict").some(
    (e) => e.gate === "terminal" && e.verified,
  );
  const ledger =
    args.accepted && alreadyAccepted
      ? state.ledger
      : recordTerminalVerdict(state.ledger, {
          verified: args.accepted,
          iteration: state.iteration,
          ...(typeof state.meta.terminatedBy === "string" ? { terminatedBy: state.meta.terminatedBy } : {}),
          ...(args.accepted ? {} : { reason: args.verdictSummary }),
        });
  const rejected = args.finalRejected ? [...args.rejected, args.finalRejected] : args.rejected;
  const decision: DeliverableDecision = {
    chosen: state.status !== "failed" && state.output ? (state.meta.deliverableProvenance ?? "model-final") : "none",
    accepted: args.accepted,
    why: args.why,
    verdictSummary: args.verdictSummary,
    rejected,
    ...(args.verifier !== undefined ? { verifier: args.verifier } : {}),
    ...(args.exitGate !== undefined ? { exitGate: args.exitGate } : {}),
  };
  return transitionState(state, {
    ledger,
    meta: { ...state.meta, deliverableDecision: decision },
  });
}

/** Metadata for the `terminal_decision` guard-fired event (audit item 3). */
export function terminalDecisionMetadata(state: KernelState): Record<string, unknown> {
  const decision = state.meta.deliverableDecision;
  const partial =
    state.meta.harnessAuthoredOutput === true ||
    state.meta.budgetTerminalPartial === true ||
    decision?.exitGate?.gateDecision === "handoff";
  const intent =
    state.status === "failed"
      ? "fail"
      : state.meta.terminatedBy === "abstained"
        ? "abstain"
        : partial
          ? "deliver-partial"
          : "deliver";
  return {
    terminatedBy: state.meta.terminatedBy ?? null,
    status: state.status,
    // Reconciled vocabulary (completed|partial|failed|abstained), alongside the
    // raw done|failed `status`, which cannot say partial/abstained.
    finalStatus: kernelReconciledStatus(state),
    intent,
    verdictSummary: decision ? deciderVerdictSummary(decision) : null,
    alternatives: decision?.rejected ?? [],
    ...(decision ? { chosen: decision.chosen } : {}),
    // Plan 8 item 3: which guard proposed the exit, what the gate decided, and
    // whether a handoff synthesis produced the output.
    ...(decision?.exitGate ? { exitGate: decision.exitGate } : {}),
    // Who set this status (derived from the same facts as the TerminalOutcome).
    authority: deriveTerminalAuthority(state.meta),
    // Provider error class when the run ended in an LLM error (authority "error").
    ...(state.meta.errorClass !== undefined ? { errorClass: state.meta.errorClass } : {}),
    // Cap evidence: the iteration counter and LLM-call counter against the cap,
    // so `max_iterations` is attributable to a corridor, not just a label.
    ...(state.meta.maxIterations !== undefined
      ? {
          iterationCap: {
            ...guardEvidence("iteration", state.iteration, state.meta.maxIterations),
            llmCalls: state.llmCalls ?? 0,
            capped: state.iteration >= state.meta.maxIterations || (state.llmCalls ?? 0) >= state.meta.maxIterations,
          },
        }
      : {}),
  };
}
