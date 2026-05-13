import type { Harness } from '@reactive-agents/core';

export interface RequireApprovalForOptions {
  tools: string[];
  // Synchronous check: returns true if approved, false if denied.
  // For async approvers, check externally before creating the killswitch.
  approver: (ctx: { toolName: string; iteration: number }) => boolean;
  onDeny?: 'stop' | 'terminate';
}

export function requireApprovalFor(options: RequireApprovalForOptions): (harness: Harness) => void {
  const { tools, approver, onDeny = 'stop' } = options;
  const toolSet = new Set(tools);
  return (harness: Harness) => {
    harness.before('act', (ctx) => {
      // ctx.state has pending tool calls — extract next tool name if available
      const pendingTools = (ctx.state as { pendingToolCalls?: Array<{ name?: string }> })
        .pendingToolCalls ?? [];
      for (const call of pendingTools) {
        if (call.name && toolSet.has(call.name)) {
          const approved = approver({ toolName: call.name, iteration: ctx.iteration });
          if (!approved) {
            return { abort: onDeny, reason: `require-approval-for:denied:${call.name}` };
          }
        }
      }
      return undefined;
    });
  };
}
