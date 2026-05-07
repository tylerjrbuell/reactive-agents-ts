// File: src/kernel/capabilities/decide/oracle-nudge.ts
//
// Layer 1 Intelligent Default Builder — oracle nudge text composer.
//
// Background: when the pulse oracle has reported readyToAnswer=true but the
// model hasn't emitted final-answer yet, the kernel injects a mandatory
// nudge into the FC thread. The nudge text was inline at runner.ts:1127
// before this commit, with two empirical-evidence-driven evolutions:
//
//   - 2026-05-06 Pivot B: replaced the generic "Call final-answer now"
//     phrasing with the FM-A1 "describe vs emit" example pair. Cogito-class
//     models interpret "Call X" literally ("I'll now provide…") rather than
//     as a function-call directive; the contrasting examples make the
//     directive unambiguous. Combined with raising the local-tier
//     `oracleNudgeLimit` from 1 → 2, this lifted cogito:14b T4 from 30%
//     (empty output, oracle force-terminated) to 100% (real synthesis,
//     6/6 correct titles), reproducible n=2.
//
//   - 2026-05-07 Layer 1 extraction: promoted to a typed pure builder near
//     the oracle primitive per the spec at
//     `wiki/Architecture/Design-Specs/2026-05-06-intelligent-default-builders.md`.
//     This is the second canonical Layer 1 example after
//     `buildFinalAnswerDescription` and the first BEHAVIORAL chokepoint
//     (the first was REMOVAL/structural).
//
// The builder is forward-compatible with the compose-harness API: when
// that API ships, this function becomes the registered default emitter
// for the `oracle.nudge` (or equivalent) tag, and user transformers
// receive the dynamically-composed default as input per the
// pass-through-default principle.

import type { OutputFormat } from "../comprehend/task-intent.js";

// ── Context ───────────────────────────────────────────────────────────────────

/**
 * Inputs the oracle nudge builder consults. Narrow per-builder context
 * per the Layer 1 builder pattern (no monolithic HarnessContext).
 */
export interface OracleNudgeContext {
  /**
   * Current nudge count BEFORE this injection. The next nudge will be
   * `nudgeCount + 1`. Used to decide whether this is the final nudge
   * before force-termination.
   */
  readonly nudgeCount: number;
  /**
   * Tier-derived nudge budget. Force-termination fires when nudge count
   * reaches this limit. Sourced from `TIER_GUARD_THRESHOLDS` in runner.ts
   * (local: 2, mid: 2, large: 3, frontier: 3 as of 2026-05-06 Pivot B).
   */
  readonly nudgeLimit: number;
  /**
   * Detected output format from the task. Currently informational only;
   * future iterations may use this to tailor the example call to the
   * task's expected shape (e.g., emit a code-shaped output param hint
   * for code tasks).
   */
  readonly outputFormat?: OutputFormat | null;
  /**
   * Whether this run has registered required tools. Currently
   * informational; future iterations may use this to tighten the nudge
   * for tool-required tasks (e.g., "you have all required tool data —
   * synthesize now").
   */
  readonly hasRequiredTools?: boolean;
}

// ── Builder ───────────────────────────────────────────────────────────────────

/**
 * Compose the oracle-gate nudge text. Returns the full mandatory-nudge
 * string with escalating final-attempt language when this is the last
 * nudge before force-termination.
 *
 * The composition is intentionally additive (preamble + examples +
 * escalation footer) rather than replacement-by-format; per the Layer 1
 * spec's empirical principle, behavioral chokepoints benefit from
 * consistent structure across firings (the model gets the SAME signal
 * shape on nudge 1 and nudge 2, distinguished only by the final-attempt
 * footer that signals "this was the last warning").
 */
export function buildOracleNudge(ctx: OracleNudgeContext): string {
  const isFinalNudge = ctx.nudgeCount + 1 >= ctx.nudgeLimit;

  return (
    "You have everything you need. STOP describing what you would do — emit a final-answer tool call NOW with your synthesized response.\n\n" +
    "❌ WRONG: \"I'll now provide the answer...\" or another thought / pulse / recall.\n" +
    "✅ RIGHT: Emit the final-answer tool call directly. Put your complete deliverable in the `output` parameter.\n\n" +
    (isFinalNudge
      ? "This is your LAST chance — if you don't emit final-answer in the next response, the run terminates with no output."
      : "If you don't emit final-answer in the next response, this signal will repeat one more time and then the run will terminate.")
  );
}
