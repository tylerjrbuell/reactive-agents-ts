// packages/trace/src/cause-description.ts
//
// Plain words for each failure cause, and the next steps the diagnosis can
// justify. One vocabulary for every reader of `analyzeCause` (`rax-diagnose
// cause`, Cortex's "Why it ended" card).
//
// Both tables are `Record<FailureCause, …>`, so a new cause is a type error
// until it has words. Next actions follow from the cause and its deterministic
// `subCause` only: a cause the trace cannot act on (a user stop, a healthy run)
// has none. Never add a step the classifier's evidence does not support.

import type { CauseAnalysis, FailureCause } from "./cause.js";

/** One-sentence plain-language description of each {@link FailureCause}. */
export const CAUSE_DESCRIPTIONS: Readonly<Record<FailureCause, string>> = {
  "direct-chat": "A direct model call, not an agent run",
  timeout: "The run hit its time limit",
  "user-stop": "Stopped by the user",
  aborted: "The run was aborted",
  "incomplete-trace": "The trace ends without the run finishing (process killed or crashed)",
  "provider-error": "The model provider returned an error",
  "strategy-error": "The reasoning strategy failed with an error before it reached a final answer",
  "satisfiability-abstain": "The agent declined up front: the task could not be done with what it had",
  "terminal-mislabel": "The final status contradicts how the run actually ended",
  "plan-posture-veto": "The plan posture limited the tools, and the result did not cover the task",
  "never-engaged": "The model never called a tool it needed",
  "tool-protocol": "The model's tool calls could not be resolved",
  "tool-failure": "Tool calls kept failing",
  "wrong-tool-arg": "A tool call failed on its arguments before a different call worked",
  "stall-after-work": "The harness ended the run as stalled after real work was done",
  "stall-no-progress": "The run stalled without making progress",
  "loop-after-work": "The harness ended a repeating loop after real work was done",
  "bookkeeping-loop": "The agent spent its loops on bookkeeping tools instead of the task",
  "verifier-reject": "The verifier rejected the final answer",
  "budget-cap": "The run used up a budget (iterations, tokens or cost)",
  unexplained: "The run did not succeed, and no diagnosis rule explains why",
  "wrong-answer": "The run finished, but the grader marked the answer wrong",
  "success-with-warning": "Succeeded, with a warning",
  none: "Finished normally",
  undetermined: "The trace is too thin to tell why the run ended",
};

/**
 * Sharper words for a `cause/subCause` pair the cause-level sentence would
 * blur (a token stop is not an iteration stop). Keys are `"<cause>/<subCause>"`.
 */
const SUBCAUSE_DESCRIPTIONS: ReadonlyMap<string, string> = new Map([
  ["budget-cap/cap-cutoff", "The run used up its iteration budget"],
  ["budget-cap/no-progress-at-cap", "The run used up its iteration budget"],
  ["budget-cap/unknown-progress", "The run used up its iteration budget"],
  ["budget-cap/token-budget", "The run used up its token budget"],
  ["budget-cap/cost-budget", "The run used up its cost budget"],
  ["budget-cap/token-and-cost-budget", "The run used up its token and cost budgets"],
  ["budget-cap/spend-budget", "The run used up its token or cost budget"],
  ["aborted/guardrail-block", "A guardrail blocked the run"],
  ["aborted/contract-violation", "A behavioral contract check stopped the run"],
  ["aborted/kill-switch", "A kill switch stopped the run"],
  ["strategy-error/config-refused", "The reasoning strategy refused the run's configuration before calling the model"],
  ["strategy-error/synthesis-failed", "The reasoning strategy produced no answer and its synthesis fallback failed"],
  ["terminal-mislabel/status-override", "A status override failed an answer the run had verified and accepted"],
]);

/**
 * Plain-language description of a failure cause, sharpened by its `subCause`
 * when the cause-level sentence would blur it (pass the analysis' `subCause`).
 *
 * @param cause A cause from {@link CauseAnalysis.cause}.
 * @param subCause Optional {@link CauseAnalysis.subCause}.
 * @returns One sentence, no trailing period.
 */
export function causeDescription(cause: FailureCause, subCause?: string): string {
  return (subCause !== undefined ? SUBCAUSE_DESCRIPTIONS.get(`${cause}/${subCause}`) : undefined) ?? CAUSE_DESCRIPTIONS[cause];
}

/** Provider-error `subCause` → what to check. Keys are the sub-causes `analyzeCause` assigns. */
const PROVIDER_ACTIONS: ReadonlyMap<string, string> = new Map([
  ["quota", "Check the provider account's credit balance or quota."],
  ["auth", "Check the provider API key."],
  ["rate", "The provider rate-limited the run: wait and retry, or lower the request rate."],
  ["token-rate-exceeded", "The request exceeded the provider's tokens-per-minute limit: wait and retry, or send less context per call."],
  ["model-not-found", "Check the model name; for Ollama, pull the model first."],
  ["context-overflow", "The request exceeded the model's context window: send less context or use a model with a larger window."],
  ["request-too-large", "The request was too large for the provider: send less context per call."],
  ["unsupported-params", "Remove the request option the model does not support."],
  ["invalid-param", "Check the request options against what the provider accepts."],
  ["tool-schema-invalid", "Check the tool input schemas: the provider rejected one."],
  ["malformed-output", "The model emitted a tool call the provider could not parse: retry, or use a model with stronger tool calling."],
  ["parse", "The provider response could not be parsed: retry, or use a model with stronger tool calling."],
  ["timeout", "Check that the provider is reachable and responding; raise the request timeout if calls are slow."],
  ["network", "Check the network connection and the provider endpoint."],
  ["provider-5xx", "The provider returned a server error: retry later."],
  ["content-filter", "The provider's content filter blocked the response: review the task text."],
]);

/** Spend-budget `subCause` (cause.ts `spendBudgetSubCause`) → the limit it names. */
const SPEND_LIMIT: Readonly<Record<string, string | undefined>> = {
  "token-budget": "token",
  "cost-budget": "cost",
  "token-and-cost-budget": "token and cost",
  "spend-budget": "token or cost",
};

type ActionRule = (subCause: string | undefined) => readonly string[];
const noActions: ActionRule = () => [];

/** Next actions per cause. A cause with no justified step returns `[]`. */
const CAUSE_ACTIONS: Readonly<Record<FailureCause, ActionRule>> = {
  "direct-chat": noActions,
  timeout: () => ["Check the run's time limit against how long the task needs."],
  "user-stop": noActions,
  aborted: (sub) =>
    sub === "guardrail-block"
      ? ["A guardrail check blocked the run (the violation is in the evidence): if it was a false positive, adjust the guardrail settings."]
      : sub === "contract-violation"
        ? ["Read the behavioral contract the run broke in the evidence."]
        : ["Read the abort reason in the evidence."],
  "incomplete-trace": () => ["Check whether the process was killed or crashed: the run wrote neither run-completed nor run-aborted."],
  "provider-error": (sub) => [
    (sub !== undefined ? PROVIDER_ACTIONS.get(sub) : undefined) ?? "Read the provider error in the evidence.",
  ],
  "satisfiability-abstain": (sub) =>
    sub === "utility-misroute"
      ? ["A utility call ran as an agent task: check why it was routed through an agent run."]
      : ["Give the agent the tools or inputs the task needs (the evidence names what the preflight found missing)."],
  "strategy-error": (sub) =>
    sub === "config-refused"
      ? ["The strategy refused this configuration (the reason is in the evidence): change the strategy or the conflicting option."]
      : ["Read the strategy error in the evidence; if it names no configuration problem, report it with this trace."],
  "terminal-mislabel": (sub) =>
    sub === "status-override"
      ? ["This is a harness defect: a status override (named in the evidence) failed an answer the terminal gate verified and accepted. Report it with this trace."]
      : ["This is a harness defect: the final status contradicts the run's own signals. Report it with this trace."],
  "plan-posture-veto": () => ["Check the plan posture's tool surface against the tools the task needs."],
  "never-engaged": () => [
    "Check that the tool the task needs was visible to the model and described clearly.",
    "If it was, try a model with stronger tool calling.",
  ],
  "tool-protocol": () => [
    "Check the tool input schemas.",
    "Try a model with stronger native tool calling.",
  ],
  "tool-failure": (sub) => [
    "Check the failing tool's inputs and environment (the first error is in the evidence).",
    ...(sub === "repeated-identical-call"
      ? ["The model repeated the same failing call: check that the tool's error message says what to change."]
      : []),
  ],
  "wrong-tool-arg": () => ["Check the first failing call's arguments against the tool's schema and description."],
  "stall-after-work": () => ["Check the work already produced: the task may have been done, or its finish condition unclear."],
  "stall-no-progress": () => ["Check that the visible tools can make progress on the task: the run produced nothing before it stalled."],
  "loop-after-work": () => ["Check that the tool results told the model the work was done: it repeated itself after real work."],
  "bookkeeping-loop": () => ["Check that the task's own tools were visible: most calls went to bookkeeping tools."],
  "verifier-reject": (sub) =>
    sub === "no-tool-evidence"
      ? ["The answer had no tool evidence behind it: check that the model called the tools the task needs."]
      : ["Read the failing verifier checks in the evidence; a check can be a false positive."],
  "budget-cap": (sub) =>
    sub !== undefined && SPEND_LIMIT[sub] !== undefined
      ? [`The run hit its ${SPEND_LIMIT[sub]} limit: raise the limit, or send less context per call.`]
      : sub === "cap-cutoff"
      ? ["The run was still making progress at the cap: raise the iteration budget."]
      : sub === "no-progress-at-cap"
        ? ["The run made no progress in its last loops: raising the budget alone is unlikely to help."]
        : ["Check whether the run was still progressing before raising the iteration budget (no progress signal was recorded)."],
  unexplained: () => ["Run the same task on another model to tell a model limit from a harness gap."],
  "wrong-answer": () => ["Compare the answer with the grader's failed checks in the evidence."],
  "success-with-warning": (sub) =>
    sub === "tool-claim-without-call"
      ? ["The task named a tool that never ran: check that the tool was registered and visible."]
      : ["Check the answer against the failing verifier check in the evidence."],
  none: noActions,
  undetermined: () => ["Record the run with full tracing: the signals listed as missing would settle it."],
};

/**
 * Next steps the diagnosis can justify, from the cause and its `subCause`.
 * Empty when nothing in the trace points to an action (a user stop, a healthy run).
 *
 * @param analysis The cause and sub-cause from {@link analyzeCause}.
 * @returns Short imperative sentences, most useful first.
 */
export function causeNextActions(analysis: Pick<CauseAnalysis, "cause" | "subCause">): readonly string[] {
  return CAUSE_ACTIONS[analysis.cause](analysis.subCause);
}
