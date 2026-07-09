// File: src/kernel/policy/harness-plan.ts
//
// HarnessPlan + the Policy Compiler (the adaptive crown, meta-loop Phase 6 /
// task G1). The kernel half of convergence ruling C6 ("the flywheel IS the
// policy compiler grown up").
//
// The problem it solves: today the per-run harness config is scattered across a
// dozen opt-in `.withX()` withers, each set (or not) independently, with no
// single object that says "given THIS model on THIS task, run the harness like
// THIS". `compileHarnessPlan` turns what a run KNOWS about itself — the model's
// capability tier, its calibration, the contract's horizon, and the task
// classification — into ONE compiled `HarnessPlan`. Withers become OVERRIDES on
// that plan (an explicit `.withStrategy` / `.withLongHorizon` wins over the
// compiled default). `recompileOnAssessment` closes the loop: mid-run, on live
// RunAssessment evidence, the plan DEEPENS scaffolding when the run struggles
// and LEANS when it flows.
//
// DAG law (binding): the compiler is a PURE function of its inputs. Same inputs
// → same plan (no Date, no randomness, no fs, no LLM). The mid-run recompile is
// a pure READ of the already-computed RunAssessment (Wave E) — it never mutates
// the ledger and never recomputes the assessment. Control re-enters the run as a
// ledger `harness-signal` entry only (wired at the iterate-pass call site).
//
// SCOPE (task G1): this module is the POLICY. It COMPUTES every field of the
// per-run harness config. What is LIVE-wired today by G1 is the guard
// `horizonProfile` (runner.ts consumes it at run-start, and the recompile
// escalates it on struggle). The remaining fields — `strategy` (Phase 7
// Strategy→Policy), `verifierTier` / `budgetClass` / `toolSurface` /
// `memoryPosture`, and purpose→tier routing (G2) — are the policy the later
// waves consume; they are computed + recorded on `state.meta.harnessPlan` now
// so those waves read ONE object instead of re-deriving.

import type { ModelCalibration } from "@reactive-agents/llm-provider";
import type { ModelTier } from "../../context/context-profile.js";
import type { TaskClassification } from "../capabilities/comprehend/task-classification.js";
import type { TaskHorizon } from "../capabilities/comprehend/task-horizon.js";
import type { RunAssessment } from "../assessment/assess.js";

// ─── Plan vocabulary ─────────────────────────────────────────────────────────

/** The strategy the plan nominates. Mirrors the registered strategy names. */
export type PlanStrategy =
  | "direct"
  | "reactive"
  | "reflexion"
  | "plan-execute"
  | "blueprint"
  | "tree-of-thought"
  | "code-action"
  | "adaptive";

/** Budget posture — how generous the run's iteration/token envelope should be. */
export type PlanBudgetClass = "lean" | "standard" | "generous";

/** Verification depth, weakest → strongest (mirrors the contract's AcceptanceTier order). */
export type VerifierTier = "none" | "self-critique" | "checker" | "deterministic";

/** Memory participation posture. Default-off matches the framework default. */
export type MemoryPosture = "off" | "read" | "read-write";

/** How this plan came to be — compiled at run-start vs recompiled mid-run. */
export type PlanSource = "compiled" | "recompiled";

/** Budget sub-plan: a discrete class plus an advisory iteration ceiling. */
export interface HarnessBudgetPlan {
  readonly budgetClass: PlanBudgetClass;
  /** Advisory maxIterations the plan recommends (05-#9: the plan is the owner). */
  readonly maxIterations: number;
}

/** Guard sub-plan: the horizon profile toggle + an abstract scaffolding depth. */
export interface HarnessGuardPlan {
  /** When "long", runner.ts scales the audit-02-#12 guard constants (A2 bundle). */
  readonly horizonProfile?: "long";
  /**
   * Abstract scaffolding depth, 0 = leanest. Bounded to [0, MAX_SCAFFOLDING].
   * The recompile lever: DEEPEN raises it, LEAN lowers it. Downstream waves map
   * a level to concrete guard/verification aggressiveness.
   */
  readonly scaffoldingLevel: number;
}

/**
 * The compiled per-run harness config — the ONE object the run would otherwise
 * assemble from scattered withers. Plain data (strings/numbers/nested objects),
 * so it rides `state.meta.harnessPlan` through kernel-codec for durable resume.
 */
export interface HarnessPlan {
  readonly strategy: PlanStrategy;
  readonly budget: HarnessBudgetPlan;
  readonly guard: HarnessGuardPlan;
  readonly toolSurface: "focused" | "full";
  readonly verifierTier: VerifierTier;
  readonly memoryPosture: MemoryPosture;
  /** Provenance. */
  readonly source: PlanSource;
  /** Human-readable why (for the receipt / trace / debug). */
  readonly rationale: string;
}

// ─── Bounds + ordered ladders ────────────────────────────────────────────────

/** Scaffolding depth is bounded so the mid-run recompile can never runaway. */
export const MAX_SCAFFOLDING = 3;

const VERIFIER_LADDER: readonly VerifierTier[] = [
  "none",
  "self-critique",
  "checker",
  "deterministic",
];
const BUDGET_LADDER: readonly PlanBudgetClass[] = ["lean", "standard", "generous"];

const clamp = (n: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, n));

/** Move up/down an ordered ladder by `delta`, clamped to its ends. */
function step<T>(ladder: readonly T[], value: T, delta: number): T {
  const i = ladder.indexOf(value);
  if (i < 0) return value;
  return ladder[clamp(i + delta, 0, ladder.length - 1)] as T;
}

const bumpVerifierTo = (v: VerifierTier, floor: VerifierTier): VerifierTier =>
  VERIFIER_LADDER.indexOf(v) >= VERIFIER_LADDER.indexOf(floor) ? v : floor;

// ─── Compiler inputs ─────────────────────────────────────────────────────────

/**
 * Everything the run KNOWS about itself at compile time. All four are available
 * at run-start (runner.ts): capability from `resolveProfile(model)`, calibration
 * from `KernelInput.calibration`, horizon from the compiled RunContract, and
 * classification from `classifyTask(task)`.
 */
export interface HarnessPlanInputs {
  /** Model capability — the resolved tier (frontier/large/mid/local). */
  readonly capability: { readonly tier: ModelTier };
  /** Live per-model calibration, when resolved. Absent → capability-only compile. */
  readonly calibration?: ModelCalibration;
  /** The contract's horizon axis (`contract.horizon`). */
  readonly horizon: TaskHorizon;
  /** The single canonical task classification (`classifyTask(task)`). */
  readonly classification: TaskClassification;
}

// ─── Base posture by capability tier ─────────────────────────────────────────

interface TierBase {
  readonly scaffolding: number;
  readonly verifier: VerifierTier;
  readonly toolSurface: "focused" | "full";
}

const TIER_BASE: Record<ModelTier, TierBase> = {
  // Weak local models get the most scaffolding + a deterministic-leaning checker.
  local: { scaffolding: 2, verifier: "checker", toolSurface: "focused" },
  mid: { scaffolding: 1, verifier: "self-critique", toolSurface: "focused" },
  large: { scaffolding: 1, verifier: "self-critique", toolSurface: "full" },
  // Strong frontier models run leanest — trusted to self-direct.
  frontier: { scaffolding: 0, verifier: "none", toolSurface: "full" },
};

/** Advisory iteration ceiling per complexity (05-#9: the plan owns the number). */
const BASE_MAX_ITER: Record<TaskClassification["complexity"]["complexity"], number> = {
  trivial: 5,
  moderate: 12,
  complex: 25,
};

/** Long-horizon runs always get a generous iteration floor. */
const LONG_MAX_ITER_FLOOR = 40;

// ─── The compiler (deterministic, pure) ──────────────────────────────────────

/**
 * Compile the per-run HarnessPlan from what the run knows about itself. Pure and
 * deterministic — same inputs → same plan. This is the FLOOR the withers then
 * override (see {@link applyExplicitOverrides}).
 */
export function compileHarnessPlan(inputs: HarnessPlanInputs): HarnessPlan {
  const { capability, calibration, horizon, classification } = inputs;
  const complexity = classification.complexity.complexity;
  const isLong = horizon === "long";

  const base = TIER_BASE[capability.tier];
  const reasons: string[] = [`tier=${capability.tier}`, `horizon=${horizon}`, `complexity=${complexity}`];

  // ── Scaffolding depth ──────────────────────────────────────────────────────
  let scaffolding = base.scaffolding;
  if (isLong) {
    scaffolding += 1;
    reasons.push("long:+scaffold");
  }

  // ── Verifier tier ──────────────────────────────────────────────────────────
  let verifier = base.verifier;
  if (isLong) {
    // Long deliverables warrant at least a self-critique pass.
    verifier = bumpVerifierTo(verifier, "self-critique");
  }

  // ── Calibration-driven deepening (only when calibration is present) ─────────
  if (calibration) {
    if (calibration.systemPromptAttention === "weak") {
      scaffolding += 1;
      reasons.push("cal:weak-attention:+scaffold");
    }
    if (calibration.observationHandling === "hallucinate-risk") {
      scaffolding += 1;
      verifier = bumpVerifierTo(verifier, "checker");
      reasons.push("cal:hallucinate-risk:+scaffold+verify");
    }
  }
  scaffolding = clamp(scaffolding, 0, MAX_SCAFFOLDING);

  // ── Strategy nomination ────────────────────────────────────────────────────
  const strategy: PlanStrategy =
    isLong && complexity !== "trivial"
      ? "plan-execute"
      : complexity === "complex"
        ? "plan-execute"
        : complexity === "trivial"
          ? "direct"
          : "reactive";

  // ── Budget class + advisory iteration ceiling ──────────────────────────────
  let budgetClass: PlanBudgetClass =
    complexity === "complex" ? "generous" : complexity === "moderate" ? "standard" : "lean";
  if (isLong) budgetClass = "generous";
  // Weak models need more room to reach the same answer — bump one class.
  if (capability.tier === "local") budgetClass = step(BUDGET_LADDER, budgetClass, 1);

  const maxIterations = isLong
    ? Math.max(BASE_MAX_ITER[complexity], LONG_MAX_ITER_FLOOR)
    : BASE_MAX_ITER[complexity];

  // ── Memory posture ─────────────────────────────────────────────────────────
  const memoryPosture: MemoryPosture = isLong || complexity === "complex" ? "read" : "off";

  return freezePlan({
    strategy,
    budget: { budgetClass, maxIterations },
    guard: {
      ...(isLong ? { horizonProfile: "long" as const } : {}),
      scaffoldingLevel: scaffolding,
    },
    toolSurface: base.toolSurface,
    verifierTier: verifier,
    memoryPosture,
    source: "compiled",
    rationale: reasons.join(" "),
  });
}

// ─── Wither overrides (explicit wins over compiled default) ───────────────────

/**
 * The explicit-wither values that OVERRIDE the compiled plan. Every field is
 * optional: a `undefined` field means "the user did not set the corresponding
 * wither — keep the plan default". A defined field WINS (the plan supplies
 * defaults; explicit withers override). This is how `horizonProfile` subsumes
 * A2's flag: the compiler decides "long" from `contract.horizon`, but a caller
 * passing `horizonProfile: "long"` (from `.withLongHorizon()`) forces it on.
 */
export interface PlanOverrides {
  readonly strategy?: PlanStrategy;
  readonly horizonProfile?: "long";
  readonly budgetClass?: PlanBudgetClass;
  readonly maxIterations?: number;
  readonly toolSurface?: "focused" | "full";
  readonly verifierTier?: VerifierTier;
  readonly memoryPosture?: MemoryPosture;
}

/**
 * Apply explicit-wither overrides onto a compiled plan. A defined override field
 * replaces the plan's default; an absent one leaves the plan value untouched.
 * Pure — returns a new frozen plan.
 */
export function applyExplicitOverrides(
  plan: HarnessPlan,
  overrides: PlanOverrides,
): HarnessPlan {
  const guard: HarnessGuardPlan = {
    ...plan.guard,
    // horizonProfile override: `.withLongHorizon()` forces "long"; when the
    // override is absent the compiled value (from contract.horizon) stands.
    ...(overrides.horizonProfile !== undefined
      ? { horizonProfile: overrides.horizonProfile }
      : {}),
  };
  return freezePlan({
    strategy: overrides.strategy ?? plan.strategy,
    budget: {
      budgetClass: overrides.budgetClass ?? plan.budget.budgetClass,
      maxIterations: overrides.maxIterations ?? plan.budget.maxIterations,
    },
    guard,
    toolSurface: overrides.toolSurface ?? plan.toolSurface,
    verifierTier: overrides.verifierTier ?? plan.verifierTier,
    memoryPosture: overrides.memoryPosture ?? plan.memoryPosture,
    source: plan.source,
    rationale: plan.rationale,
  });
}

// ─── Mid-run recompile (the adaptive lever) ──────────────────────────────────

/** Which way a recompile moved the plan. */
export type RecompileDirection = "deepen" | "lean" | "none";

/** The outcome of a mid-run recompile. */
export interface RecompileResult {
  readonly plan: HarnessPlan;
  /** True when the plan actually changed (a bounded step was taken). */
  readonly changed: boolean;
  readonly direction: RecompileDirection;
  readonly reason: string;
}

/** Tunables for the recompile decision. Defaults are the shipped policy. */
export interface RecompileOptions {
  /** Consecutive tool failures that trigger a DEEPEN. */
  readonly deepenFailureThreshold?: number;
  /** Stall/loop harness-signals in the window that trigger a DEEPEN. */
  readonly deepenStuckSignals?: number;
  /** Iterations without new evidence that trigger a DEEPEN. */
  readonly deepenStuckIters?: number;
}

const DEFAULT_RECOMPILE: Required<RecompileOptions> = {
  deepenFailureThreshold: 3,
  deepenStuckSignals: 2,
  deepenStuckIters: 3,
};

/**
 * Recompile the plan from live RunAssessment evidence. Pure READ of the
 * assessment (no ledger mutation, no assessment recompute — DAG law). Bounded:
 * at most ONE step per call, scaffolding clamped to [0, MAX_SCAFFOLDING].
 *
 *  - DEEPEN (raise scaffolding, bump verifier, force horizonProfile "long") when
 *    the run is STRUGGLING: repeated failures, stuck signals, or no new evidence.
 *  - LEAN (lower scaffolding, ease verifier) when the run is FLOWING cleanly and
 *    there is scaffolding to shed.
 *  - none when neither holds, or when a step would exceed the bounds.
 */
export function recompileOnAssessment(
  plan: HarnessPlan,
  assessment: RunAssessment,
  options: RecompileOptions = {},
): RecompileResult {
  const opts = { ...DEFAULT_RECOMPILE, ...options };
  const { health, evidenceDelta } = assessment;

  const struggling =
    health.consecutiveFailures >= opts.deepenFailureThreshold ||
    health.stuckSignals >= opts.deepenStuckSignals ||
    (evidenceDelta === 0 && health.iterationsSinceEvidence >= opts.deepenStuckIters);

  const flowing =
    health.consecutiveFailures === 0 &&
    health.recentFailures === 0 &&
    health.stuckSignals === 0 &&
    evidenceDelta > 0;

  if (struggling) {
    const nextScaffold = clamp(plan.guard.scaffoldingLevel + 1, 0, MAX_SCAFFOLDING);
    const nextVerifier = step(VERIFIER_LADDER, plan.verifierTier, 1);
    const nextBudget = step(BUDGET_LADDER, plan.budget.budgetClass, 1);
    const alreadyLong = plan.guard.horizonProfile === "long";
    const changed =
      nextScaffold !== plan.guard.scaffoldingLevel ||
      nextVerifier !== plan.verifierTier ||
      nextBudget !== plan.budget.budgetClass ||
      !alreadyLong;
    if (!changed) {
      return { plan, changed: false, direction: "none", reason: "already at max scaffolding" };
    }
    const reason = `deepen: consecutiveFailures=${health.consecutiveFailures} stuckSignals=${health.stuckSignals} evidenceDelta=${evidenceDelta}`;
    return {
      plan: freezePlan({
        ...plan,
        guard: { horizonProfile: "long", scaffoldingLevel: nextScaffold },
        verifierTier: nextVerifier,
        budget: { ...plan.budget, budgetClass: nextBudget },
        source: "recompiled",
        rationale: reason,
      }),
      changed: true,
      direction: "deepen",
      reason,
    };
  }

  if (flowing) {
    const nextScaffold = clamp(plan.guard.scaffoldingLevel - 1, 0, MAX_SCAFFOLDING);
    const nextVerifier = step(VERIFIER_LADDER, plan.verifierTier, -1);
    const changed = nextScaffold !== plan.guard.scaffoldingLevel || nextVerifier !== plan.verifierTier;
    if (!changed) {
      return { plan, changed: false, direction: "none", reason: "already lean" };
    }
    const reason = `lean: clean trajectory, evidenceDelta=${evidenceDelta}`;
    return {
      plan: freezePlan({
        ...plan,
        guard: { ...plan.guard, scaffoldingLevel: nextScaffold },
        verifierTier: nextVerifier,
        source: "recompiled",
        rationale: reason,
      }),
      changed: true,
      direction: "lean",
      reason,
    };
  }

  return { plan, changed: false, direction: "none", reason: "steady" };
}

// ─── Freeze helper ───────────────────────────────────────────────────────────

function freezePlan(plan: HarnessPlan): HarnessPlan {
  Object.freeze(plan.budget);
  Object.freeze(plan.guard);
  return Object.freeze(plan);
}
