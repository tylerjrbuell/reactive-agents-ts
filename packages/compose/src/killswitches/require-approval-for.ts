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
      // Pending provider-parsed tool calls live at state.meta.pendingNativeToolCalls
      // (kernel-state.ts). The previous code read a non-existent
      // state.pendingToolCalls, so this safety gate silently approved every
      // call. Tests encoded the same wrong shape and false-passed.
      const pendingTools =
        (ctx.state as { meta?: { pendingNativeToolCalls?: ReadonlyArray<{ name?: string }> } })
          .meta?.pendingNativeToolCalls ?? [];
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
