/**
 * decide/grounded-terminal-gate.ts — F1 grounded-terminal invariant gate (2026-07-02).
 *
 * applyGroundedTerminalGate: the post-verdict gate that rejects an
 * ungrounded terminal answer ONCE (redirect) and then accepts-for-abstention.
 * Moved verbatim from `arbitrator.ts` (GH #220 / quality program Task 7).
 * Internal to the decide/ cluster (arbitrate imports it); the decision itself
 * is still owned by terminal-gate.ts's evaluateTerminalGate.
 */

import {
  GROUNDING_REDIRECT,
  TERMINAL_ANSWER_REASONS,
  hasSuccessfulSubstantiveToolCall,
  buildGroundingRedirectGuidance,
} from "../../loop/runner-helpers/grounded-terminal.js";
import { evaluateTerminalGate } from "./terminal-gate.js";
import type { ArbitrationContext, Verdict } from "./arbitration-types.js";

// ─── F1 — Grounded-terminal invariant gate (2026-07-02) ──────────────────────
//
// Bench root cause (wiki/Research/Harness-Reports/2026-07-02-cogito8b-
// competitor-bench-root-cause.md): a model that never landed a single
// successful substantive tool call can still ship a terminal final answer —
// a parametric guess — as status:success. Every runtime enforcement mechanism
// (recovery steering, forced abstention) was keyed to conditions an early
// ungrounded terminal never reaches.
//
// The gate runs POST-verdict (only on exit-success) for the terminal-ANSWER
// family (TERMINAL_ANSWER_REASONS) when the task declares requiredTools:
//   - zero successful substantive calls + no prior redirect → escalate ONCE
//     with recovery/grounding steering (GROUNDING_REDIRECT sentinel; the
//     applyTermination branch appends a harness_signal step, rides the message
//     on pendingGuidance.errorRecovery, and bumps meta.groundingRedirectCount).
//   - zero successful substantive calls + redirect already spent → ACCEPT the
//     exit verbatim (deliberately bypassing the post-condition steer, which
//     would otherwise grind the run to max_iterations). The runner's §7.5
//     forced-abstention path then converts the accepted-but-ungrounded terminal
//     into terminatedBy:"abstained" — the honest outcome, reachable at last.
//   - any successful substantive call OR no requiredTools → null (no opinion);
//     the post-condition gate proceeds exactly as before (zero behavior change
//     for grounded runs and pure-synthesis tasks).
export function applyGroundedTerminalGate(
  verdict: Verdict,
  ctx: ArbitrationContext,
): Verdict | null {
  if (verdict.action !== "exit-success") return null;
  if (!TERMINAL_ANSWER_REASONS.has(verdict.terminatedBy)) return null;
  // Lever-8 precedent (2026-05-26): the final-answer TOOL is the model's
  // deliberate, structured exit channel — it already skips the controller
  // veto. The bench failure class THIS gate closes is the WEAK-signal family
  // (end_turn / FINAL ANSWER regex narration give-ups); deliberate tool exits
  // stay owned by the PostCondition spine below, which derives
  // ToolCalled(requiredTools) and — for any task with declared requiredTools —
  // steers an ungrounded final_answer_tool exit into its own (uncapped)
  // post-condition-steer loop rather than letting it through. That is
  // pre-existing PostCondition behavior, not this gate's concern: this line
  // only means F1's one-shot redirect / forced-abstention pairing does not
  // also fire on the tool-exit path, NOT that a graceful-failure tool exit
  // is guaranteed to be accepted. (The PostCondition steer's own lack of a
  // graceful-failure carve-out is a separate, real gap — see
  // wiki/Research/Harness-Reports/2026-07-02-cogito8b-competitor-bench-root-cause.md
  // follow-ups.)
  if (verdict.terminatedBy === "final_answer_tool") return null;
  if (ctx.requiredTools.length === 0) return null;
  if (hasSuccessfulSubstantiveToolCall(ctx.steps)) return null;

  // Phase 3: the decision itself lives in the terminal gate (grounding check).
  // This site only consults the F1 arm: coverage is vacuously satisfied here
  // (B1 owns it pre-verdict in llmEndTurnEvaluator) and no checker is wired
  // at this seam yet.
  const gate = evaluateTerminalGate({
    terminatedBy: verdict.terminatedBy,
    requiredTools: ctx.requiredTools,
    // Step 3 item 3c (09 §6.5): this seam only consults the F1/grounding arm
    // (see the function comment above) — express that explicitly rather than
    // faking full coverage via `new Set(ctx.requiredTools)`, which was
    // indistinguishable from a genuine covered verdict.
    coveredTools: new Set<string>(),
    coverageNotEvaluated: true,
    hasSubstantiveGrounding: false,
    redirectsSpent: {
      grounding: ctx.groundingRedirectCount ?? 0,
      coverage: 0,
      checker: 0,
    },
    redirectBudget: ctx.redirectBudget,
    coverageExhaustionPolicy: "accept",
    buildGroundingGuidance: () =>
      buildGroundingRedirectGuidance(ctx.steps, ctx.requiredTools),
    buildCoverageGuidance: (missing) => missing.join(", "),
  });
  if (gate.decision === "redirect" && gate.check === "grounding") {
    return {
      action: "escalate",
      nextStrategy: GROUNDING_REDIRECT,
      reason: gate.guidance,
    };
  }
  // gate.decision === "abstain": accept the verdict verbatim so the loop
  // exits; the runner's §7.5 forced-abstention path owns the conversion to
  // "abstained" (unchanged mechanics).
  return verdict;
}
