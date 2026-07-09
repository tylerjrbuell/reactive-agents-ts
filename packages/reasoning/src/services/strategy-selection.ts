// File: src/services/strategy-selection.ts
//
// Phase 7 (Strategy→Policy) — the kernel-side finale of the policy-compiler
// movement (convergence ruling C6). The Policy Compiler (`kernel/policy/
// harness-plan.ts`) already COMPUTES `plan.strategy`; this module lets that
// compiled plan DRIVE the run's strategy selection at dispatch time when the run
// is adaptive.
//
// DAG law (binding): `selectStrategyName` is a PURE compile from its inputs
// (model tier + task classification incl. horizon) → a registry strategy id. It
// reads inputs and returns a name — no mutation, no ledger, no I/O, no LLM.
//
// Precedence (highest → lowest), and the reasoning for it:
//   1. `config.adaptive.enabled` → "adaptive". UNCHANGED from the pre-Phase-7
//      expression, and deliberately kept at the TOP. It is a DISTINCT opt-in
//      meta-strategy (a runtime sub-strategy PICKER that chooses per-task inside
//      the run), orthogonal to the dispatch-time plan compile. Keeping it top
//      also preserves the byte-identical default path (the old expression had
//      `adaptive.enabled` win over `params.strategy`).
//   2. explicit `params.strategy` (`.withStrategy()`) → wins over the PLAN.
//      Mirrors the compiler's `applyExplicitOverrides` philosophy (wither wins).
//   3. `params.adaptiveHarness === true` → the mapped `compileHarnessPlan(...)
//      .strategy` (NEW in Phase 7).
//   4. `config.defaultStrategy` (the floor).
//
// config.adaptive.enabled interaction decision: the task's aspirational ordering
// ("explicit > adaptive.enabled") would REORDER the default-off path (where
// adaptive.enabled currently beats params.strategy) and thus break the
// byte-identical pin. So we take the smallest coherent cut: explicit
// `.withStrategy()` overrides the PLAN, not the adaptive.enabled meta-strategy.
// adaptive.enabled behaviour is therefore identical to before Phase 7.
//
// When `adaptiveHarness` is OFF (default/undefined), branches 3 collapses out
// and the whole function reduces to the exact current expression:
//   config.adaptive.enabled ? "adaptive" : (params.strategy ?? config.defaultStrategy)

import type { ReasoningStrategy } from "../types/index.js";
import type { ContextProfile } from "../context/context-profile.js";
import type { ModelCalibration } from "@reactive-agents/llm-provider";
import type { TaskClassification } from "../kernel/capabilities/comprehend/task-classification.js";
import type { PlanStrategy } from "../kernel/policy/harness-plan.js";
import { nominatePlanStrategy } from "../kernel/policy/strategy-nomination.js";

/**
 * Map a compiled {@link PlanStrategy} to the registry's {@link ReasoningStrategy}
 * id. Identity for every strategy except `plan-execute`, which the registry
 * registers under `plan-execute-reflect` (see strategy-registry.ts). The mapping
 * is total over `PlanStrategy`, so the compiler can never nominate a strategy the
 * registry cannot resolve.
 */
export const PLAN_TO_REGISTRY: Record<PlanStrategy, ReasoningStrategy> = {
  direct: "direct",
  reactive: "reactive",
  reflexion: "reflexion",
  "plan-execute": "plan-execute-reflect",
  blueprint: "blueprint",
  "tree-of-thought": "tree-of-thought",
  "code-action": "code-action",
  adaptive: "adaptive",
};

/** The fields `selectStrategyName` reads. A structural subset of the service's
 *  `execute` params, so the call site can pass `params` directly. */
export interface StrategySelectionParams {
  readonly strategy?: ReasoningStrategy;
  readonly adaptiveHarness?: boolean;
  readonly taskDescription: string;
  /** Canonical pre-computed classification, when threaded (preferred over
   *  re-classifying the task string — HS-cleanup-2). */
  readonly taskClassification?: TaskClassification;
  readonly modelId?: string;
  readonly providerName?: string;
  readonly contextProfile?: Partial<ContextProfile>;
  readonly calibration?: ModelCalibration;
}

/** The minimal config shape `selectStrategyName` reads — a structural subset of
 *  `ReasoningConfig` so the full config (and any partial config in tests) fits. */
export interface StrategySelectionConfig {
  readonly adaptive: { readonly enabled: boolean };
  readonly defaultStrategy: ReasoningStrategy;
}

/**
 * Compile the plan's nominated strategy at dispatch time (pure).
 *
 * The compile itself lives in `kernel/policy/strategy-nomination.ts` — the
 * Policy Compiler is the single owner of `compileHarnessPlan`
 * (`scripts/check-policy-compiler.sh`). Calling it from here directly is what
 * turned that invariant script red the day Phase 7 landed.
 */
function compilePlanStrategy(params: StrategySelectionParams): PlanStrategy {
  return nominatePlanStrategy(params);
}

/**
 * Select the strategy id the registry should run for this dispatch. Pure — see
 * the precedence + DAG law in the module header.
 */
export function selectStrategyName(
  params: StrategySelectionParams,
  config: StrategySelectionConfig,
): ReasoningStrategy {
  if (config.adaptive.enabled) return "adaptive";
  if (params.strategy !== undefined) return params.strategy;
  if (params.adaptiveHarness === true) {
    return PLAN_TO_REGISTRY[compilePlanStrategy(params)];
  }
  return config.defaultStrategy;
}
