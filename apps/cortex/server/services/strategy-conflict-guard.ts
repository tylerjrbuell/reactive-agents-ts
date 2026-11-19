/**
 * Refuse, up front, a Code Action run the framework would refuse mid-run.
 *
 * Code Action runs tools inside a sandbox, past the approval gate, so the framework refuses to start
 * it when the approval policy gates a tool the sandbox can call (`codeActionApprovalConflict` in
 * `@reactive-agents/runtime`, the one home of that rule). This module does not re-derive the rule:
 * it builds the predicate's two inputs the way the agent is BUILT and calls it.
 *
 *  - Policy: `effectiveApprovalPolicy` (an explicit policy, else the rule-less default unless
 *    `askBeforeRiskyTools: false`), with the tools the framework folds in for a policy of any kind:
 *    every registered tool flagged `requiresApproval` (`approvalRequiredToolNames`). Cortex sets no
 *    `requireFor` predicate.
 *  - Callable tools: the build's allow-list (`mergeCortexAllowedTools`, the same list `toolsDraft`
 *    sends as `tools.allowedTools`). A build with no tool layer calls nothing. Known gap: an MCP
 *    server attached with none of its tools named exposes tools this list cannot see, so an explicit
 *    policy naming one of those is left to the framework's own refusal.
 *
 * The result is what the UI renders (ui-core `strategyApprovalConflictOf` only words it), so the
 * 409 and the note never disagree with the framework. The policy is never dropped silently: each
 * resolution is a choice the person makes.
 */
import { codeActionApprovalConflict } from "@reactive-agents/runtime";
import { approvalGateOf, strategyApprovalConflictOf, type StrategyApprovalConflict } from "@reactive-agents/ui-core";
import { approvalPolicyOf, effectiveApprovalPolicy } from "./approval-policy.js";
import { mergeCortexAllowedTools, mergeCortexUiToolNames, type CortexMetaToolsConfig } from "./cortex-agent-config.js";
import { shellExecuteRequested } from "./cortex-to-agent-config.js";
import { approvalRequiredToolNames } from "./tool-catalog.js";

/** The only strategy the framework's approval-scope rule applies to. */
const CODE_ACTION = "code-action";

/** The 409 body the run and chat routes send. */
export interface StrategyConflictBody {
  readonly error: string;
  readonly code: "strategy-approval-conflict";
  readonly conflict: StrategyApprovalConflict;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const record = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
const nonEmpty = (v: unknown): boolean => Array.isArray(v) && v.length > 0;

/** Names of the sub-agent tools (`.withAgentTool`) a config attaches. The framework gates these under any approval policy. */
function agentToolNamesOf(raw: Readonly<Record<string, unknown>>): string[] {
  return (Array.isArray(raw.agentTools) ? raw.agentTools : []).flatMap((t) => {
    const name = record(t)?.toolName;
    return typeof name === "string" ? [name] : [];
  });
}

/**
 * The tool names the built agent's sandbox could call: the allow-list `toolsDraft` builds
 * (user pick, host shell, kernel tools, meta-tools, sub-agent tools). Empty when no tool layer is built.
 */
export function callableToolNamesOf(raw: Readonly<Record<string, unknown>>): string[] {
  const additional = typeof raw.additionalToolNames === "string" ? raw.additionalToolNames : undefined;
  const tools = strings(raw.tools);
  const shell = shellExecuteRequested({
    ...(raw.terminalTools === true ? { terminalTools: true } : {}),
    tools,
    ...(additional !== undefined ? { additionalToolNames: additional } : {}),
    ...(typeof raw.terminalShellAdditionalCommands === "string" ? { terminalShellAdditionalCommands: raw.terminalShellAdditionalCommands } : {}),
    ...(typeof raw.terminalShellAllowedCommands === "string" ? { terminalShellAllowedCommands: raw.terminalShellAllowedCommands } : {}),
  });
  const userTools = mergeCortexUiToolNames(tools, additional);
  if (shell && !userTools.includes("shell-execute")) userTools.push("shell-execute");
  const mt = record(raw.metaTools);
  const meta: CortexMetaToolsConfig | undefined = mt
    ? { enabled: mt.enabled === true, brief: mt.brief === true, find: mt.find === true, pulse: mt.pulse === true, recall: mt.recall === true, todo: mt.todo === true }
    : undefined;
  const dsa = record(raw.dynamicSubAgents);
  const agentToolNames = agentToolNamesOf(raw);
  const toolLayer = nonEmpty(raw.mcpServerIds) || nonEmpty(raw.mcpConfigs) || agentToolNames.length > 0 || dsa?.enabled === true || userTools.length > 0 || meta?.enabled === true;
  if (!toolLayer) return [];
  return mergeCortexAllowedTools(userTools, meta, { spawnAgent: dsa?.enabled === true, agentToolNames });
}

/** The conflict a config would hit, or `undefined`. `toolsEnabled: false` (a chat with tools off) builds no tool layer, so it never conflicts. */
export function approvalConflictOfConfig(
  raw: Readonly<Record<string, unknown>>,
  opts: { readonly toolsEnabled?: boolean } = {},
): StrategyApprovalConflict | undefined {
  if (opts.toolsEnabled === false) return undefined;
  if (typeof raw.strategy !== "string" || raw.strategy.trim() !== CODE_ACTION) return undefined;
  const effective = effectiveApprovalPolicy(raw);
  const verdict = codeActionApprovalConflict({
    callableTools: callableToolNamesOf(raw),
    policy: effective
      ? { tools: new Set([...(effective.tools ?? []), ...approvalRequiredToolNames(), ...agentToolNamesOf(raw)]), ...(effective.commands ? { commands: effective.commands } : {}) }
      : undefined,
  });
  return strategyApprovalConflictOf({
    strategy: CODE_ACTION,
    gate: approvalGateOf({ hasExplicitPolicy: approvalPolicyOf(raw) !== undefined, askBeforeRiskyTools: raw.askBeforeRiskyTools }),
    refuse: verdict.refuse,
    gatedCallable: verdict.gatedCallable,
    requireFor: verdict.requireFor,
  });
}

/** The 409 body for a config, or `undefined` when it can run. */
export function strategyConflictBodyOf(
  raw: Readonly<Record<string, unknown>>,
  opts: { readonly toolsEnabled?: boolean } = {},
): StrategyConflictBody | undefined {
  const conflict = approvalConflictOfConfig(raw, opts);
  return conflict ? { error: conflict.message, code: "strategy-approval-conflict", conflict } : undefined;
}
