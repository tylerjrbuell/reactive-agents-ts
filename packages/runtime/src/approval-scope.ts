/**
 * approval-scope.ts — public re-export of the code-action approval rule, so
 * apps can warn before a run without depending on `@reactive-agents/reasoning`.
 *
 * The rule lives in reasoning (`strategies/code-action/approval-scope.ts`) and
 * is the same one the code-action strategy applies when it refuses a run. This
 * module adds no logic.
 */
import { codeActionApprovalConflict as reasoningCodeActionApprovalConflict } from "@reactive-agents/reasoning";
import type { CodeActionApprovalConflict } from "@reactive-agents/reasoning";

export type { CodeActionApprovalConflict };

/**
 * Input to {@link codeActionApprovalConflict}: `callableTools` is the exact set
 * of tool names the code-action sandbox binds; `policy` is the approval gate
 * (gated `tools` set, optional `requireFor`, optional shell `commands`), or
 * `undefined` for no policy.
 */
export type CodeActionApprovalConflictInput = Parameters<typeof reasoningCodeActionApprovalConflict>[0];

/**
 * Decide whether the code-action strategy must refuse an approval policy.
 *
 * Refuses when a callable tool is in `policy.tools`, when `policy.commands` is
 * non-empty and a callable tool is a shell tool, or when `policy.requireFor` is
 * set. Code-action runs tool calls inside a sandbox worker, past the approval
 * gate, so it cannot honor a gate on a tool it can reach. Pure, no IO.
 *
 * Note: an agent's live gated set also holds tools registered after build
 * (MCP tools that write, sub-agent tools). A static, config-only check cannot
 * see those; the strategy's own refusal at run start still does.
 *
 * @example
 * ```ts
 * import { codeActionApprovalConflict } from "reactive-agents";
 *
 * const verdict = codeActionApprovalConflict({
 *   callableTools: ["file-write", "web-search"],
 *   policy: { tools: new Set(["file-write"]) },
 * });
 * // verdict.refuse === true, verdict.gatedCallable === ["file-write"]
 * ```
 */
export const codeActionApprovalConflict = (input: CodeActionApprovalConflictInput): CodeActionApprovalConflict =>
  reasoningCodeActionApprovalConflict(input);
