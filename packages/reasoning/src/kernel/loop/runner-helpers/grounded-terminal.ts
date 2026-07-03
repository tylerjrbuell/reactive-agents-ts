/**
 * runner-helpers/grounded-terminal.ts — F1 grounded-terminal invariant (shared bits).
 *
 * Root cause (2026-07-02 cogito:8b competitor-bench report): small models give up
 * after 1-4 failed tool calls and ship a parametric guess as the FIRST terminal
 * answer at iteration 1-2. Recovery steering only fired on stall/loop guards
 * (never reached by an early end_turn) and forced abstention's "repeated
 * ungrounded synthesis ≥2" threshold was unreachable because the first synthesis
 * terminated the run.
 *
 * The invariant: a run whose task declares `requiredTools` may NOT accept a
 * terminal final answer while ZERO substantive (non-meta) tool calls have
 * succeeded. The Arbitrator's `applyGroundedTerminalGate` rejects the terminal
 * ONCE (recovery/grounding steering via a harness_signal), and the runner's
 * §7.5 forced-abstention path converts the SECOND ungrounded attempt into an
 * honest `terminatedBy:"abstained"`.
 *
 * This file owns the pure, shared vocabulary consumed by BOTH sites (the
 * Arbitrator gate in `capabilities/decide/arbitrator.ts` and the §7.5 boost in
 * `loop/runner.ts`) so the two cannot drift.
 */

import type { ReasoningStep } from "../../../types/index.js";
import { HARNESS_PSEUDO_TOOLS } from "../../state/kernel-constants.js";
import { buildSuccessfulToolCallCounts } from "../../capabilities/verify/requirement-state.js";
import {
  buildRecoverySteeringGuidance,
  getToolFailureRecoveryFromSteps,
} from "./recovery-steering.js";

/** Sentinel `Verdict.nextStrategy` for the one-shot grounding redirect. */
export const GROUNDING_REDIRECT = "grounding-redirect";

/** Hard cap on the redirect message length (mission constraint: token-bounded). */
const MAX_GUIDANCE_CHARS = 300;

/**
 * The `terminatedBy` family that means "the model claimed a terminal final
 * answer" — the ONLY terminals the grounded-terminal invariant applies to.
 * Harness give-up deliveries (loop_detected:*, stall harness_deliverable,
 * controller_early_stop:*, low_delta_guard, abstained, awaiting-approval, ...)
 * are deliberately excluded: redirecting a harness-forced exit would loop.
 */
export const TERMINAL_ANSWER_REASONS: ReadonlySet<string> = new Set([
  "final_answer_tool",
  "final_answer",
  "final_answer_regex",
  "end_turn",
  "llm_end_turn",
]);

/**
 * True when at least one substantive (non-meta) tool call SUCCEEDED. Failed
 * attempts do not count — a run that tried a tool 4× and always failed is
 * still ungrounded (the exact bench failure mode this invariant closes).
 *
 * Harness pseudo-observations (`system` quality nudges, `completion-guard`
 * redirects, `abstention-legitimacy` verdicts) are excluded: they carry
 * `success:true` observationResult metadata but are harness feedback, not
 * model tool executions — counting them would mask an ungrounded run the
 * moment any guard injects a nudge.
 */
export function hasSuccessfulSubstantiveToolCall(
  steps: readonly ReasoningStep[],
): boolean {
  return Object.keys(buildSuccessfulToolCallCounts(steps)).some(
    (toolName) => !HARNESS_PSEUDO_TOOLS.has(toolName),
  );
}

/**
 * Build the one-shot grounding redirect message (< 300 chars).
 *
 * When failed tool paths exist, reuse the existing recovery-steering builder
 * (it already names the failed tools + the best alternate path). When the model
 * never even attempted a tool, emit the grounding variant naming the required
 * tools directly.
 */
export function buildGroundingRedirectGuidance(
  steps: readonly ReasoningStep[],
  requiredTools: readonly string[],
): string {
  const recovery = getToolFailureRecoveryFromSteps(steps, { requiredTools });
  const guidance =
    recovery.failedUnresolved.length > 0
      ? buildRecoverySteeringGuidance(recovery, 1, 1, "stall")
      : `Grounding required: no tool call has succeeded yet, but this task requires tools (${requiredTools
          .slice(0, 5)
          .join(", ")}). Call ${requiredTools[0] ?? "a required tool"} now with concrete arguments. Do not finalize until a tool call succeeds.`;
  return guidance.length > MAX_GUIDANCE_CHARS
    ? `${guidance.slice(0, MAX_GUIDANCE_CHARS - 1)}…`
    : guidance;
}
