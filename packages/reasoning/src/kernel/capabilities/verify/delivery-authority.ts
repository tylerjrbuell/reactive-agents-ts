// File: src/kernel/capabilities/verify/delivery-authority.ts
//
// THE single success authority for delivery post-conditions (Move 2 /
// Sys-audit 2026-07-29 RC#1). Every path that decides whether a run met its
// deliverable contract — the imperative hard-stop (`terminate.ts`) and the
// verdict gate (`terminal-gate.ts` via the arbitrator) — MUST route through
// this function, never call the pure `verify()` directly for a delivery
// decision. That is what keeps the fix from being Face-A ("fixed where we were
// looking"): the ground-truth (disk) + run-scoped-ledger evidence is composed
// in ONE place, so a NEW authority cannot silently regress to filesystem-blind
// reconstruction. `check-success-authority.sh` enforces the routing.

import type { ReasoningStep } from "../../../types/index.js";
import type { RunLedger } from "../../ledger/run-ledger.js";
import { nodeFileExists } from "./file-truth.js";
import {
  verify,
  type PostCondition,
  type PostConditionResult,
} from "./post-conditions.js";

/** The evidence a delivery decision is made from. */
export interface DeliveryEvidence {
  /** The current agent's own steps (`state.steps`). */
  readonly steps: readonly ReasoningStep[];
  /** Assembled deliverable output — feeds `OutputContains` conditions. */
  readonly output?: string;
  /**
   * The run-scoped RunLedger. A DELEGATED write lives only here (the parent's
   * steps hold `spawn-agent`), so omitting it false-fails a delegated
   * deliverable. Optional only so pre-ledger unit callers keep working.
   */
  readonly ledger?: RunLedger;
  /**
   * Ground-truth filesystem check. Defaults to the real fs (`nodeFileExists`)
   * so ground truth is ON BY CONSTRUCTION — a caller cannot forget it. Injected
   * as a stub ONLY by unit tests that need determinism without touching disk.
   */
  readonly fileExists?: (path: string) => boolean;
}

/**
 * Decide which delivery post-conditions are met. Ground truth (disk existence
 * of an `ArtifactProduced` target) is a positive-only override wired in here by
 * default: it can flip a would-be UNMET to MET but never the reverse, so it
 * strictly reduces the filesystem-blind false-failure RC#1 measured at 88%,
 * without opening a false-met.
 */
export function verifyDelivery(
  conditions: readonly PostCondition[],
  evidence: DeliveryEvidence,
): PostConditionResult {
  return verify(conditions, evidence.steps, {
    output: evidence.output ?? "",
    ledger: evidence.ledger,
    fileExists: evidence.fileExists ?? nodeFileExists,
  });
}
