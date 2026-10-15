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
      // Wave 6.3: read the NORMALIZED pending calls (native + text-extracted),
      // stashed by act.ts immediately before this hook runs. The previous code
      // read only `pendingNativeToolCalls`, which is empty on text-parse runs —
      // so this safety gate silently approved every call on non-native models
      // (the exact silent-approval class DEBT-REGISTER §3 tracks). Native-only
      // kept as fallback for producers that set just that field.
      const meta = (ctx.state as {
        meta?: {
          pendingToolCalls?: ReadonlyArray<{ name?: string }>;
          pendingNativeToolCalls?: ReadonlyArray<{ name?: string }>;
        };
      }).meta;
      const pendingTools = [...(meta?.pendingToolCalls ?? []), ...(meta?.pendingNativeToolCalls ?? [])];
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
