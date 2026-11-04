// File: src/kernel/capabilities/verify/strategy-delivery.ts
//
// D9 (Plan 8 section D item 9) — primitive B: judge a strategy's delivery
// against its run contract through the single delivery authority.
//
// A strategy without a top-level kernel pass (plan-execute first) has no
// terminal verify gate, so its outcome carried no verdict. This judges the
// contract's deterministic conditions with `verifyDelivery` (ledger, then
// steps, then disk) and returns the gate-shaped `DeliverableDecision` the
// finalize mint turns into a non-null outcome verdict.
//
// Never judge with the ledger-only `conditionMetByLedger`: a strategy that
// mints no `artifact` entries would be refused for files it wrote. Routed
// through `verifyDelivery` (check-success-authority.sh lists this file).

import type { ReasoningStep } from "../../../types/index.js";
import type { RunLedger } from "../../ledger/run-ledger.js";
import type { RunContract } from "../../contract/run-contract.js";
import { deliveryConditions } from "../../contract/declared-deliverables.js";
import type { DeliverableDecision, DeliverableProvenance } from "../../loop/runner-helpers/deliverable-decision.js";
import { verifyDelivery } from "./delivery-authority.js";
import { describeUnmet, type PostCondition } from "./post-conditions.js";

/** Evidence the strategy judgment reads. */
export interface StrategyDeliveryEvidence {
  /** The strategy's own steps. */
  readonly steps: readonly ReasoningStep[];
  /** Run-scoped ledger (sub-kernel and delegated writes live here). */
  readonly ledger?: RunLedger;
  /** The final output (feeds `OutputContains`). */
  readonly output?: string;
  /** Test-only disk stub; defaults to the real filesystem inside `verifyDelivery`. */
  readonly fileExists?: (path: string) => boolean;
}

/** Options for {@link judgeStrategyDelivery}. */
export interface StrategyDeliveryOptions {
  /**
   * `"pre-synthesis"`: the answer is not written yet, so `OutputContains`
   * conditions are skipped (they cannot be met before synthesis). Default
   * `"terminal"` judges every condition.
   */
  readonly phase?: "pre-synthesis" | "terminal";
  /** Provenance of the delivered output. Default: `"model-final"` with output, `"none"` without. */
  readonly provenance?: DeliverableProvenance;
}

/** The strategy delivery judgment. */
export interface StrategyDeliveryJudgment {
  /** Conditions the evidence left unmet. */
  readonly unmet: readonly PostCondition[];
  /** Contract requirement ids of the unmet conditions (stable: `artifact:./x`, `tool:y`, ...). */
  readonly unmetIds: readonly string[];
  /** Human-readable descriptions of what is still outstanding. */
  readonly outstanding: readonly string[];
  /** Gate-shaped decision: `accepted` iff nothing is unmet. */
  readonly decision: DeliverableDecision;
}

/** Stable id for an unmet condition: its contract requirement id, else a kind-derived id. */
function conditionId(condition: PostCondition, contract: RunContract): string {
  const key = JSON.stringify(condition);
  const owner = contract.requirements.find(
    (r) => r.spec.condition !== undefined && JSON.stringify(r.spec.condition) === key,
  );
  if (owner !== undefined) return owner.id;
  switch (condition.kind) {
    case "ToolCalled":
      return `tool:${condition.tool}`;
    case "ArtifactProduced":
      return `artifact:${condition.path}`;
    case "OutputContains":
      return `output:${condition.pattern}`;
    case "SideEffectLanded":
      return "side-effect";
  }
}

/** Description of one unmet condition, without the steering prefix. */
function conditionDescription(condition: PostCondition): string {
  return describeUnmet([condition]).replace(/^You still must: /, "").replace(/\.$/, "");
}

/**
 * Judge a strategy's delivery against its run contract. Deterministic, no LLM;
 * reads the disk only through `verifyDelivery` (positive-only ground truth).
 * A contract with no deterministic conditions (a plain answer) is accepted.
 */
export function judgeStrategyDelivery(
  contract: RunContract,
  evidence: StrategyDeliveryEvidence,
  options: StrategyDeliveryOptions = {},
): StrategyDeliveryJudgment {
  const all = deliveryConditions({ postConditions: contract.postConditions, runContract: contract }) ?? [];
  const conditions =
    options.phase === "pre-synthesis" ? all.filter((c) => c.kind !== "OutputContains") : all;
  const output = evidence.output ?? "";
  const { unmet } = verifyDelivery(conditions, {
    steps: evidence.steps,
    output,
    ...(evidence.ledger !== undefined ? { ledger: evidence.ledger } : {}),
    ...(evidence.fileExists !== undefined ? { fileExists: evidence.fileExists } : {}),
  });
  const unmetIds = [...new Set(unmet.map((c) => conditionId(c, contract)))];
  const outstanding = unmet.map(conditionDescription);
  const accepted = unmet.length === 0;
  const why = accepted
    ? conditions.length === 0
      ? "no deterministic delivery conditions"
      : "all delivery conditions met"
    : `delivery conditions unmet: ${outstanding.join("; ")}`;
  const verdictSummary = accepted
    ? `delivery verified (${conditions.length}/${conditions.length} conditions met)`
    : `delivery unmet (${conditions.length - unmet.length}/${conditions.length} conditions met): ${unmetIds.join(", ")}`;
  const chosen: DeliverableDecision["chosen"] =
    options.provenance ?? (output.trim().length > 0 ? "model-final" : "none");
  return {
    unmet,
    unmetIds,
    outstanding,
    decision: {
      chosen,
      accepted,
      why,
      verdictSummary,
      rejected: [],
      verifier: { verified: accepted, failedChecks: unmetIds },
    },
  };
}
