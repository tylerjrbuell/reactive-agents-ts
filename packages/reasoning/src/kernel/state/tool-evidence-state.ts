/**
 * state/tool-evidence-state.ts — `state.evidence`, the run's ONE tool-evidence
 * value, kept current at the ledger chokepoint (`transitionState`).
 *
 * The value is a pure function of the run ledger (`toolEvidence(ledger)` in
 * capabilities/verify/requirement-state.ts) plus the sticky `seeded` flag the
 * pass seed sets. `transitionState` calls {@link nextToolEvidence} on every
 * transition: an unchanged ledger keeps the prior value by identity, an
 * append-only growth folds only the new tail, anything else recomputes.
 *
 * Interface merging keeps kernel-state.ts (LOC-pinned) to a few wiring lines;
 * the field lives next to the code that maintains it (precedent: pass-seed.ts).
 */
import type { RunLedger } from "../ledger/run-ledger.js";
import { foldToolEvidence, toolEvidence, type ToolEvidence } from "../capabilities/verify/requirement-state.js";
import type { KernelState } from "./kernel-state.js";

declare module "./kernel-state.js" {
  interface KernelState {
    /**
     * Tool evidence of the whole run — every successful executed call in the
     * run ledger, including a seeded earlier pass. Gates read this instead of
     * scanning `steps` (which hold only this pass). Maintained by
     * `transitionState`; never write it except to set `seeded` (pass seed).
     */
    readonly evidence: ToolEvidence;
  }
}

/**
 * The evidence for the state `transitionState` is about to return.
 *
 * `patch.evidence` contributes only its `seeded` flag (the pass seed's way to
 * mark carried evidence); counts always come from `nextLedger`. A prior state
 * without evidence (hand-built, or decoded from an older checkpoint) recomputes.
 */
export function nextToolEvidence(
  state: KernelState,
  patch: Partial<KernelState>,
  nextLedger: RunLedger,
): ToolEvidence {
  // Runtime guard: hand-built and older decoded states can lack the field, or
  // carry evidence from before the attempt counts existed (recompute those).
  const held: Partial<ToolEvidence> | undefined = state.evidence;
  const prior = isCurrentEvidence(held) ? held : undefined;
  const seeded = patch.evidence?.seeded ?? held?.seeded ?? false;
  const priorLedger = state.ledger ?? [];
  const n = priorLedger.length;
  const appendOnly =
    prior !== undefined &&
    nextLedger.length >= n &&
    (n === 0 || nextLedger[n - 1] === priorLedger[n - 1]);
  const evidence = !appendOnly
    ? toolEvidence(nextLedger)
    : nextLedger.length === n
      ? prior
      : foldToolEvidence(prior, nextLedger.slice(n));
  return evidence.seeded === seeded ? evidence : { ...evidence, seeded };
}

/** Evidence carrying every current field (older checkpoints lack the attempt counts). */
function isCurrentEvidence(evidence: Partial<ToolEvidence> | undefined): evidence is ToolEvidence {
  return evidence !== undefined && evidence.attemptedCounts !== undefined && evidence.permanentlyFailed !== undefined;
}

/**
 * The evidence of a decoded checkpoint: kept as written when it carries every
 * current field, otherwise rebuilt from the ledger (keeping its `seeded` flag),
 * so a checkpoint written before a field existed resumes with whole evidence.
 */
export function decodedEvidence(evidence: Partial<ToolEvidence> | undefined, ledger: RunLedger | undefined): ToolEvidence {
  if (isCurrentEvidence(evidence)) return evidence;
  const rebuilt = toolEvidence(ledger);
  return evidence?.seeded === true ? { ...rebuilt, seeded: true } : rebuilt;
}
