import * as React from "react";

export interface ApprovalGateProps {
  readonly approval: { readonly runId: string; readonly gateId: string; readonly toolName: string; readonly args: unknown };
  readonly onDecide: (decision: "approve" | "deny", reason?: string) => void;
  readonly className?: string;
}

export function ApprovalGate({ approval, onDecide, className }: ApprovalGateProps): React.ReactElement {
  return (
    <div className={className} data-ra-approval data-ra-tool={approval.toolName}>
      <p data-ra-approval-text>
        Run tool call: <code>{approval.toolName}</code>?
      </p>
      <pre data-ra-approval-args>{JSON.stringify(approval.args, null, 2)}</pre>
      <button type="button" onClick={() => onDecide("approve")}>
        Approve
      </button>
      <button type="button" onClick={() => onDecide("deny", "denied by user")}>
        Deny
      </button>
    </div>
  );
}
