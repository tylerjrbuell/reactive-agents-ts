/**
 * The strategy / approval-gate conflict for a config the panel or the chat bar holds. The rule is
 * ui-core's (`strategyApprovalConflictOf`, also what the server's 409 uses); this reads the gate from
 * the config the way the server builds it, so the note appears before the run is refused.
 */
import { approvalGateOf, strategyApprovalConflictOf, type StrategyApprovalConflict } from "@reactive-agents/ui-core";
import { approvalPolicyBody, approvalPolicyFrom } from "../approval-policy.js";

/**
 * The conflict `cfg` would hit, or `undefined`. `toolsEnabled: false` (a chat with tools off) builds no
 * gate, so it never conflicts; leave it out for a desk or Lab run, which always builds one.
 */
export function strategyConflictOfConfig(
  cfg: Readonly<Record<string, unknown>>,
  opts: { readonly toolsEnabled?: boolean } = {},
): StrategyApprovalConflict | undefined {
  if (opts.toolsEnabled === false) return undefined;
  const strategy = typeof cfg.strategy === "string" ? cfg.strategy : undefined;
  const explicit = approvalPolicyBody(approvalPolicyFrom(cfg)) !== undefined;
  return strategyApprovalConflictOf({ strategy, gate: approvalGateOf({ hasExplicitPolicy: explicit, askBeforeRiskyTools: cfg.askBeforeRiskyTools }) });
}
