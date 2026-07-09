// File: src/kernel/policy/strategy-nomination.ts
//
// The dispatch-time half of Phase 7 (Strategy→Policy), owned by the Policy
// Compiler module.
//
// Why it lives here: `scripts/check-policy-compiler.sh` enforces that
// `compileHarnessPlan` / `applyExplicitOverrides` / `recompileOnAssessment` are
// called ONLY from `kernel/policy/` (plus two grandfathered loop seams). Phase 7
// originally called `compileHarnessPlan` from `services/strategy-selection.ts`,
// which violated that invariant — and the script went red the moment Phase 7
// landed. Nobody noticed, because nothing executed the script (wiring audit
// 2026-07-09). The plan compile now lives behind this policy-owned seam, and
// `strategy-selection.ts` consumes a nominated strategy rather than reaching for
// the compiler itself.
//
// Note on horizon: this compile derives horizon from `classifyTask(task)
// .horizon.horizon`, and `compileRunContract` derives it from
// `classifyTaskHorizon(task)`. Both bottom out in the SAME `classifyTaskHorizon`
// function, so the dispatch-time nomination and the run-start contract agree by
// construction. They are two calls, not two sources of truth.
//
// DAG law: pure. Same inputs → same nomination. No mutation, no ledger, no I/O.

import type { ModelTier } from "../../context/context-profile.js";
import type { ModelCalibration } from "@reactive-agents/llm-provider";
import type { ContextProfile } from "../../context/context-profile.js";
import {
  classifyTask,
  type TaskClassification,
} from "../capabilities/comprehend/task-classification.js";
import { compileHarnessPlan, type PlanStrategy } from "./harness-plan.js";

/** The fields the dispatch-time nomination reads. */
export interface StrategyNominationInputs {
  readonly taskDescription: string;
  /** Canonical pre-computed classification, when threaded (HS-cleanup-2). */
  readonly taskClassification?: TaskClassification;
  readonly providerName?: string;
  readonly contextProfile?: Partial<ContextProfile>;
  readonly calibration?: ModelCalibration;
}

/**
 * Resolve the dispatch-time model tier the SAME way runner.ts does when it
 * compiles its own guard plan: an explicit `contextProfile.tier` wins, else
 * Ollama defaults to "local" and everything else to "mid".
 */
function dispatchTier(inputs: StrategyNominationInputs): ModelTier {
  return (
    inputs.contextProfile?.tier ?? (inputs.providerName === "ollama" ? "local" : "mid")
  );
}

/**
 * The strategy the compiled plan nominates for this dispatch. Pure.
 * Callers map it onto a registry id (see `PLAN_TO_REGISTRY`).
 */
export function nominatePlanStrategy(inputs: StrategyNominationInputs): PlanStrategy {
  const classification = inputs.taskClassification ?? classifyTask(inputs.taskDescription);
  return compileHarnessPlan({
    capability: { tier: dispatchTier(inputs) },
    ...(inputs.calibration ? { calibration: inputs.calibration } : {}),
    horizon: classification.horizon.horizon,
    classification,
  }).strategy;
}
