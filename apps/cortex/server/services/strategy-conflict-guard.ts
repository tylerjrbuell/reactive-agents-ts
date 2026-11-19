/**
 * Refuse, up front, a strategy the approval gate cannot work with (ui-core `strategyApprovalConflictOf`).
 * Code Action runs tools inside a sandbox, past the approval gate, so the framework refuses to start it
 * while a policy gates any tool. Cortex builds every agent with a gate by default, so without this check
 * that refusal surfaces mid-run. The framework's refusal stays; this is the friendly early version, and
 * its resolutions are choices the person makes: the policy is never dropped silently.
 *
 * The gate is judged the way the agent is BUILT (`effectiveApprovalPolicy`): an explicit policy, else the
 * rule-less default unless `askBeforeRiskyTools: false`. A tools-off chat builds no gate, so no conflict.
 */
import { approvalGateOf, strategyApprovalConflictOf, type StrategyApprovalConflict } from "@reactive-agents/ui-core";
import { approvalPolicyOf } from "./approval-policy.js";

/** The 409 body the run and chat routes send. */
export interface StrategyConflictBody {
  readonly error: string;
  readonly code: "strategy-approval-conflict";
  readonly conflict: StrategyApprovalConflict;
}

/** The conflict a config would hit, or `undefined`. `toolsEnabled: false` (a chat with tools off) has no gate. */
export function approvalConflictOfConfig(
  raw: Readonly<Record<string, unknown>>,
  opts: { readonly toolsEnabled?: boolean } = {},
): StrategyApprovalConflict | undefined {
  if (opts.toolsEnabled === false) return undefined;
  const strategy = typeof raw.strategy === "string" ? raw.strategy : undefined;
  const gate = approvalGateOf({ hasExplicitPolicy: approvalPolicyOf(raw) !== undefined, askBeforeRiskyTools: raw.askBeforeRiskyTools });
  return strategyApprovalConflictOf({ strategy, gate });
}

/** The 409 body for a config, or `undefined` when it can run. */
export function strategyConflictBodyOf(
  raw: Readonly<Record<string, unknown>>,
  opts: { readonly toolsEnabled?: boolean } = {},
): StrategyConflictBody | undefined {
  const conflict = approvalConflictOfConfig(raw, opts);
  return conflict ? { error: conflict.message, code: "strategy-approval-conflict", conflict } : undefined;
}
