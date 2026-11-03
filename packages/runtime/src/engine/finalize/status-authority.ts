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

/**
 * Fold the runtime gate into the kernel's reconciled outcome. Returns the
 * outcome unchanged when no runtime authority owns the status.
 */
export function foldRuntimeAuthority(
  outcome: ReconciledOutcome,
  metadata: Readonly<Record<string, unknown>> | undefined,
): ReconciledOutcome {
  const runtime = runtimeStatusAuthority(metadata);
  if (runtime === undefined) return outcome;
  return {
    ...outcome,
    authority: runtime,
    ...(outcome.authority !== undefined ? { kernelAuthority: outcome.authority } : {}),
  };
}
