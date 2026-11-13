/**
 * runner-helpers/loop-guidance.ts — graduated response to a loop detection.
 *
 * A detection is not a verdict. The detector patterns read a window of recent
 * steps; a single hit proves the model is repeating itself, not that the run is
 * lost (an agent that struggles to get a call right deserves to be told and
 * given room, especially on long-horizon work). So the FIRST detections are
 * answered with model-visible PendingGuidance (never a stray USER message,
 * AGENTS pitfall 9) and the pass continues. Only SUSTAINED zero-progress, i.e.
 * the pattern still tripping after {@link loopGuidanceBudget} guidance cycles
 * with no progress action in between, falls through to the strategy switch /
 * `resolveDetectedLoop` stop path.
 *
 * "Sustained" is DERIVED from the step list (guidance signals stamped after the
 * last progress action, progress = the ONE arbiter's verdict, state-delta
 * aware), so it needs no carrier field and resets itself the moment the run
 * shows real progress.
 *
 * Budget (documented thresholds): `2 + floor(maxIterations / 20)`, capped at 6;
 * a long-horizon run (`.withLongHorizon()` or a long-classified contract) gets
 * +2, capped at 8. maxIterations 10 -> 2, 40 -> 4, 100+ -> 6, long-horizon 100+ -> 8.
 */

import { Effect } from "effect";
import { authorityOf } from "../../capabilities/decide/authority.js";
import { classifyActions, type LoopDetection } from "../../capabilities/reflect/loop-detector.js";
import { makeStep } from "../../capabilities/sense/step-utils.js";
import { contributeGuidance } from "../../state/guidance-channel.js";
import { transitionState, type KernelState } from "../../state/kernel-state.js";
import { emitGuardFired } from "../../utils/diagnostics.js";

/** Intervention actor stamped on every graduated loop-guidance step. */
export const LOOP_GUIDANCE_ACTOR = "loop-guidance";

const BASE_BUDGET = 2;
const PER_ITERATIONS = 20;
const BUDGET_CAP = 6;
const LONG_HORIZON_BONUS = 2;
const LONG_HORIZON_CAP = 8;

/** Guidance cycles a run gets (per stretch of zero progress) before a loop verdict may stop it. */
export function loopGuidanceBudget(maxIterations: number, longHorizon: boolean): number {
  const base = Math.min(BUDGET_CAP, BASE_BUDGET + Math.floor(Math.max(0, maxIterations) / PER_ITERATIONS));
  return longHorizon ? Math.min(LONG_HORIZON_CAP, base + LONG_HORIZON_BONUS) : base;
}

/** Guidance cycles issued since the last progress action (0 once the run progresses). */
export function loopGuidanceCycles(steps: readonly KernelState["steps"][number][]): number {
  const verdicts = classifyActions(steps);
  let cycles = 0;
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i]!;
    if (s.type === "action" && verdicts.get(s)?.kind === "substantive") break;
    if (s.type === "harness_signal" && (s.metadata?.intervention as { actor?: string } | undefined)?.actor === LOOP_GUIDANCE_ACTOR) {
      cycles++;
    }
  }
  return cycles;
}

/**
 * Answer a detection with guidance while the run's budget lasts. Returns the
 * guided state (status back to "thinking"), or `null` when the budget is spent
 * and the caller must proceed to the strategy switch / stop path.
 */
export function applyLoopGuidance(args: {
  readonly state: KernelState;
  readonly detection: LoopDetection;
  readonly maxIterations: number;
  readonly longHorizon: boolean;
  readonly taskId: string;
  /** `loopDetection.guidanceCycles`: explicit budget (0 = stop on first detection). */
  readonly budgetOverride?: number;
}): Effect.Effect<KernelState | null, never> {
  return Effect.gen(function* () {
    const { state, detection } = args;
    const budget = args.budgetOverride ?? loopGuidanceBudget(args.maxIterations, args.longHorizon);
    const used = loopGuidanceCycles(state.steps);
    if (used >= budget) return null;
    const text =
      `${detection.message} (loop warning ${used + 1} of ${budget}: the run is stopped only if this ` +
      `continues with no progress.) Try a different approach, or deliver the answer you have.`;
    yield* emitGuardFired({
      taskId: args.taskId,
      iteration: state.iteration,
      guard: "loop_guidance",
      outcome: "redirect",
      reason: detection.pattern.name,
      metadata: { pattern: detection.pattern.id, cycle: used + 1, budget, ...detection.evidence },
    });
    return transitionState(state, {
      status: "thinking",
      steps: [
        ...state.steps,
        makeStep("harness_signal", `⚠️ ${text}`, {
          intervention: {
            actor: LOOP_GUIDANCE_ACTOR,
            authorityClass: authorityOf(LOOP_GUIDANCE_ACTOR),
            evidence: `pattern ${detection.pattern.id} (${detection.pattern.name}); warning ${used + 1}/${budget}`,
            whatChanged: "loop-guidance: graduated warning instead of stopping the run",
            iter: state.iteration,
          },
        }),
      ],
      pendingGuidance: contributeGuidance(state.pendingGuidance, [
        { kind: "loopDetected", detected: true },
        { kind: "errorRecovery", text },
      ]),
      error: null,
    });
  });
}
