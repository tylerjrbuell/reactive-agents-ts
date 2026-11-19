// File: src/strategies/code-action/approval-scope.ts
//
// Which approval policies code-action must refuse (audit G6, 2026-11-18).
//
// code-action runs model-written code in a sandbox worker; that code calls
// tools through handlers bound before the code runs. A script cannot pause
// for a human between two tool calls, so code-action cannot honor a gate on
// any tool its sandbox can reach. It can honor a gate on a tool it cannot
// reach: the gate never has a call to stop.
import { isShellToolName } from "@reactive-agents/tools";
import type { ApprovalGateConfig } from "../../kernel/capabilities/decide/tool-gating.js";

/** Why code-action cannot run under an approval policy. */
export interface CodeActionApprovalConflict {
  /** True when code-action must refuse the run before any model call. */
  readonly refuse: boolean;
  /**
   * Callable tools the policy gates: named in `policy.tools`, or a shell tool
   * (`shell-execute`, `git-cli`, `gh-cli`) while `policy.commands` is
   * non-empty. Sorted, no duplicates. Empty when only `requireFor` refuses.
   */
  readonly gatedCallable: readonly string[];
  /** True when the refusal comes from a `requireFor` predicate. */
  readonly requireFor: boolean;
}

/**
 * Decide whether code-action must refuse an approval policy.
 *
 * Refuse when ANY of these holds:
 * - a callable tool is named in `policy.tools`;
 * - `policy.commands` is non-empty and a callable tool is a shell tool
 *   (command rules gate shell calls by their arguments, which a script picks
 *   at run time);
 * - `policy.requireFor` is set, whatever the callable set (a predicate can
 *   gate any call by its arguments or iteration, so it is never evaluated
 *   ahead of the script).
 *
 * Otherwise run: no policy, an empty policy, or a policy that gates only tools
 * the sandbox cannot call. The mode (`block` or `detach`) does not change the
 * answer: neither can stop a call inside the sandbox.
 *
 * `callableTools` must be the exact set the sandbox binds handlers for (in
 * code-action, the names of `availableToolSchemas`). The sandbox refuses a
 * call to any other name, so a tool outside this set is unreachable.
 *
 * Pure: no Effect, no IO.
 */
export function codeActionApprovalConflict(input: {
  readonly callableTools: readonly string[];
  readonly policy: ApprovalGateConfig | undefined;
}): CodeActionApprovalConflict {
  const { callableTools, policy } = input;
  if (policy === undefined) return { refuse: false, gatedCallable: [], requireFor: false };
  const commandRules = (policy.commands?.length ?? 0) > 0;
  const gated = new Set(
    callableTools.filter((name) => policy.tools.has(name) || (commandRules && isShellToolName(name))),
  );
  const gatedCallable = [...gated].sort();
  const requireFor = policy.requireFor !== undefined;
  return { refuse: requireFor || gatedCallable.length > 0, gatedCallable, requireFor };
}

/**
 * The refusal message for a conflict. Starts with
 * `code-action cannot honor .withApprovalPolicy(`, which UIs match on.
 */
export function codeActionApprovalRefusal(mode: string, conflict: CodeActionApprovalConflict): string {
  const reasons = [
    ...(conflict.gatedCallable.length > 0 ? [`it can call gated tool(s) ${conflict.gatedCallable.join(", ")}`] : []),
    ...(conflict.requireFor ? ["a requireFor predicate can gate any of its calls"] : []),
  ];
  return (
    `code-action cannot honor .withApprovalPolicy({ mode: "${mode}" }): ${reasons.join("; ")}, ` +
    `and its tool calls run inside the sandbox worker, past the approval gate. ` +
    `Use the reactive, reflexion, plan-execute-reflect or tree-of-thought strategy for gated tools.`
  );
}
