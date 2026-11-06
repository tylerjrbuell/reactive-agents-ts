/**
 * Shared constants for the composable kernel.
 *
 * Single source of truth for meta-tool names and other kernel-wide constants.
 * Every kernel phase, guard, and utility MUST import from here instead of
 * defining their own copy.
 */

/**
 * Meta-tool names — tools handled inline by the harness rather than
 * dispatched to ToolService. Not counted as "real work" for
 * completion detection, deliverable assembly, or loop detection.
 */
export const META_TOOLS = new Set([
  "final-answer",
  "task-complete",
  "context-status",
  "brief",
  "pulse",
  "todo",
  "find",
  "recall",
  "checkpoint",
  "activate-skill",
  "discover-tools",
]) as ReadonlySet<string>;

/**
 * Pseudo tool names the HARNESS stamps on injected observation steps
 * (guard redirects, quality-check nudges, legitimacy verdicts) via
 * `makeObservationResult("<pseudo>", …)`. These are harness feedback, not
 * model-initiated tool executions — grounding checks (F1 grounded-terminal
 * invariant) and failure-streak detection (F3) MUST ignore them: a
 * `system`/success:true quality nudge would otherwise count as a
 * "successful substantive tool call" and mask an ungrounded run.
 * Enumerated from the non-test `makeObservationResult("…")` literals in
 * kernel/ (2026-07-02).
 */
export const HARNESS_PSEUDO_TOOLS = new Set([
  "system",
  "completion-guard",
  "abstention-legitimacy",
]) as ReadonlySet<string>;

/**
 * `frameworkInstrumentation` tag act.ts stamps on the observation step of a
 * guard-blocked call (repeat/duplicate warnings, availability refusals). The
 * step keeps the REAL tool name, but its content is harness-authored, so the
 * ledger projection marks the tool-result `harnessAuthored` and the progress
 * arbiter classifies it NON-PROGRESS (design law 5).
 */
export const GUARD_OBSERVATION_TAG = "harness-guard";

/**
 * Intervention actor (and guard-fired name) of a think-phase tool-gate refusal
 * (decide/tool-call-refusals.ts). A step whose intervention carries it answers
 * a call that never ran: failure counters skip it (`isFailedToolObservation`).
 */
export const TOOL_GATE_ACTOR = "tool-gate";

/**
 * Introspection-only meta-tools subject to consecutive-call dedup detection.
 * Subset of META_TOOLS — excludes final-answer and task-complete which are
 * termination tools, not introspection tools.
 */
export const INTROSPECTION_META_TOOLS = new Set([
  "brief",
  "pulse",
  "todo",
  "find",
  "recall",
  "checkpoint",
]) as ReadonlySet<string>;

/**
 * Strategies whose thoughts are scored by the kernel observer.
 *
 * Defined in @reactive-agents/core (entropy-sensor-tag.ts) so the runtime
 * engine and reactive-intelligence can consult the same set without a
 * dependency cycle; re-exported here for kernel-adjacent consumers.
 */
export {
  KERNEL_INLINE_ENTROPY_STRATEGIES,
  scoresEntropyInline,
} from "@reactive-agents/core";

/** Returns true when the tool is a delegation adapter (spawn-agent, agent-*). */
export function isDelegationTool(toolName: string): boolean {
  return toolName === "spawn-agent" || toolName.startsWith("agent-");
}
