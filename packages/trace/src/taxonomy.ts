// packages/trace/src/taxonomy.ts
//
// The one failure taxonomy for recorded runs (Plan 9, advisor item 7).
//
// Two classifiers read a trace: `analyzeCause` (cause.ts) says HOW a run ended,
// `attributeFailure` (attribution.ts) says WHO is at fault. They used to keep
// separate vocabularies, so a run `cause` explained (an abort, a provider
// error, a model that never called a tool) still read `unattributed`. This
// module is the single vocabulary both share: every attribution reason is
// `<owner>:<id>`, and every failure cause maps to exactly one reason through
// {@link CAUSE_ATTRIBUTION}. `rax-diagnose attribute`, `rax-diagnose cause` and
// the H3 verdict all read reasons from here.
//
// Owners:
//   harness      the harness configuration or a harness mechanism caused it
//   model        the model did the wrong thing with what the harness gave it
//   environment  outside both: provider fault, abort/timeout, a user budget,
//                a tool that itself failed (a tool refusing the model's content is
//                not: see attribution-refusal.ts)
//   unattributed the trace cannot prove a side (`missing` says what would)
//
// Attribution rules (attribution.ts) run first and are more specific; the
// cause mapping is the fallback when no rule fires, and is reported as
// `probable` (an ownership mapping, not a turn-level proof).

import type { FailureCause } from "./cause.js";

/** Who the trace says is at fault for a failed run. */
export type AttributionVerdict = "harness" | "model" | "environment" | "unattributed" | "not-failed";

/**
 * Reasons the turn-level rules (attribution.ts, attribution-rules.ts,
 * attribution-guidance.ts, attribution-forcing.ts) return, listed in rule order
 * (first match wins; `harness:refusal-counted-as-repeat` also runs last, in its
 * probable mode). The runtime list the {@link AttributionReason} type is derived
 * from, so the docs Reasons table (`reference/cli.md`) is pinned against it.
 */
export const TURN_LEVEL_REASONS = [
  "model:fabrication-vetoed",
  "harness:false-veto",
  "harness:tool-surface",
  "harness:tool-not-offered",
  "harness:contradictory-guidance",
  "harness:subpass-abstained",
  "harness:tool-call-dropped",
  "harness:refusal-counted-as-repeat",
  "harness:refused-repairable",
  "harness:misleading-refusal",
  "model:invalid-content",
  "harness:tool-call-corrupted",
  "harness:plan-fanout-blob",
  "harness:premature-stop",
  "harness:completeness-blind",
  "harness:offer-accepted-as-done",
  "harness:evidence-withheld",
  "harness:evidence-truncated",
  "harness:evidence-missing",
  "harness:misleading-guidance",
  "harness:forcing-unused",
  "model:ignored-guidance",
  "model:evidence-not-gathered",
  "model:had-evidence-wrong-output",
] as const;

/** A reason a turn-level attribution rule returns. */
export type TurnLevelReason = (typeof TURN_LEVEL_REASONS)[number];

/** Closed set of attribution reasons. The prefix names the {@link AttributionVerdict}. */
export type AttributionReason =
  | TurnLevelReason
  // Cause-derived (CAUSE_ATTRIBUTION).
  | "harness:terminal-mislabel"
  | "harness:plan-posture-veto"
  | "harness:stall-after-work"
  | "harness:loop-after-work"
  | "model:never-engaged"
  | "model:tool-protocol"
  | "model:wrong-tool-arg"
  | "model:stall-no-progress"
  | "model:bookkeeping-loop"
  | "environment:run-aborted"
  | "environment:provider-error"
  | "environment:budget-cap"
  | "environment:tool-failure"
  | "unattributed"
  | "not-failed";

/**
 * Owner of each failure cause, as an attribution reason. Causes whose owner
 * the trace cannot settle without a grader map to `unattributed`:
 * a satisfiability abstain may be right, a verifier reject may be a correct
 * veto, and `unexplained` / `undetermined` are residuals by definition.
 */
export const CAUSE_ATTRIBUTION: Readonly<Record<FailureCause, AttributionReason>> = {
  "direct-chat": "unattributed",
  timeout: "environment:run-aborted",
  "user-stop": "environment:run-aborted",
  aborted: "environment:run-aborted",
  // No run-completed and no run-aborted: a killed process and a harness crash look the same.
  "incomplete-trace": "unattributed",
  "provider-error": "environment:provider-error",
  "satisfiability-abstain": "unattributed",
  "terminal-mislabel": "harness:terminal-mislabel",
  "plan-posture-veto": "harness:plan-posture-veto",
  "never-engaged": "model:never-engaged",
  "tool-protocol": "model:tool-protocol",
  "tool-failure": "environment:tool-failure",
  "wrong-tool-arg": "model:wrong-tool-arg",
  "stall-after-work": "harness:stall-after-work",
  "stall-no-progress": "model:stall-no-progress",
  "loop-after-work": "harness:loop-after-work",
  "bookkeeping-loop": "model:bookkeeping-loop",
  "verifier-reject": "unattributed",
  "budget-cap": "environment:budget-cap",
  unexplained: "unattributed",
  // A graded wrong answer is the model's only when its turn held the evidence:
  // that is the turn-level rule model:had-evidence-wrong-output, not this map.
  "wrong-answer": "unattributed",
  "success-with-warning": "unattributed",
  none: "unattributed",
  undetermined: "unattributed",
};

/** The owner a reason names. */
export const verdictOf = (r: AttributionReason): AttributionVerdict => {
  if (r === "not-failed") return "not-failed";
  const owner = r.split(":", 1)[0];
  return owner === "harness" || owner === "model" || owner === "environment" ? owner : "unattributed";
};
