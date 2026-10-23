/**
 * decide/arbitration-veto.ts — the Arbitrator-side success veto.
 *
 * shouldVetoSuccess: the controller-history + tool-failure-evidence check the
 * Arbitrator applies before granting exit-success. Moved verbatim from
 * `arbitrator.ts` (GH #220 / quality program Task 7). Internal to the decide/
 * cluster (arbitrateInner imports it); `arbitrator.ts` does not re-export it,
 * matching its original private visibility.
 */

import { META_TOOLS } from "../../state/kernel-constants.js";
import { windowDecisions } from "../../loop/runner-helpers/horizon-profile.js";
import type { ArbitrationContext } from "./arbitration-types.js";

// ─── Veto evaluator (Sprint 3.3 — uses controllerDecisionLog patterns) ───────

/**
 * Detects pathological tactical activity that should override an apparent
 * agent success.
 *
 * Critical refinement (Sprint 3.3 — corpus run 1 result):
 * controllerDecisionLog includes BOTH dispatched and suppressed
 * interventions. Suppressed interventions on success scenarios (knowledge
 * recall tasks with low entropy) were producing false-positive vetoes.
 * The differentiator between success and failure scenarios is whether the
 * agent encountered ACTUAL TOOL FAILURES — failure scenarios have
 * always-error tools that produce failed observations; success scenarios
 * (no tools or successful tools) don't.
 *
 * The veto now requires THREE conditions:
 *   1. Pathological controller activity pattern (stall/inject thresholds)
 *   2. No switch-strategy escalation
 *   3. AT LEAST ONE failed tool observation in the run's steps (concrete
 *      evidence the agent's success claim is contradicted by reality)
 *
 * This eliminates the false-veto regression on knowledge-recall successes
 * while preserving the corpus signal on real failures (which always have
 * failed tool observations).
 */
export function shouldVetoSuccess(ctx: ArbitrationContext): { readonly veto: true; readonly reason: string } | { readonly veto: false } {
  // E2 (audit 02-#2 veto-at-finish-line): the synthesis endgame is off-limits
  // to the veto under the long-horizon profile — a finishing run's success must
  // not be flipped to failure on stale tactical churn. Absent → today's path.
  if (ctx.assessmentPhase === "synthesize") return { veto: false };
  // A2 — windowed under the long-horizon profile; run-cumulative otherwise.
  const log = windowDecisions(ctx.controllerDecisionLog ?? [], ctx.vetoDecisionWindow);
  if (log.length === 0) return { veto: false };

  const decisionTypes = log.map((e) => e.split(":", 1)[0]?.trim() ?? "");
  if (decisionTypes.some((d) => d === "switch-strategy")) return { veto: false };

  const stallCount = decisionTypes.filter((d) => d === "stall-detect").length;
  const injectCount = decisionTypes.filter((d) => d === "tool-inject").length;
  const entropy = ctx.entropyComposite ?? 0;

  const repeatedStall = stallCount >= 2;
  const repeatedInject = injectCount >= 3;
  const stallWithHighEntropy = stallCount >= 1 && entropy > 0.55;

  if (!repeatedStall && !repeatedInject && !stallWithHighEntropy) {
    return { veto: false };
  }

  // Concrete evidence: at least one observation step where a USER-FACING
  // tool returned success=false. Meta-tool rejections (final-answer
  // refused because required tools missing, recall() hitting an absent
  // key, etc.) are framework signaling, not real "the agent's claim
  // contradicts reality" evidence. Without filtering these out, ANY run
  // that calls final-answer prematurely produces a "failed observation"
  // and triggers the veto on stall threshold.
  const hasFailedToolObservation = ctx.steps.some((s) => {
    if (s.type !== "observation") return false;
    const obs = s.metadata?.observationResult;
    if (!obs || obs.success !== false) return false;
    const toolName = obs.toolName;
    // Drop meta-tool rejections — they're not concrete tool failures.
    if (typeof toolName === "string" && META_TOOLS.has(toolName)) return false;
    // ...and drop the synthetic `system` pseudo-tool for exactly the same
    // reason. These are the HARNESS's own steering injections ("Review your
    // answer: does it fully address ...?"), recorded as failed observations.
    // Counting them as "the agent's claim contradicts reality" evidence means
    // the harness reads its own nudges as proof that the agent's tools are
    // failing.
    //
    // Measured 2026-07-28, haiku, multi-step task (read ./data.json, sum it,
    // write ./sum.txt). Every REAL tool succeeded:
    //   file-read true, code-execute true, file-write true  (x2 rounds)
    //   system false x6                                     <- steering only
    // The correct file was on disk in 6 of 6 runs across three arms, and every
    // one reported status=failure / terminatedBy=controller_signal_veto. The
    // inline path reported success for identical work.
    //
    // This is F1's defect on the opposite rail: F1 stopped talking from passing
    // as doing; this stops doing from being recorded as failing.
    if (toolName === "system") return false;
    return true;
  });
  if (!hasFailedToolObservation) {
    return { veto: false };
  }

  const reasons: string[] = [];
  if (repeatedStall) reasons.push(`${stallCount} stall-detect`);
  if (repeatedInject) reasons.push(`${injectCount} tool-inject`);
  if (stallWithHighEntropy) reasons.push(`stall+entropy=${entropy.toFixed(2)}`);
  reasons.push("with tool-failure evidence");

  return {
    veto: true,
    reason: `controller_signal_veto: ${reasons.join(", ")} without switch-strategy escalation`,
  };
}
