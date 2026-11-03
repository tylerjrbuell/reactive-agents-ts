/**
 * Run-status authority fold (measurement only, ZERO behavior change).
 *
 * The kernel records ONE `authority` for its terminal outcome, but the runtime
 * can flip the final success bit AFTER the kernel is done (verifier block,
 * abstention / outstanding-contract / terminal-outcome / required-tool /
 * empty-output / unproduced-deliverable vetoes). The kernel cannot see those,
 * so `terminal_decision=done` next to `run-completed=failure` was unexplained.
 *
 * This reads the honesty markers the engine ALREADY stamps on `ctx.metadata`
 * (it adds no new decision) and names the runtime authority. When a runtime
 * authority owns the status, the kernel's own authority moves to
 * `kernelAuthority`, so a done-vs-failure disagreement is explained by two
 * recorded fields. Deterministic facts only.
 */
import type { ReconciledOutcome } from "./terminal-outcome-read.js";

/** Marker flag -> authority, in the order the engine applies them. */
const VETO_MARKERS: readonly (readonly [string, string])[] = [
  ["verificationBlocked", "runtime-verifier-gate"],
  ["abstainedNotSuccess", "runtime-success-veto:abstained"],
  ["outstandingContractNotSuccess", "runtime-success-veto:outstanding-criteria"],
  ["terminalOutcomeNotSuccess", "runtime-success-veto:terminal-outcome"],
  ["requiredToolUnmetNotSuccess", "runtime-success-veto:required-tool-unmet"],
  ["emptyOutputFailure", "runtime-success-veto:empty-output"],
  ["unproducedDeliverableFailure", "runtime-success-veto:unproduced-deliverable"],
];

/** The runtime authority that flipped the final status, if any (first marker wins). */
export function runtimeStatusAuthority(
  metadata: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  if (metadata === undefined) return undefined;
  for (const [flag, authority] of VETO_MARKERS) {
    const v = metadata[flag];
    if (v !== undefined && v !== null && v !== false) return authority;
  }
  return undefined;
}

/** `ctx.metadata` marker stamped when the partial+substantive tolerance lane maps `partial` to success. */
export const PARTIAL_TOLERANCE_MARKER = "partialToleratedBy";
/** The one tolerance lane today: kernel `partial` + non-empty output ships as success. */
export const PARTIAL_SUBSTANTIVE_OUTPUT = "partial-substantive-output";

/**
 * The ONE explicit final-status decision. Keyed off the shared kernel
 * `TerminalOutcome` (not per strategy): the shipped status/success bit, the
 * authority that owns it, a deterministic reason, and — when the runtime
 * tolerance lane shipped success over a kernel `partial` — the typed exception
 * (`tolerated` + `toleratedBy`) so it reads as explained, never a contradiction.
 */
export interface FinalStatusDecision {
  readonly success: boolean;
  readonly status: "success" | "failure";
  readonly authority: string | undefined;
  readonly reason: string;
  readonly tolerated?: boolean;
  readonly toleratedBy?: string;
}

/**
 * Derive the final-status decision from the shipped success bit, the kernel's
 * reconciled outcome and the honesty markers the engine already stamped.
 * Measurement only: `success` is passed in, never recomputed.
 */
export function deriveFinalStatus(
  success: boolean,
  outcome: ReconciledOutcome,
  metadata: Readonly<Record<string, unknown>> | undefined,
): FinalStatusDecision {
  const status = success ? "success" : "failure";
  const runtime = runtimeStatusAuthority(metadata);
  const authority = runtime ?? outcome.authority;
  const toleratedBy = metadata?.[PARTIAL_TOLERANCE_MARKER];
  if (success && typeof toleratedBy === "string" && toleratedBy.length > 0) {
    return {
      success,
      status,
      authority,
      reason: `kernel status ${outcome.status} shipped as success: ${toleratedBy}`,
      tolerated: true,
      toleratedBy,
    };
  }
  if (runtime !== undefined) {
    return { success, status, authority, reason: `${status} owned by ${runtime}; kernel outcome was ${outcome.status}` };
  }
  return { success, status, authority, reason: `${status} agrees with kernel outcome ${outcome.status}` };
}

/**
 * Fold the final-status decision into the kernel's reconciled outcome: a
 * runtime authority replaces `authority` (kernel's moves to `kernelAuthority`),
 * `statusReason` is always recorded, and `tolerated`/`toleratedBy` appear
 * exactly when the tolerance lane fired.
 */
export function foldRuntimeAuthority(
  outcome: ReconciledOutcome,
  metadata: Readonly<Record<string, unknown>> | undefined,
  success?: boolean,
): ReconciledOutcome {
  const runtime = runtimeStatusAuthority(metadata);
  const decision = success === undefined ? undefined : deriveFinalStatus(success, outcome, metadata);
  if (runtime === undefined && decision === undefined) return outcome;
  return {
    ...outcome,
    ...(runtime !== undefined
      ? {
          authority: runtime,
          ...(outcome.authority !== undefined ? { kernelAuthority: outcome.authority } : {}),
        }
      : {}),
    ...(decision !== undefined ? { statusReason: decision.reason } : {}),
    ...(decision?.tolerated === true
      ? { tolerated: true, toleratedBy: decision.toleratedBy }
      : {}),
  };
}
