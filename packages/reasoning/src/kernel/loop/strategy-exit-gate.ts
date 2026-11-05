/**
 * strategy-exit-gate.ts — D9 (Plan 8 section D item 9) primitive C: the
 * strategy-level analog of `exit-gate.ts` `proposeExit`.
 *
 * A strategy without a top-level kernel pass (plan-execute first) claims "done"
 * on its own terms (a SATISFIED reflection). That claim is a PROPOSAL. This
 * gate judges it against the run contract with `judgeStrategyDelivery`
 * (`pre-synthesis` phase: the answer is not written yet) and disposes with the
 * SAME law the kernel's exit gate uses (`disposeExit`, verbatim):
 *
 *   - nothing unmet                       → `accept`
 *   - unmet, room, not denied before      → `repair` (one targeted repair turn
 *                                           whose guidance names each missing
 *                                           deliverable: file paths, tools)
 *   - unmet, denied before or no room     → `handoff` (a labelled partial; the
 *                                           strategy appends `unfinishedBlock`)
 *   - unmet, nothing to hand off          → `accept-with-failure` (the honest
 *                                           failure; a partial built from no
 *                                           material would only invent one)
 *
 * Before the delivery judgment, the required-tool grounding arm runs (moved
 * from plan-execute's `evaluateGroundedSatisfaction`, generalized by strategy):
 * a SATISFIED claim with a required tool never executed redirects once, then
 * abstains.
 *
 * Every non-clean disposition emits the `strategy_delivery_gate` guard
 * (distinct from `exit_gate`, which composite step kernels already emit), so
 * `h3/verdict.ts --mechanism strategy_delivery_gate` counts only this gate.
 * The gate never finalizes: it returns a tagged result the strategy branches
 * on, and the strategy's finalize call owns the terminal.
 */
import { Effect } from "effect";
import type { RunContract } from "../contract/run-contract.js";
import {
  evaluateTerminalGate,
  PLAN_EXECUTE_SATISFIED,
  REFLEXION_SATISFIED,
} from "../capabilities/decide/terminal-gate.js";
import {
  judgeStrategyDelivery,
  type StrategyDeliveryEvidence,
} from "../capabilities/verify/strategy-delivery.js";
import { detectContinuationIntent } from "../capabilities/verify/quality-utils.js";
import { emitGuardFired } from "../utils/diagnostics.js";
import { disposeExit, type ExitGateDecision } from "./exit-gate.js";
import { MIN_MODEL_SYNTHESIS_LENGTH } from "./runner-helpers/deliverable.js";
import type { DeliverableDecision } from "./runner-helpers/deliverable-decision.js";

/** Guard name every strategy delivery gate disposition is emitted under. */
export const STRATEGY_DELIVERY_GATE = "strategy_delivery_gate";

/** Strategies whose SATISFIED claim this gate judges (each maps to a gated terminal reason). */
export type GatedStrategy = "plan-execute" | "reflexion";

const SATISFIED_REASON: Record<GatedStrategy, string> = {
  "plan-execute": PLAN_EXECUTE_SATISFIED,
  reflexion: REFLEXION_SATISFIED,
};

/** Result of the required-tool grounding arm. */
export interface StrategyGroundingVerdict {
  readonly verdict: "accept" | "redirect" | "abstain";
  readonly missing: readonly string[];
}

/**
 * Pure required-tool grounding for a strategy's SATISFIED claim: acceptable
 * only when every required tool was actually executed. First violation
 * redirects (one chance to add real tool steps); a repeat violation abstains
 * honestly instead of shipping an ungrounded success. Moved unchanged from
 * plan-execute (P3/FM#4); `strategy` selects the gated terminal reason.
 */
export function evaluateStrategyGrounding(args: {
  readonly strategy: GatedStrategy;
  readonly satisfied: boolean;
  readonly requiredTools: readonly string[] | undefined;
  readonly completedToolNames: ReadonlySet<string>;
  readonly redirectsSoFar: number;
}): StrategyGroundingVerdict {
  if (!args.satisfied) return { verdict: "accept", missing: [] };
  // The decision lives in the kernel terminal gate (coverage check,
  // covered = COMPLETED tool steps, abstain on exhaustion). Grounding is held
  // true: a SATISFIED claim with zero completed tool steps is exactly the
  // missing-coverage case anyway.
  const gate = evaluateTerminalGate({
    terminatedBy: SATISFIED_REASON[args.strategy],
    requiredTools: args.requiredTools ?? [],
    coveredTools: args.completedToolNames,
    hasSubstantiveGrounding: true,
    redirectsSpent: { grounding: 0, coverage: args.redirectsSoFar, checker: 0 },
    coverageExhaustionPolicy: "abstain",
    buildGroundingGuidance: () => "",
    buildCoverageGuidance: (missing) => missing.join(", "),
  });
  if (gate.decision === "accept") return { verdict: "accept", missing: [] };
  return { verdict: gate.decision, missing: gate.missing };
}

/**
 * The pure strategy disposition: {@link disposeExit} verbatim. A strategy
 * SATISFIED claim is a `soft` exit (deny-once eligible). The strategy owns its
 * own room test (refinements left, budget), so `roomForOneMore` is mapped onto
 * disposeExit's iteration arithmetic: iteration 0 of a cap of 2 has room, of a
 * cap of 1 has none.
 */
export function disposeStrategyExit(args: {
  readonly outstanding: readonly string[];
  readonly hasMaterial: boolean;
  readonly deniedBefore: boolean;
  readonly roomForOneMore: boolean;
}): ExitGateDecision {
  return disposeExit({
    kind: "soft",
    outstanding: args.outstanding,
    hasMaterial: args.hasMaterial,
    deniedBefore: args.deniedBefore,
    iteration: 0,
    llmCalls: 0,
    maxIterations: args.roomForOneMore ? 2 : 1,
  });
}

/**
 * Material a strategy handoff could work from: a successful tool observation
 * on the strategy's steps, or an output draft substantial enough to be an
 * answer candidate (the kernel's {@link MIN_MODEL_SYNTHESIS_LENGTH} bar) that
 * is not a promise to act.
 */
export function strategyHasMaterial(evidence: StrategyDeliveryEvidence): boolean {
  if (evidence.steps.some((s) => s.type === "observation" && s.metadata?.observationResult?.success === true)) {
    return true;
  }
  const text = (evidence.output ?? "").trim();
  return text.length >= MIN_MODEL_SYNTHESIS_LENGTH && !detectContinuationIntent(text).isContinuation;
}

/** The repair guidance a `repair` result carries: each missing deliverable, by name. */
export function strategyRepairGuidance(outstanding: readonly string[]): string {
  return (
    `The goal is not met yet. Still outstanding:\n${outstanding.map((o) => `- ${o}`).join("\n")}\n` +
    "Add steps that do exactly these now, using the results you already have. Do not declare the goal met until they are done."
  );
}

/** What {@link proposeStrategyExit} decided; the strategy branches on `_tag`. */
export type StrategyExitResult =
  /** Nothing outstanding: ship. `decision.accepted` is true. */
  | { readonly _tag: "accept"; readonly decision: DeliverableDecision }
  /** One targeted repair: feed `guidance` into the strategy's refinement. */
  | { readonly _tag: "repair"; readonly guidance: string; readonly outstanding: readonly string[] }
  /** Labelled partial: append `unfinishedBlock(outstanding)`; pass `decision` to finalize. */
  | { readonly _tag: "handoff"; readonly outstanding: readonly string[]; readonly decision: DeliverableDecision }
  /** Outstanding items and no material: the honest failure stands; pass `decision` to finalize. */
  | { readonly _tag: "accept-with-failure"; readonly outstanding: readonly string[]; readonly decision: DeliverableDecision }
  /** Grounding: a required tool never ran; redirect once. */
  | { readonly _tag: "redirect"; readonly missing: readonly string[] }
  /** Grounding: a required tool still never ran after the redirect; abstain. */
  | { readonly _tag: "abstain"; readonly missing: readonly string[] };

/** Inputs to {@link proposeStrategyExit}. */
export interface StrategyExitProposal {
  readonly strategy: GatedStrategy;
  readonly contract: RunContract;
  readonly evidence: StrategyDeliveryEvidence;
  /** True once this run already took its one repair (deny-once is per run). */
  readonly deniedBefore: boolean;
  /** True when the strategy can still run one more refinement to act on a repair. */
  readonly roomForOneMore: boolean;
  readonly taskId: string;
  /** Iteration stamped on the guard event (e.g. the refinement index). */
  readonly iteration: number;
  /** Override the derived {@link strategyHasMaterial} (evidence the steps do not carry). */
  readonly hasMaterial?: boolean;
  /**
   * Required-tool coverage arm (redirect / abstain when a required tool never
   * ran); omitted = skipped. Named `toolGrounding`, not `grounding`: the
   * RunEnvelope cross-cutting `grounding` field is a different concern, and a
   * strategy input re-declaring that name trips check-cross-cutting.
   */
  readonly toolGrounding?: {
    readonly requiredTools: readonly string[] | undefined;
    readonly completedToolNames: ReadonlySet<string>;
    readonly redirectsSoFar: number;
  };
}

const OUTCOME: Record<"repair" | "handoff" | "accept-with-failure", "block" | "terminate"> = {
  repair: "block",
  handoff: "terminate",
  "accept-with-failure": "terminate",
};

/**
 * Propose a strategy's SATISFIED exit to the shared delivery gate. Grounding
 * first (redirect / abstain), then the contract judgment disposed by
 * {@link disposeExit}. Emits `strategy_delivery_gate` on repair (`block`),
 * handoff and accept-with-failure (`terminate`); a clean accept is silent.
 */
export function proposeStrategyExit(
  args: StrategyExitProposal,
): Effect.Effect<StrategyExitResult, never, never> {
  return Effect.gen(function* () {
    if (args.toolGrounding !== undefined) {
      const grounded = evaluateStrategyGrounding({ strategy: args.strategy, satisfied: true, ...args.toolGrounding });
      if (grounded.verdict !== "accept") return { _tag: grounded.verdict, missing: grounded.missing };
    }
    const judgment = judgeStrategyDelivery(args.contract, args.evidence, { phase: "pre-synthesis" });
    const outstanding = judgment.outstanding;
    const gateDecision = disposeStrategyExit({
      outstanding,
      hasMaterial: args.hasMaterial ?? strategyHasMaterial(args.evidence),
      deniedBefore: args.deniedBefore,
      roomForOneMore: args.roomForOneMore,
    });
    if (gateDecision === "accept" && outstanding.length === 0) {
      return { _tag: "accept", decision: judgment.decision };
    }
    const tag = gateDecision === "deny-once" ? "repair" : gateDecision === "handoff" ? "handoff" : "accept-with-failure";
    yield* emitGuardFired({
      taskId: args.taskId,
      iteration: args.iteration,
      guard: STRATEGY_DELIVERY_GATE,
      outcome: OUTCOME[tag],
      reason: "strategy_delivery_unmet",
      metadata: { strategy: args.strategy, gateDecision, outstanding },
    });
    if (tag === "repair") return { _tag: "repair", guidance: strategyRepairGuidance(outstanding), outstanding };
    const decision: DeliverableDecision = {
      ...judgment.decision,
      exitGate: { proposedBy: args.strategy, gateDecision, outstanding, handoffSynthesis: false },
    };
    return { _tag: tag, outstanding, decision };
  });
}
